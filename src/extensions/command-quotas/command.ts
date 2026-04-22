import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  QUOTAS_EXTENSIONS_REGISTER_EVENT,
  QUOTAS_EXTENSIONS_REQUEST_EVENT,
  configLoader,
} from "../../config.js";
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
    ctx.ui.notify(JSON.stringify(snapshots, null, 2), "info");
  }
}

export function registerQuotasCommands(pi: ExtensionAPI): void {
  pi.registerCommand("quotas", {
    description: "Display remaining quotas for Anthropic, Codex, and GitHub Copilot",
    handler: async (_args, ctx) => {
      if (!configLoader.getConfig().quotasCommand) {
        ctx.ui.notify("/quotas is disabled. Re-enable it in /quotas:settings.", "warning");
        return;
      }
      await openQuotaView(
        "Provider Quotas",
        (force, signal) => fetchAllProviderQuotas(ctx.modelRegistry.authStorage, { force, signal }),
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
              result: await fetchProviderQuotas(ctx.modelRegistry.authStorage, provider, { force, signal }),
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
