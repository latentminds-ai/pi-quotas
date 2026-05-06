import { describe, expect, it } from "vitest";
import { parseAnthropicUsage } from "./providers.js";
import { parseCodexUsage } from "./providers.js";
import { parseGitHubCopilotUsage } from "./providers.js";
import { parseOpenRouterUsage } from "./providers.js";
import { parseSyntheticUsage } from "./providers.js";

describe("parseAnthropicUsage", () => {
  it("maps oauth usage response into quota windows", () => {
    const windows = parseAnthropicUsage({
      five_hour: {
        utilization: 23.4,
        resets_at: "2026-04-22T18:30:00Z",
      },
      seven_day: {
        utilization: 14.1,
        resets_at: "2026-04-25T08:30:00Z",
      },
    });

    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      provider: "anthropic",
      label: "5h",
      usedPercent: 23.4,
      windowSeconds: 5 * 60 * 60,
    });
    expect(windows[1]).toMatchObject({
      provider: "anthropic",
      label: "7d",
      usedPercent: 14.1,
      windowSeconds: 7 * 24 * 60 * 60,
    });
  });

  it("includes extra_usage as a currency window", () => {
    const windows = parseAnthropicUsage({
      five_hour: { utilization: 9, resets_at: "2026-04-22T09:00:00Z" },
      seven_day: { utilization: 31, resets_at: "2026-04-23T23:00:00Z" },
      extra_usage: {
        is_enabled: true,
        monthly_limit: 30000,
        used_credits: 21548,
        utilization: 71.83,
        currency: "AUD",
      },
    });

    const extra = windows.find((w) => w.label === "Extra (AUD)");
    expect(extra).toBeDefined();
    expect(extra).toMatchObject({
      provider: "anthropic",
      label: "Extra (AUD)",
      isCurrency: true,
      usedPercent: 71.83,
      usedValue: 215.48,
      limitValue: 300,
    });
  });

  it("includes per-model 7d windows when present", () => {
    const windows = parseAnthropicUsage({
      five_hour: { utilization: 9, resets_at: "2026-04-22T09:00:00Z" },
      seven_day: { utilization: 31, resets_at: "2026-04-23T23:00:00Z" },
      seven_day_sonnet: { utilization: 8, resets_at: "2026-04-23T23:00:00Z" },
      seven_day_omelette: { utilization: 23, resets_at: "2026-04-26T23:00:00Z" },
      seven_day_opus: null,
    });

    const sonnet = windows.find((w) => w.label === "7d Sonnet");
    const opus = windows.find((w) => w.label === "7d Opus");
    expect(sonnet).toMatchObject({ usedPercent: 8 });
    expect(opus).toMatchObject({ usedPercent: 23 });
  });

  it("skips extra_usage when disabled", () => {
    const windows = parseAnthropicUsage({
      five_hour: { utilization: 5, resets_at: "2026-04-22T09:00:00Z" },
      seven_day: { utilization: 10, resets_at: "2026-04-23T23:00:00Z" },
      extra_usage: { is_enabled: false },
    });
    expect(windows.find((w) => w.label.startsWith("Extra"))).toBeUndefined();
  });
});

describe("parseCodexUsage", () => {
  it("maps primary and secondary windows from wham usage", () => {
    const windows = parseCodexUsage({
      plan_type: "plus",
      rate_limit: {
        primary_window: {
          used_percent: 27,
          reset_at: 1776880800,
          limit_window_seconds: 18000,
        },
        secondary_window: {
          used_percent: 11,
          reset_at: 1777485600,
          limit_window_seconds: 604800,
        },
      },
    });

    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      provider: "openai-codex",
      label: "5h",
      usedPercent: 27,
      windowSeconds: 18000,
    });
    expect(windows[1]).toMatchObject({
      provider: "openai-codex",
      label: "7d",
      usedPercent: 11,
      windowSeconds: 604800,
    });
  });

  it("handles alternate field names", () => {
    const windows = parseCodexUsage({
      rate_limits: {
        five_hour_limit: {
          percent_left: 61,
          reset_time_ms: 1776880800000,
          limit_window_seconds: 18000,
        },
        weekly_limit: {
          percent_left: 83,
          reset_time_ms: 1777485600000,
          limit_window_seconds: 604800,
        },
      },
    });

    expect(windows[0]).toMatchObject({ usedPercent: 39, label: "5h" });
    expect(windows[1]).toMatchObject({ usedPercent: 17, label: "7d" });
  });

  it("includes credits window when balance is present", () => {
    const windows = parseCodexUsage({
      plan_type: "team",
      rate_limit: {
        primary_window: { used_percent: 10, reset_at: 1776880800, limit_window_seconds: 18000 },
      },
      credits: {
        has_credits: true,
        unlimited: false,
        balance: 4200,
        approx_local_messages: 840,
        approx_cloud_messages: 168,
      },
    });

    const credit = windows.find((w) => w.label === "Credits");
    expect(credit).toBeDefined();
    expect(credit).toMatchObject({ isCurrency: true, usedValue: 4200 });
  });

  it("includes spend control status", () => {
    const windows = parseCodexUsage({
      plan_type: "team",
      rate_limit: {
        primary_window: { used_percent: 10, reset_at: 1776880800, limit_window_seconds: 18000 },
      },
      spend_control: { reached: true },
    });

    const sc = windows.find((w) => w.label === "Spend cap");
    expect(sc).toBeDefined();
    expect(sc).toMatchObject({ limited: true, usedPercent: 100 });
  });

  it("skips credits when no balance", () => {
    const windows = parseCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 10, reset_at: 1776880800, limit_window_seconds: 18000 },
      },
      credits: { has_credits: false, balance: null },
    });
    expect(windows.find((w) => w.label === "Credits")).toBeUndefined();
  });
});

describe("parseGitHubCopilotUsage", () => {
  it("maps premium interaction quota snapshot", () => {
    const windows = parseGitHubCopilotUsage({
      copilot_plan: "pro",
      quota_reset_date: "2026-05-01T00:00:00Z",
      quota_snapshots: {
        premium_interactions: {
          entitlement: 300,
          remaining: 240,
          percent_remaining: 80,
          quota_id: "premium",
        },
        chat: {
          entitlement: 1000,
          remaining: 950,
          percent_remaining: 95,
          quota_id: "chat",
        },
      },
    });

    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      provider: "github-copilot",
      label: "Premium / month",
      usedPercent: 20,
      usedValue: 60,
      limitValue: 300,
    });
    expect(windows[1]).toMatchObject({
      provider: "github-copilot",
      label: "Chat / month",
      usedPercent: 5,
      usedValue: 50,
      limitValue: 1000,
    });
  });

  it("includes overage info on premium interactions", () => {
    const windows = parseGitHubCopilotUsage({
      copilot_plan: "business",
      quota_reset_date: "2026-05-01T00:00:00Z",
      quota_snapshots: {
        premium_interactions: {
          entitlement: 300,
          remaining: 293,
          percent_remaining: 97.8,
          overage_count: 5,
          overage_permitted: true,
        },
      },
    });

    const premium = windows.find((w) => w.label === "Premium / month");
    expect(premium).toBeDefined();
    expect(premium!.nextAmount).toBe("+5 overage");
  });

  it("handles free-tier completions data", () => {
    const windows = parseGitHubCopilotUsage({
      access_type_sku: "free_limited_copilot",
      limited_user_reset_date: "2026-05-01",
      monthly_quotas: {
        chat: 500,
        completions: 4000,
      },
      limited_user_quotas: {
        chat: 410,
        completions: 4000,
      },
    });

    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ label: "Chat / month", usedPercent: 18 });
    expect(windows[1]).toMatchObject({ label: "Completions / month", usedPercent: 0 });
  });
});

describe("parseOpenRouterUsage", () => {
  it("maps API response with monthly budget limit", () => {
    const windows = parseOpenRouterUsage({
      data: {
        label: "Test Key",
        limit: 50,
        limit_remaining: 35,
        limit_reset: "monthly",
        usage: 15,
        usage_daily: 2.5,
        usage_weekly: 12,
        usage_monthly: 15,
        byok_usage: 0,
        byok_usage_daily: 0,
        byok_usage_weekly: 0,
        byok_usage_monthly: 0,
        creator_user_id: "user123",
        include_byok_in_limit: false,
        is_free_tier: false,
        is_management_key: false,
        is_provisioning_key: false,
      },
    });

    // When limit is set, we get: Monthly Budget + Daily + Weekly + Monthly = 4 windows
    expect(windows).toHaveLength(4);

    // Monthly Budget window
    const budget = windows.find((w) => w.label === "Monthly Budget");
    expect(budget).toBeDefined();
    expect(budget).toMatchObject({
      provider: "openrouter",
      label: "Monthly Budget",
      usedPercent: 30, // 15/50 = 30%
      isCurrency: true,
      usedValue: 15,
      limitValue: 50,
      showPace: true,
    });

    // Daily, Weekly, Monthly usage windows
    expect(windows.find((w) => w.label === "Daily")).toBeDefined();
    expect(windows.find((w) => w.label === "Weekly")).toBeDefined();
    expect(windows.find((w) => w.label === "Monthly")).toBeDefined();
  });

  it("maps unlimited key with remaining credits", () => {
    const windows = parseOpenRouterUsage({
      data: {
        label: "Unlimited Key",
        limit: null,
        limit_remaining: 100,
        limit_reset: null,
        usage: 50,
        usage_daily: 5,
        usage_weekly: 20,
        usage_monthly: 50,
        byok_usage: 0,
        byok_usage_daily: 0,
        byok_usage_weekly: 0,
        byok_usage_monthly: 0,
        creator_user_id: "user123",
        include_byok_in_limit: false,
        is_free_tier: false,
        is_management_key: false,
        is_provisioning_key: false,
      },
    });

    // When unlimited with limit_remaining: Credits Remaining + Daily + Weekly + Monthly = 4 windows
    expect(windows).toHaveLength(4);

    // Credits Remaining window
    const remaining = windows.find((w) => w.label === "Credits Remaining");
    expect(remaining).toBeDefined();
    expect(remaining).toMatchObject({
      provider: "openrouter",
      label: "Credits Remaining",
      usedPercent: 0,
      isCurrency: true,
      usedValue: 100,
      limitValue: 100,
      showPace: false,
    });
  });

  it("handles zero usage", () => {
    const windows = parseOpenRouterUsage({
      data: {
        label: "Test Key",
        limit: 100,
        limit_remaining: 100,
        limit_reset: "monthly",
        usage: 0,
        usage_daily: 0,
        usage_weekly: 0,
        usage_monthly: 0,
        byok_usage: 0,
        byok_usage_daily: 0,
        byok_usage_weekly: 0,
        byok_usage_monthly: 0,
        creator_user_id: "user123",
        include_byok_in_limit: false,
        is_free_tier: false,
        is_management_key: false,
        is_provisioning_key: false,
      },
    });

    const budget = windows.find((w) => w.label === "Monthly Budget");
    expect(budget).toBeDefined();
    expect(budget!.usedPercent).toBe(0);
  });

  it("returns empty array when no data", () => {
    const windows = parseOpenRouterUsage({});
    expect(windows).toHaveLength(0);
  });

  it("handles missing limit_remaining for unlimited keys", () => {
    const windows = parseOpenRouterUsage({
      data: {
        label: "Test Key",
        limit: null,
        limit_remaining: null,
        limit_reset: null,
        usage: 25,
        usage_daily: 3,
        usage_weekly: 10,
        usage_monthly: 25,
        byok_usage: 0,
        byok_usage_daily: 0,
        byok_usage_weekly: 0,
        byok_usage_monthly: 0,
        creator_user_id: "user123",
        include_byok_in_limit: false,
        is_free_tier: false,
        is_management_key: false,
        is_provisioning_key: false,
      },
    });

    // Should not have "Credits Remaining" window if limit_remaining is null
    const remaining = windows.find((w) => w.label === "Credits Remaining");
    expect(remaining).toBeUndefined();

    // But should still have usage tracking windows
    expect(windows.find((w) => w.label === "Daily")).toBeDefined();
    expect(windows.find((w) => w.label === "Weekly")).toBeDefined();
    expect(windows.find((w) => w.label === "Monthly")).toBeDefined();
  });
});

describe("parseSyntheticUsage", () => {
  it("parses a full API response with all windows", () => {
    const windows = parseSyntheticUsage({
      subscription: {
        limit: 500,
        requests: 0,
        renewsAt: "2026-05-06T12:27:17.097Z",
      },
      search: {
        hourly: {
          limit: 250,
          requests: 30,
          renewsAt: "2026-05-06T08:27:17.097Z",
        },
      },
      freeToolCalls: {
        limit: 0,
        requests: 0,
        renewsAt: "2026-05-07T07:27:17.102Z",
      },
      weeklyTokenLimit: {
        nextRegenAt: "2026-05-06T09:44:14.000Z",
        percentRemaining: 96.39,
        maxCredits: "$24.00",
        remainingCredits: "$23.13",
        nextRegenCredits: "$0.48",
      },
      rollingFiveHourLimit: {
        nextTickAt: "2026-05-06T07:27:51.000Z",
        tickPercent: 0.05,
        remaining: 420,
        max: 500,
        limited: false,
      },
    });

    // subscription is NOT a window (matching pi-synthetic extension)
    expect(windows.find((w) => w.label === "Subscription")).toBeUndefined();

    // weeklyTokenLimit: 100 - 96.39 = ~3.61%
    const credits = windows.find((w) => w.label === "Credits / week");
    expect(credits).toBeDefined();
    expect(credits!.usedPercent).toBeCloseTo(3.61, 1);
    expect(credits!.isCurrency).toBe(true);
    expect(credits!.limitValue).toBe(24);
    expect(credits!.usedValue).toBeCloseTo(0.87, 1);
    expect(credits!.paceScale).toBe(1 / 7);
    expect(credits!.nextAmount).toBe("+$0.48");

    // rollingFiveHourLimit: (500-420)/500 = 16%
    const fiveHour = windows.find((w) => w.label === "Requests / 5h");
    expect(fiveHour).toBeDefined();
    expect(fiveHour!.usedPercent).toBe(16);
    expect(fiveHour!.usedValue).toBe(80);
    expect(fiveHour!.limitValue).toBe(500);
    expect(fiveHour!.limited).toBe(false);

    // search hourly
    const search = windows.find((w) => w.label === "Search / hour");
    expect(search).toBeDefined();
    expect(search!.usedPercent).toBeCloseTo(12, 0);
    expect(search!.usedValue).toBe(30);
    expect(search!.limitValue).toBe(250);

    // freeToolCalls with limit=0 is NOT shown
    expect(windows.find((w) => w.label === "Free Tool Calls / day")).toBeUndefined();
  });

  it("shows freeToolCalls when limit > 0", () => {
    const windows = parseSyntheticUsage({
      weeklyTokenLimit: {
        nextRegenAt: "2026-05-06T09:44:14.000Z",
        percentRemaining: 50,
        maxCredits: "$10.00",
        remainingCredits: "$5.00",
        nextRegenCredits: "$0.50",
      },
      freeToolCalls: {
        limit: 100,
        requests: 25,
        renewsAt: "2026-05-07T07:27:17.102Z",
      },
    });

    const tools = windows.find((w) => w.label === "Free Tool Calls / day");
    expect(tools).toBeDefined();
    expect(tools!.usedPercent).toBe(25);
  });

  it("parses currency strings like $24.00 correctly", () => {
    const windows = parseSyntheticUsage({
      weeklyTokenLimit: {
        nextRegenAt: "2026-05-06T09:44:14.000Z",
        percentRemaining: 75,
        maxCredits: "$1,234.56",
        remainingCredits: "$925.92",
        nextRegenCredits: "$12.34",
      },
    });

    const credits = windows.find((w) => w.label === "Credits / week");
    expect(credits).toBeDefined();
    expect(credits!.limitValue).toBe(1234.56);
    expect(credits!.usedValue).toBeCloseTo(308.64, 1);
    expect(credits!.usedPercent).toBe(25); // 100 - 75
  });

  it("handles limited state", () => {
    const windows = parseSyntheticUsage({
      rollingFiveHourLimit: {
        nextTickAt: "2026-05-06T07:27:51.000Z",
        tickPercent: 100,
        remaining: 0,
        max: 500,
        limited: true,
      },
    });

    const fiveHour = windows.find((w) => w.label === "Requests / 5h");
    expect(fiveHour).toBeDefined();
    expect(fiveHour!.usedPercent).toBe(100);
    expect(fiveHour!.limited).toBe(true);
  });

  it("returns empty array when no data", () => {
    const windows = parseSyntheticUsage({});
    expect(windows).toHaveLength(0);
  });
});
