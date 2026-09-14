import type { SupportedQuotaProvider } from "../../types/quotas.js";

export interface ProviderCommandInfo {
  provider: SupportedQuotaProvider;
  commandName: string;
  title: string;
}

export function getProviderCommandInfo(
  provider: SupportedQuotaProvider,
): ProviderCommandInfo {
  switch (provider) {
    case "anthropic":
      return {
        provider,
        commandName: "anthropic:quotas",
        title: "Anthropic Quotas",
      };
    case "openai-codex":
      return {
        provider,
        commandName: "codex:quotas",
        title: "OpenAI Codex Quotas",
      };
    case "github-copilot":
      return {
        provider,
        commandName: "github:quotas",
        title: "GitHub Copilot Quotas",
      };
    case "openrouter":
      return {
        provider,
        commandName: "openrouter:quotas",
        title: "OpenRouter Quotas",
      };
    case "synthetic":
      return {
        provider,
        commandName: "synthetic:quotas",
        title: "Synthetic Quotas",
      };
    case "xai":
      return {
        provider,
        commandName: "grok:quotas",
        title: "Grok Quotas",
      };
    case "zai":
      return {
        provider,
        commandName: "zai:quotas",
        title: "Z.ai Quotas",
      };
    case "opencode-go":
      return {
        provider,
        commandName: "opencode-go:quotas",
        title: "OpenCode Go Quotas",
      };
    case "kimi-coding":
      return {
        provider,
        commandName: "kimi:quotas",
        title: "Kimi Code Quotas",
      };
    case "ollama-cloud":
      return {
        provider,
        commandName: "ollama:quotas",
        title: "Ollama Cloud Quotas",
      };
    case "antigravity":
      return {
        provider,
        commandName: "antigravity:quotas",
        title: "Antigravity Quotas",
      };
  }
}
