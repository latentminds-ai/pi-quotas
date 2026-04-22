import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  QUOTAS_CONFIG_UPDATED_EVENT,
  QUOTAS_EXTENSIONS_REGISTER_EVENT,
  QUOTAS_EXTENSIONS_REQUEST_EVENT,
  type QuotasConfigUpdatedPayload,
  configLoader,
} from "../../config.js";
import { fetchProviderQuotas, isSupportedProvider } from "../../lib/quotas.js";
import {
  assessWindow,
  formatTimeRemaining,
  type RiskSeverity,
} from "../../utils/quotas-severity.js";

const COOLDOWN_MS = 60 * 60 * 1000;
const MIN_FETCH_INTERVAL_MS = 30_000;

type AlertState = { lastSeverity: RiskSeverity; lastNotifiedAt: number };
const alertState = new Map<string, AlertState>();
let lastFetchAt = 0;

function shouldNotify(key: string, severity: RiskSeverity): boolean {
  const current = alertState.get(key);
  if (!current) return true;
  const order: RiskSeverity[] = ["none", "warning", "high", "critical"];
  if (order.indexOf(severity) > order.indexOf(current.lastSeverity)) return true;
  if (severity === "high" || severity === "critical") return true;
  if (severity === "warning") return Date.now() - current.lastNotifiedAt >= COOLDOWN_MS;
  return false;
}

function markNotified(key: string, severity: RiskSeverity): void {
  alertState.set(key, { lastSeverity: severity, lastNotifiedAt: Date.now() });
}

function clearAlertState(): void {
  alertState.clear();
  lastFetchAt = 0;
}

export default async function (pi: ExtensionAPI) {
  await configLoader.load();
  let enabled = configLoader.getConfig().quotaWarnings;
  let currentContext: ExtensionContext | undefined;
  async function check(ctx: ExtensionContext, onlyNew: boolean): Promise<void> {
    const provider = ctx.model?.provider;
    if (!ctx.hasUI || !provider || !isSupportedProvider(provider)) return;
    const now = Date.now();
    if (onlyNew && now - lastFetchAt < MIN_FETCH_INTERVAL_MS) return;
    lastFetchAt = now;

    const result = await fetchProviderQuotas(ctx.modelRegistry.authStorage, provider);
    if (!result.success) return;

    const risky = result.data.windows
      .map((window) => ({ window, assessment: assessWindow(window) }))
      .filter((entry) => entry.assessment.severity !== "none");
    if (risky.length === 0) return;

    const toNotify = onlyNew
      ? risky.filter((entry) => shouldNotify(`${provider}:${entry.window.label}`, entry.assessment.severity))
      : risky;
    if (toNotify.length === 0) return;

    for (const entry of toNotify) {
      markNotified(`${provider}:${entry.window.label}`, entry.assessment.severity);
    }

    const providerName = provider === "openai-codex"
      ? "Codex"
      : provider === "github-copilot"
        ? "GitHub Copilot"
        : "Anthropic";

    const lines = toNotify.map(({ window, assessment }) => {
      const projected = Math.round(assessment.projectedPercent);
      const used = Math.round(window.usedPercent);
      return `- ${window.label}: ${used}% used, projected ${projected}% (${assessment.severity}), resets in ${formatTimeRemaining(window.resetsAt)}`;
    });

    const level = toNotify.some((entry) => entry.assessment.severity === "critical" || entry.assessment.severity === "high")
      ? "error"
      : "warning";
    ctx.ui.notify(`${providerName} quota warning:\n${lines.join("\n")}`, level);
  }

  pi.events.on(QUOTAS_CONFIG_UPDATED_EVENT, (data: unknown) => {
    enabled = (data as QuotasConfigUpdatedPayload).config.quotaWarnings;
    if (!enabled) {
      clearAlertState();
      return;
    }
    if (currentContext) {
      clearAlertState();
      void check(currentContext, false);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    currentContext = ctx;
    clearAlertState();
    if (!enabled) return;
    await check(ctx, false);
  });

  pi.on("turn_end", async (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) return;
    await check(ctx, true);
  });

  pi.on("model_select", async (_event, ctx) => {
    currentContext = ctx;
    clearAlertState();
  });

  pi.on("session_shutdown", async () => {
    currentContext = undefined;
    clearAlertState();
  });

  pi.events.on(QUOTAS_EXTENSIONS_REQUEST_EVENT, () => {
    if (configLoader.getConfig().quotaWarnings) {
      pi.events.emit(QUOTAS_EXTENSIONS_REGISTER_EVENT, { feature: "quotaWarnings" });
    }
  });
}
