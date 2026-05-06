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

/** Event emitted by pi-synthetic when its usage-status extension registers. */
const SYNTHETIC_EXTENSIONS_REGISTER_EVENT = "synthetic:extensions:register";
interface SyntheticExtensionsRegisterPayload {
  feature: string;
}
import {
  fetchProviderQuotas,
  isSupportedProvider,
} from "../../lib/quotas.js";
import {
  assessWindow,
  formatTimeRemaining,
} from "../../utils/quotas-severity.js";
import type { QuotaWindow } from "../../types/quotas.js";
import { formatWindowStatus, type WindowStatus } from "./format-status.js";

const EXTENSION_ID = "pi-quotas-usage";
const REFRESH_INTERVAL_MS = 60_000;

function formatFooterResetTime(resetsAt: string): string {
  const remaining = formatTimeRemaining(new Date(resetsAt));
  return remaining === "now" ? "now" : `in ${remaining}`;
}

export function formatStatus(ctx: Pick<ExtensionContext, "ui">, windows: WindowStatus[]): string {
  const theme = ctx.ui.theme;
  return windows
    .map((w) => {
      const core = formatWindowStatus(theme, w);
      const reset = w.resetsAt ? theme.fg("dim", ` (↺${formatFooterResetTime(w.resetsAt)})`) : "";
      return `${core}${reset}`;
    })
    .join(" ");
}

const ANTHROPIC_SUBSCRIPTION_WINDOW_LABELS = new Set([
  "5h",
  "7d",
  "7d Sonnet",
  "7d Opus",
  "7d Opus (legacy)",
]);

function shouldShowInStatus(window: QuotaWindow): boolean {
  return !(
    window.provider === "anthropic" &&
    ANTHROPIC_SUBSCRIPTION_WINDOW_LABELS.has(window.label)
  );
}

export function toWindowStatus(window: QuotaWindow): WindowStatus {
  return {
    label: window.label,
    usedPercent: window.usedPercent,
    severity: assessWindow(window).severity,
    resetsAt: window.resetsAt.getTime() > 0 ? window.resetsAt.toISOString() : null,
    limited: window.limited ?? false,
    isCurrency: window.isCurrency,
    usedValue: window.usedValue,
    limitValue: window.limitValue,
  };
}

export function toStatusWindows(windows: QuotaWindow[]): WindowStatus[] {
  return windows.filter(shouldShowInStatus).map(toWindowStatus);
}

export function formatStatusForFooter(
  ctx: Pick<ExtensionContext, "ui">,
  windows: WindowStatus[],
): string | undefined {
  if (windows.length === 0) return undefined;
  return formatStatus(ctx, windows);
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
      const windows: WindowStatus[] = toStatusWindows(result.data.windows);
      const status = formatStatusForFooter(ctx, windows);
      lastStatus = status === undefined ? undefined : windows;
      ctx.ui.setStatus(EXTENSION_ID, status);
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
      ctx.ui.setStatus(EXTENSION_ID, formatStatusForFooter(ctx, lastStatus));
      return true;
    },
  };
}

export default async function (pi: ExtensionAPI) {
  await configLoader.load();
  const refresher = createStatusRefresher();
  let enabled = configLoader.getConfig().usageStatus;
  let deferToSynthetic = configLoader.getConfig().deferToSynthetic;
  let currentContext: ExtensionContext | undefined;

  /** Whether pi-synthetic's usage footer is active in this session. */
  let syntheticUsageActive = false;

  pi.events.on(SYNTHETIC_EXTENSIONS_REGISTER_EVENT, (data: unknown) => {
    const { feature } = data as SyntheticExtensionsRegisterPayload;
    if (feature === "usageStatus") {
      syntheticUsageActive = true;
      // If currently showing synthetic data, clear our footer
      if (currentContext && enabled && deferToSynthetic && currentContext.model?.provider === "synthetic") {
        currentContext.ui.setStatus(EXTENSION_ID, undefined);
        refresher.stop();
      }
    }
  });

  pi.events.on(QUOTAS_CONFIG_UPDATED_EVENT, (data: unknown) => {
    const config = (data as QuotasConfigUpdatedPayload).config;
    enabled = config.usageStatus;
    deferToSynthetic = config.deferToSynthetic;
    if (!enabled) {
      refresher.stop(currentContext);
      return;
    }
    if (currentContext) {
      refresher.start();
      void refresher.refreshFor(currentContext);
    }
  });

  /**
   * Whether to suppress our footer because pi-synthetic is showing
   * the same data for the Synthetic provider.
   */
  function shouldDeferToSynthetic(provider: string | undefined): boolean {
    return deferToSynthetic && syntheticUsageActive && provider === "synthetic";
  }

  pi.on("session_start", async (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) return;
    if (shouldDeferToSynthetic(ctx.model?.provider)) {
      ctx.ui.setStatus(EXTENSION_ID, undefined);
      return;
    }
    refresher.start();
    await refresher.refreshFor(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) return;
    if (shouldDeferToSynthetic(ctx.model?.provider)) return;
    await refresher.refreshFor(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) {
      refresher.stop(ctx);
      return;
    }
    if (shouldDeferToSynthetic(ctx.model?.provider)) {
      ctx.ui.setStatus(EXTENSION_ID, undefined);
      return;
    }
    await refresher.refreshFor(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    currentContext = undefined;
    syntheticUsageActive = false;
    refresher.stop(ctx);
  });

  pi.events.on(QUOTAS_EXTENSIONS_REQUEST_EVENT, () => {
    if (configLoader.getConfig().usageStatus) {
      pi.events.emit(QUOTAS_EXTENSIONS_REGISTER_EVENT, { feature: "usageStatus" });
    }
  });
}
