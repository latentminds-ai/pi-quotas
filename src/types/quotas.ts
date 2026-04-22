export type SupportedQuotaProvider =
  | "anthropic"
  | "openai-codex"
  | "github-copilot";

export type QuotasErrorKind =
  | "cancelled"
  | "timeout"
  | "config"
  | "http"
  | "network";

export type QuotasResult =
  | { success: true; data: { windows: QuotaWindow[]; provider: SupportedQuotaProvider } }
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
