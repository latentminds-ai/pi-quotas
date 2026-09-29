import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { aggregateAllSessions } from "../../lib/session-tokens.js";
import { TokensComponent } from "./tokens-display.js";

function isRpcContext(ctx: ExtensionCommandContext): boolean {
  return (ctx as ExtensionCommandContext & { mode?: string }).mode === "rpc";
}

async function openTokensView(
  ctx: ExtensionCommandContext,
  cwd?: string,
): Promise<void> {
  if (isRpcContext(ctx)) {
    try {
      const aggregateResult = await aggregateAllSessions({ cwd });
      const { totals } = aggregateResult;
      const lines = [
        `Token Usage: ${aggregateResult.sessionCount} sessions, ${aggregateResult.messageCount} messages`,
        `  Input: ${totals.input.toLocaleString()} · Output: ${totals.output.toLocaleString()}`,
        `  Cache Read: ${totals.cacheRead.toLocaleString()} · Cache Write: ${totals.cacheWrite.toLocaleString()}`,
        `  Total: ${totals.totalTokens.toLocaleString()} tokens · $${totals.costTotal.toFixed(2)}`,
      ];
      for (const model of aggregateResult.byModel) {
        lines.push(
          `  ${model.provider}/${model.model}: $${model.tokens.costTotal.toFixed(2)} (${model.messageCount} msgs)`,
        );
      }
      ctx.ui.notify(lines.join("\n"), "info");
    } catch {
      ctx.ui.notify("Token usage unavailable", "warning");
    }
    return;
  }

  const result = await ctx.ui.custom<null>((tui, theme, _kb, done) => {
    const controller = new AbortController();
    const component = new TokensComponent(
      theme,
      tui,
      () => {
        controller.abort();
        done(null);
      },
      () => {
        component.setState({ type: "loading" });
        tui.requestRender();
        void load();
      },
      cwd,
    );

    async function load(): Promise<void> {
      try {
        const aggregateResult = await aggregateAllSessions({ cwd });
        if (controller.signal.aborted) return;
        component.setState({ type: "loaded", result: aggregateResult });
        tui.requestRender();
      } catch {
        if (controller.signal.aborted) return;
        component.setState({
          type: "loaded",
          result: {
            totals: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              costTotal: 0,
            },
            byModel: [],
            byProvider: [],
            bySession: [],
            sessionCount: 0,
            messageCount: 0,
          },
        });
        tui.requestRender();
      }
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

  // Fallback for non-interactive mode
  if (result === undefined) {
    const aggregateResult = await aggregateAllSessions({ cwd });
    const { totals } = aggregateResult;
    const lines = [
      `Token Usage: ${aggregateResult.sessionCount} sessions, ${aggregateResult.messageCount} messages`,
      `  Input: ${totals.input.toLocaleString()} · Output: ${totals.output.toLocaleString()}`,
      `  Cache Read: ${totals.cacheRead.toLocaleString()} · Cache Write: ${totals.cacheWrite.toLocaleString()}`,
      `  Total: ${totals.totalTokens.toLocaleString()} tokens · $${totals.costTotal.toFixed(2)}`,
    ];
    for (const model of aggregateResult.byModel) {
      lines.push(
        `  ${model.provider}/${model.model}: $${model.tokens.costTotal.toFixed(2)} (${model.messageCount} msgs)`,
      );
    }
    ctx.ui.notify(lines.join("\n"), "info");
  }
}

export function registerTokensCommand(pi: ExtensionAPI): void {
  pi.registerCommand("tokens", {
    description: "Display token usage and cost across all sessions",
    handler: async (_args, ctx) => {
      await openTokensView(ctx, ctx.cwd);
    },
  });
}

export default async function (pi: ExtensionAPI) {
  registerTokensCommand(pi);
}
