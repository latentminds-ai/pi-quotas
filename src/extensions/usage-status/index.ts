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
const STALE_CONTEXT_ERROR_FRAGMENT = "This extension ctx is stale";

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === "object" && "unref" in timer) {
    (timer as { unref?: () => void }).unref?.();
  }
}

function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STALE_CONTEXT_ERROR_FRAGMENT);
}

function readContextProvider(ctx: ExtensionContext):
  | { stale: false; provider: string | undefined }
  | { stale: true } {
  try {
    return { stale: false, provider: ctx.model?.provider };
  } catch (error) {
    if (isStaleExtensionContextError(error)) return { stale: true };
    throw error;
  }
}

function clearFooterStatus(ctx: ExtensionContext | undefined): boolean {
  if (!ctx) return true;
  try {
    ctx.ui.setStatus(EXTENSION_ID, undefined);
    return true;
  } catch (error) {
    if (isStaleExtensionContextError(error)) return false;
    throw error;
  }
}

function setUnavailableStatus(ctx: ExtensionContext): boolean {
  try {
    if (ctx.hasUI) {
      ctx.ui.setStatus(EXTENSION_ID, ctx.ui.theme.fg("warning", "usage unavailable"));
    }
    return true;
  } catch (error) {
    if (isStaleExtensionContextError(error)) return false;
    throw error;
  }
}

function setFooterStatus(ctx: ExtensionContext, status: string | undefined): boolean {
  try {
    ctx.ui.setStatus(EXTENSION_ID, status);
    return true;
  } catch (error) {
    if (isStaleExtensionContextError(error)) return false;
    throw error;
  }
}

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

export function createStatusRefresher() {
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let activeContext: ExtensionContext | undefined;
  let activeProvider: string | undefined;
  let lastStatus: WindowStatus[] | undefined;
  let inFlight = false;
  let queued = false;
  let refreshVersion = 0;

  function deactivate(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = undefined;
    activeContext = undefined;
    activeProvider = undefined;
    lastStatus = undefined;
    queued = false;
    refreshVersion += 1;
  }

  function isCurrent(ctx: ExtensionContext, version: number): boolean {
    return activeContext === ctx && refreshVersion === version;
  }

  async function update(ctx: ExtensionContext, version: number): Promise<void> {
    if (inFlight) {
      queued = true;
      return;
    }

    inFlight = true;
    try {
      const provider = activeProvider;
      if (!isCurrent(ctx, version) || !provider || !isSupportedProvider(provider)) return;
      if (!ctx.hasUI) return;

      const result = await fetchProviderQuotas(ctx.modelRegistry.authStorage, provider);
      if (!isCurrent(ctx, version)) return;

      if (!result.success) {
        if (!setUnavailableStatus(ctx)) deactivate();
        return;
      }

      const windows: WindowStatus[] = toStatusWindows(result.data.windows);
      const status = formatStatusForFooter(ctx, windows);
      if (!isCurrent(ctx, version)) return;

      lastStatus = status === undefined ? undefined : windows;
      if (!setFooterStatus(ctx, status)) deactivate();
    } catch (error) {
      if (isStaleExtensionContextError(error)) {
        deactivate();
        return;
      }
      if (!setUnavailableStatus(ctx)) deactivate();
    } finally {
      inFlight = false;
      if (queued) {
        queued = false;
        const nextContext = activeContext;
        if (nextContext) void update(nextContext, refreshVersion);
      }
    }
  }

  return {
    async refreshFor(ctx: ExtensionContext): Promise<void> {
      const provider = readContextProvider(ctx);
      if (provider.stale) {
        deactivate();
        return;
      }

      activeContext = ctx;
      activeProvider = provider.provider;
      const version = refreshVersion + 1;
      refreshVersion = version;

      if (!activeProvider || !isSupportedProvider(activeProvider)) {
        clearFooterStatus(ctx);
        return;
      }

      await update(ctx, version);
    },
    start(): void {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(() => {
        const ctx = activeContext;
        if (!ctx) return;
        void update(ctx, refreshVersion).catch((error: unknown) => {
          if (isStaleExtensionContextError(error)) {
            deactivate();
            return;
          }
          if (!setUnavailableStatus(ctx)) deactivate();
        });
      }, REFRESH_INTERVAL_MS);
      unrefTimer(refreshTimer);
    },
    stop(ctx?: ExtensionContext): void {
      deactivate();
      clearFooterStatus(ctx);
    },
    renderLast(ctx: ExtensionContext): boolean {
      if (!lastStatus) return false;
      try {
        if (!ctx.hasUI) return false;
        const status = formatStatusForFooter(ctx, lastStatus);
        if (!setFooterStatus(ctx, status)) {
          deactivate();
          return false;
        }
        return true;
      } catch (error) {
        if (isStaleExtensionContextError(error)) {
          deactivate();
          return false;
        }
        throw error;
      }
    },
  };
}

export default async function (pi: ExtensionAPI) {
  await configLoader.load();
  const refresher = createStatusRefresher();
  const unsubscribeEventHandlers: Array<() => void> = [];
  let enabled = configLoader.getConfig().usageStatus;
  let deferToSynthetic = configLoader.getConfig().deferToSynthetic;
  let currentContext: ExtensionContext | undefined;

  /** Whether pi-synthetic's usage footer is active in this session. */
  let syntheticUsageActive = false;

  unsubscribeEventHandlers.push(pi.events.on(SYNTHETIC_EXTENSIONS_REGISTER_EVENT, (data: unknown) => {
    const { feature } = data as SyntheticExtensionsRegisterPayload;
    if (feature === "usageStatus") {
      syntheticUsageActive = true;
      const ctx = currentContext;
      const provider = ctx ? readContextProvider(ctx) : undefined;
      if (provider?.stale) {
        currentContext = undefined;
        refresher.stop();
        return;
      }
      // If currently showing synthetic data, clear our footer.
      if (ctx && enabled && shouldDeferToSynthetic(provider?.provider)) {
        refresher.stop(ctx);
      }
    }
  }));

  function scheduleRefresh(ctx: ExtensionContext): void {
    void refresher.refreshFor(ctx).catch((error: unknown) => {
      if (isStaleExtensionContextError(error)) {
        if (currentContext === ctx) currentContext = undefined;
        refresher.stop();
        return;
      }
      if (!setUnavailableStatus(ctx)) {
        if (currentContext === ctx) currentContext = undefined;
        refresher.stop();
      }
    });
  }

  unsubscribeEventHandlers.push(pi.events.on(QUOTAS_CONFIG_UPDATED_EVENT, (data: unknown) => {
    const config = (data as QuotasConfigUpdatedPayload).config;
    enabled = config.usageStatus;
    deferToSynthetic = config.deferToSynthetic;
    if (!enabled) {
      refresher.stop(currentContext);
      return;
    }
    if (currentContext) {
      refresher.start();
      scheduleRefresh(currentContext);
    }
  }));

  /**
   * Whether to suppress our footer because pi-synthetic is showing
   * the same data for the Synthetic provider.
   */
  function shouldDeferToSynthetic(provider: string | undefined): boolean {
    return deferToSynthetic && syntheticUsageActive && provider === "synthetic";
  }

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) return;
    const provider = readContextProvider(ctx);
    if (provider.stale) {
      currentContext = undefined;
      refresher.stop();
      return;
    }
    if (shouldDeferToSynthetic(provider.provider)) {
      refresher.stop(ctx);
      return;
    }
    refresher.start();
    scheduleRefresh(ctx);
  });

  pi.on("turn_end", (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) return;
    const provider = readContextProvider(ctx);
    if (provider.stale) {
      currentContext = undefined;
      refresher.stop();
      return;
    }
    if (shouldDeferToSynthetic(provider.provider)) {
      refresher.stop(ctx);
      return;
    }
    scheduleRefresh(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) {
      refresher.stop(ctx);
      return;
    }
    const provider = readContextProvider(ctx);
    if (provider.stale) {
      currentContext = undefined;
      refresher.stop();
      return;
    }
    if (shouldDeferToSynthetic(provider.provider)) {
      refresher.stop(ctx);
      return;
    }
    refresher.start();
    scheduleRefresh(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    currentContext = undefined;
    syntheticUsageActive = false;
    refresher.stop(ctx);
    for (const unsubscribe of unsubscribeEventHandlers.splice(0)) {
      unsubscribe();
    }
  });

  unsubscribeEventHandlers.push(pi.events.on(QUOTAS_EXTENSIONS_REQUEST_EVENT, () => {
    if (configLoader.getConfig().usageStatus) {
      pi.events.emit(QUOTAS_EXTENSIONS_REGISTER_EVENT, { feature: "usageStatus" });
    }
  }));
}
