import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { QuotasErrorKind, QuotasResult, SupportedQuotaProvider } from "../types/quotas.js";
import {
  parseAnthropicUsage,
  parseCodexUsage,
  parseGitHubCopilotUsage,
  parseKimiCodingUsage,
  parseOllamaCloudUsage,
  parseOpenRouterUsage,
  parseSyntheticUsage,
  parseXaiUsage,
  parseZaiUsage,
  parseOpenCodeGoUsage,
  parseAntigravityUsage,
} from "./providers.js";
import { resolveOpenCodeGoConfigCached } from "./opencode-go-config.js";
import { queryOpenCodeGoQuota } from "./opencode-go.js";

const FETCH_TIMEOUT_MS = 15_000;
const COPILOT_VERSION = "0.35.0";
const EDITOR_VERSION = "vscode/1.107.0";

function isTimeoutReason(reason: unknown): boolean {
  return (
    (reason instanceof DOMException && reason.name === "TimeoutError") ||
    (reason instanceof Error && reason.name === "TimeoutError")
  );
}

async function providerAccessToken(
  authStorage: AuthStorage,
  provider: string,
): Promise<string | undefined> {
  return authStorage.getApiKey(provider);
}

/**
 * Detect a raw Anthropic API key. OAuth subscription tokens use the
 * `sk-ant-oat` prefix, while direct API keys use `sk-ant-api`.
 */
function isDirectAnthropicApiKey(token: string): boolean {
  return token.startsWith("sk-ant-api");
}

function codexAccountId(authStorage: AuthStorage): string | undefined {
  const credential = authStorage.get("openai-codex") as any;
  if (typeof credential?.accountId === "string") return credential.accountId;
  try {
    const authPath = join(homedir(), ".codex", "auth.json");
    const data = JSON.parse(readFileSync(authPath, "utf8")) as any;
    return data?.tokens?.account_id ?? data?.tokens?.accountId;
  } catch {
    return undefined;
  }
}

type FetchJsonResult =
  | { ok: true; data: any }
  | {
      ok: false;
      status?: number;
      message: string;
      kind: "timeout" | "cancelled" | "http" | "network";
    };

/**
 * Reduce a raw HTTP error body to a short, human-readable message.
 *
 * Many APIs return a JSON error object (e.g. Anthropic's
 * `{"error":{"type":"authentication_error","message":"..."}}` or a
 * bare `{"message":"..."}`). Surfacing the raw blob in the dashboard or
 * footer is ugly and confusing, so extract the inner message field when the
 * body parses as JSON; otherwise return the body unchanged.
 */
function cleanHttpErrorMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as any;
    const message =
      parsed?.error?.message ??
      parsed?.message ??
      parsed?.error ??
      parsed?.detail ??
      parsed?.error_description;
    if (typeof message === "string" && message.trim()) return message.trim();
  } catch {
    // Not valid JSON — fall through to the raw body.
  }
  return trimmed;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<FetchJsonResult> {
  const signals: AbortSignal[] = [AbortSignal.timeout(FETCH_TIMEOUT_MS)];
  if (signal) signals.push(signal);
  const combined = AbortSignal.any(signals);

  try {
    const response = await fetch(url, { ...init, signal: combined });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        message: cleanHttpErrorMessage(body) || response.statusText || `HTTP ${response.status}`,
        kind: "http",
      };
    }
    return { ok: true, data: await response.json() };
  } catch (err: unknown) {
    const isAbort =
      combined.aborted ||
      (err instanceof DOMException && err.name === "AbortError");
    if (isAbort) {
      if (isTimeoutReason(combined.reason)) {
        return { ok: false, message: "Request timed out", kind: "timeout" };
      }
      return { ok: false, message: "Request cancelled", kind: "cancelled" };
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, message, kind: "network" };
  }
}

function success(
  provider: SupportedQuotaProvider,
  windows: ReturnType<typeof parseAnthropicUsage>,
): QuotasResult {
  return { success: true, data: { provider, windows } };
}

function failure(
  message: string,
  kind: QuotasErrorKind,
): QuotasResult {
  return { success: false, error: { message, kind } };
}

export async function fetchAnthropicQuotasWithToken(
  accessToken: string | undefined,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  if (!accessToken) return failure("No Anthropic OAuth token found", "config");
  // The /api/oauth/usage endpoint requires OAuth subscription credentials.
  // A direct API key (e.g. `sk-ant-api03-...` registered via `pi /login`) is
  // not an OAuth token, so the call would always fail. Detect it up front and
  // return a silent "not applicable" result rather than a warning.
  if (isDirectAnthropicApiKey(accessToken)) {
    return failure(
      "Direct Anthropic API key — no subscription usage to report",
      "not_applicable",
    );
  }
  const result = await fetchJson(
    "https://api.anthropic.com/api/oauth/usage",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
    },
    signal,
  );
  if (!result.ok) return failure(result.message, result.kind);
  return success("anthropic", parseAnthropicUsage(result.data));
}

export async function fetchCodexQuotasWithToken(
  accessToken: string | undefined,
  accountId: string | undefined,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  if (!accessToken) return failure("No Codex access token found", "config");
  if (!accountId) return failure("No Codex account id found", "config");
  const result = await fetchJson(
    "https://chatgpt.com/backend-api/wham/usage",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "ChatGPT-Account-Id": accountId,
        Accept: "application/json",
        Origin: "https://chatgpt.com",
        Referer: "https://chatgpt.com/",
        "User-Agent": "Mozilla/5.0",
      },
    },
    signal,
  );
  if (!result.ok) return failure(result.message, result.kind);
  return success("openai-codex", parseCodexUsage(result.data));
}

function copilotHeaders(authHeader: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: authHeader,
    "User-Agent": `GitHubCopilotChat/${COPILOT_VERSION}`,
    "Editor-Version": EDITOR_VERSION,
    "Editor-Plugin-Version": `copilot-chat/${COPILOT_VERSION}`,
    "Copilot-Integration-Id": "vscode-chat",
    "Content-Type": "application/json",
  };
}

/**
 * Try to get a token from `gh auth token` CLI as fallback when the Pi-stored
 * OAuth token is stale or the token exchange returns 401.
 */
function ghCliToken(): string | undefined {
  try {
    return (
      execFileSync("gh", ["auth", "token"], {
        timeout: 5000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

async function tryGitHubUserEndpoint(
  authHeader: string,
  signal?: AbortSignal,
): Promise<FetchJsonResult> {
  return fetchJson(
    "https://api.github.com/copilot_internal/user",
    { headers: copilotHeaders(authHeader) },
    signal,
  );
}

function githubOAuthToken(authStorage: AuthStorage): string | undefined {
  // Pi's GitHub Copilot OAuth credential stores the GitHub OAuth token in
  // `refresh`; `access` is a Copilot proxy token (tid=...;proxy-ep=...) that
  // is valid for model calls but rejected by api.github.com quota endpoints.
  const credential = authStorage.get("github-copilot") as any;
  if (credential?.type !== "oauth") return undefined;
  return typeof credential.refresh === "string" && credential.refresh.length > 0
    ? credential.refresh
    : undefined;
}

async function fetchGitHubCopilotQuotasWithGitHubToken(
  githubToken: string | undefined,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  if (!githubToken)
    return failure("No GitHub Copilot OAuth token found", "config");

  const bearerUsage = await tryGitHubUserEndpoint(
    `Bearer ${githubToken}`,
    signal,
  );
  if (bearerUsage.ok)
    return success("github-copilot", parseGitHubCopilotUsage(bearerUsage.data));

  const tokenUsage = await tryGitHubUserEndpoint(
    `token ${githubToken}`,
    signal,
  );
  if (tokenUsage.ok)
    return success("github-copilot", parseGitHubCopilotUsage(tokenUsage.data));

  return failure(bearerUsage.message, bearerUsage.kind);
}

export async function fetchGitHubCopilotQuotasWithToken(
  accessToken: string | undefined,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  if (!accessToken)
    return failure("No GitHub Copilot OAuth token found", "config");

  // 1) Try Copilot token exchange with stored Pi token
  const exchange = await fetchJson(
    "https://api.github.com/copilot_internal/v2/token",
    { headers: copilotHeaders(`Bearer ${accessToken}`) },
    signal,
  );

  if (exchange.ok && exchange.data?.token) {
    const usage = await tryGitHubUserEndpoint(
      `Bearer ${exchange.data.token}`,
      signal,
    );
    if (usage.ok)
      return success("github-copilot", parseGitHubCopilotUsage(usage.data));
  }

  // 2) Try stored token directly
  const directUsage = await tryGitHubUserEndpoint(
    `token ${accessToken}`,
    signal,
  );
  if (directUsage.ok)
    return success("github-copilot", parseGitHubCopilotUsage(directUsage.data));

  // 3) Fallback: gh CLI token
  const cliToken = ghCliToken();
  if (cliToken && cliToken !== accessToken) {
    const cliUsage = await tryGitHubUserEndpoint(`token ${cliToken}`, signal);
    if (cliUsage.ok)
      return success("github-copilot", parseGitHubCopilotUsage(cliUsage.data));
    return failure(cliUsage.message, cliUsage.kind);
  }

  return failure(directUsage.message, directUsage.kind);
}

export async function fetchAnthropicQuotas(
  authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  return fetchAnthropicQuotasWithToken(
    await providerAccessToken(authStorage, "anthropic"),
    signal,
  );
}

export async function fetchCodexQuotas(
  authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  return fetchCodexQuotasWithToken(
    await providerAccessToken(authStorage, "openai-codex"),
    codexAccountId(authStorage),
    signal,
  );
}

export async function fetchGitHubCopilotQuotas(
  authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  const oauthResult = await fetchGitHubCopilotQuotasWithGitHubToken(
    githubOAuthToken(authStorage),
    signal,
  );
  if (
    oauthResult.success ||
    oauthResult.error.kind === "cancelled" ||
    oauthResult.error.kind === "timeout"
  ) {
    return oauthResult;
  }

  return fetchGitHubCopilotQuotasWithToken(
    await providerAccessToken(authStorage, "github-copilot"),
    signal,
  );
}

export async function fetchOpenRouterQuotasWithToken(
  accessToken: string | undefined,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  if (!accessToken) return failure("No OpenRouter API key found", "config");
  const result = await fetchJson(
    "https://openrouter.ai/api/v1/key",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
    signal,
  );
  if (!result.ok) return failure(result.message, result.kind);
  return success("openrouter", parseOpenRouterUsage(result.data));
}

export async function fetchOpenRouterQuotas(
  authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  return fetchOpenRouterQuotasWithToken(
    await providerAccessToken(authStorage, "openrouter"),
    signal,
  );
}

export async function fetchSyntheticQuotas(
  authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  // Prefer the key stored via `pi /login` (auth.json); fall back to the
  // SYNTHETIC_API_KEY env var for setups that don't register credentials.
  const apiKey =
    (await providerAccessToken(authStorage, "synthetic")) ??
    process.env.SYNTHETIC_API_KEY;
  if (!apiKey)
    return failure(
      "No Synthetic API key found (run `pi /login synthetic` or set SYNTHETIC_API_KEY)",
      "config",
    );

  const result = await fetchJson(
    "https://api.synthetic.new/v2/quotas",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    signal,
  );
  if (!result.ok) return failure(result.message, result.kind);
  return success("synthetic", parseSyntheticUsage(result.data));
}

export async function fetchOpenCodeGoQuotas(
  _authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  const configResult = await resolveOpenCodeGoConfigCached();
  if (configResult.state === "none") {
    return failure(
      "No OpenCode Go config. Set OPENCODE_GO_WORKSPACE_ID +" +
        " OPENCODE_GO_AUTH_COOKIE, or create" +
        " ~/.config/opencode/opencode-quota/opencode-go.json",
      "config",
    );
  }
  if (configResult.state === "incomplete") {
    return failure(
      `OpenCode Go config incomplete: missing ${configResult.missing}`,
      "config",
    );
  }
  if (configResult.state === "invalid") {
    return failure(
      `OpenCode Go config invalid: ${configResult.error}`,
      "config",
    );
  }

  const result = await queryOpenCodeGoQuota(configResult.config, signal);
  if (!result.success) return failure(result.error, "http");
  return success("opencode-go", parseOpenCodeGoUsage(result));
}

export async function fetchKimiCodingQuotasWithToken(
  accessToken: string | undefined,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  if (!accessToken)
    return failure("No Kimi Code access token found", "config");

  const result = await fetchJson(
    "https://api.kimi.com/coding/v1/usages",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
    signal,
  );
  if (!result.ok) return failure(result.message, result.kind);
  return success("kimi-coding", parseKimiCodingUsage(result.data));
}

export async function fetchKimiCodingQuotas(
  authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  return fetchKimiCodingQuotasWithToken(
    await providerAccessToken(authStorage, "kimi-coding"),
    signal,
  );
}

export async function fetchZaiQuotasWithToken(
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  if (!apiKey) return failure("No Z.ai API key found", "config");
  const result = await fetchJson(
    "https://api.z.ai/api/monitor/usage/quota/limit",
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
    signal,
  );
  if (!result.ok) return failure(result.message, result.kind);
  return success("zai", parseZaiUsage(result.data));
}

export async function fetchZaiQuotas(
  authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  return fetchZaiQuotasWithToken(await providerAccessToken(authStorage, "zai"), signal);
}

export async function fetchOllamaCloudQuotasWithToken(
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  if (!apiKey) return failure("No Ollama Cloud API key found", "config");
  const result = await fetchJson(
    "https://ollama.com/api/usage",
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
    signal,
  );
  if (!result.ok) return failure(result.message, result.kind);
  return success("ollama-cloud", parseOllamaCloudUsage(result.data));
}

export async function fetchOllamaCloudQuotas(
  authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  const apiKey =
    (await providerAccessToken(authStorage, "ollama-cloud")) ??
    process.env.OLLAMA_API_KEY;
  return fetchOllamaCloudQuotasWithToken(apiKey, signal);
}

export async function fetchXaiQuotasWithToken(
  accessToken: string | undefined,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  if (!accessToken) return failure("No xAI OAuth token found", "config");

  const result = await fetchJson(
    "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
    signal,
  );
  if (!result.ok) return failure(result.message, result.kind);
  return success("xai", parseXaiUsage(result.data));
}

export async function fetchXaiQuotas(
  authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  return fetchXaiQuotasWithToken(
    await providerAccessToken(authStorage, "xai"),
    signal,
  );
}

export const ANTIGRAVITY_CLIENT_ID =
  process.env.ANTIGRAVITY_CLIENT_ID ||
  atob(
    "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlc" +
      "C5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
  );
export const ANTIGRAVITY_CLIENT_SECRET =
  process.env.ANTIGRAVITY_CLIENT_SECRET ||
  atob("R09DU1BYLUs1OEZXUjQ" + "4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");

const ANTIGRAVITY_FETCH_MODELS_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const ANTIGRAVITY_USER_AGENT = "antigravity/1.11.9 darwin/arm64";

export async function refreshAntigravityToken(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; message: string }
> {
  const body = new URLSearchParams({
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetchJson(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    signal,
  );

  if (!res.ok) {
    return {
      ok: false,
      message: res.message || "Failed to refresh Antigravity token",
    };
  }

  return {
    ok: true,
    accessToken: res.data.access_token,
    expiresIn: res.data.expires_in,
  };
}

function readAntigravityAccountsFallback(): {
  accessToken?: string;
  refreshToken?: string;
  projectId?: string;
} | null {
  const candidates = [
    join(homedir(), ".config", "opencode", "antigravity-accounts.json"),
    join(homedir(), ".local", "share", "opencode", "antigravity-accounts.json"),
  ];
  if (process.env.APPDATA) {
    candidates.push(
      join(process.env.APPDATA, "opencode", "antigravity-accounts.json"),
    );
  }
  if (process.env.XDG_CONFIG_HOME) {
    candidates.push(
      join(
        process.env.XDG_CONFIG_HOME,
        "opencode",
        "antigravity-accounts.json",
      ),
    );
  }
  if (process.env.XDG_DATA_HOME) {
    candidates.push(
      join(process.env.XDG_DATA_HOME, "opencode", "antigravity-accounts.json"),
    );
  }

  for (const p of candidates) {
    try {
      const data = JSON.parse(readFileSync(p, "utf8")) as any;
      if (Array.isArray(data?.accounts) && data.accounts.length > 0) {
        // 1. Honor selected/active account specified in file metadata
        const activeId =
          data.activeAccountId || data.selectedAccountId || data.selectedAccount;
        const activeIndex =
          typeof data.selectedAccountIndex === "number"
            ? data.selectedAccountIndex
            : -1;

        let acc = data.accounts.find(
          (a: any) =>
            (activeId && (a.id === activeId || a.email === activeId)) ||
            a.active === true ||
            a.selected === true,
        );

        if (!acc && activeIndex >= 0 && activeIndex < data.accounts.length) {
          acc = data.accounts[activeIndex];
        }

        // 2. Otherwise find the first non-disabled account with tokens
        if (!acc) {
          acc = data.accounts.find(
            (a: any) =>
              !a.disabled &&
              (typeof a.refreshToken === "string" ||
                typeof a.accessToken === "string"),
          );
        }

        // 3. Fallback to first entry
        if (!acc) {
          acc = data.accounts[0];
        }

        const refreshToken = acc?.refreshToken;
        const accessToken = acc?.accessToken;
        const projectId =
          acc?.managedProjectId || acc?.projectId || acc?.quotaProjectId;
        if (refreshToken || accessToken) {
          return { accessToken, refreshToken, projectId };
        }
      }
    } catch {
      // continue searching
    }
  }
  return null;
}

interface CachedAntigravityToken {
  accessToken: string;
  expiresAt: number;
}
const antigravityTokenCache = new Map<string, CachedAntigravityToken>();

export async function fetchAntigravityQuotasWithCredentials(
  creds: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    projectId?: string;
  },
  signal?: AbortSignal,
): Promise<QuotasResult> {
  let accessToken = creds.accessToken;
  const refreshToken = creds.refreshToken;
  const projectId = creds.projectId || "aicode-consumers";

  if (refreshToken) {
    const cached = antigravityTokenCache.get(refreshToken);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      accessToken = cached.accessToken;
    } else if (
      !accessToken ||
      (creds.expiresAt && creds.expiresAt < Date.now() + 60_000)
    ) {
      const refresh = await refreshAntigravityToken(refreshToken, signal);
      if (refresh.ok) {
        accessToken = refresh.accessToken;
        const expiresAt = Date.now() + (refresh.expiresIn ?? 3600) * 1000;
        antigravityTokenCache.set(refreshToken, { accessToken, expiresAt });
      }
    }
  }

  if (!accessToken) {
    return failure(
      "No Antigravity credentials found (login with /login antigravity)",
      "config",
    );
  }

  let result = await fetchJson(
    ANTIGRAVITY_FETCH_MODELS_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_USER_AGENT,
      },
      body: JSON.stringify({ project: projectId }),
    },
    signal,
  );

  if (
    !result.ok &&
    (result.status === 401 || result.status === 403) &&
    refreshToken
  ) {
    // Retry once with a fresh token
    const refresh = await refreshAntigravityToken(refreshToken, signal);
    if (refresh.ok) {
      accessToken = refresh.accessToken;
      const expiresAt = Date.now() + (refresh.expiresIn ?? 3600) * 1000;
      antigravityTokenCache.set(refreshToken, { accessToken, expiresAt });
      result = await fetchJson(
        ANTIGRAVITY_FETCH_MODELS_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": ANTIGRAVITY_USER_AGENT,
          },
          body: JSON.stringify({ project: projectId }),
        },
        signal,
      );
    }
  }

  if (!result.ok) return failure(result.message, result.kind);
  return success("antigravity", parseAntigravityUsage(result.data));
}

export async function fetchAntigravityQuotas(
  authStorage: AuthStorage,
  signal?: AbortSignal,
): Promise<QuotasResult> {
  const credential = authStorage.get("antigravity") as any;
  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  let expiresAt: number | undefined;
  let projectId: string | undefined;

  if (credential && typeof credential === "object") {
    accessToken = credential.access;
    refreshToken = credential.refresh;
    expiresAt =
      typeof credential.expires === "number" ? credential.expires : undefined;
    projectId = credential.projectId;
  } else if (typeof credential === "string") {
    accessToken = credential;
  }

  if (!accessToken && !refreshToken) {
    const fallback = readAntigravityAccountsFallback();
    if (fallback) {
      accessToken = fallback.accessToken;
      refreshToken = fallback.refreshToken;
      projectId = fallback.projectId;
    }
  }

  if (!accessToken && !refreshToken) {
    const apiKey = await providerAccessToken(authStorage, "antigravity");
    if (apiKey) accessToken = apiKey;
  }

  return fetchAntigravityQuotasWithCredentials(
    { accessToken, refreshToken, expiresAt, projectId },
    signal,
  );
}

export const PROVIDER_FETCHERS = {
  anthropic: fetchAnthropicQuotas,
  "openai-codex": fetchCodexQuotas,
  "github-copilot": fetchGitHubCopilotQuotas,
  openrouter: fetchOpenRouterQuotas,
  synthetic: fetchSyntheticQuotas,
  xai: fetchXaiQuotas,
  zai: fetchZaiQuotas,
  "opencode-go": fetchOpenCodeGoQuotas,
  "kimi-coding": fetchKimiCodingQuotas,
  "ollama-cloud": fetchOllamaCloudQuotas,
  antigravity: fetchAntigravityQuotas,
} as const;
