import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import pkg from "../package.json" with { type: "json" };

export type QuotasFeatureId =
  | "quotasCommand"
  | "providerCommands"
  | "usageStatus"
  | "quotaWarnings";

export const QUOTAS_EXTENSIONS_REQUEST_EVENT =
  "quotas:extensions:request" as const;
export const QUOTAS_EXTENSIONS_REGISTER_EVENT =
  "quotas:extensions:register" as const;
export const QUOTAS_CONFIG_UPDATED_EVENT =
  "quotas:config:updated" as const;

export interface QuotasExtensionsRegisterPayload {
  feature: QuotasFeatureId;
}

export interface QuotasConfig {
  configVersion?: string;
  quotasCommand?: boolean;
  providerCommands?: boolean;
  usageStatus?: boolean;
  quotaWarnings?: boolean;
}

export interface ResolvedQuotasConfig {
  configVersion: string;
  quotasCommand: boolean;
  providerCommands: boolean;
  usageStatus: boolean;
  quotaWarnings: boolean;
}

const DEFAULT_CONFIG: ResolvedQuotasConfig = {
  configVersion: pkg.version,
  quotasCommand: true,
  providerCommands: true,
  usageStatus: true,
  quotaWarnings: true,
};

let pendingMigrationNotice = false;

function markMigrationNoticePending(): void {
  pendingMigrationNotice = true;
}

export function hasPendingMigrationNotice(): boolean {
  return pendingMigrationNotice;
}

export function clearPendingMigrationNotice(): void {
  pendingMigrationNotice = false;
}

class QuotasConfigStore {
  private config: ResolvedQuotasConfig = DEFAULT_CONFIG;
  private cwd = process.cwd();

  private globalPath(): string {
    return join(homedir(), ".pi", "agent", "extensions", "quotas.json");
  }

  private localPath(): string {
    return join(this.cwd, ".pi", "quotas.json");
  }

  private resolve(input?: QuotasConfig): ResolvedQuotasConfig {
    return {
      configVersion: input?.configVersion ?? DEFAULT_CONFIG.configVersion,
      quotasCommand: input?.quotasCommand ?? DEFAULT_CONFIG.quotasCommand,
      providerCommands: input?.providerCommands ?? DEFAULT_CONFIG.providerCommands,
      usageStatus: input?.usageStatus ?? DEFAULT_CONFIG.usageStatus,
      quotaWarnings: input?.quotaWarnings ?? DEFAULT_CONFIG.quotaWarnings,
    };
  }

  private async readConfig(path: string): Promise<QuotasConfig | undefined> {
    try {
      const data = JSON.parse(await readFile(path, "utf8")) as QuotasConfig;
      return data;
    } catch {
      return undefined;
    }
  }

  async load(cwd = process.cwd()): Promise<void> {
    this.cwd = cwd;
    const global = await this.readConfig(this.globalPath());
    const local = await this.readConfig(this.localPath());
    const merged = { ...global, ...local };
    if (!global && !local) markMigrationNoticePending();
    this.config = this.resolve(merged);
  }

  getConfig(): ResolvedQuotasConfig {
    return this.config;
  }

  hasConfig(scope: "global" | "local"): boolean {
    const path = scope === "global" ? this.globalPath() : this.localPath();
    return existsSync(path);
  }

  async save(scope: "global" | "local", config: QuotasConfig): Promise<void> {
    const path = scope === "global" ? this.globalPath() : this.localPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(this.resolve(config), null, 2) + "\n", "utf8");
    await this.load(this.cwd);
  }
}

export const configLoader = new QuotasConfigStore();

export async function seedQuotasConfigIfMissing(): Promise<void> {
  if (configLoader.hasConfig("global") || configLoader.hasConfig("local")) return;
  markMigrationNoticePending();
  try {
    await configLoader.save("global", DEFAULT_CONFIG);
  } catch {
    // ignore
  }
}

export interface QuotasConfigUpdatedPayload {
  config: ResolvedQuotasConfig;
}

export function emitQuotasConfigUpdated(pi: ExtensionAPI): void {
  pi.events.emit(QUOTAS_CONFIG_UPDATED_EVENT, {
    config: configLoader.getConfig(),
  });
}

const FEATURE_META: Array<{
  id: QuotasFeatureId;
  label: string;
  description: string;
}> = [
  {
    id: "quotasCommand",
    label: "Combined quotas command",
    description: "Toggle the `/quotas` command",
  },
  {
    id: "providerCommands",
    label: "Provider quota commands",
    description: "Toggle `/anthropic:quotas`, `/codex:quotas`, and `/github:quotas`",
  },
  {
    id: "usageStatus",
    label: "Usage status",
    description: "Toggle footer quota status for the active provider",
  },
  {
    id: "quotaWarnings",
    label: "Quota warnings",
    description: "Toggle projected-usage warning notifications",
  },
];

export function registerQuotasSettings(
  pi: ExtensionAPI,
  getLoadedFeatures: () => Set<QuotasFeatureId>,
): void {
  pi.registerCommand("quotas:settings", {
    description: "Configure quota extension settings",
    handler: async (_args, ctx) => {
      await configLoader.load(ctx.cwd);
      const scopeChoice = await ctx.ui.select("Save settings to", [
        "global",
        "local",
        "cancel",
      ]);
      if (!scopeChoice || scopeChoice === "cancel") return;
      const scope = scopeChoice as "global" | "local";
      const draft: ResolvedQuotasConfig = { ...configLoader.getConfig() };

      while (true) {
        const choices = FEATURE_META.map((feature) => {
          const loaded = getLoadedFeatures().has(feature.id) ? "" : " (not loaded)";
          const enabled = draft[feature.id] ? "enabled" : "disabled";
          return `${feature.label}: ${enabled}${loaded}`;
        });
        choices.push("Save and exit", "Cancel");

        const selected = await ctx.ui.select("Quotas Settings", choices);
        if (!selected || selected === "Cancel") return;
        if (selected === "Save and exit") {
          await configLoader.save(scope, draft);
          emitQuotasConfigUpdated(pi);
          ctx.ui.notify(
            "Quota settings saved. Run /reload to fully apply command visibility changes.",
            "info",
          );
          return;
        }

        const feature = FEATURE_META.find((item) => selected.startsWith(item.label));
        if (!feature) continue;
        if (!getLoadedFeatures().has(feature.id)) {
          ctx.ui.notify(`${feature.label} is not loaded by Pi in this session.`, "warning");
          continue;
        }
        draft[feature.id] = !draft[feature.id];
      }
    },
  });
}
