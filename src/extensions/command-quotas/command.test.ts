import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerQuotasCommands } from "./command.js";

// Provider credentials can leak in from the host environment (pi resolves
// API keys from env vars, and the Synthetic provider reads
// SYNTHETIC_API_KEY directly), which would turn these "no credentials"
// tests into live network calls. Keep them hermetic.
const CREDENTIAL_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "SYNTHETIC_API_KEY",
  "OLLAMA_API_KEY",
  "MINIMAX_API_KEY",
];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of CREDENTIAL_ENV_KEYS) delete process.env[key];
  globalThis.fetch = vi.fn().mockRejectedValue(
    new Error("network disabled in tests"),
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function registeredCommands() {
  const commands = new Map<string, any>();
  registerQuotasCommands({
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
  } as any);
  return commands;
}

function contextWithoutCredentials(notify: ReturnType<typeof vi.fn>) {
  return {
    modelRegistry: { authStorage: AuthStorage.inMemory({}) },
    ui: {
      custom: async () => undefined,
      notify,
    },
  } as any;
}

describe("quota command visibility", () => {
  it("hides unconfigured providers from the combined dashboard", async () => {
    const commands = registeredCommands();
    const notify = vi.fn();

    await commands.get("quotas").handler(
      "",
      contextWithoutCredentials(notify),
    );

    expect(notify).toHaveBeenCalledWith("No quota data available", "info");
  });

  it("keeps provider-specific commands diagnostic", async () => {
    const commands = registeredCommands();
    const notify = vi.fn();

    await commands.get("anthropic:quotas").handler(
      "",
      contextWithoutCredentials(notify),
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("No Anthropic OAuth token found"),
      "info",
    );
  });
});
