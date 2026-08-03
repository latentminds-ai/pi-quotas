import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAnthropicQuotasWithToken,
  fetchCodexQuotasWithToken,
  fetchGitHubCopilotQuotas,
  fetchGitHubCopilotQuotasWithToken,
  fetchKimiCodingQuotasWithToken,
  fetchOpenRouterQuotasWithToken,
} from "./fetch.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchAnthropicQuotasWithToken", () => {
  it("returns config error when token missing", async () => {
    const result = await fetchAnthropicQuotasWithToken(undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("skips the OAuth usage call for a direct API key and returns not_applicable", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const result = await fetchAnthropicQuotasWithToken("sk-ant-api03-direct-key");

    expect(result).toMatchObject({
      success: false,
      error: { kind: "not_applicable" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches and parses quota windows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 21, resets_at: "2026-04-22T18:30:00Z" },
          seven_day: { utilization: 9, resets_at: "2026-04-25T08:30:00Z" },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchAnthropicQuotasWithToken("token");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("anthropic");
      expect(result.data.windows).toHaveLength(2);
    }
  });
});

describe("fetchCodexQuotasWithToken", () => {
  it("returns config error when account id missing", async () => {
    const result = await fetchCodexQuotasWithToken("token", undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses codex windows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: {
              used_percent: 44,
              reset_at: 1776880800,
              limit_window_seconds: 18000,
            },
            secondary_window: {
              used_percent: 12,
              reset_at: 1777485600,
              limit_window_seconds: 604800,
            },
          },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchCodexQuotasWithToken("token", "acct_123");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("openai-codex");
      expect(result.data.windows).toHaveLength(2);
    }
  });
});

describe("fetchGitHubCopilotQuotasWithToken", () => {
  it("exchanges token then fetches usage on happy path", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "copilot-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            quota_reset_date: "2026-05-01T00:00:00Z",
            quota_snapshots: {
              premium_interactions: {
                entitlement: 300,
                remaining: 240,
                percent_remaining: 80,
              },
            },
          }),
          { status: 200 },
        ),
      ) as any;

    const result = await fetchGitHubCopilotQuotasWithToken("gh-token");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("github-copilot");
      expect(result.data.windows).toHaveLength(1);
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to direct token when exchange returns 401", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            quota_reset_date: "2026-05-01T00:00:00Z",
            quota_snapshots: {
              premium_interactions: { entitlement: 300, remaining: 293 },
            },
          }),
          { status: 200 },
        ),
      ) as any;

    const result = await fetchGitHubCopilotQuotasWithToken("gh-token");
    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the stored GitHub OAuth refresh token for Pi 0.74 Copilot quota checks", async () => {
    const auth = AuthStorage.inMemory({
      "github-copilot": {
        type: "oauth",
        refresh: "ghu-refresh-token",
        access: "tid=abc;proxy-ep=proxy.individual.githubcopilot.com;exp=1778611280",
        expires: Date.now() + 60_000,
      },
    });

    globalThis.fetch = vi.fn(async (_url, init) => {
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization === "Bearer ghu-refresh-token") {
        return new Response(
          JSON.stringify({
            quota_reset_date: "2026-05-01T00:00:00Z",
            quota_snapshots: {
              premium_interactions: { entitlement: 300, remaining: 210 },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
    }) as any;

    const result = await fetchGitHubCopilotQuotas(auth);

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.github.com/copilot_internal/user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ghu-refresh-token" }),
      }),
    );
  });
});

describe("fetchKimiCodingQuotasWithToken", () => {
  it("returns config error when token missing", async () => {
    const result = await fetchKimiCodingQuotasWithToken(undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses Kimi Code subscription windows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            limit: "100",
            used: "20",
            remaining: "80",
            resetTime: "2026-08-10T10:01:47.875212Z",
          },
          limits: [
            {
              window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
              detail: {
                limit: "100",
                used: "45",
                resetTime: "2026-08-03T15:01:47.875212Z",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchKimiCodingQuotasWithToken("kimi-token");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("kimi-coding");
      expect(result.data.windows).toHaveLength(2);
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.kimi.com/coding/v1/usages",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer kimi-token",
        }),
      }),
    );
  });
});

describe("fetchOpenRouterQuotasWithToken", () => {
  it("returns config error when token missing", async () => {
    const result = await fetchOpenRouterQuotasWithToken(undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses OpenRouter key info with budget", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
            is_free_tier: false,
          },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchOpenRouterQuotasWithToken("sk-or-test");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("openrouter");
      expect(result.data.windows).toHaveLength(4);
      expect(result.data.windows[0]).toMatchObject({
        label: "Monthly Budget",
        usedValue: 15,
        limitValue: 50,
      });
    }
  });

  it("handles HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    ) as any;

    const result = await fetchOpenRouterQuotasWithToken("bad-key");
    expect(result).toMatchObject({
      success: false,
      error: { kind: "http" },
    });
  });

  it("extracts a clean message from a JSON error body instead of raw JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
        { status: 401 },
      ),
    ) as any;

    const result = await fetchOpenRouterQuotasWithToken("bad-key");
    expect(result).toMatchObject({ success: false, error: { kind: "http" } });
    if (!result.success) {
      expect(result.error.message).toBe("invalid x-api-key");
      expect(result.error.message).not.toContain("{");
    }
  });
});
