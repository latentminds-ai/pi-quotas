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
});
