import type { QuotaWindow } from "../types/quotas.js";
import { safePercent } from "../utils/quotas-severity.js";

function parseDateish(value: unknown): Date {
  if (typeof value === "number") {
    const ms = value > 10 ** 11 ? value : value * 1000;
    return new Date(ms);
  }
  if (typeof value === "string") return new Date(value);
  return new Date(0);
}

function monthWindowSeconds(resetAt: Date): number {
  const approxStart = new Date(resetAt);
  approxStart.setMonth(approxStart.getMonth() - 1);
  return Math.max(1, Math.round((resetAt.getTime() - approxStart.getTime()) / 1000));
}

export function parseAnthropicUsage(data: any): QuotaWindow[] {
  const windows: QuotaWindow[] = [];

  if (data?.five_hour) {
    windows.push({
      provider: "anthropic",
      label: "5h",
      usedPercent: Number(data.five_hour.utilization ?? 0),
      resetsAt: parseDateish(data.five_hour.resets_at),
      windowSeconds: 5 * 60 * 60,
      usedValue: Number(data.five_hour.utilization ?? 0),
      limitValue: 100,
      showPace: false,
      nextLabel: "Resets",
    });
  }

  if (data?.seven_day) {
    windows.push({
      provider: "anthropic",
      label: "7d",
      usedPercent: Number(data.seven_day.utilization ?? 0),
      resetsAt: parseDateish(data.seven_day.resets_at),
      windowSeconds: 7 * 24 * 60 * 60,
      usedValue: Number(data.seven_day.utilization ?? 0),
      limitValue: 100,
      showPace: false,
      nextLabel: "Resets",
    });
  }

  return windows;
}

function percentLeftToUsedPercent(limit: any): number {
  if (limit?.percent_left != null) return Math.max(0, 100 - Number(limit.percent_left));
  if (limit?.remaining_percent != null) return Math.max(0, 100 - Number(limit.remaining_percent));
  if (limit?.used_percent != null) return Number(limit.used_percent);
  return 0;
}

export function parseCodexUsage(data: any): QuotaWindow[] {
  const rateLimit = data?.rate_limit ?? data?.rate_limits ?? {};
  const primary = rateLimit.primary_window ?? rateLimit.primary ?? rateLimit.five_hour_limit ?? rateLimit.five_hour;
  const secondary = rateLimit.secondary_window ?? rateLimit.secondary ?? rateLimit.weekly_limit ?? rateLimit.weekly;

  const windows: QuotaWindow[] = [];

  if (primary) {
    windows.push({
      provider: "openai-codex",
      label: "5h",
      usedPercent: percentLeftToUsedPercent(primary),
      resetsAt: parseDateish(primary.reset_at ?? primary.reset_time_ms),
      windowSeconds: Number(primary.limit_window_seconds ?? 5 * 60 * 60),
      usedValue: percentLeftToUsedPercent(primary),
      limitValue: 100,
      showPace: false,
      nextLabel: "Resets",
    });
  }

  if (secondary) {
    windows.push({
      provider: "openai-codex",
      label: "7d",
      usedPercent: percentLeftToUsedPercent(secondary),
      resetsAt: parseDateish(secondary.reset_at ?? secondary.reset_time_ms),
      windowSeconds: Number(secondary.limit_window_seconds ?? 7 * 24 * 60 * 60),
      usedValue: percentLeftToUsedPercent(secondary),
      limitValue: 100,
      showPace: false,
      nextLabel: "Resets",
    });
  }

  return windows;
}

export function parseGitHubCopilotUsage(data: any): QuotaWindow[] {
  const windows: QuotaWindow[] = [];

  const resetAt = parseDateish(data?.quota_reset_date ?? data?.quota_reset_date_utc ?? data?.limited_user_reset_date);
  const periodSeconds = monthWindowSeconds(resetAt);

  const snapshots = data?.quota_snapshots;
  if (snapshots && typeof snapshots === "object") {
    const mappings: Array<[string, string]> = [
      ["premium_interactions", "Premium / month"],
      ["chat", "Chat / month"],
      ["completions", "Completions / month"],
    ];

    for (const [key, label] of mappings) {
      const snap = snapshots[key];
      if (!snap || snap.unlimited) continue;
      const entitlement = Number(snap.entitlement ?? 0);
      const remaining = Number(snap.remaining ?? snap.quota_remaining ?? 0);
      if (entitlement <= 0) continue;
      windows.push({
        provider: "github-copilot",
        label,
        usedPercent: safePercent(entitlement - remaining, entitlement),
        resetsAt: resetAt,
        windowSeconds: periodSeconds,
        usedValue: entitlement - remaining,
        limitValue: entitlement,
        showPace: true,
        nextLabel: "Resets",
      });
    }
    return windows;
  }

  if (data?.monthly_quotas && data?.limited_user_quotas) {
    for (const [key, label] of [
      ["chat", "Chat / month"],
      ["completions", "Completions / month"],
    ] as const) {
      const limitValue = Number(data.monthly_quotas[key] ?? 0);
      const remaining = Number(data.limited_user_quotas[key] ?? 0);
      if (limitValue <= 0) continue;
      windows.push({
        provider: "github-copilot",
        label,
        usedPercent: safePercent(limitValue - remaining, limitValue),
        resetsAt: resetAt,
        windowSeconds: periodSeconds,
        usedValue: limitValue - remaining,
        limitValue,
        showPace: true,
        nextLabel: "Resets",
      });
    }
  }

  return windows;
}
