import type { RiskSeverity } from "../../utils/quotas-severity.js";
import { getSeverityColor } from "../../utils/quotas-severity.js";

export type WindowStatus = {
  label: string;
  usedPercent: number;
  severity: RiskSeverity;
  resetsAt: string | null;
  limited: boolean;
  isCurrency?: boolean;
  usedValue?: number;
  limitValue?: number;
};

export interface ThemeLike {
  fg(color: string, text: string): string;
}

const SHORT_LABELS: Record<string, string> = {
  "5h": "5h",
  "7d": "7d",
  "7d Sonnet": "7d-son",
  "7d Opus": "7d-opus",
  "7d Opus (legacy)": "7d-opus",
  "Premium / month": "premium",
  "Chat / month": "chat",
  "Completions / month": "comp",
  "Spend cap": "cap",
  "Credits": "credits",
  "Extra (AUD)": "extra",
  "Extra (USD)": "extra",
  "Extra (EUR)": "extra",
  "Extra (GBP)": "extra",
};

/**
 * Returns true when a window has a real used/limit pair
 * (e.g. 293/300 premium requests) rather than just a percentage.
 */
function hasRealCounts(w: WindowStatus): boolean {
  if (w.limitValue == null || w.usedValue == null) return false;
  // Percentage-only windows store limitValue=100 and usedValue=usedPercent
  if (w.limitValue === 100 && Math.abs(w.usedValue - w.usedPercent) < 0.01) return false;
  return w.limitValue > 0;
}

/**
 * Format a single window for the footer status bar.
 *
 * - Colors both the label and value based on severity
 * - Uses used/limit for real counts (e.g. "7/300")
 * - Uses "$X/$Y" for currency windows
 * - Uses "N% left" for percentage-only windows
 * - Uses "REACHED" / "OK" for spend cap
 */
export function formatWindowStatus(theme: ThemeLike, w: WindowStatus): string {
  const short = SHORT_LABELS[w.label] ?? w.label;
  const color = getSeverityColor(w.severity);

  // Color the label based on severity: dim when safe, colored when at risk
  const isAtRisk = w.severity !== "none";
  const labelColor = isAtRisk ? color : "dim";
  const labelText = theme.fg(labelColor, `${short}:`);

  let valueText: string;
  if (w.label === "Spend cap") {
    valueText = theme.fg(color, w.limited ? "REACHED" : "OK");
  } else if (w.isCurrency && w.usedValue != null && w.limitValue != null) {
    valueText = theme.fg(color, `$${w.usedValue.toFixed(0)}/$${w.limitValue.toFixed(0)}`);
  } else if (hasRealCounts(w)) {
    const remaining = Math.max(0, Math.round(w.limitValue! - w.usedValue!));
    valueText = theme.fg(color, `${remaining}/${w.limitValue}`);
  } else {
    const remaining = Math.max(0, Math.min(100, Math.round(100 - w.usedPercent)));
    valueText = theme.fg(color, `${remaining}% left`);
  }

  const limitTag = w.limited ? theme.fg("error", " !") : "";
  return `${labelText}${valueText}${limitTag}`;
}
