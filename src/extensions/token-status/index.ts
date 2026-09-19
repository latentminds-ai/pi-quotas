import type {
  ExtensionAPI,
  ExtensionContext,
  ThemeColor,
} from "@mariozechner/pi-coding-agent";
import {
  QUOTAS_CONFIG_UPDATED_EVENT,
  QUOTAS_EXTENSIONS_REGISTER_EVENT,
  QUOTAS_EXTENSIONS_REQUEST_EVENT,
  type QuotasConfigUpdatedPayload,
  type QuotasExtensionsRegisterPayload,
  configLoader,
} from "../../config.js";
import { quotaAuthStorage } from "../../lib/auth.js";
import { fetchProviderQuotas } from "../../lib/quotas.js";
import { aggregateAllSessions, formatCost } from "../../lib/session-tokens.js";

const EXTENSION_ID = "pi-quotas-token-status";
const REFRESH_INTERVAL_MS = 60_000;

/** Go tier limits (approximate, from docs) */
const GO_LIMITS = {
  rolling5h: 12, // $12 per 5 hours
  weekly: 30, // $30 per week
  monthly: 60, // $60 per month
} as const;

interface RollingWindowCosts {
  rolling5h: number;
  weekly: number;
  monthly: number;
}

function computeWindowTimestamps(now: Date): {
  since5h: Date;
  sinceWeekly: Date;
  sinceMonthly: Date;
} {
  return {
    since5h: new Date(now.getTime() - 5 * 60 * 60 * 1000),
    sinceWeekly: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    sinceMonthly: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  };
}

async function computeRollingCosts(cwd?: string): Promise<RollingWindowCosts> {
  const now = new Date();
  const { since5h, sinceWeekly, sinceMonthly } = computeWindowTimestamps(now);

  // Run all three aggregations in parallel
  const [result5h, resultWeekly, resultMonthly] = await Promise.all([
    aggregateAllSessions({ cwd, since: since5h }),
    aggregateAllSessions({ cwd, since: sinceWeekly }),
    aggregateAllSessions({ cwd, since: sinceMonthly }),
  ]);

  return {
    rolling5h: result5h.totals.costTotal,
    weekly: resultWeekly.totals.costTotal,
    monthly: resultMonthly.totals.costTotal,
  };
}

function formatWindowForStatus(
  theme: ExtensionContext["ui"]["theme"],
  label: string,
  cost: number,
  limit: number,
): string {
  const percent = limit > 0 ? Math.round((cost / limit) * 100) : 0;
  const costStr = formatCost(cost);

  // Color by usage level
  let color: ThemeColor;
  if (percent >= 90) {
    color = "error";
  } else if (percent >= 70) {
    color = "warning";
  } else {
    color = "dim";
  }

  return `${theme.fg(color, `${label}:`)}${theme.fg("accent", costStr)}`;
}

function formatTokenStatus(
  theme: ExtensionContext["ui"]["theme"],
  costs: RollingWindowCosts,
): string {
  const parts = [
    formatWindowForStatus(theme, "5h", costs.rolling5h, GO_LIMITS.rolling5h),
    formatWindowForStatus(theme, "wk", costs.weekly, GO_LIMITS.weekly),
    formatWindowForStatus(theme, "mo", costs.monthly, GO_LIMITS.monthly),
  ];
  return parts.join(" · ");
}

function isGoProvider(provider: string | undefined): boolean {
  if (!provider) return false;
  return provider === "opencode-go" || provider.startsWith("opencode-go/");
}

function createTokenStatusRefresher(getUsageStatusEnabled: () => boolean) {
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let activeContext: ExtensionContext | undefined;
  let lastCosts: RollingWindowCosts | undefined;
  let inFlight = false;
  let queued = false;

  /**
   * Whether the account-wide OpenCode Go usage API can report the real
   * plan usage. When it can, the usage-status footer already shows the
   * percents, so this local estimate stays hidden to avoid two conflicting
   * usage readouts.
   */
  async function hasRealUsage(ctx: ExtensionContext): Promise<boolean> {
    try {
      const quota = await fetchProviderQuotas(
        quotaAuthStorage(ctx.modelRegistry),
        "opencode-go",
      );
      return quota.success;
    } catch {
      return false;
    }
  }

  async function update(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      if (getUsageStatusEnabled() && (await hasRealUsage(ctx))) {
        if (!ctx.hasUI) return;
        lastCosts = undefined;
        ctx.ui.setStatus(EXTENSION_ID, undefined);
        return;
      }
      const costs = await computeRollingCosts(ctx.cwd);
      if (!ctx.hasUI) return;
      lastCosts = costs;
      const status = formatTokenStatus(ctx.ui.theme, costs);
      ctx.ui.setStatus(EXTENSION_ID, status);
    } catch {
      ctx.ui.setStatus(
        EXTENSION_ID,
        ctx.ui.theme.fg("warning", "token tracking unavailable"),
      );
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
      if (!isGoProvider(ctx.model?.provider)) {
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
      lastCosts = undefined;
      ctx?.ui.setStatus(EXTENSION_ID, undefined);
    },
    renderLast(ctx: ExtensionContext): boolean {
      if (!lastCosts || !ctx.hasUI) return false;
      ctx.ui.setStatus(
        EXTENSION_ID,
        formatTokenStatus(ctx.ui.theme, lastCosts),
      );
      return true;
    },
  };
}

export default async function (pi: ExtensionAPI) {
  await configLoader.load();
  let usageStatusEnabled = configLoader.getConfig().usageStatus;
  /** Set once the usage-status extension registers for this session. */
  let usageStatusLoaded = false;
  const refresher = createTokenStatusRefresher(
    () => usageStatusEnabled && usageStatusLoaded,
  );
  let enabled = configLoader.getConfig().tokenStatus;
  let currentContext: ExtensionContext | undefined;

  pi.events.on(QUOTAS_EXTENSIONS_REGISTER_EVENT, (data: unknown) => {
    const { feature } = data as QuotasExtensionsRegisterPayload;
    if (feature === "usageStatus") usageStatusLoaded = true;
  });

  function scheduleRefresh(ctx: ExtensionContext): void {
    void refresher.refreshFor(ctx).catch(() => {
      if (ctx.hasUI)
        ctx.ui.setStatus(
          EXTENSION_ID,
          ctx.ui.theme.fg("warning", "token tracking unavailable"),
        );
    });
  }

  pi.events.on(QUOTAS_CONFIG_UPDATED_EVENT, (data: unknown) => {
    const config = (data as QuotasConfigUpdatedPayload).config;
    enabled = config.tokenStatus;
    usageStatusEnabled = config.usageStatus;
    if (!enabled) {
      refresher.stop(currentContext);
      return;
    }
    if (currentContext) {
      refresher.start();
      scheduleRefresh(currentContext);
    }
  });

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) return;
    if (!isGoProvider(ctx.model?.provider)) {
      ctx.ui.setStatus(EXTENSION_ID, undefined);
      return;
    }
    refresher.start();
    scheduleRefresh(ctx);
  });

  pi.on("turn_end", (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) return;
    if (!isGoProvider(ctx.model?.provider)) return;
    scheduleRefresh(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    currentContext = ctx;
    if (!enabled) {
      refresher.stop(ctx);
      return;
    }
    if (!isGoProvider(ctx.model?.provider)) {
      refresher.stop(ctx);
      return;
    }
    refresher.start();
    scheduleRefresh(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    currentContext = undefined;
    refresher.stop(ctx);
  });

  pi.events.on(QUOTAS_EXTENSIONS_REQUEST_EVENT, () => {
    if (configLoader.getConfig().tokenStatus) {
      pi.events.emit(QUOTAS_EXTENSIONS_REGISTER_EVENT, {
        feature: "tokenStatus",
      });
    }
  });
}
