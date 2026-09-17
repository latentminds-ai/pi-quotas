import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import { PROVIDER_FETCHERS } from "../providers/fetch.js";
import type { QuotasResult, SupportedQuotaProvider } from "../types/quotas.js";

export const SUPPORTED_PROVIDERS: SupportedQuotaProvider[] = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "openrouter",
  "synthetic",
  "xai",
  "zai",
  "opencode-go",
  "kimi-coding",
  "ollama-cloud",
];

export const PROVIDER_LABELS: Record<SupportedQuotaProvider, string> = {
  anthropic: "Anthropic",
  "openai-codex": "OpenAI Codex",
  "github-copilot": "GitHub Copilot",
  openrouter: "OpenRouter",
  synthetic: "Synthetic",
  xai: "Grok",
  zai: "Z.ai",
  "opencode-go": "OpenCode Go",
  "kimi-coding": "Kimi Code",
  "ollama-cloud": "Ollama Cloud",
};

/**
 * Cache freshness for each provider.
 * Anthropic uses the same 60 s window as pi-anthropic-auth’s
 * DEFAULT_USAGE_CACHE_MAX_AGE_MS so that background polling and the
 * on-demand /quotas command share the same rate behaviour.
 */
const PROVIDER_TTLS_MS: Record<SupportedQuotaProvider, number> = {
  anthropic: 60_000,
  "openai-codex": 60_000,
  "github-copilot": 5 * 60_000,
  openrouter: 60_000,
  synthetic: 60_000,
  xai: 60_000,
  zai: 60_000,
  "opencode-go": 60_000,
  "kimi-coding": 60_000,
  "ollama-cloud": 60_000,
};

/**
 * Mirrors pi-anthropic-auth’s UsageSnapshotCache design:
 * - lastSuccess stores only the most recent successful result.
 * - On any failure the caller receives lastSuccess (stale) when available,
 *   so the footer never shows “usage unavailable” just because one refresh
 *   hit a transient error.
 * - lastFailure stores the most recent failure when there is no known-good
 *   snapshot, so a burst of polls (or a repeated /quotas command) reuses one
 *   contained failure instead of re-hitting a failing endpoint.
 * - rateLimitedUntil prevents hammering the endpoint after a 429.
 */
type CacheEntry = {
  lastSuccess?: QuotasResult;
  lastSuccessAt?: number;
  lastFailure?: QuotasResult;
  lastFailureAt?: number;
  /** Set on 429 — don’t retry until this timestamp. */
  rateLimitedUntil?: number;
  inFlight?: Promise<QuotasResult>;
};

/** 2-hour backoff when a provider returns 429. */
const RATE_LIMIT_BACKOFF_MS = 2 * 60 * 60_000;

const cache = new Map<SupportedQuotaProvider, CacheEntry>();

/**
 * Convert an unexpected throw from a provider fetcher into a failure result.
 *
 * The most common cause is pi's auth layer throwing a ModelsError when an
 * OAuth token refresh fails (e.g. an expired Anthropic refresh token). If we
 * let that rejection escape, it surfaces as an uncaughtException and crashes
 * pi, so it must be contained here.
 */
function toFailureResult(
  provider: SupportedQuotaProvider,
  err: unknown,
): QuotasResult {
  const message = err instanceof Error ? err.message : String(err);
  const isOAuthError =
    (err as { code?: string } | null)?.code === "oauth" ||
    /oauth|refresh token|token refresh/i.test(message);
  if (isOAuthError) {
    return {
      success: false,
      error: {
        message: `${PROVIDER_LABELS[provider]} OAuth token refresh failed — re-authenticate with /login`,
        kind: "config",
      },
    };
  }
  return {
    success: false,
    error: {
      message: message.split("\n")[0].slice(0, 200) || "Unknown error",
      kind: "network",
    },
  };
}

export function isSupportedProvider(
  provider: string | undefined,
): provider is SupportedQuotaProvider {
  return SUPPORTED_PROVIDERS.includes(provider as SupportedQuotaProvider);
}

export function clearQuotaCache(provider?: SupportedQuotaProvider): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}

export async function fetchProviderQuotas(
  authStorage: AuthStorage,
  provider: SupportedQuotaProvider,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<QuotasResult> {
  const entry = cache.get(provider) ?? {};
  const now = Date.now();
  const ttl = PROVIDER_TTLS_MS[provider];

  // Still inside the rate-limit backoff window — return last good result
  // (stale) if available, otherwise treat as not_applicable so nothing shows.
  if (!options?.force && entry.rateLimitedUntil && now < entry.rateLimitedUntil) {
    return entry.lastSuccess ?? {
      success: false,
      error: { message: "Rate limited", kind: "not_applicable" },
    };
  }

  // Fresh successful result — return it as-is (mirrors isFresh() in
  // pi-anthropic-auth’s UsageSnapshotCache).
  if (
    !options?.force &&
    entry.lastSuccess &&
    entry.lastSuccessAt &&
    now - entry.lastSuccessAt < ttl
  ) {
    return entry.lastSuccess;
  }

  if (!options?.force && entry.inFlight) return entry.inFlight;

  // Fresh failure with nothing better to show — reuse it. Without this, every
  // poll would re-hit a failing endpoint and hand back a brand new failure
  // object, which also breaks the "cached like any other result" contract.
  if (
    !options?.force &&
    !entry.lastSuccess &&
    entry.lastFailure &&
    entry.lastFailureAt &&
    now - entry.lastFailureAt < ttl
  ) {
    return entry.lastFailure;
  }

  const promise = PROVIDER_FETCHERS[provider](authStorage, options?.signal)
    .catch((err: unknown) => toFailureResult(provider, err))
    .then((result: QuotasResult) => {
      if (result.success) {
        // Success — store as the new fresh snapshot (mirrors startRefresh in
        // pi-anthropic-auth’s UsageSnapshotCache).
        cache.set(provider, {
          lastSuccess: result,
          lastSuccessAt: Date.now(),
        });
        return result;
      }

      // Failure — keep lastSuccess alive. On 429 apply the longer
      // rate-limit backoff; other transient failures retry on next tick.
      const rateLimitedUntil =
        result.error.kind === "rate_limited"
          ? Date.now() + RATE_LIMIT_BACKOFF_MS
          : undefined;

      // A stale last-good snapshot always wins over a fresh failure. Only
      // memoize the failure when it is the best information we have.
      if (!entry.lastSuccess) {
        cache.set(provider, {
          ...entry,
          lastFailure: result,
          lastFailureAt: Date.now(),
          ...(rateLimitedUntil ? { rateLimitedUntil } : {}),
        });
        return result;
      }

      cache.set(provider, {
        ...entry,
        ...(rateLimitedUntil ? { rateLimitedUntil } : {}),
      });

      // Return stale last-good result when available (mirrors the catch branch
      // in pi-anthropic-auth’s UsageSnapshotCache.get()).
      return entry.lastSuccess ?? result;
    })
    .finally(() => {
      const current = cache.get(provider) ?? {};
      if (current.inFlight === promise) {
        delete current.inFlight;
        cache.set(provider, current);
      }
    });

  cache.set(provider, { ...entry, inFlight: promise });
  return promise;
}

export async function fetchAllProviderQuotas(
  authStorage: AuthStorage,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<Array<{ provider: SupportedQuotaProvider; result: QuotasResult }>> {
  return Promise.all(
    SUPPORTED_PROVIDERS.map(async (provider) => ({
      provider,
      result: await fetchProviderQuotas(authStorage, provider, options),
    })),
  );
}

export function formatResetTime(renewsAt: string): string {
  const date = new Date(renewsAt);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) return "soon";

  const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffDays < 7) return `in ${diffDays}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
