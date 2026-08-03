import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAgentDir,
  type AuthStorage,
} from "@mariozechner/pi-coding-agent";

type CompatibleModelRegistry = {
  authStorage?: AuthStorage;
  getApiKeyForProvider?: (provider: string) => Promise<string | undefined>;
  getProviderAuth?: (
    provider: string,
  ) => Promise<{ auth?: { apiKey?: string } } | undefined>;
};

function storedCredential(provider: string): unknown {
  try {
    const authPath = join(getAgentDir(), "auth.json");
    const credentials = JSON.parse(readFileSync(authPath, "utf8")) as Record<
      string,
      unknown
    >;
    return credentials[provider];
  } catch {
    return undefined;
  }
}

/**
 * Support both upstream Pi's legacy `modelRegistry.authStorage` API and
 * newer Pi distributions that expose resolved provider auth through methods.
 */
export function quotaAuthStorage(
  modelRegistry: CompatibleModelRegistry,
): AuthStorage {
  const legacy = modelRegistry.authStorage;
  if (legacy) return legacy;

  return {
    // Quota endpoints need stored OAuth metadata such as the GitHub refresh
    // token and Codex account id, which resolved provider auth omits.
    get: storedCredential,
    getApiKey: async (provider: string) => {
      if (modelRegistry.getApiKeyForProvider) {
        return modelRegistry.getApiKeyForProvider(provider);
      }
      return (await modelRegistry.getProviderAuth?.(provider))?.auth?.apiKey;
    },
  } as unknown as AuthStorage;
}
