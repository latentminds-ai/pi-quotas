import { describe, expect, it } from "vitest";
import {
  getProviderCommandInfo,
  type ProviderCommandInfo,
} from "./provider-commands.js";

describe("getProviderCommandInfo", () => {
  it("maps anthropic to anthropic:quotas", () => {
    const info = getProviderCommandInfo("anthropic");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "anthropic",
      commandName: "anthropic:quotas",
      title: "Anthropic Quotas",
    });
  });

  it("maps openai-codex to codex:quotas", () => {
    const info = getProviderCommandInfo("openai-codex");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "openai-codex",
      commandName: "codex:quotas",
      title: "OpenAI Codex Quotas",
    });
  });

  it("maps github-copilot to github:quotas", () => {
    const info = getProviderCommandInfo("github-copilot");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "github-copilot",
      commandName: "github:quotas",
      title: "GitHub Copilot Quotas",
    });
  });

  it("maps openrouter to openrouter:quotas", () => {
    const info = getProviderCommandInfo("openrouter");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "openrouter",
      commandName: "openrouter:quotas",
      title: "OpenRouter Quotas",
    });
  });

  it("maps xai to grok:quotas", () => {
    const info = getProviderCommandInfo("xai");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "xai",
      commandName: "grok:quotas",
      title: "Grok Quotas",
    });
  });

  it("maps zai to zai:quotas", () => {
    const info = getProviderCommandInfo("zai");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "zai",
      commandName: "zai:quotas",
      title: "Z.ai Quotas",
    });
  });

  it("maps kimi-coding to kimi:quotas", () => {
    const info = getProviderCommandInfo("kimi-coding");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "kimi-coding",
      commandName: "kimi:quotas",
      title: "Kimi Code Quotas",
    });
  });

  it("maps ollama-cloud to ollama:quotas", () => {
    const info = getProviderCommandInfo("ollama-cloud");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "ollama-cloud",
      commandName: "ollama:quotas",
      title: "Ollama Cloud Quotas",
    });
  });

  it("maps antigravity to antigravity:quotas", () => {
    const info = getProviderCommandInfo("antigravity");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "antigravity",
      commandName: "antigravity:quotas",
      title: "Antigravity Quotas",
    });
  });
});
