import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import {
  clearPendingMigrationNotice,
  emitQuotasConfigUpdated,
  hasPendingMigrationNotice,
  QUOTAS_EXTENSIONS_REGISTER_EVENT,
  QUOTAS_EXTENSIONS_REQUEST_EVENT,
  registerQuotasSettings,
  type QuotasExtensionsRegisterPayload,
  type QuotasFeatureId,
  configLoader,
  seedQuotasConfigIfMissing,
} from "../../config.js";

const NOTICE_TYPE = "quotas:migration-notice";
const NOTICE_TITLE = "pi-quotas";
const NOTICE_CONTENT = [
  "Optional features available in `pi-quotas`:",
  "- Combined quotas command",
  "- Provider-specific quota commands",
  "- Usage footer status",
  "- Quota warnings",
  "",
  "Use `/quotas:settings` to enable or disable them.",
].join("\n");

function wrapInRoundedBorder(
  lines: string[],
  width: number,
  colorFn: (text: string) => string,
): string[] {
  const innerWidth = Math.max(1, width - 2);
  const hBar = "─".repeat(innerWidth);
  const top = colorFn(`╭${hBar}╮`);
  const bottom = colorFn(`╰${hBar}╯`);
  const left = colorFn("│");
  const right = colorFn("│");
  return [
    top,
    ...lines.map((line) => {
      const fill = Math.max(0, innerWidth - visibleWidth(line));
      return `${left}${line}${" ".repeat(fill)}${right}`;
    }),
    bottom,
  ];
}

function highlightInlineCode(text: string, colorFn: (text: string) => string): string {
  return text.replace(/`([^`]+)`/g, (_, code) => colorFn(code));
}

export default async function (pi: ExtensionAPI) {
  await configLoader.load();
  await seedQuotasConfigIfMissing();

  pi.registerMessageRenderer(NOTICE_TYPE, (message, _options, theme) => {
    const rawContent = typeof message.content === "string" ? message.content : NOTICE_CONTENT;
    const accent = (t: string) => theme.fg("accent", t);
    const title = theme.bold(accent(NOTICE_TITLE));
    const body = highlightInlineCode(rawContent, accent);
    return {
      render(width: number) {
        const contentWidth = Math.max(1, width - 4);
        const bodyLines = wrapTextWithAnsi(body, contentWidth);
        return wrapInRoundedBorder([` ${title} `, " ", ...bodyLines.map((line) => ` ${line} `)], width, accent);
      },
      handleInput() {
        return false;
      },
      invalidate() {},
    };
  });

  const loadedFeatures = new Set<QuotasFeatureId>();
  pi.events.on(QUOTAS_EXTENSIONS_REGISTER_EVENT, (data: unknown) => {
    const { feature } = data as QuotasExtensionsRegisterPayload;
    loadedFeatures.add(feature);
  });

  registerQuotasSettings(pi, () => loadedFeatures);

  pi.on("session_start", async () => {
    loadedFeatures.clear();
    pi.events.emit(QUOTAS_EXTENSIONS_REQUEST_EVENT, undefined);
    emitQuotasConfigUpdated(pi);
    if (hasPendingMigrationNotice()) {
      clearPendingMigrationNotice();
      pi.sendMessage(
        { customType: NOTICE_TYPE, content: NOTICE_CONTENT, display: true },
        { triggerTurn: false },
      );
    }
  });
}
