import { describe, expect, it } from "vitest";
import { parseAnthropicUsage } from "./providers.js";
import { parseCodexUsage } from "./providers.js";
import { parseGitHubCopilotUsage } from "./providers.js";

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
