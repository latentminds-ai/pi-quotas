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
    xai: vi.fn(),
    zai: vi.fn(),
    "opencode-go": vi.fn(),
    "kimi-coding": vi.fn(),
    "ollama-cloud": vi.fn(),
    antigravity: vi.fn(),
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

  it("passes through successful results", async () => {
    fetcherMocks["kimi-coding"].mockResolvedValue(successResult);

    const result = await fetchProviderQuotas(authStorage, "kimi-coding");

    expect(result).toBe(successResult);
  });
});
