/**
 * OpenCode Go client.
 *
 * Fetches usage data from the official OpenCode Go API using the provider API
 * key stored by Pi. Falls back to dashboard scraping with a workspace ID and
 * auth cookie for legacy configurations.
 *
 * Optional dashboard fallback configuration:
 * - Environment: OPENCODE_GO_WORKSPACE_ID + OPENCODE_GO_AUTH_COOKIE
 * - Config file: ~/.config/opencode/opencode-quota/opencode-go.json
 */

const DASHBOARD_URL_SUFFIX = "/go";
const DASHBOARD_URL_PREFIXES = [
  "https://opencode.ai/console/",
  "https://opencode.ai/workspace/",
] as const;
const USAGE_API_URL = "https://opencode.ai/zen/go/v1/usage";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";
const API_USER_AGENT = "pi-quotas/0.5.1";
const REQUEST_TIMEOUT_MS = 10_000;

const SCRAPED_NUMBER_PATTERN = String.raw`(-?\d+(?:\.\d+)?)`;

const RE_ROLLING_PCT_FIRST = new RegExp(
  String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_ROLLING_RESET_FIRST = new RegExp(
  String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);

const RE_WEEKLY_PCT_FIRST = new RegExp(
  String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_WEEKLY_RESET_FIRST = new RegExp(
  String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);

const RE_MONTHLY_PCT_FIRST = new RegExp(
  String.raw`monthlyUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_MONTHLY_RESET_FIRST = new RegExp(
  String.raw`monthlyUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);

interface ScrapedWindowUsage {
  usagePercent: number;
  resetInSec: number;
}

export interface OpenCodeGoWindow {
  usagePercent: number;
  resetInSec: number;
  percentRemaining: number;
  resetTimeIso: string;
}

export interface OpenCodeGoQuotaResult {
  success: true;
  rolling?: OpenCodeGoWindow;
  weekly?: OpenCodeGoWindow;
  monthly?: OpenCodeGoWindow;
}

export interface OpenCodeGoQuotaError {
  success: false;
  error: string;
}

export type OpenCodeGoResult = OpenCodeGoQuotaResult | OpenCodeGoQuotaError;

export interface OpenCodeGoConfig {
  workspaceId: string;
  authCookie: string;
}

function dashboardUrls(workspaceId: string): string[] {
  const encodedWorkspaceId = encodeURIComponent(workspaceId);
  return DASHBOARD_URL_PREFIXES.map(
    (prefix) => `${prefix}${encodedWorkspaceId}${DASHBOARD_URL_SUFFIX}`,
  );
}

function parseWindowUsage(
  html: string,
  rePctFirst: RegExp,
  reResetFirst: RegExp,
): ScrapedWindowUsage | null {
  const pctFirstMatch = rePctFirst.exec(html);
  if (pctFirstMatch) {
    const usagePercent = Number(pctFirstMatch[1]);
    const resetInSec = Number(pctFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  const resetFirstMatch = reResetFirst.exec(html);
  if (resetFirstMatch) {
    const resetInSec = Number(resetFirstMatch[1]);
    const usagePercent = Number(resetFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  return null;
}

function normalizeWindowUsage(
  window: ScrapedWindowUsage,
  now: number,
): OpenCodeGoWindow {
  const usagePercent = Math.max(0, window.usagePercent);
  const resetInSec = Math.max(0, window.resetInSec);
  return {
    usagePercent,
    resetInSec,
    percentRemaining: 100 - usagePercent,
    resetTimeIso: new Date(now + resetInSec * 1000).toISOString(),
  };
}

function parseApiWindowUsage(
  value: unknown,
  now: number,
): OpenCodeGoWindow | undefined {
  if (!value || typeof value !== "object") return undefined;

  const window = value as Record<string, unknown>;
  const usagePercent = Number(window.percent);
  const resetTime = new Date(String(window.resetsAt ?? ""));
  if (!Number.isFinite(usagePercent) || Number.isNaN(resetTime.getTime())) {
    return undefined;
  }

  const resetInSec = Math.max(
    0,
    Math.ceil((resetTime.getTime() - now) / 1000),
  );
  return {
    usagePercent: Math.max(0, usagePercent),
    resetInSec,
    percentRemaining: 100 - Math.max(0, usagePercent),
    resetTimeIso: resetTime.toISOString(),
  };
}

function apiErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  } catch {
    // The body is not JSON; use its text below.
  }
  return body.trim().slice(0, 120);
}

/**
 * Query the official OpenCode Go usage API with the provider API key stored by Pi.
 */
export async function queryOpenCodeGoQuotaWithApiKey(
  apiKey: string,
  signal?: AbortSignal,
): Promise<OpenCodeGoResult> {
  try {
    const signals: AbortSignal[] = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
    if (signal) signals.push(signal);
    const combined = AbortSignal.any(signals);

    const response = await fetch(USAGE_API_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": API_USER_AGENT,
      },
      signal: combined,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = apiErrorDetail(body);
      return {
        success: false,
        error: `OpenCode Go usage API error ${response.status}${detail ? `: ${detail}` : ""}`,
      };
    }

    const data = (await response.json()) as {
      usage?: {
        rolling?: unknown;
        weekly?: unknown;
        monthly?: unknown;
      };
    };
    const now = Date.now();
    const rolling = parseApiWindowUsage(data.usage?.rolling, now);
    const weekly = parseApiWindowUsage(data.usage?.weekly, now);
    const monthly = parseApiWindowUsage(data.usage?.monthly, now);

    if (!rolling && !weekly && !monthly) {
      return {
        success: false,
        error: "Could not parse OpenCode Go usage API response",
      };
    }

    return {
      success: true,
      ...(rolling ? { rolling } : {}),
      ...(weekly ? { weekly } : {}),
      ...(monthly ? { monthly } : {}),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { success: false, error: "Request timed out" };
    }
    if (err instanceof Error && err.name === "AbortError") {
      return { success: false, error: "Request cancelled" };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function queryOpenCodeGoQuota(
  config: OpenCodeGoConfig,
  signal?: AbortSignal,
): Promise<OpenCodeGoResult> {
  try {
    const signals: AbortSignal[] = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
    if (signal) signals.push(signal);
    const combined = AbortSignal.any(signals);
    let lastError = "Could not parse OpenCode Go dashboard usage windows";

    for (const url of dashboardUrls(config.workspaceId)) {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html",
          Cookie: `auth=${config.authCookie}`,
        },
        signal: combined,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        lastError = `OpenCode Go dashboard error ${response.status}: ${text.slice(0, 120)}`;
        continue;
      }

      const html = await response.text();
      const rolling = parseWindowUsage(
        html,
        RE_ROLLING_PCT_FIRST,
        RE_ROLLING_RESET_FIRST,
      );
      const weekly = parseWindowUsage(
        html,
        RE_WEEKLY_PCT_FIRST,
        RE_WEEKLY_RESET_FIRST,
      );
      const monthly = parseWindowUsage(
        html,
        RE_MONTHLY_PCT_FIRST,
        RE_MONTHLY_RESET_FIRST,
      );

      if (!rolling && !weekly && !monthly) {
        lastError = "Could not parse OpenCode Go dashboard usage windows";
        continue;
      }

      const now = Date.now();
      return {
        success: true,
        ...(rolling ? { rolling: normalizeWindowUsage(rolling, now) } : {}),
        ...(weekly ? { weekly: normalizeWindowUsage(weekly, now) } : {}),
        ...(monthly ? { monthly: normalizeWindowUsage(monthly, now) } : {}),
      };
    }

    return { success: false, error: lastError };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { success: false, error: "Request timed out" };
    }
    if (err instanceof Error && err.name === "AbortError") {
      return { success: false, error: "Request cancelled" };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
