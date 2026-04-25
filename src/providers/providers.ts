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
      usedPercent: Number(extra.utilization ?? safePercent(usedDollars, limitDollars)),
      resetsAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
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
        nextAmount: overageCount > 0
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
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return midnight;
}

function calculateNextMondayUTC(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysUntilMonday = day === 0 ? 1 : (8 - day); // Days until next Monday
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday, 0, 0, 0));
  return monday;
}

function calculateNextMonthStartUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
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

export function parseSyntheticUsage(data: any): QuotaWindow[] {
  const windows: QuotaWindow[] = [];

  // Subscription (requests)
  if (data?.subscription) {
    windows.push({
      provider: "synthetic",
      label: "Subscription",
      usedPercent: safePercent(data.subscription.requests, data.subscription.limit),
      resetsAt: parseDateish(data.subscription.renewsAt),
      windowSeconds: 30 * 24 * 60 * 60,
      usedValue: data.subscription.requests,
      limitValue: data.subscription.limit,
      showPace: true,
      nextLabel: "Resets",
    });
  }

  // Search hourly
  if (data?.search?.hourly) {
    windows.push({
      provider: "synthetic",
      label: "Search / hour",
      usedPercent: safePercent(data.search.hourly.requests, data.search.hourly.limit),
      resetsAt: parseDateish(data.search.hourly.renewsAt),
      windowSeconds: 60 * 60,
      usedValue: data.search.hourly.requests,
      limitValue: data.search.hourly.limit,
      showPace: false,
      nextLabel: "Resets",
    });
  }

  // Free tool calls
  if (data?.freeToolCalls) {
    windows.push({
      provider: "synthetic",
      label: "Free Tools",
      usedPercent: safePercent(data.freeToolCalls.requests, data.freeToolCalls.limit),
      resetsAt: parseDateish(data.freeToolCalls.renewsAt),
      windowSeconds: 30 * 24 * 60 * 60,
      usedValue: data.freeToolCalls.requests,
      limitValue: data.freeToolCalls.limit,
      showPace: true,
      nextLabel: "Resets",
    });
  }

  // Weekly token limit
  if (data?.weeklyTokenLimit) {
    const maxCredits = parseFloat(data.weeklyTokenLimit.maxCredits) || 0;
    const remainingCredits = parseFloat(data.weeklyTokenLimit.remainingCredits) || 0;
    windows.push({
      provider: "synthetic",
      label: "Weekly Tokens",
      usedPercent: data.weeklyTokenLimit.percentRemaining ?? safePercent(remainingCredits, maxCredits),
      resetsAt: parseDateish(data.weeklyTokenLimit.nextRegenAt),
      windowSeconds: 7 * 24 * 60 * 60,
      usedValue: maxCredits - remainingCredits,
      limitValue: maxCredits,
      isCurrency: true,
      showPace: true,
      nextLabel: "Regen",
    });
  }

  // Rolling 5-hour limit
  if (data?.rollingFiveHourLimit) {
    windows.push({
      provider: "synthetic",
      label: "5h Limit",
      usedPercent: data.rollingFiveHourLimit.tickPercent,
      resetsAt: parseDateish(data.rollingFiveHourLimit.nextTickAt),
      windowSeconds: 5 * 60 * 60,
      usedValue: data.rollingFiveHourLimit.max - data.rollingFiveHourLimit.remaining,
      limitValue: data.rollingFiveHourLimit.max,
      limited: data.rollingFiveHourLimit.limited,
      showPace: false,
      nextLabel: data.rollingFiveHourLimit.limited ? "Limited" : "Resets",
    });
  }

  return windows;
}
