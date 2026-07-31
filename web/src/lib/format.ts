/**
 * Convert tinybar integer strings to HBAR decimal strings without IEEE floats.
 * 1 HBAR = 100_000_000 tinybar.
 */
export function tinybarToHbar(tinybar: string): string {
  const raw = tinybar.trim();
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`Invalid tinybar amount: ${tinybar}`);
  }

  const negative = raw.startsWith("-");
  let digits = negative ? raw.slice(1) : raw;
  digits = digits.replace(/^0+/, "") || "0";

  let whole: string;
  let frac: string;

  if (digits.length <= 8) {
    whole = "0";
    frac = digits.padStart(8, "0");
  } else {
    whole = digits.slice(0, -8);
    frac = digits.slice(-8);
  }

  frac = frac.replace(/0+$/, "");
  const body = frac.length > 0 ? `${whole}.${frac}` : whole;
  return negative ? `-${body}` : body;
}

/** HBAR string with unit suffix for UI. */
export function formatHbar(tinybar: string): string {
  return `${tinybarToHbar(tinybar)} ℏ`;
}

/** Shorten long identifiers for table display. */
export function truncateMiddle(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Relative-ish time for tables (UTC ISO in → local short). */
export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function formatPolicyOutcome(outcome: string | null): string {
  if (!outcome) return "—";
  return outcome.replace(/_/g, " ");
}
