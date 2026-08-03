import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  QUOTAS_EXTENSIONS_REGISTER_EVENT,
  QUOTAS_EXTENSIONS_REQUEST_EVENT,
  configLoader,
} from "../../config.js";
import { quotaAuthStorage } from "../../lib/auth.js";
import {
  fetchAllProviderQuotas,
  fetchProviderQuotas,
  SUPPORTED_PROVIDERS,
} from "../../lib/quotas.js";
import type { QuotasResult, SupportedQuotaProvider } from "../../types/quotas.js";
import { QuotasComponent } from "./components/quotas-display.js";
import { getProviderCommandInfo } from "./provider-commands.js";

type Snapshot = { provider: SupportedQuotaProvider; result: QuotasResult };

async function openQuotaView(
  title: string,
  loadSnapshots: (force: boolean, signal?: AbortSignal) => Promise<Snapshot[]>,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const result = await ctx.ui.custom<null>((tui, theme, _kb, done) => {
    const controller = new AbortController();
    const component = new QuotasComponent(
      theme,
      tui,
      title,
      () => {
        controller.abort();
        done(null);
      },
      () => {
        component.setState({ type: "loading" });
        tui.requestRender();
        void load(true);
      },
    );

    async function load(force = false): Promise<void> {
      const snapshots = await loadSnapshots(force, controller.signal);
      if (controller.signal.aborted) return;
      component.setState({ type: "loaded", snapshots });
      tui.requestRender();
    }

    void load();

    return {
      render: (width: number) => component.render(width),
      invalidate: () => component.invalidate(),
      handleInput: (data: string) => component.handleInput(data),
      dispose: () => {
        controller.abort();
        component.destroy();
      },
    };
  });

  if (result === undefined) {
    const snapshots = await loadSnapshots(true);
    ctx.ui.notify(formatSnapshotsForNotify(snapshots), "info");
  }
}

/**
 * Render quota snapshots as a readable multi-line summary for the
 * non-interactive fallback (when `ctx.ui.custom` returns undefined). Avoids
 * dumping raw JSON — which previously leaked raw HTTP error bodies — and
 * skips "not_applicable" providers since they have nothing to report.
 */
function formatSnapshotsForNotify(snapshots: Snapshot[]): string {
  const lines: string[] = [];
  for (const { provider, result } of snapshots) {
    if (!result.success) {
      if (result.error.kind === "not_applicable") continue;
      lines.push(`${provider}: ${result.error.message}`);
      continue;
    }
    const summary = result.data.windows
      .map((w) => `${w.label} ${w.usedPercent}%`)
      .join(", ");
    lines.push(`${provider}: ${summary || "no windows"}`);
  }
  return lines.join("\n") || "No quota data available";
}

export function registerQuotasCommands(pi: ExtensionAPI): void {
  pi.registerCommand("quotas", {
    description: "Display remaining quotas for Anthropic, Codex, GitHub Copilot, and OpenRouter",
    handler: async (_args, ctx) => {
      if (!configLoader.getConfig().quotasCommand) {
        ctx.ui.notify("/quotas is disabled. Re-enable it in /quotas:settings.", "warning");
        return;
      }
      await openQuotaView(
        "Provider Quotas",
        (force, signal) => fetchAllProviderQuotas(quotaAuthStorage(ctx.modelRegistry), { force, signal }),
        ctx,
      );
    },
  });

  for (const provider of SUPPORTED_PROVIDERS) {
    const info = getProviderCommandInfo(provider);
    pi.registerCommand(info.commandName, {
      description: `Display remaining ${info.title.toLowerCase()}`,
      handler: async (_args, ctx) => {
        if (!configLoader.getConfig().providerCommands) {
          ctx.ui.notify(`${info.commandName} is disabled. Re-enable it in /quotas:settings.`, "warning");
          return;
        }
        await openQuotaView(
          info.title,
          async (force, signal) => [
            {
              provider,
              result: await fetchProviderQuotas(quotaAuthStorage(ctx.modelRegistry), provider, { force, signal }),
            },
          ],
          ctx,
        );
      },
    });
  }
}

export default async function (pi: ExtensionAPI) {
  await configLoader.load();

  const config = configLoader.getConfig();
  if (config.quotasCommand || config.providerCommands) {
    registerQuotasCommands(pi);
  }

  pi.events.on(QUOTAS_EXTENSIONS_REQUEST_EVENT, () => {
    if (configLoader.getConfig().quotasCommand) {
      pi.events.emit(QUOTAS_EXTENSIONS_REGISTER_EVENT, { feature: "quotasCommand" });
    }
    if (configLoader.getConfig().providerCommands) {
      pi.events.emit(QUOTAS_EXTENSIONS_REGISTER_EVENT, { feature: "providerCommands" });
    }
  });
}
