import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  AttemptContract,
  AttemptStatus,
  AuditEventContract,
  PolicyContract,
  SpendSummaryContract,
} from "../core/contracts.js";

interface AttemptRow {
  id: string;
  service_id: string;
  service_name: string;
  merchant_id: string;
  resource_url: string;
  amount_tinybar: string;
  currency: "HBAR";
  status: AttemptStatus;
  policy_outcome: "approved" | "pending_approval" | "rejected" | null;
  policy_reasons: string;
  challenge_hash: string | null;
  payment_required_header: string | null;
  reservation_expires_at: string | null;
  transaction_id: string | null;
  hashscan_url: string | null;
  response_preview: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface AuditRow {
  id: number;
  attempt_id: string;
  type: string;
  from_status: AttemptStatus | null;
  to_status: AttemptStatus;
  metadata: string;
  created_at: string;
}

export interface CreateAttemptInput {
  id: string;
  serviceId: string;
  serviceName: string;
  merchantId: string;
  resourceUrl: string;
  amountTinybar: string;
  status?: AttemptStatus;
  challengeHash?: string | null;
  paymentRequiredHeader?: string | null;
}

export interface AttemptUpdate {
  policyOutcome?: "approved" | "pending_approval" | "rejected" | null;
  policyReasons?: string[];
  reservationExpiresAt?: string | null;
  transactionId?: string | null;
  hashscanUrl?: string | null;
  responsePreview?: unknown | null;
  error?: string | null;
}

const utcDayBounds = (now = new Date()): { day: string; start: string; end: string } => {
  const day = now.toISOString().slice(0, 10);
  return {
    day,
    start: `${day}T00:00:00.000Z`,
    end: `${day}T23:59:59.999Z`,
  };
};

const safeJsonParse = <T>(value: string | null, fallback: T): T => {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toAttempt = (row: AttemptRow): AttemptContract => ({
  id: row.id,
  serviceId: row.service_id,
  serviceName: row.service_name,
  merchantId: row.merchant_id,
  resourceUrl: row.resource_url,
  amountTinybar: row.amount_tinybar,
  currency: row.currency,
  status: row.status,
  policyOutcome: row.policy_outcome,
  policyReasons: safeJsonParse<string[]>(row.policy_reasons, []),
  challengeHash: row.challenge_hash,
  reservationExpiresAt: row.reservation_expires_at,
  transactionId: row.transaction_id,
  hashscanUrl: row.hashscan_url,
  responsePreview: safeJsonParse<unknown | null>(row.response_preview, null),
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAuditEvent = (row: AuditRow): AuditEventContract => ({
  id: row.id,
  attemptId: row.attempt_id,
  type: row.type,
  fromStatus: row.from_status,
  toStatus: row.to_status,
  metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
  createdAt: row.created_at,
});

export class SqliteStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        service_id TEXT NOT NULL,
        service_name TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        amount_tinybar TEXT NOT NULL,
        currency TEXT NOT NULL CHECK (currency = 'HBAR'),
        status TEXT NOT NULL,
        policy_outcome TEXT,
        policy_reasons TEXT NOT NULL DEFAULT '[]',
        challenge_hash TEXT,
        payment_required_header TEXT,
        reservation_expires_at TEXT,
        transaction_id TEXT,
        hashscan_url TEXT,
        response_preview TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),
        amount_tinybar TEXT NOT NULL,
        utc_day TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'released', 'consumed', 'expired')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id TEXT NOT NULL REFERENCES attempts(id),
        type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS receipts (
        attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
        challenge_hash TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        receipt_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_attempts_created_at ON attempts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reservations_day_status ON reservations(utc_day, status);
      CREATE INDEX IF NOT EXISTS idx_audit_attempt_id ON audit_events(attempt_id, id);

      CREATE TRIGGER IF NOT EXISTS audit_events_no_update
      BEFORE UPDATE ON audit_events BEGIN
        SELECT RAISE(ABORT, 'audit_events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
      BEFORE DELETE ON audit_events BEGIN
        SELECT RAISE(ABORT, 'audit_events are append-only');
      END;
    `);
  }

  reset(): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM receipts").run();
      this.db.prepare("DELETE FROM reservations").run();
      // Reset is an explicit demo-only administrative operation. Temporarily drop
      // append-only triggers so a fresh deterministic scenario can be seeded.
      this.db.exec("DROP TRIGGER audit_events_no_delete");
      this.db.prepare("DELETE FROM audit_events").run();
      this.db.prepare("DELETE FROM attempts").run();
      this.db.exec(`
        CREATE TRIGGER audit_events_no_delete
        BEFORE DELETE ON audit_events BEGIN
          SELECT RAISE(ABORT, 'audit_events are append-only');
        END;
      `);
    })();
  }

  createAttempt(input: CreateAttemptInput): AttemptContract {
    const now = new Date().toISOString();
    const status = input.status ?? "challenged";
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO attempts (
          id, service_id, service_name, merchant_id, resource_url,
          amount_tinybar, currency, status, challenge_hash,
          payment_required_header, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'HBAR', ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.serviceId,
        input.serviceName,
        input.merchantId,
        input.resourceUrl,
        input.amountTinybar,
        status,
        input.challengeHash ?? null,
        input.paymentRequiredHeader ?? null,
        now,
        now,
      );
      this.insertAudit(input.id, "attempt_created", null, status, {}, now);
    })();
    return this.requireAttempt(input.id);
  }

  transition(
    attemptId: string,
    toStatus: AttemptStatus,
    update: AttemptUpdate = {},
    eventType = "status_changed",
    metadata: Record<string, unknown> = {},
  ): AttemptContract {
    return this.db.transaction(() => {
      const current = this.requireAttempt(attemptId);
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE attempts SET
          status = ?,
          policy_outcome = COALESCE(?, policy_outcome),
          policy_reasons = COALESCE(?, policy_reasons),
          reservation_expires_at = CASE WHEN ? = 1 THEN ? ELSE reservation_expires_at END,
          transaction_id = COALESCE(?, transaction_id),
          hashscan_url = COALESCE(?, hashscan_url),
          response_preview = CASE WHEN ? = 1 THEN ? ELSE response_preview END,
          error = CASE WHEN ? = 1 THEN ? ELSE error END,
          updated_at = ?
        WHERE id = ?
      `).run(
        toStatus,
        update.policyOutcome === undefined ? null : update.policyOutcome,
        update.policyReasons === undefined ? null : JSON.stringify(update.policyReasons),
        update.reservationExpiresAt === undefined ? 0 : 1,
        update.reservationExpiresAt ?? null,
        update.transactionId ?? null,
        update.hashscanUrl ?? null,
        update.responsePreview === undefined ? 0 : 1,
        update.responsePreview === undefined ? null : JSON.stringify(update.responsePreview),
        update.error === undefined ? 0 : 1,
        update.error ?? null,
        now,
        attemptId,
      );
      this.insertAudit(attemptId, eventType, current.status, toStatus, metadata, now);
      return this.requireAttempt(attemptId);
    })();
  }

  getAttempt(id: string): AttemptContract | null {
    const row = this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as AttemptRow | undefined;
    return row ? toAttempt(row) : null;
  }

  requireAttempt(id: string): AttemptContract {
    const attempt = this.getAttempt(id);
    if (!attempt) throw new Error(`Attempt ${id} not found`);
    return attempt;
  }

  listAttempts(): AttemptContract[] {
    return (this.db.prepare("SELECT * FROM attempts ORDER BY created_at DESC").all() as AttemptRow[]).map(toAttempt);
  }

  getEvents(attemptId: string): AuditEventContract[] {
    return (
      this.db.prepare("SELECT * FROM audit_events WHERE attempt_id = ? ORDER BY id ASC").all(attemptId) as AuditRow[]
    ).map(toAuditEvent);
  }

  getPaymentRequiredHeader(attemptId: string): string | null {
    const row = this.db.prepare("SELECT payment_required_header FROM attempts WHERE id = ?").get(attemptId) as
      | { payment_required_header: string | null }
      | undefined;
    return row?.payment_required_header ?? null;
  }

  getSpendSummary(policy: PolicyContract, now = new Date()): SpendSummaryContract {
    this.expireReservations(now);
    const bounds = utcDayBounds(now);
    const settledRows = this.db.prepare(`
      SELECT amount_tinybar FROM attempts
      WHERE transaction_id IS NOT NULL AND created_at BETWEEN ? AND ?
    `).all(bounds.start, bounds.end) as Array<{ amount_tinybar: string }>;
    const reservedRows = this.db.prepare(`
      SELECT amount_tinybar FROM reservations WHERE utc_day = ? AND status = 'active'
    `).all(bounds.day) as Array<{ amount_tinybar: string }>;
    const settled = settledRows.reduce((sum, row) => sum + BigInt(row.amount_tinybar), 0n);
    const reserved = reservedRows.reduce((sum, row) => sum + BigInt(row.amount_tinybar), 0n);
    const limit = BigInt(policy.dailyLimitTinybar);
    return {
      utcDay: bounds.day,
      settledTinybar: settled.toString(),
      reservedTinybar: reserved.toString(),
      remainingTinybar: (limit > settled + reserved ? limit - settled - reserved : 0n).toString(),
    };
  }

  reserveIfWithinBudget(
    attemptId: string,
    amountTinybar: string,
    dailyLimitTinybar: string,
    ttlSeconds: number,
    now = new Date(),
  ): { reserved: boolean; expiresAt: string | null } {
    return this.db.transaction(() => {
      this.expireReservations(now);
      const bounds = utcDayBounds(now);
      const existing = this.db.prepare("SELECT status, expires_at FROM reservations WHERE attempt_id = ?").get(attemptId) as
        | { status: string; expires_at: string }
        | undefined;
      if (existing?.status === "active") return { reserved: true, expiresAt: existing.expires_at };

      const settledRows = this.db.prepare(`
        SELECT amount_tinybar FROM attempts
        WHERE transaction_id IS NOT NULL AND created_at BETWEEN ? AND ?
      `).all(bounds.start, bounds.end) as Array<{ amount_tinybar: string }>;
      const reservedRows = this.db.prepare(`
        SELECT amount_tinybar FROM reservations WHERE utc_day = ? AND status = 'active'
      `).all(bounds.day) as Array<{ amount_tinybar: string }>;
      const used = [...settledRows, ...reservedRows].reduce((sum, row) => sum + BigInt(row.amount_tinybar), 0n);
      if (used + BigInt(amountTinybar) > BigInt(dailyLimitTinybar)) {
        return { reserved: false, expiresAt: null };
      }

      const timestamp = now.toISOString();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
      this.db.prepare(`
        INSERT INTO reservations (id, attempt_id, amount_tinybar, utc_day, status, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
        ON CONFLICT(attempt_id) DO UPDATE SET
          amount_tinybar = excluded.amount_tinybar,
          utc_day = excluded.utc_day,
          status = 'active',
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `).run(crypto.randomUUID(), attemptId, amountTinybar, bounds.day, expiresAt, timestamp, timestamp);
      return { reserved: true, expiresAt };
    })();
  }

  hasActiveReservation(attemptId: string, now = new Date()): boolean {
    this.expireReservations(now);
    const row = this.db.prepare("SELECT 1 FROM reservations WHERE attempt_id = ? AND status = 'active'").get(attemptId);
    return Boolean(row);
  }

  releaseReservation(attemptId: string, status: "released" | "expired" = "released"): void {
    this.db.prepare(`
      UPDATE reservations SET status = ?, updated_at = ? WHERE attempt_id = ? AND status = 'active'
    `).run(status, new Date().toISOString(), attemptId);
  }

  consumeReservation(attemptId: string): void {
    this.db.prepare(`
      UPDATE reservations SET status = 'consumed', updated_at = ? WHERE attempt_id = ? AND status = 'active'
    `).run(new Date().toISOString(), attemptId);
  }

  saveReceipt(
    attemptId: string,
    challengeHash: string,
    transactionId: string,
    receipt: Record<string, unknown>,
    receiptHash: string,
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO receipts
        (attempt_id, challenge_hash, transaction_id, receipt_json, receipt_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(attemptId, challengeHash, transactionId, JSON.stringify(receipt), receiptHash, new Date().toISOString());
  }

  private expireReservations(now: Date): void {
    this.db.prepare(`
      UPDATE reservations SET status = 'expired', updated_at = ?
      WHERE status = 'active' AND expires_at <= ?
    `).run(now.toISOString(), now.toISOString());
  }

  private insertAudit(
    attemptId: string,
    type: string,
    fromStatus: AttemptStatus | null,
    toStatus: AttemptStatus,
    metadata: Record<string, unknown>,
    createdAt: string,
  ): void {
    this.db.prepare(`
      INSERT INTO audit_events (attempt_id, type, from_status, to_status, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(attemptId, type, fromStatus, toStatus, JSON.stringify(metadata), createdAt);
  }
}
