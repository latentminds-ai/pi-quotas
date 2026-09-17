import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuotasResult } from "../types/quotas.js";
import { clearQuotaCache, fetchProviderQuotas } from "./quotas.js";

const successResult: QuotasResult = {
  success: true,
  data: { provider: "anthropic", windows: [] },
};

const { fetcherMocks } = vi.hoisted(() => ({
  fetcherMocks: {
    anthropic: vi.fn(),
    "openai-codex": vi.fn(),
    "github-copilot": vi.fn(),
    openrouter: vi.fn(),
    synthetic: vi.fn(),
    zai: vi.fn(),
    "opencode-go": vi.fn(),
    "kimi-coding": vi.fn(),
  },
}));

vi.mock("../providers/fetch.js", () => ({
  PROVIDER_FETCHERS: fetcherMocks,
}));

const authStorage = {} as AuthStorage;

afterEach(() => {
  clearQuotaCache();
  vi.clearAllMocks();
});

describe("fetchProviderQuotas", () => {
  it("converts an OAuth refresh failure into a failure result instead of throwing", async () => {
    // pi's auth layer throws a ModelsError with code "oauth" when an OAuth
    // token refresh fails (e.g. an expired Anthropic refresh token). This
    // must not escape as an uncaughtException.
    const err = new Error(
      "OAuth refresh failed for anthropic: Refresh token expired",
    );
    (err as { code?: string }).code = "oauth";
    fetcherMocks.anthropic.mockRejectedValue(err);

    const result = await fetchProviderQuotas(authStorage, "anthropic");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe("config");
      expect(result.error.message).toContain("/login");
      expect(result.error.message).not.toContain("Refresh token expired");
    }
  });

  it("converts unexpected throws into a network failure result", async () => {
    fetcherMocks.zai.mockRejectedValue(new Error("boom\nwith a stack trace"));

    const result = await fetchProviderQuotas(authStorage, "zai");

    expect(result).toMatchObject({
      success: false,
      error: { kind: "network", message: "boom" },
    });
  });

  it("caches converted failures like normal results", async () => {
    fetcherMocks.synthetic.mockRejectedValue(new Error("boom"));

    const first = await fetchProviderQuotas(authStorage, "synthetic");
    const second = await fetchProviderQuotas(authStorage, "synthetic");

    expect(first.success).toBe(false);
    expect(second).toBe(first);
    expect(fetcherMocks.synthetic).toHaveBeenCalledTimes(1);
  });

  it("keeps serving the last good snapshot when a refresh fails", async () => {
    fetcherMocks.zai.mockResolvedValueOnce(successResult);
    const first = await fetchProviderQuotas(authStorage, "zai");
    expect(first).toBe(successResult);

    // Age the snapshot past the provider TTL, then fail the refresh.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    try {
      fetcherMocks.zai.mockRejectedValueOnce(new Error("boom"));
      const second = await fetchProviderQuotas(authStorage, "zai");

      expect(second).toBe(successResult);
      expect(fetcherMocks.zai).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses a cached failure when there is no known-good snapshot", async () => {
    fetcherMocks.zai.mockRejectedValue(new Error("boom"));

    const first = await fetchProviderQuotas(authStorage, "zai");
    const second = await fetchProviderQuotas(authStorage, "zai");

    expect(first.success).toBe(false);
    expect(second).toBe(first);
    expect(fetcherMocks.zai).toHaveBeenCalledTimes(1);
  });

  it("passes through successful results", async () => {
    fetcherMocks["kimi-coding"].mockResolvedValue(successResult);

    const result = await fetchProviderQuotas(authStorage, "kimi-coding");

    expect(result).toBe(successResult);
  });
});
