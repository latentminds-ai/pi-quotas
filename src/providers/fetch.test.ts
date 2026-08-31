import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAnthropicQuotasWithToken,
  fetchCodexQuotasWithToken,
  fetchGitHubCopilotQuotas,
  fetchGitHubCopilotQuotasWithToken,
  fetchKimiCodingQuotasWithToken,
  fetchOllamaCloudQuotasWithToken,
  fetchOpenRouterQuotasWithToken,
  fetchSyntheticQuotas,
  fetchXaiQuotasWithToken,
  fetchAntigravityQuotasWithCredentials,
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

  it("accepts OAuth tokens and parses quota windows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 21, resets_at: "2026-04-22T18:30:00Z" },
          seven_day: { utilization: 9, resets_at: "2026-04-25T08:30:00Z" },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchAnthropicQuotasWithToken("sk-ant-oat01-oauth-token");
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

describe("fetchSyntheticQuotas", () => {
  const authStorageWithKey = (key: string | undefined) =>
    ({
      getApiKey: vi.fn().mockResolvedValue(key),
    }) as unknown as AuthStorage;

  const quotasResponse = () =>
    new Response(
      JSON.stringify({
        weeklyTokenLimit: {
          nextRegenAt: "2026-01-08T00:00:00.000Z",
          percentRemaining: 90,
          maxCredits: "$24.00",
          remainingCredits: "$21.60",
          nextRegenCredits: "$0.48",
        },
        rollingFiveHourLimit: {
          nextTickAt: "2026-01-01T01:00:00.000Z",
          tickPercent: 0.05,
          remaining: 490,
          max: 500,
          limited: false,
        },
      }),
      { status: 200 },
    );

  afterEach(() => {
    delete process.env.SYNTHETIC_API_KEY;
  });

  it("prefers the auth.json key over SYNTHETIC_API_KEY", async () => {
    process.env.SYNTHETIC_API_KEY = "env-key";
    const fetchSpy = vi.fn().mockResolvedValue(quotasResponse());
    globalThis.fetch = fetchSpy as any;

    const result = await fetchSyntheticQuotas(authStorageWithKey("syn_stored"));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("synthetic");
      expect(result.data.windows.length).toBeGreaterThan(0);
    }
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer syn_stored",
    );
  });

  it("falls back to SYNTHETIC_API_KEY when no stored credential exists", async () => {
    process.env.SYNTHETIC_API_KEY = "env-key";
    const fetchSpy = vi.fn().mockResolvedValue(quotasResponse());
    globalThis.fetch = fetchSpy as any;

    const result = await fetchSyntheticQuotas(authStorageWithKey(undefined));
    expect(result.success).toBe(true);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer env-key",
    );
  });

  it("returns config error when neither auth.json nor env var provides a key", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const result = await fetchSyntheticQuotas(authStorageWithKey(undefined));
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchOllamaCloudQuotasWithToken", () => {
  it("returns config error when token missing", async () => {
    const result = await fetchOllamaCloudQuotasWithToken(undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses Ollama Cloud usage", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          limits: {
            session: { usage: 0.34, models: [] },
            weekly: { usage: 0.45, models: [] },
          },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchOllamaCloudQuotasWithToken("ollama-key");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("ollama-cloud");
      expect(result.data.windows).toHaveLength(2);
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://ollama.com/api/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ollama-key",
        }),
      }),
    );
  });
});

describe("fetchXaiQuotasWithToken", () => {
  it("returns config error when token missing", async () => {
    const result = await fetchXaiQuotasWithToken(undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses Grok subscription quotas", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          config: {
            currentPeriod: {
              type: "USAGE_PERIOD_TYPE_WEEKLY",
              start: "2026-08-25T17:13:55Z",
              end: "2026-09-01T17:13:55Z",
            },
            creditUsagePercent: 17,
            productUsage: [{ product: "GrokBuild", usagePercent: 10 }],
          },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchXaiQuotasWithToken("xai-token");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("xai");
      expect(result.data.windows).toHaveLength(2);
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer xai-token",
        }),
      }),
    );
  });

  it("reports Grok billing HTTP failures", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "token rejected" }), {
        status: 401,
      }),
    ) as any;

    const result = await fetchXaiQuotasWithToken("bad-token");

    expect(result).toMatchObject({
      success: false,
      error: { kind: "http", message: "token rejected" },
    });
  });
});

describe("fetchAntigravityQuotasWithCredentials", () => {
  it("returns config error when credentials missing", async () => {
    const result = await fetchAntigravityQuotasWithCredentials({});
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses Google Antigravity quotas", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: {
            "claude-opus-4-6-thinking": {
              displayName: "Claude Opus 4.6 (Thinking)",
              quotaInfo: {
                remainingFraction: 1,
                resetTime: "2026-09-01T01:52:45Z",
              },
            },
            "gemini-3.1-pro-low": {
              displayName: "Gemini 3.1 Pro (Low)",
              quotaInfo: {
                remainingFraction: 0.7,
                resetTime: "2026-09-01T00:17:56Z",
              },
            },
          },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchAntigravityQuotasWithCredentials({
      accessToken: "antigravity-token",
      projectId: "aicode-consumers",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("antigravity");
      expect(result.data.windows).toHaveLength(2);
      expect(result.data.windows[0]).toMatchObject({
        label: "Claude",
        usedPercent: 0,
      });
      expect(result.data.windows[1]).toMatchObject({
        label: "Gemini Pro",
        usedPercent: 30,
      });
    }

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer antigravity-token",
        }),
      }),
    );
  });

  it("handles HTTP error from fetchAvailableModels", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    ) as any;

    const result = await fetchAntigravityQuotasWithCredentials({
      accessToken: "bad-token",
    });

    expect(result).toMatchObject({
      success: false,
      error: { kind: "http" },
    });
  });
});
