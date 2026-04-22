import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import { PROVIDER_FETCHERS } from "../providers/fetch.js";
import type { QuotasResult, SupportedQuotaProvider } from "../types/quotas.js";

export const SUPPORTED_PROVIDERS: SupportedQuotaProvider[] = [
  "anthropic",
  "openai-codex",
  "github-copilot",
];

export const PROVIDER_LABELS: Record<SupportedQuotaProvider, string> = {
  anthropic: "Anthropic",
  "openai-codex": "OpenAI Codex",
  "github-copilot": "GitHub Copilot",
};

const PROVIDER_TTLS_MS: Record<SupportedQuotaProvider, number> = {
  anthropic: 5 * 60_000,
  "openai-codex": 60_000,
  "github-copilot": 5 * 60_000,
};

type CacheEntry = {
  result?: QuotasResult;
  fetchedAt?: number;
  inFlight?: Promise<QuotasResult>;
};

const cache = new Map<SupportedQuotaProvider, CacheEntry>();

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

  if (!options?.force && entry.result && entry.fetchedAt && now - entry.fetchedAt < ttl) {
    return entry.result;
  }
  if (!options?.force && entry.inFlight) return entry.inFlight;

  const promise = PROVIDER_FETCHERS[provider](authStorage, options?.signal)
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
