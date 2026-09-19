import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import quotaWarningsExtension from "./index.js";
import { fetchProviderQuotas } from "../../lib/quotas.js";

vi.mock("../../config.js", () => ({
  QUOTAS_CONFIG_UPDATED_EVENT: "quotas:config:updated",
  QUOTAS_EXTENSIONS_REGISTER_EVENT: "quotas:extensions:register",
  QUOTAS_EXTENSIONS_REQUEST_EVENT: "quotas:extensions:request",
  configLoader: {
    load: vi.fn(async () => undefined),
    getConfig: vi.fn(() => ({
      configVersion: "test",
      quotasCommand: true,
      providerCommands: true,
      usageStatus: true,
      tokenStatus: true,
      quotaWarnings: true,
      deferToSynthetic: true,
    })),
  },
}));

vi.mock("../../lib/quotas.js", () => ({
  resolveQuotaProvider: (provider: string | undefined) =>
    provider === "minimax" ? "minimax-global" : undefined,
  fetchProviderQuotas: vi.fn(async () => ({
    success: false,
    error: { kind: "http", message: "no quota data" },
  })),
  PROVIDER_LABELS: { "minimax-global": "MiniMax Global" },
}));

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;

function createFakePi() {
  const extensionHandlers = new Map<string, EventHandler[]>();
  const eventBusHandlers = new Map<string, Array<(data: unknown) => void>>();

  const pi = {
    on(event: string, handler: EventHandler) {
      const handlers = extensionHandlers.get(event) ?? [];
      handlers.push(handler);
      extensionHandlers.set(event, handlers);
    },
    events: {
      on(channel: string, handler: (data: unknown) => void) {
        const handlers = eventBusHandlers.get(channel) ?? [];
        handlers.push(handler);
        eventBusHandlers.set(channel, handlers);
        return () => {
          const current = eventBusHandlers.get(channel) ?? [];
          eventBusHandlers.set(
            channel,
            current.filter((entry) => entry !== handler),
          );
        };
      },
      emit(channel: string, data: unknown) {
        for (const handler of eventBusHandlers.get(channel) ?? []) handler(data);
      },
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    async emitExtensionEvent(event: string, ctx: ExtensionContext) {
      for (const handler of extensionHandlers.get(event) ?? []) {
        await handler({ type: event, reason: "test" }, ctx);
      }
    },
  };
}

function createContext(provider: string) {
  return {
    hasUI: true,
    model: { provider },
    modelRegistry: { authStorage: {} },
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      notify: vi.fn(),
    },
  } as unknown as ExtensionContext;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("quota-warnings provider resolution", () => {
  it("resolves pi's minimax provider to the minimax-global quota provider", async () => {
    const { pi, emitExtensionEvent } = createFakePi();
    const ctx = createContext("minimax");

    await quotaWarningsExtension(pi);
    await emitExtensionEvent("session_start", ctx);

    await vi.waitFor(() => {
      expect(fetchProviderQuotas).toHaveBeenCalledWith(
        expect.anything(),
        "minimax-global",
      );
    });
  });

  it("skips providers without quota support", async () => {
    const { pi, emitExtensionEvent } = createFakePi();
    const ctx = createContext("google");

    await quotaWarningsExtension(pi);
    await emitExtensionEvent("session_start", ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchProviderQuotas).not.toHaveBeenCalled();
  });
});
