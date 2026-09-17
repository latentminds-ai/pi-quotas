import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseOpenCodeGoApiUsage,
  queryOpenCodeGoQuota,
} from "./opencode-go.js";
import { apiKeyFromConfigData } from "./opencode-go-config.js";
import { parseOpenCodeGoUsage } from "./providers.js";
import { assessWindow } from "../utils/quotas-severity.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

describe("parseOpenCodeGoApiUsage", () => {
  it("converts percent + resetsAt into usage windows", () => {
    const parsed = parseOpenCodeGoApiUsage(
      {
        usage: {
          rolling: { status: "ok", percent: 0, resetsAt: "2026-09-17T19:29:31.391Z" },
          weekly: { status: "ok", percent: 11, resetsAt: "2026-09-21T00:00:00.000Z" },
          monthly: { status: "ok", percent: 5, resetsAt: "2026-10-16T13:49:43.000Z" },
        },
      },
      NOW,
    );

    expect(parsed).toMatchObject({
      success: true,
      rolling: { usagePercent: 0, percentRemaining: 100 },
      weekly: { usagePercent: 11, percentRemaining: 89 },
      monthly: { usagePercent: 5, percentRemaining: 95 },
    });
    expect(parsed?.rolling?.resetTimeIso).toBe("2026-09-17T19:29:31.391Z");
    expect(parsed?.rolling?.resetInSec).toBe(7 * 3600 + 29 * 60 + 31);
    expect(parsed?.monthly?.resetInSec).toBeGreaterThan(0);
  });

  it("omits windows that are absent", () => {
    const parsed = parseOpenCodeGoApiUsage(
      { usage: { weekly: { percent: 50, resetsAt: "2026-09-21T00:00:00.000Z" } } },
      NOW,
    );
    expect(parsed).toMatchObject({ success: true, weekly: { usagePercent: 50 } });
    expect(parsed?.rolling).toBeUndefined();
    expect(parsed?.monthly).toBeUndefined();
  });

  it("returns null for malformed payloads", () => {
    expect(parseOpenCodeGoApiUsage(null, NOW)).toBeNull();
    expect(parseOpenCodeGoApiUsage({}, NOW)).toBeNull();
    expect(parseOpenCodeGoApiUsage({ usage: {} }, NOW)).toBeNull();
  });

  it("marks a rate-limited window as limited", () => {
    const parsed = parseOpenCodeGoApiUsage(
      {
        usage: {
          rolling: { status: "rate-limited", percent: 100, resetsAt: "2026-09-17T19:29:31.391Z" },
          weekly: { status: "ok", percent: 11, resetsAt: "2026-09-21T00:00:00.000Z" },
        },
      },
      NOW,
    );

    expect(parsed?.rolling?.limited).toBe(true);
    expect(parsed?.weekly?.limited).toBeUndefined();
  });

  it("clamps out-of-range percentages to 0..100", () => {
    const parsed = parseOpenCodeGoApiUsage(
      {
        usage: {
          rolling: { status: "ok", percent: 137, resetsAt: "2026-09-17T19:29:31.391Z" },
          weekly: { status: "ok", percent: -5, resetsAt: "2026-09-21T00:00:00.000Z" },
        },
      },
      NOW,
    );

    expect(parsed?.rolling).toMatchObject({ usagePercent: 100, percentRemaining: 0 });
    expect(parsed?.weekly).toMatchObject({ usagePercent: 0, percentRemaining: 100 });
  });

  it("tolerates a window without resetsAt", () => {
    const parsed = parseOpenCodeGoApiUsage({ usage: { rolling: { percent: 3 } } }, NOW);
    expect(parsed?.rolling).toMatchObject({ usagePercent: 3, resetInSec: 0 });
  });

  it("escalates a rate-limited window to critical severity end to end", () => {
    const parsed = parseOpenCodeGoApiUsage(
      {
        usage: {
          rolling: { status: "rate-limited", percent: 100, resetsAt: "2026-09-17T19:29:31.391Z" },
        },
      },
      NOW,
    );
    if (!parsed) throw new Error("expected a parsed payload");

    const windows = parseOpenCodeGoUsage(parsed);

    expect(windows[0]).toMatchObject({ label: "5h Rolling", limited: true });
    expect(assessWindow(windows[0]).severity).toBe("critical");
  });
});

describe("queryOpenCodeGoQuota", () => {
  it("sends a bearer key to the official usage endpoint and parses it", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            rolling: { status: "ok", percent: 0, resetsAt: "2026-09-17T19:29:31.391Z" },
            weekly: { status: "ok", percent: 11, resetsAt: "2026-09-21T00:00:00.000Z" },
            monthly: { status: "ok", percent: 5, resetsAt: "2026-10-16T13:49:43.000Z" },
          },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await queryOpenCodeGoQuota({ apiKey: "sk-test" });

    expect(result).toMatchObject({ success: true, weekly: { usagePercent: 11 } });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://opencode.ai/zen/go/v1/usage");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("explains how to fix a rejected key", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 401 })) as unknown as typeof fetch;

    const result = await queryOpenCodeGoQuota({ apiKey: "bad" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContain("pi /login opencode-go");
  });

  it("reports a missing Go subscription", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 403 })) as unknown as typeof fetch;

    const result = await queryOpenCodeGoQuota({ apiKey: "sk-test" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContain("subscription required");
  });

  it("fails on an unparsable body", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("not json", { status: 200 })) as unknown as typeof fetch;

    const result = await queryOpenCodeGoQuota({ apiKey: "sk-test" });

    expect(result).toMatchObject({ success: false });
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContain("Could not parse");
  });

  it.each([
    ["TimeoutError", "Request timed out"],
    ["AbortError", "Request cancelled"],
  ])("maps %s to a friendly message", async (name, expected) => {
    const err = new Error("boom");
    err.name = name;
    globalThis.fetch = vi.fn().mockRejectedValue(err) as unknown as typeof fetch;

    const result = await queryOpenCodeGoQuota({ apiKey: "sk-test" });

    expect(result).toMatchObject({ success: false, error: expected });
  });

  it("surfaces unexpected request failures", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("socket hang up")) as unknown as typeof fetch;

    const result = await queryOpenCodeGoQuota({ apiKey: "sk-test" });

    expect(result).toMatchObject({ success: false, error: "socket hang up" });
  });
});

describe("apiKeyFromConfigData", () => {
  it("reads apiKey, key, and nested OpenCode auth entries", () => {
    expect(apiKeyFromConfigData({ apiKey: "sk-a" })).toEqual({ apiKey: "sk-a" });
    expect(apiKeyFromConfigData({ key: "sk-b" })).toEqual({ apiKey: "sk-b" });
    expect(apiKeyFromConfigData({ "opencode-go": { type: "api_key", key: "sk-c" } })).toEqual({
      apiKey: "sk-c",
    });
  });

  it("flags the removed workspaceId/authCookie config", () => {
    expect(apiKeyFromConfigData({ workspaceId: "wrk_1", authCookie: "Fe26.2**x" })).toEqual({
      legacy: true,
    });
  });

  it("returns null when no key is present", () => {
    expect(apiKeyFromConfigData({})).toBeNull();
    expect(apiKeyFromConfigData({ openai: { key: "sk-other" } })).toBeNull();
  });
});
