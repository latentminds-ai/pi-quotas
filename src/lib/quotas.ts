import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import { PROVIDER_FETCHERS } from "../providers/fetch.js";
import type {
  QuotaSource,
  QuotasResult,
  SupportedQuotaProvider,
} from "../types/quotas.js";

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

const PROVIDER_TTLS_MS: Record<QuotaSource, number> = {
  anthropic: 5 * 60_000,
  "claude-bridge": 5 * 60_000,
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

type CacheEntry = {
  result?: QuotasResult;
  fetchedAt?: number;
  inFlight?: Promise<QuotasResult>;
};

const cache = new Map<QuotaSource, CacheEntry>();

/**
 * Convert an unexpected throw from a provider fetcher into a failure result.
 *
 * The most common cause is pi's auth layer throwing a ModelsError when an
 * OAuth token refresh fails (e.g. an expired Anthropic refresh token). If we
 * let that rejection escape, it surfaces as an uncaughtException and crashes
 * pi, so it must be contained here.
 */
function toFailureResult(
  source: QuotaSource,
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
        message: `${PROVIDER_LABELS[quotaProviderForSource(source)]} OAuth token refresh failed — re-authenticate with /login`,
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

/**
 * Map the active model's provider to the quota source that reports its usage.
 * pi-claude-bridge models (`claude-bridge`) run on the Claude Code login, so
 * they report the Anthropic subscription through that login.
 */
export function quotaSourceForModelProvider(
  provider: string | undefined,
): QuotaSource | undefined {
  if (provider === "claude-bridge") return "claude-bridge";
  return isSupportedProvider(provider) ? provider : undefined;
}

/** The provider whose quota windows a source reports. */
export function quotaProviderForSource(
  source: QuotaSource,
): SupportedQuotaProvider {
  return source === "claude-bridge" ? "anthropic" : source;
}

export function clearQuotaCache(provider?: QuotaSource): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}

export async function fetchProviderQuotas(
  authStorage: AuthStorage,
  provider: QuotaSource,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<QuotasResult> {
  const entry = cache.get(provider) ?? {};
  const now = Date.now();
  const ttl = PROVIDER_TTLS_MS[provider];

  if (
    !options?.force &&
    entry.result &&
    entry.fetchedAt &&
    now - entry.fetchedAt < ttl
  ) {
    return entry.result;
  }
  if (!options?.force && entry.inFlight) return entry.inFlight;

  const promise = PROVIDER_FETCHERS[provider](authStorage, options?.signal)
    .catch((err: unknown) => toFailureResult(provider, err))
    .then((result: QuotasResult) => {
      cache.set(provider, { result, fetchedAt: Date.now() });
      return result;
    })
    .finally(() => {
      const current = cache.get(provider) ?? {};
      delete current.inFlight;
      cache.set(provider, current);
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
