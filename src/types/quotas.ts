export type SupportedQuotaProvider =
  | "anthropic"
  | "openai-codex"
  | "github-copilot"
  | "openrouter"
  | "synthetic"
  | "xai"
  | "zai"
  | "opencode-go"
  | "kimi-coding"
  | "ollama-cloud"
  | "antigravity";

export type QuotasErrorKind =
  | "cancelled"
  | "timeout"
  | "config"
  | "http"
  | "network"
  // The provider is not applicable for the stored credential type
  // (e.g. a direct Anthropic API key has no OAuth subscription usage to
  // report). Consumers should render this silently rather than as a warning.
  | "not_applicable";

export type QuotasResult =
  | {
      success: true;
      data: { windows: QuotaWindow[]; provider: SupportedQuotaProvider };
    }
  | { success: false; error: { message: string; kind: QuotasErrorKind } };

export interface QuotaWindow {
  provider: SupportedQuotaProvider;
  label: string;
  usedPercent: number;
  resetsAt: Date;
  windowSeconds: number;
  usedValue: number;
  limitValue: number;
  isCurrency?: boolean;
  showPace?: boolean;
  paceScale?: number;
  limited?: boolean;
  nextAmount?: string;
  nextLabel?: string;
}
