import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  QUOTAS_CONFIG_UPDATED_EVENT,
  QUOTAS_EXTENSIONS_REGISTER_EVENT,
  QUOTAS_EXTENSIONS_REQUEST_EVENT,
  type QuotasConfigUpdatedPayload,
  configLoader,
} from "../../config.js";
import {
  fetchProviderQuotas,
  formatResetTime,
  isSupportedProvider,
} from "../../lib/quotas.js";
import {
  assessWindow,
  getSeverityColor,
  type RiskSeverity,
} from "../../utils/quotas-severity.js";

const EXTENSION_ID = "pi-quotas-usage";
const REFRESH_INTERVAL_MS = 60_000;

type WindowStatus = {
  label: string;
  usedPercent: number;
  severity: RiskSeverity;
  resetsAt: string | null;
  limited: boolean;
};

const SHORT_LABELS: Record<string, string> = {
  "5h": "5h",
  "7d": "7d",
  "Premium / month": "premium",
  "Chat / month": "chat",
  "Completions / month": "comp",
};

function formatStatus(ctx: ExtensionContext, windows: WindowStatus[]): string {
  const theme = ctx.ui.theme;
  return windows
    .map((w) => {
      const short = SHORT_LABELS[w.label] ?? w.label;
      const remaining = Math.max(0, Math.min(100, Math.round(100 - w.usedPercent)));
      const color = getSeverityColor(w.severity);
      const pctText = theme.fg(color, `${remaining}%`);
      const reset = w.resetsAt ? theme.fg("dim", ` (↺${formatResetTime(w.resetsAt)})`) : "";
      const limitTag = w.limited ? theme.fg("error", " [limited]") : "";
      return `${theme.fg("dim", `${short}:`)}${pctText}${reset}${limitTag}`;
    })
    .join(" ");
}

function createStatusRefresher() {
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let activeContext: ExtensionContext | undefined;
  let activeProvider: string | undefined;
  let lastStatus: WindowStatus[] | undefined;
  let inFlight = false;
  let queued = false;

  async function update(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || !activeProvider || !isSupportedProvider(activeProvider)) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      const result = await fetchProviderQuotas(ctx.modelRegistry.authStorage, activeProvider);
      if (!result.success) {
        ctx.ui.setStatus(EXTENSION_ID, ctx.ui.theme.fg("warning", "usage unavailable"));
        return;
      }
      const windows = result.data.windows.map((window) => ({
        label: window.label,
        usedPercent: window.usedPercent,
        severity: assessWindow(window).severity,
        resetsAt: window.resetsAt.toISOString(),
        limited: window.limited ?? false,
      }));
      lastStatus = windows;
      ctx.ui.setStatus(EXTENSION_ID, formatStatus(ctx, windows));
    } catch {
      ctx.ui.setStatus(EXTENSION_ID, ctx.ui.theme.fg("warning", "usage unavailable"));
    } finally {
      inFlight = false;
      if (queued) {
        queued = false;
        void update(ctx);
      }
    }
  }

  return {
    async refreshFor(ctx: ExtensionContext): Promise<void> {
      activeContext = ctx;
      activeProvider = ctx.model?.provider;
      if (!activeProvider || !isSupportedProvider(activeProvider)) {
        ctx.ui.setStatus(EXTENSION_ID, undefined);
        return;
      }
      await update(ctx);
    },
    start(): void {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(() => {
        if (activeContext) void update(activeContext);
      }, REFRESH_INTERVAL_MS);
      refreshTimer.unref?.();
    },
    stop(ctx?: ExtensionContext): void {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = undefined;
      activeContext = undefined;
      activeProvider = undefined;
      lastStatus = undefined;
      ctx?.ui.setStatus(EXTENSION_ID, undefined);
    },
    renderLast(ctx: ExtensionContext): boolean {
      if (!lastStatus || !ctx.hasUI) return false;
      ctx.ui.setStatus(EXTENSION_ID, formatStatus(ctx, lastStatus));
      return true;
    },
  };
}

export default async function (pi: ExtensionAPI) {
  await configLoader.load();
  const refresher = createStatusRefresher();
  let enabled = configLoader.getConfig().usageStatus;
  let currentContext: ExtensionContext | undefined;

  pi.events.on(QUOTAS_CONFIG_UPDATED_EVENT, (data: unknown) => {
    enabled = (data as QuotasConfigUpdatedPayload).config.usageStatus;
    if (!enabled) {
      refresher.stop(currentContext);
      return;
    }
    if (currentContext) {
      refresher.start();
      void refresher.refreshFor(currentContext);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) return;
    refresher.start();
    await refresher.refreshFor(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) return;
    await refresher.refreshFor(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) {
      refresher.stop(ctx);
      return;
    }
    await refresher.refreshFor(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    currentContext = undefined;
    refresher.stop(ctx);
  });

  pi.events.on(QUOTAS_EXTENSIONS_REQUEST_EVENT, () => {
    if (configLoader.getConfig().usageStatus) {
      pi.events.emit(QUOTAS_EXTENSIONS_REGISTER_EVENT, { feature: "usageStatus" });
    }
  });
}
