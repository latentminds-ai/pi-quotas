/**
 * OpenCode Go client.
 *
 * Uses the official quota API instead of scraping the dashboard:
 *
 *   GET https://opencode.ai/zen/go/v1/usage
 *   Authorization: Bearer <OpenCode Go API key>
 *
 * Response shape:
 *   { usage: { rolling|weekly|monthly: { status, percent, resetsAt } } }
 *
 * Configuration:
 * - Pi auth entry: `pi /login opencode-go` (preferred)
 * - Environment: OPENCODE_GO_API_KEY
 * - Config file: ~/.config/opencode/opencode-quota/opencode-go.json
 * - OpenCode CLI auth: ~/.local/share/opencode/auth.json
 */

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const REQUEST_TIMEOUT_MS = 10_000;

export interface OpenCodeGoWindow {
  usagePercent: number;
  resetInSec: number;
  percentRemaining: number;
  resetTimeIso: string;
  /** True when the API reports the window as rate-limited rather than "ok". */
  limited?: boolean;
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
  apiKey: string;
}

interface ApiWindow {
  status?: unknown;
  percent?: unknown;
  resetsAt?: unknown;
}

interface ApiPayload {
  usage?: {
    rolling?: ApiWindow;
    weekly?: ApiWindow;
    monthly?: ApiWindow;
  };
}

function normalizeWindow(window: ApiWindow, now: number): OpenCodeGoWindow | null {
  const usagePercent = Number(window.percent);
  if (!Number.isFinite(usagePercent)) return null;

  const resetsAtMs = typeof window.resetsAt === "string" ? Date.parse(window.resetsAt) : Number.NaN;
  const resetInSec = Number.isFinite(resetsAtMs)
    ? Math.max(0, Math.round((resetsAtMs - now) / 1000))
    : 0;

  const clampedPercent = Math.max(0, Math.min(100, usagePercent));
  const limited = typeof window.status === "string" && window.status !== "ok";

  return {
    usagePercent: clampedPercent,
    resetInSec,
    percentRemaining: 100 - clampedPercent,
    resetTimeIso: Number.isFinite(resetsAtMs)
      ? new Date(resetsAtMs).toISOString()
      : new Date(now + resetInSec * 1000).toISOString(),
    ...(limited ? { limited: true } : {}),
  };
}

/** Parse the `/zen/go/v1/usage` payload into usage windows. */
export function parseOpenCodeGoApiUsage(
  payload: unknown,
  now = Date.now(),
): OpenCodeGoQuotaResult | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as ApiPayload).usage;
  if (!usage || typeof usage !== "object") return null;

  const rolling = usage.rolling ? normalizeWindow(usage.rolling, now) : null;
  const weekly = usage.weekly ? normalizeWindow(usage.weekly, now) : null;
  const monthly = usage.monthly ? normalizeWindow(usage.monthly, now) : null;

  if (!rolling && !weekly && !monthly) return null;

  return {
    success: true,
    ...(rolling ? { rolling } : {}),
    ...(weekly ? { weekly } : {}),
    ...(monthly ? { monthly } : {}),
  };
}

function errorForStatus(status: number, body: string): string {
  if (status === 401) {
    return (
      "OpenCode Go API key rejected (401). Run `pi /login opencode-go`," +
      " or set OPENCODE_GO_API_KEY"
    );
  }
  if (status === 403) {
    return "OpenCode Go subscription required (403). Subscribe to OpenCode Go first.";
  }
  return `OpenCode Go usage API error ${status}: ${body.slice(0, 120)}`;
}

export async function queryOpenCodeGoQuota(
  config: OpenCodeGoConfig,
  signal?: AbortSignal,
): Promise<OpenCodeGoResult> {
  try {
    const signals: AbortSignal[] = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
    if (signal) signals.push(signal);
    const combined = AbortSignal.any(signals);

    const response = await fetch(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
      signal: combined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, error: errorForStatus(response.status, text) };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const parsed = parseOpenCodeGoApiUsage(payload);
    if (!parsed) {
      return {
        success: false,
        error: "Could not parse OpenCode Go usage response",
      };
    }

    return parsed;
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
