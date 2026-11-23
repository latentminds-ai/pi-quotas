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
  return Math.max(
    1,
    Math.round((resetAt.getTime() - approxStart.getTime()) / 1000),
  );
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

  // Per-model 7d windows
  const modelWindows: Array<[string, string]> = [
    ["seven_day_sonnet", "7d Sonnet"],
    ["seven_day_omelette", "7d Opus"],
    ["seven_day_opus", "7d Opus (legacy)"],
  ];
  for (const [key, label] of modelWindows) {
    const entry = data?.[key];
    if (entry && typeof entry === "object" && entry.utilization != null) {
      windows.push({
        provider: "anthropic",
        label,
        usedPercent: Number(entry.utilization),
        resetsAt: parseDateish(entry.resets_at),
        windowSeconds: 7 * 24 * 60 * 60,
        usedValue: Number(entry.utilization),
        limitValue: 100,
        showPace: false,
        nextLabel: "Resets",
      });
    }
  }

  // Extra usage (overage budget)
  const extra = data?.extra_usage;
  if (extra && extra.is_enabled && extra.monthly_limit > 0) {
    const limitDollars = extra.monthly_limit / 100;
    const usedDollars = (extra.used_credits ?? 0) / 100;
    const currency = extra.currency ?? "USD";
    windows.push({
      provider: "anthropic",
      label: `Extra (${currency})`,
      usedPercent: Number(
        extra.utilization ?? safePercent(usedDollars, limitDollars),
      ),
      resetsAt: new Date(
        new Date().getFullYear(),
        new Date().getMonth() + 1,
        1,
      ),
      windowSeconds: 30 * 24 * 60 * 60,
      usedValue: usedDollars,
      limitValue: limitDollars,
      isCurrency: true,
      showPace: true,
      paceScale: 1,
      nextLabel: "Resets",
    });
  }

  return windows;
}

function percentLeftToUsedPercent(limit: any): number {
  if (limit?.percent_left != null)
    return Math.max(0, 100 - Number(limit.percent_left));
  if (limit?.remaining_percent != null)
    return Math.max(0, 100 - Number(limit.remaining_percent));
  if (limit?.used_percent != null) return Number(limit.used_percent);
  return 0;
}

function codexWindowSeconds(value: unknown, fallback: number): number {
  const seconds = Number(value ?? fallback);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
}

function codexWindowLabel(windowSeconds: number): string {
  if (windowSeconds % (24 * 60 * 60) === 0)
    return `${windowSeconds / (24 * 60 * 60)}d`;
  if (windowSeconds % (60 * 60) === 0)
    return `${windowSeconds / (60 * 60)}h`;
  if (windowSeconds % 60 === 0) return `${windowSeconds / 60}m`;
  return `${windowSeconds}s`;
}

export function parseCodexUsage(data: any): QuotaWindow[] {
  const rateLimit = data?.rate_limit ?? data?.rate_limits ?? {};
  const primary =
    rateLimit.primary_window ??
    rateLimit.primary ??
    rateLimit.five_hour_limit ??
    rateLimit.five_hour;
  const secondary =
    rateLimit.secondary_window ??
    rateLimit.secondary ??
    rateLimit.weekly_limit ??
    rateLimit.weekly;

  const windows: QuotaWindow[] = [];

  if (primary) {
    const windowSeconds = codexWindowSeconds(
      primary.limit_window_seconds,
      5 * 60 * 60,
    );
    windows.push({
      provider: "openai-codex",
      label: codexWindowLabel(windowSeconds),
      usedPercent: percentLeftToUsedPercent(primary),
      resetsAt: parseDateish(primary.reset_at ?? primary.reset_time_ms),
      windowSeconds,
      usedValue: percentLeftToUsedPercent(primary),
      limitValue: 100,
      showPace: false,
      nextLabel: "Resets",
    });
  }

  if (secondary) {
    const windowSeconds = codexWindowSeconds(
      secondary.limit_window_seconds,
      7 * 24 * 60 * 60,
    );
    windows.push({
      provider: "openai-codex",
      label: codexWindowLabel(windowSeconds),
      usedPercent: percentLeftToUsedPercent(secondary),
      resetsAt: parseDateish(secondary.reset_at ?? secondary.reset_time_ms),
      windowSeconds,
      usedValue: percentLeftToUsedPercent(secondary),
      limitValue: 100,
      showPace: false,
      nextLabel: "Resets",
    });
  }

  // Credits balance
  const credits = data?.credits;
  if (credits && credits.has_credits && credits.balance != null) {
    const balance = Number(credits.balance);
    windows.push({
      provider: "openai-codex",
      label: "Credits",
      usedPercent: 0,
      resetsAt: new Date(0),
      windowSeconds: 0,
      usedValue: balance,
      limitValue: balance,
      isCurrency: true,
      showPace: false,
      nextLabel: credits.approx_local_messages
        ? `~${credits.approx_local_messages} local msgs`
        : undefined,
    });
  }

  // Spend control
  const spendControl = data?.spend_control;
  if (spendControl) {
    const reached = !!spendControl.reached;
    windows.push({
      provider: "openai-codex",
      label: "Spend cap",
      usedPercent: reached ? 100 : 0,
      resetsAt: new Date(0),
      windowSeconds: 0,
      usedValue: reached ? 1 : 0,
      limitValue: 1,
      limited: reached,
      showPace: false,
      nextLabel: reached ? "Reached" : "OK",
    });
  }

  return windows;
}

export function parseGitHubCopilotUsage(data: any): QuotaWindow[] {
  const windows: QuotaWindow[] = [];

  const resetAt = parseDateish(
    data?.quota_reset_date ??
      data?.quota_reset_date_utc ??
      data?.limited_user_reset_date,
  );
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
      const overageCount = Number(snap.overage_count ?? 0);
      const overagePermitted = !!snap.overage_permitted;
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
        nextAmount:
          overageCount > 0
            ? `+${overageCount} overage`
            : overagePermitted
              ? "overage allowed"
              : undefined,
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

// Helper functions for OpenRouter date calculations (UTC-based)
function calculateNextMidnightUTC(): Date {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
    ),
  );
  return midnight;
}

function calculateNextMondayUTC(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysUntilMonday = day === 0 ? 1 : 8 - day; // Days until next Monday
  const monday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysUntilMonday,
      0,
      0,
      0,
    ),
  );
  return monday;
}

function calculateNextMonthStartUTC(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0),
  );
}

export function parseOpenRouterUsage(data: any): QuotaWindow[] {
  const windows: QuotaWindow[] = [];
  const keyData = data?.data;

  if (!keyData) return windows;

  const limit = keyData.limit;
  const limitRemaining = keyData.limit_remaining;
  const usageDaily = keyData.usage_daily ?? 0;
  const usageWeekly = keyData.usage_weekly ?? 0;
  const usageMonthly = keyData.usage_monthly ?? 0;

  // Monthly budget window (if limit is set)
  if (limit != null && limit > 0) {
    const usedPercent = safePercent(usageMonthly, limit);
    windows.push({
      provider: "openrouter",
      label: "Monthly Budget",
      usedPercent,
      resetsAt: calculateNextMonthStartUTC(),
      windowSeconds: 30 * 24 * 60 * 60,
      usedValue: usageMonthly,
      limitValue: limit,
      isCurrency: true,
      showPace: true,
      paceScale: 1,
      nextLabel: "Resets",
    });
  } else if (limitRemaining != null && limitRemaining >= 0) {
    // Unlimited key with remaining tracked
    windows.push({
      provider: "openrouter",
      label: "Credits Remaining",
      usedPercent: 0,
      resetsAt: new Date(0),
      windowSeconds: 0,
      usedValue: limitRemaining,
      limitValue: limitRemaining,
      isCurrency: true,
      showPace: false,
      nextLabel: undefined,
    });
  }

  // Daily usage window (tracking only)
  windows.push({
    provider: "openrouter",
    label: "Daily",
    usedPercent: 0,
    resetsAt: calculateNextMidnightUTC(),
    windowSeconds: 24 * 60 * 60,
    usedValue: usageDaily,
    limitValue: 0,
    isCurrency: true,
    showPace: false,
    nextLabel: "UTC",
  });

  // Weekly usage window (tracking only)
  windows.push({
    provider: "openrouter",
    label: "Weekly",
    usedPercent: 0,
    resetsAt: calculateNextMondayUTC(),
    windowSeconds: 7 * 24 * 60 * 60,
    usedValue: usageWeekly,
    limitValue: 0,
    isCurrency: true,
    showPace: false,
    nextLabel: "Week",
  });

  // Monthly usage window (tracking only)
  windows.push({
    provider: "openrouter",
    label: "Monthly",
    usedPercent: 0,
    resetsAt: calculateNextMonthStartUTC(),
    windowSeconds: 30 * 24 * 60 * 60,
    usedValue: usageMonthly,
    limitValue: 0,
    isCurrency: true,
    showPace: false,
    nextLabel: "Month",
  });

  return windows;
}

/** Parse currency strings like "$24.00" to a number */
function parseCurrency(value: string): number {
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function parseSyntheticUsage(data: any): QuotaWindow[] {
  const windows: QuotaWindow[] = [];

  // Weekly token/credit limit (primary window for paid plans)
  if (data?.weeklyTokenLimit) {
    const limitValue = parseCurrency(data.weeklyTokenLimit.maxCredits);
    const remainingValue = parseCurrency(data.weeklyTokenLimit.remainingCredits);
    windows.push({
      provider: "synthetic",
      label: "Credits / week",
      usedPercent: Math.max(0, Math.min(100, 100 - data.weeklyTokenLimit.percentRemaining)),
      resetsAt: parseDateish(data.weeklyTokenLimit.nextRegenAt),
      windowSeconds: 24 * 60 * 60,
      usedValue: limitValue - remainingValue,
      limitValue,
      isCurrency: true,
      showPace: true,
      paceScale: 1 / 7,
      nextAmount: `+${data.weeklyTokenLimit.nextRegenCredits}`,
      nextLabel: "Next regen",
    });
  }

  // Rolling 5-hour request limit
  if (data?.rollingFiveHourLimit && data.rollingFiveHourLimit.max > 0) {
    const used =
      data.rollingFiveHourLimit.max - data.rollingFiveHourLimit.remaining;
    windows.push({
      provider: "synthetic",
      label: "Requests / 5h",
      usedPercent: safePercent(used, data.rollingFiveHourLimit.max),
      resetsAt: parseDateish(data.rollingFiveHourLimit.nextTickAt),
      windowSeconds: 5 * 60 * 60,
      usedValue: Math.round(used),
      limitValue: data.rollingFiveHourLimit.max,
      showPace: false,
      limited: data.rollingFiveHourLimit.limited,
      nextLabel: data.rollingFiveHourLimit.limited ? "Limited" : "Resets",
    });
  }

  // Search hourly (only if limit > 0)
  if (data?.search?.hourly?.limit && data.search.hourly.limit > 0) {
    windows.push({
      provider: "synthetic",
      label: "Search / hour",
      usedPercent: safePercent(
        data.search.hourly.requests,
        data.search.hourly.limit,
      ),
      resetsAt: parseDateish(data.search.hourly.renewsAt),
      windowSeconds: 60 * 60,
      usedValue: data.search.hourly.requests,
      limitValue: data.search.hourly.limit,
      showPace: true,
      paceScale: 1,
      nextLabel: "Resets",
    });
  }

  // Free tool calls (only if limit > 0)
  if (data?.freeToolCalls?.limit && data.freeToolCalls.limit > 0) {
    windows.push({
      provider: "synthetic",
      label: "Free Tool Calls / day",
      usedPercent: safePercent(
        data.freeToolCalls.requests,
        data.freeToolCalls.limit,
      ),
      resetsAt: parseDateish(data.freeToolCalls.renewsAt),
      windowSeconds: 24 * 60 * 60,
      usedValue: data.freeToolCalls.requests,
      limitValue: data.freeToolCalls.limit,
      showPace: true,
      paceScale: 1,
      nextLabel: "Resets",
    });
  }

  return windows;
}

export function parseOpenCodeGoUsage(data: {
  rolling?: {
    usagePercent: number;
    resetInSec: number;
    percentRemaining: number;
    resetTimeIso: string;
  };
  weekly?: {
    usagePercent: number;
    resetInSec: number;
    percentRemaining: number;
    resetTimeIso: string;
  };
  monthly?: {
    usagePercent: number;
    resetInSec: number;
    percentRemaining: number;
    resetTimeIso: string;
  };
}): QuotaWindow[] {
  const windows: QuotaWindow[] = [];

  if (data.rolling) {
    windows.push({
      provider: "opencode-go",
      label: "5h Rolling",
      usedPercent: data.rolling.usagePercent,
      resetsAt: new Date(data.rolling.resetTimeIso),
      windowSeconds: 5 * 60 * 60,
      usedValue: data.rolling.usagePercent,
      limitValue: 100,
      showPace: false,
      nextLabel: "Resets",
    });
  }

  if (data.weekly) {
    windows.push({
      provider: "opencode-go",
      label: "Weekly",
      usedPercent: data.weekly.usagePercent,
      resetsAt: new Date(data.weekly.resetTimeIso),
      windowSeconds: 7 * 24 * 60 * 60,
      usedValue: data.weekly.usagePercent,
      limitValue: 100,
      showPace: true,
      paceScale: 1 / 7,
      nextLabel: "Resets",
    });
  }

  if (data.monthly) {
    windows.push({
      provider: "opencode-go",
      label: "Monthly",
      usedPercent: data.monthly.usagePercent,
      resetsAt: new Date(data.monthly.resetTimeIso),
      windowSeconds: 30 * 24 * 60 * 60,
      usedValue: data.monthly.usagePercent,
      limitValue: 100,
      showPace: true,
      paceScale: 1,
      nextLabel: "Resets",
    });
  }

  return windows;
}

// Kimi Code subscription quotas. The /coding/v1/usages endpoint exposes a
// weekly allowance plus one or more shorter rolling windows.
export function parseKimiCodingUsage(data: any): QuotaWindow[] {
  const windows: QuotaWindow[] = [];

  const weekly = data?.usage;
  if (weekly && typeof weekly === "object") {
    const limit = Number(weekly.limit ?? 0);
    const used = Number(weekly.used ?? 0);
    if (Number.isFinite(limit) && Number.isFinite(used) && limit > 0) {
      windows.push({
        provider: "kimi-coding",
        label: "Weekly",
        usedPercent: safePercent(used, limit),
        resetsAt: parseDateish(weekly.resetTime),
        windowSeconds: 7 * 24 * 60 * 60,
        usedValue: used,
        limitValue: limit,
        showPace: true,
        limited: used >= limit,
        nextLabel: "Resets",
      });
    }
  }

  const limits = Array.isArray(data?.limits) ? data.limits : [];
  for (const entry of limits) {
    const detail = entry?.detail;
    const window = entry?.window;
    if (!detail || !window) continue;

    const limit = Number(detail.limit ?? 0);
    const used = Number(detail.used ?? 0);
    const duration = Number(window.duration ?? 0);
    if (
      !Number.isFinite(limit) ||
      !Number.isFinite(used) ||
      !Number.isFinite(duration) ||
      limit <= 0 ||
      duration <= 0
    ) {
      continue;
    }

    let windowSeconds: number;
    let label: string;
    switch (window.timeUnit) {
      case "TIME_UNIT_SECOND":
        windowSeconds = duration;
        label = `${duration}s`;
        break;
      case "TIME_UNIT_MINUTE":
        windowSeconds = duration * 60;
        label =
          duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`;
        break;
      case "TIME_UNIT_HOUR":
        windowSeconds = duration * 60 * 60;
        label = `${duration}h`;
        break;
      case "TIME_UNIT_DAY":
        windowSeconds = duration * 24 * 60 * 60;
        label = `${duration}d`;
        break;
      default:
        continue;
    }
    windows.push({
      provider: "kimi-coding",
      label,
      usedPercent: safePercent(used, limit),
      resetsAt: parseDateish(detail.resetTime),
      windowSeconds,
      usedValue: used,
      limitValue: limit,
      showPace: false,
      limited: used >= limit,
      nextLabel: "Resets",
    });
  }

  windows.sort((a, b) => a.windowSeconds - b.windowSeconds);
  return windows;
}

// Z.ai (Zhipu AI) GLM Coding Plan quotas.
//
// The quota endpoint returns { data: { limits: [...], level } }. Each entry in
// `limits` is either a TOKENS_LIMIT (token utilisation, reported as a bare
// `percentage` with no absolute used/limit counts) or a TIME_LIMIT (a monthly
// count window such as web searches, which does carry real used/limit counts).
//
// The window length is encoded as (unit, number). Observed values:
//   unit 3 = HOUR  (e.g. the rolling 5-hour session window)
//   unit 6 = WEEK  (e.g. the rolling 7-day weekly window)
//   unit 5 = MONTH (TIME_LIMIT only, the monthly count window)
// Reset times are epoch milliseconds.
export function parseZaiUsage(data: any): QuotaWindow[] {
  const collected: QuotaWindow[] = [];

  const limits: any[] = data?.data?.limits ?? data?.limits ?? [];
  if (!Array.isArray(limits)) return collected;

  for (const entry of limits) {
    if (!entry || typeof entry !== "object") continue;

    // Token windows only expose a percentage, so — like Anthropic/Codex — we
    // report usedValue as the percentage against a nominal limit of 100.
    if (entry.type === "TOKENS_LIMIT") {
      const unit = entry.unit;
      const count = Number(entry.number ?? 1) || 1;
      let label: string;
      let windowSeconds: number;

      switch (unit) {
        case 3: // HOUR
          label = `${count}h`;
          windowSeconds = count * 60 * 60;
          break;
        case 4: // DAY (defensive — not observed, but handled)
          label = `${count}d`;
          windowSeconds = count * 24 * 60 * 60;
          break;
        case 6: // WEEK
          label = `${count * 7}d`;
          windowSeconds = count * 7 * 24 * 60 * 60;
          break;
        default:
          // Unknown unit — still surface it so usage is never silently hidden.
          label = "Tokens";
          windowSeconds = 0;
          break;
      }

      collected.push({
        provider: "zai",
        label,
        usedPercent: Number(entry.percentage ?? 0),
        resetsAt: parseDateish(entry.nextResetTime),
        windowSeconds,
        usedValue: Number(entry.percentage ?? 0),
        limitValue: 100,
        showPace: false,
        nextLabel: "Resets",
      });
      continue;
    }

    // Monthly web-search / tool-call count window. Here z.ai gives real
    // counts: `usage` is the entitlement, `currentValue` is what's been used.
    if (entry.type === "TIME_LIMIT") {
      const limit = Number(entry.usage ?? 0);
      const used = Number(entry.currentValue ?? 0);
      if (limit <= 0) continue;

      collected.push({
        provider: "zai",
        label: "Web / month",
        usedPercent: safePercent(used, limit),
        resetsAt: parseDateish(entry.nextResetTime),
        windowSeconds: 30 * 24 * 60 * 60,
        usedValue: used,
        limitValue: limit,
        showPace: false,
        nextLabel: "Resets",
      });
    }
  }

  // Shortest window first (5h → 7d → month), matching Anthropic/Codex order.
  collected.sort((a, b) => a.windowSeconds - b.windowSeconds);
  return collected;
}

// Ollama Cloud subscription quotas. The undocumented /api/usage endpoint
// exposes a rolling 5-hour session limit and a rolling 7-day weekly limit,
// each reported as a 0-1 usage fraction (not tokens) plus per-model request
// counts. Reset timestamps are not exposed, so windows carry no reset time.
export function parseOllamaCloudUsage(data: any): QuotaWindow[] {
  const windows: QuotaWindow[] = [];

  const session = data?.limits?.session;
  if (session && typeof session.usage === "number") {
    windows.push({
      provider: "ollama-cloud",
      label: "5h",
      usedPercent: Math.max(0, Math.min(100, Math.round(session.usage * 100))),
      resetsAt: new Date(0),
      windowSeconds: 5 * 60 * 60,
      usedValue: Math.max(0, Math.min(100, Math.round(session.usage * 100))),
      limitValue: 100,
      showPace: false,
    });
  }

  const weekly = data?.limits?.weekly;
  if (weekly && typeof weekly.usage === "number") {
    windows.push({
      provider: "ollama-cloud",
      label: "7d",
      usedPercent: Math.max(0, Math.min(100, Math.round(weekly.usage * 100))),
      resetsAt: new Date(0),
      windowSeconds: 7 * 24 * 60 * 60,
      usedValue: Math.max(0, Math.min(100, Math.round(weekly.usage * 100))),
      limitValue: 100,
      showPace: false,
    });
  }

  return windows;
}

// Grok subscription quotas. The CLI billing endpoint exposes one current
// credit period, optional per-product usage percentages, and an on-demand cap.
export function parseXaiUsage(data: any): QuotaWindow[] {
  const config = data?.config;
  if (!config || typeof config !== "object") return [];

  const start = parseDateish(
    config.currentPeriod?.start ?? config.billingPeriodStart,
  );
  const end = parseDateish(
    config.currentPeriod?.end ?? config.billingPeriodEnd,
  );
  const periodMs = end.getTime() - start.getTime();
  if (!Number.isFinite(periodMs) || periodMs <= 0) return [];

  const windowSeconds = Math.round(periodMs / 1000);
  const isWeekly =
    config.currentPeriod?.type === "USAGE_PERIOD_TYPE_WEEKLY" ||
    config.isUnifiedBillingUser === true;
  const periodLabel = isWeekly ? "Week" : "Month";
  const windows: QuotaWindow[] = [];

  // The billing response omits protobuf scalar fields when their value is 0.
  // A valid period without creditUsagePercent therefore means 0% used.
  const creditUsagePercent =
    config.creditUsagePercent == null ? 0 : Number(config.creditUsagePercent);
  if (Number.isFinite(creditUsagePercent)) {
    windows.push({
      provider: "xai",
      label: `${periodLabel} (credits)`,
      usedPercent: creditUsagePercent,
      resetsAt: end,
      windowSeconds,
      usedValue: creditUsagePercent,
      limitValue: 100,
      showPace: false,
      nextLabel: "Resets",
    });
  }

  const products = Array.isArray(config.productUsage)
    ? config.productUsage
    : [];
  for (const product of products.slice(0, 8)) {
    if (product?.usagePercent == null) continue;
    const usagePercent = Number(product?.usagePercent);
    if (!Number.isFinite(usagePercent)) continue;
    const label = String(product?.product ?? "")
      .replace(/^Grok/i, "")
      .trim();
    if (!label) continue;
    windows.push({
      provider: "xai",
      label,
      usedPercent: usagePercent,
      resetsAt: end,
      windowSeconds,
      usedValue: usagePercent,
      limitValue: 100,
      showPace: false,
      nextLabel: "Resets",
    });
  }

  const onDemandLimit = Number(config.onDemandCap?.val);
  const onDemandUsed = Number(config.onDemandUsed?.val);
  if (
    Number.isFinite(onDemandLimit) &&
    Number.isFinite(onDemandUsed) &&
    onDemandLimit > 0
  ) {
    windows.push({
      provider: "xai",
      label: "On-demand",
      usedPercent: safePercent(onDemandUsed, onDemandLimit),
      resetsAt: end,
      windowSeconds,
      usedValue: onDemandUsed,
      limitValue: onDemandLimit,
      isCurrency: true,
      showPace: false,
      limited: onDemandUsed >= onDemandLimit,
      nextLabel: "Resets",
    });
  }

  return windows;
}
