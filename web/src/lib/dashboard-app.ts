import { api, ApiError } from "./api";
import { getApiBaseUrl, POLL_INTERVAL_MS } from "./config";
import { createFixtureStore, type FixtureStore } from "../data/fixtures";
import { site } from "../data/site";
import {
  formatHbar,
  formatPolicyOutcome,
  formatStatusLabel,
  formatTime,
  truncateMiddle,
} from "./format";
import type {
  AttemptContract,
  AttemptResponseContract,
  AuditEventContract,
  PolicyResponseContract,
  ServiceId,
} from "./types";

type Mode = "live" | "fixture" | "loading" | "unavailable";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function statusTone(status: string): string {
  switch (status) {
    case "rejected":
    case "denied":
      return "chip chip--danger";
    case "pending_approval":
      return "chip chip--amber";
    case "authorized":
    case "signing":
    case "submitted":
    case "settled":
      return "chip chip--info";
    case "fulfilled":
      return "chip chip--success";
    case "settlement_failed":
      return "chip chip--danger";
    default:
      return "chip chip--muted";
  }
}

function outcomeTone(outcome: string | null): string {
  if (outcome === "rejected") return "chip chip--danger";
  if (outcome === "pending_approval") return "chip chip--amber";
  if (outcome === "approved") return "chip chip--success";
  return "chip chip--muted";
}

function serviceMark(serviceId: string): string {
  if (serviceId === "risk-report") return "RR";
  if (serviceId === "market-brief") return "MB";
  return "UP";
}

function spendParts(spend: PolicyResponseContract["spend"]) {
  const settled = BigInt(spend.settledTinybar);
  const reserved = BigInt(spend.reservedTinybar);
  const remaining = BigInt(spend.remainingTinybar);
  const total = settled + reserved + remaining;
  const pct = (n: bigint) =>
    total === 0n ? 0 : Number((n * 10000n) / total) / 100;
  return {
    settledPct: pct(settled),
    reservedPct: pct(reserved),
    remainingPct: pct(remaining),
  };
}

export function mountDashboard() {
  const root = document.getElementById("dashboard-root");
  if (!root) return;
  const dashboardRoot = root;

  let mode: Mode = "loading";
  let policyData: PolicyResponseContract | null = null;
  let attempts: AttemptContract[] = [];
  let selectedId: string | null = null;
  let detail: AttemptResponseContract | null = null;
  let busy = false;
  let pollTimer: number | null = null;
  let fixture: FixtureStore | null = null;
  let facilitatorOk: boolean | null = null;

  const els = {
    modeBadge: $("mode-badge"),
    facilitatorDot: $("facilitator-dot"),
    facilitatorLabel: $("facilitator-label"),
    apiBase: $("api-base-label"),
    liveRegion: $("live-region"),
    actionError: $("action-error"),
    policyGrid: $("policy-grid"),
    spendMeter: $("spend-meter"),
    spendLegend: $("spend-legend"),
    attemptsBody: $("attempts-body"),
    attemptsEmpty: $("attempts-empty"),
    attemptsLoading: $("attempts-loading"),
    detailPanel: $("detail-panel"),
    detailEmpty: $("detail-empty"),
    detailContent: $("detail-content"),
    prompt: $("agent-prompt") as HTMLTextAreaElement,
    service: $("agent-service") as HTMLSelectElement,
    paramLabel: $("param-label"),
    paramInput: $("agent-param") as HTMLInputElement,
    runBtn: $("run-agent") as HTMLButtonElement,
    resetBtn: $("reset-demo") as HTMLButtonElement,
    approveBtn: $("approve-attempt") as HTMLButtonElement,
    denyBtn: $("deny-attempt") as HTMLButtonElement,
  };

  const navItems = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(".app-nav__item[href^='#']"),
  );
  let navFrame: number | null = null;

  function setActiveNav(sectionId: string) {
    for (const item of navItems) {
      const active = item.hash === `#${sectionId}`;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
  }

  function syncActiveNav() {
    const targets = navItems
      .map((item) => document.getElementById(item.hash.slice(1)))
      .filter((section): section is HTMLElement => section != null)
      .sort((a, b) => a.offsetTop - b.offsetTop);
    if (!targets.length) return;

    const probe = window.scrollY + Math.min(240, window.innerHeight * 0.3);
    let current = targets[0].id;
    for (const section of targets) {
      if (section.offsetTop <= probe) current = section.id;
    }
    setActiveNav(current);
  }

  navItems.forEach((item) => {
    item.addEventListener("click", () => setActiveNav(item.hash.slice(1)));
  });

  window.addEventListener(
    "scroll",
    () => {
      if (navFrame != null) return;
      navFrame = window.requestAnimationFrame(() => {
        navFrame = null;
        syncActiveNav();
      });
    },
    { passive: true },
  );
  window.addEventListener("hashchange", () => {
    const id = window.location.hash.slice(1);
    if (id) setActiveNav(id);
  });

  function announce(msg: string) {
    els.liveRegion.textContent = msg;
  }

  function setActionError(msg: string | null) {
    if (msg) {
      els.actionError.hidden = false;
      els.actionError.textContent = msg;
    } else {
      els.actionError.hidden = true;
      els.actionError.textContent = "";
    }
  }

  function renderMode() {
    els.apiBase.textContent = getApiBaseUrl();
    els.modeBadge.className = "badge";
    if (mode === "fixture") {
      els.modeBadge.hidden = false;
      els.modeBadge.textContent = "Fixture mode";
      els.modeBadge.classList.add("badge--amber");
      els.modeBadge.title =
        "Backend unreachable. Showing local demo data — not live chain activity.";
    } else if (mode === "live") {
      els.modeBadge.hidden = false;
      els.modeBadge.textContent = "Live API";
      els.modeBadge.classList.add("badge--success");
      els.modeBadge.title = "Connected to Sophron API";
    } else if (mode === "unavailable") {
      els.modeBadge.hidden = false;
      els.modeBadge.textContent = "Backend unavailable";
      els.modeBadge.classList.add("badge--danger");
    } else {
      els.modeBadge.hidden = false;
      els.modeBadge.textContent = "Connecting…";
      els.modeBadge.classList.add("badge--muted");
    }

    if (facilitatorOk === true) {
      els.facilitatorDot.className = "status-dot status-dot--ok";
      els.facilitatorLabel.textContent = "Facilitator ready";
    } else if (facilitatorOk === false) {
      els.facilitatorDot.className = "status-dot status-dot--warn";
      els.facilitatorLabel.textContent =
        mode === "fixture" ? "Facilitator offline (fixture)" : "Facilitator unknown";
    } else {
      els.facilitatorDot.className = "status-dot";
      els.facilitatorLabel.textContent =
        mode === "live" ? "Facilitator unverified" : "Facilitator…";
    }
  }

  function renderPolicy() {
    if (!policyData) {
      els.policyGrid.innerHTML = `<p class="muted">Loading policy…</p>`;
      els.spendMeter.innerHTML = "";
      els.spendLegend.innerHTML = "";
      return;
    }
    const { policy, spend } = policyData;
    const ttlMin = Math.round(policy.reservationTtlSeconds / 60);
    els.policyGrid.innerHTML = `
      <div class="stat">
        <span class="stat__label">Per-request max</span>
        <span class="stat__value mono">${formatHbar(policy.maxPerRequestTinybar)}</span>
      </div>
      <div class="stat">
        <span class="stat__label">Daily limit (UTC)</span>
        <span class="stat__value mono">${formatHbar(policy.dailyLimitTinybar)}</span>
      </div>
      <div class="stat">
        <span class="stat__label">Approval above</span>
        <span class="stat__value mono">${formatHbar(policy.approvalAboveTinybar)}</span>
      </div>
      <div class="stat">
        <span class="stat__label">Allowlisted merchants</span>
        <span class="stat__value">${policy.allowedMerchants.length}</span>
      </div>
      <div class="stat">
        <span class="stat__label">Reservation TTL</span>
        <span class="stat__value">${ttlMin} min</span>
      </div>
      <div class="stat">
        <span class="stat__label">UTC day</span>
        <span class="stat__value mono">${spend.utcDay}</span>
      </div>
    `;

    const parts = spendParts(spend);
    els.spendMeter.innerHTML = `
      <div class="spend-summary">
        <div class="spend-summary__primary">
          <span>Available to agents</span>
          <strong class="mono">${formatHbar(spend.remainingTinybar)}</strong>
        </div>
        <div class="spend-summary__limit">
          <span>Daily ceiling</span>
          <strong class="mono">${formatHbar(policy.dailyLimitTinybar)}</strong>
        </div>
      </div>
      <div class="meter" role="img" aria-label="UTC-day spend: settled ${formatHbar(spend.settledTinybar)}, reserved ${formatHbar(spend.reservedTinybar)}, remaining ${formatHbar(spend.remainingTinybar)}">
        <span class="meter__seg meter__seg--settled" style="width:${parts.settledPct}%"></span>
        <span class="meter__seg meter__seg--reserved" style="width:${parts.reservedPct}%"></span>
        <span class="meter__seg meter__seg--remaining" style="width:${parts.remainingPct}%"></span>
      </div>
    `;
    els.spendLegend.innerHTML = `
      <li><span class="swatch swatch--settled"></span> Settled <strong class="mono">${formatHbar(spend.settledTinybar)}</strong></li>
      <li><span class="swatch swatch--reserved"></span> Reserved <strong class="mono">${formatHbar(spend.reservedTinybar)}</strong></li>
      <li><span class="swatch swatch--remaining"></span> Remaining <strong class="mono">${formatHbar(spend.remainingTinybar)}</strong></li>
    `;
  }

  function renderAttempts() {
    els.attemptsLoading.hidden = mode !== "loading";
    if (mode === "loading") {
      els.attemptsBody.innerHTML = "";
      els.attemptsEmpty.hidden = true;
      return;
    }

    if (attempts.length === 0) {
      els.attemptsBody.innerHTML = "";
      els.attemptsEmpty.hidden = false;
      return;
    }
    els.attemptsEmpty.hidden = true;

    els.attemptsBody.innerHTML = attempts
      .map((a) => {
        const selected = a.id === selectedId ? " is-selected" : "";
        const tx =
          a.hashscanUrl && a.transactionId
            ? `<a class="link mono" href="${escapeAttr(a.hashscanUrl)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${escapeHtml(truncateMiddle(a.transactionId, 10, 8))}</a>`
            : a.status === "settlement_failed"
              ? `<span class="muted">failed</span>`
              : `<span class="muted">—</span>`;
        return `
          <tr class="attempt-row${selected}" data-id="${a.id}" tabindex="0" role="button" aria-selected="${a.id === selectedId}">
            <td>
              <div class="service-cell">
                <span class="service-mark" aria-hidden="true">${serviceMark(a.serviceId)}</span>
                <span>
                  <span class="cell-primary">${escapeHtml(a.serviceName)}</span>
                  <span class="cell-sub mono">${escapeHtml(a.merchantId)}</span>
                </span>
              </div>
            </td>
            <td class="mono">${formatHbar(a.amountTinybar)}</td>
            <td><span class="${outcomeTone(a.policyOutcome)}">${formatPolicyOutcome(a.policyOutcome)}</span></td>
            <td><span class="${statusTone(a.status)}">${formatStatusLabel(a.status)}</span></td>
            <td class="muted">${formatTime(a.createdAt)}</td>
            <td>${tx}</td>
          </tr>
        `;
      })
      .join("");

    els.attemptsBody.querySelectorAll<HTMLElement>(".attempt-row").forEach((row) => {
      const id = row.dataset.id!;
      row.addEventListener("click", () => selectAttempt(id));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectAttempt(id);
        }
      });
    });
  }

  function renderDetail() {
    if (!selectedId || !detail) {
      els.detailEmpty.hidden = false;
      els.detailContent.hidden = true;
      els.approveBtn.hidden = true;
      els.denyBtn.hidden = true;
      return;
    }
    els.detailEmpty.hidden = true;
    els.detailContent.hidden = false;

    const a = detail.attempt;
    const pending = a.status === "pending_approval";
    els.approveBtn.hidden = !pending;
    els.denyBtn.hidden = !pending;
    els.approveBtn.disabled = busy;
    els.denyBtn.disabled = busy;

    const reasons =
      a.policyReasons.length > 0
        ? `<ul class="reason-list">${a.policyReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
        : `<p class="muted">No policy reasons recorded.</p>`;

    const hash = a.challengeHash
      ? `<div class="copy-row">
          <code class="mono break">${escapeHtml(a.challengeHash)}</code>
          <button type="button" class="btn btn--ghost btn--sm" data-copy="${escapeAttr(a.challengeHash)}" aria-label="Copy challenge hash">Copy</button>
        </div>`
      : `<p class="muted">—</p>`;

    const tx = a.transactionId
      ? `<div class="copy-row">
          <code class="mono break">${escapeHtml(a.transactionId)}</code>
          <button type="button" class="btn btn--ghost btn--sm" data-copy="${escapeAttr(a.transactionId)}" aria-label="Copy transaction id">Copy</button>
        </div>
        ${
          a.hashscanUrl
            ? `<p class="mt-2"><a class="link" href="${escapeAttr(a.hashscanUrl)}" target="_blank" rel="noreferrer">Open on HashScan ↗</a></p>`
            : ""
        }`
      : `<p class="muted">No on-chain transaction yet.</p>`;

    const preview =
      a.responsePreview != null
        ? `<pre class="code-block">${escapeHtml(JSON.stringify(a.responsePreview, null, 2))}</pre>`
        : `<p class="muted">No protected response yet.</p>`;

    const err = a.error
      ? `<div class="alert alert--danger" role="alert">${escapeHtml(a.error)}</div>`
      : "";

    const timeline = renderTimeline(detail.events);

    els.detailContent.innerHTML = `
      <header class="detail-head">
        <div>
          <h3 class="detail-title">${escapeHtml(a.serviceName)}</h3>
          <p class="detail-id mono">${escapeHtml(a.id)}</p>
        </div>
        <div class="detail-chips">
          <span class="${outcomeTone(a.policyOutcome)}">${formatPolicyOutcome(a.policyOutcome)}</span>
          <span class="${statusTone(a.status)}">${formatStatusLabel(a.status)}</span>
        </div>
      </header>
      ${err}
      <div class="decision-summary">
        <div class="decision-summary__item">
          <span>Merchant</span>
          <strong class="mono">${escapeHtml(a.merchantId)}</strong>
        </div>
        <div class="decision-summary__item">
          <span>Amount</span>
          <strong class="mono">${formatHbar(a.amountTinybar)}</strong>
        </div>
        <div class="decision-summary__item">
          <span>Current state</span>
          <strong>${formatStatusLabel(a.status)}</strong>
        </div>
      </div>
      <dl class="meta-grid">
        <div><dt>Service</dt><dd class="mono">${escapeHtml(a.serviceId)}</dd></div>
        <div><dt>Reservation expires</dt><dd class="mono">${a.reservationExpiresAt ? formatTime(a.reservationExpiresAt) : "—"}</dd></div>
        <div class="meta-grid__full"><dt>Resource</dt><dd class="mono break">${escapeHtml(a.resourceUrl)}</dd></div>
      </dl>
      <section class="detail-section">
        <h4>Policy reasons</h4>
        ${reasons}
      </section>
      <section class="detail-section">
        <h4>Challenge hash</h4>
        ${hash}
      </section>
      <section class="detail-section">
        <h4>Transaction</h4>
        ${tx}
      </section>
      <section class="detail-section">
        <h4>Protected response</h4>
        ${preview}
      </section>
      <section class="detail-section">
        <h4>Audit timeline</h4>
        ${timeline}
      </section>
    `;

    els.detailContent.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const value = btn.dataset.copy ?? "";
        try {
          await navigator.clipboard.writeText(value);
          announce("Copied to clipboard");
          const prev = btn.textContent;
          btn.textContent = "Copied";
          window.setTimeout(() => {
            btn.textContent = prev;
          }, 1200);
        } catch {
          announce("Copy failed");
        }
      });
    });
  }

  function renderTimeline(events: AuditEventContract[]): string {
    if (!events.length) return `<p class="muted">No audit events.</p>`;
    const sorted = [...events].sort((a, b) => a.id - b.id);
    return `
      <ol class="timeline">
        ${sorted
          .map(
            (e) => `
          <li class="timeline__item">
            <div class="timeline__time mono">${formatTime(e.createdAt)}</div>
            <div class="timeline__body">
              <strong>${escapeHtml(e.type)}</strong>
              <span class="muted">
                ${e.fromStatus ? `${formatStatusLabel(e.fromStatus)} → ` : ""}${formatStatusLabel(e.toStatus)}
              </span>
            </div>
          </li>`,
          )
          .join("")}
      </ol>
    `;
  }

  function paint() {
    dashboardRoot.classList.toggle("is-busy", busy);
    dashboardRoot.setAttribute("aria-busy", String(busy));
    renderMode();
    renderPolicy();
    renderAttempts();
    renderDetail();
    els.runBtn.disabled = busy;
    els.resetBtn.disabled = busy;
  }

  async function selectAttempt(id: string) {
    selectedId = id;
    try {
      if (mode === "fixture" && fixture) {
        detail = fixture.getDetail(id);
      } else {
        detail = await api.getAttempt(id);
      }
    } catch (err) {
      detail = null;
      setActionError(err instanceof Error ? err.message : "Failed to load attempt");
    }
    paint();
  }

  async function refreshList(opts?: { silent?: boolean }) {
    try {
      if (mode === "fixture" && fixture) {
        policyData = fixture.getPolicy();
        attempts = fixture.getAttempts();
        if (selectedId) detail = fixture.getDetail(selectedId);
        facilitatorOk = false;
        paint();
        return;
      }

      const [policy, list] = await Promise.all([api.getPolicy(), api.getAttempts()]);
      policyData = policy;
      attempts = [...list.attempts].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      mode = "live";
      // A responsive control API does not prove that its external facilitator is healthy.
      facilitatorOk = null;
      if (selectedId) {
        try {
          detail = await api.getAttempt(selectedId);
        } catch {
          /* keep previous detail */
        }
      }
      if (!opts?.silent) setActionError(null);
      paint();
    } catch (err) {
      if (mode === "live") {
        // transient poll failure — keep last data
        facilitatorOk = false;
        if (!opts?.silent) {
          setActionError(err instanceof Error ? err.message : "Refresh failed");
        }
        paint();
        return;
      }
      enterFixtureMode();
    }
  }

  function enterFixtureMode() {
    fixture = createFixtureStore();
    mode = "fixture";
    facilitatorOk = false;
    policyData = fixture.getPolicy();
    attempts = fixture.getAttempts();
    selectedId = attempts[0]?.id ?? null;
    detail = selectedId ? fixture.getDetail(selectedId) : null;
    setActionError(null);
    announce("Fixture mode: backend unavailable. Demo data loaded.");
    paint();
  }

  async function bootstrap() {
    mode = "loading";
    paint();
    try {
      const [policy, list] = await Promise.all([api.getPolicy(), api.getAttempts()]);
      policyData = policy;
      attempts = [...list.attempts].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      mode = "live";
      facilitatorOk = null;
      selectedId = attempts[0]?.id ?? null;
      if (selectedId) detail = await api.getAttempt(selectedId);
      paint();
      startPoll();
    } catch {
      enterFixtureMode();
      // still poll in case backend comes up
      startPoll();
    }
  }

  function startPoll() {
    if (pollTimer != null) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => {
      if (busy) return;
      if (mode === "fixture") {
        // Try to reconnect to live API occasionally
        void tryReconnect();
        return;
      }
      void refreshList({ silent: true });
    }, POLL_INTERVAL_MS);
  }

  async function tryReconnect() {
    try {
      await api.getPolicy();
      mode = "live";
      fixture = null;
      announce("Reconnected to live API");
      await refreshList();
    } catch {
      /* stay in fixture */
    }
  }

  function syncServiceParams() {
    const id = els.service.value as ServiceId;
    const svc = site.services.find((s) => s.id === id) ?? site.services[0];
    els.paramLabel.textContent = svc.paramLabel;
    els.paramInput.placeholder = svc.paramPlaceholder;
    els.paramInput.name = svc.paramKey;
    if (!els.prompt.value.trim() || els.prompt.dataset.autofill === "1") {
      els.prompt.value = svc.demoPrompt;
      els.prompt.dataset.autofill = "1";
    }
  }

  // Event bindings
  els.service.addEventListener("change", () => {
    els.prompt.dataset.autofill = "1";
    syncServiceParams();
  });
  els.prompt.addEventListener("input", () => {
    els.prompt.dataset.autofill = "0";
  });

  document.querySelectorAll<HTMLButtonElement>("[data-demo-prompt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const serviceId = btn.dataset.demoPrompt as ServiceId;
      els.service.value = serviceId;
      els.prompt.dataset.autofill = "1";
      syncServiceParams();
      const svc = site.services.find((s) => s.id === serviceId)!;
      els.prompt.value = svc.demoPrompt;
      if (svc.paramPlaceholder) els.paramInput.value = svc.paramPlaceholder;
      announce(`Loaded demo prompt for ${svc.label}`);
    });
  });

  els.runBtn.addEventListener("click", async () => {
    setActionError(null);
    busy = true;
    paint();
    const serviceId = els.service.value as ServiceId;
    const svc = site.services.find((s) => s.id === serviceId)!;
    const params: Record<string, string> = {};
    if (els.paramInput.value.trim()) {
      params[svc.paramKey] = els.paramInput.value.trim();
    }
    const body = {
      prompt: els.prompt.value.trim() || svc.demoPrompt,
      serviceId,
      params,
    };
    try {
      if (mode === "fixture" && fixture) {
        const attempt = fixture.runAgent(serviceId, body.prompt);
        attempts = fixture.getAttempts();
        policyData = fixture.getPolicy();
        selectedId = attempt.id;
        detail = fixture.getDetail(attempt.id);
        announce(attempt.policyOutcome === "rejected" ? "Rejected by policy" : "Agent run recorded");
      } else {
        const res = await api.runAgent(body);
        announce(res.message || "Agent run complete");
        await refreshList();
        selectedId = res.attempt.id;
        detail = await api.getAttempt(res.attempt.id);
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Agent run failed";
      setActionError(msg);
      announce("Agent run failed");
    } finally {
      busy = false;
      paint();
    }
  });

  els.approveBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    setActionError(null);
    busy = true;
    paint();
    try {
      if (mode === "fixture" && fixture) {
        detail = fixture.approve(selectedId);
        policyData = fixture.getPolicy();
        attempts = fixture.getAttempts();
        announce("Approved (fixture)");
      } else {
        detail = await api.approve(selectedId);
        await refreshList();
        announce("Payment approved");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      busy = false;
      paint();
    }
  });

  els.denyBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    setActionError(null);
    busy = true;
    paint();
    try {
      if (mode === "fixture" && fixture) {
        detail = fixture.deny(selectedId);
        policyData = fixture.getPolicy();
        attempts = fixture.getAttempts();
        announce("Denied (fixture)");
      } else {
        detail = await api.deny(selectedId);
        await refreshList();
        announce("Payment denied");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Deny failed");
    } finally {
      busy = false;
      paint();
    }
  });

  els.resetBtn.addEventListener("click", async () => {
    if (!window.confirm("Reset demo state? This clears attempts on the backend (or fixture store).")) {
      return;
    }
    setActionError(null);
    busy = true;
    paint();
    try {
      if (mode === "fixture" && fixture) {
        policyData = fixture.reset();
        attempts = fixture.getAttempts();
        selectedId = attempts[0]?.id ?? null;
        detail = selectedId ? fixture.getDetail(selectedId) : null;
        announce("Fixture demo reset");
      } else {
        const res = await api.resetDemo();
        policyData = res.policy;
        await refreshList();
        selectedId = attempts[0]?.id ?? null;
        detail = selectedId ? await api.getAttempt(selectedId) : null;
        announce("Demo reset");
        // full refresh of derived UI
        window.location.reload();
        return;
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      busy = false;
      paint();
    }
  });

  syncServiceParams();
  if (window.location.hash) setActiveNav(window.location.hash.slice(1));
  else syncActiveNav();
  void bootstrap();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
