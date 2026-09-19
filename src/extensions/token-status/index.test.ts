import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import tokenStatusExtension from "./index.js";
import { fetchProviderQuotas } from "../../lib/quotas.js";

const { configState } = vi.hoisted(() => ({
  configState: {
    usageStatus: true,
    tokenStatus: true,
  },
}));

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
      usageStatus: configState.usageStatus,
      tokenStatus: configState.tokenStatus,
      quotaWarnings: true,
      deferToSynthetic: true,
    })),
  },
}));

vi.mock("../../lib/quotas.js", () => ({
  fetchProviderQuotas: vi.fn(),
}));

vi.mock("../../lib/session-tokens.js", () => ({
  aggregateAllSessions: vi.fn(async () => ({
    totals: { costTotal: 11.24 },
  })),
  formatCost: (value: number) => `$${value.toFixed(2)}`,
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
    emitBusEvent(channel: string, data: unknown) {
      pi.events.emit(channel, data);
    },
  };
}

function createContext() {
  const setStatus = vi.fn();
  const ctx = {
    hasUI: true,
    cwd: "/tmp",
    model: { provider: "opencode-go" },
    modelRegistry: { authStorage: {} },
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus,
    },
  } as unknown as ExtensionContext;
  return { ctx, setStatus };
}

afterEach(() => {
  vi.clearAllMocks();
  configState.usageStatus = true;
  configState.tokenStatus = true;
});

describe("token-status OpenCode Go deference", () => {
  it("hides the local dollar estimate when account-wide usage is available", async () => {
    vi.mocked(fetchProviderQuotas).mockResolvedValue({
      success: true,
      data: { provider: "opencode-go", windows: [] },
    });

    const { pi, emitExtensionEvent, emitBusEvent } = createFakePi();
    const { ctx, setStatus } = createContext();

    await tokenStatusExtension(pi);
    emitBusEvent("quotas:extensions:register", { feature: "usageStatus" });
    await emitExtensionEvent("session_start", ctx);

    await vi.waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith("pi-quotas-token-status", undefined);
    });
    const calls = setStatus.mock.calls as unknown as Array<
      [string, string | undefined]
    >;
    expect(calls.some((call) => call[1]?.includes("$"))).toBe(false);

    await emitExtensionEvent("session_shutdown", ctx);
  });

  it("shows the local dollar estimate while the usage API is unavailable", async () => {
    vi.mocked(fetchProviderQuotas).mockResolvedValue({
      success: false,
      error: { message: "Request timed out", kind: "timeout" },
    });

    const { pi, emitExtensionEvent, emitBusEvent } = createFakePi();
    const { ctx, setStatus } = createContext();

    await tokenStatusExtension(pi);
    emitBusEvent("quotas:extensions:register", { feature: "usageStatus" });
    await emitExtensionEvent("session_start", ctx);

    await vi.waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith(
        "pi-quotas-token-status",
        expect.stringContaining("$11.24"),
      );
    });

    await emitExtensionEvent("session_shutdown", ctx);
  });

  it("shows the local dollar estimate when the usage footer is disabled", async () => {
    configState.usageStatus = false;
    vi.mocked(fetchProviderQuotas).mockResolvedValue({
      success: true,
      data: { provider: "opencode-go", windows: [] },
    });

    const { pi, emitExtensionEvent, emitBusEvent } = createFakePi();
    const { ctx, setStatus } = createContext();

    await tokenStatusExtension(pi);
    emitBusEvent("quotas:extensions:register", { feature: "usageStatus" });
    await emitExtensionEvent("session_start", ctx);

    await vi.waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith(
        "pi-quotas-token-status",
        expect.stringContaining("$11.24"),
      );
    });
    expect(fetchProviderQuotas).not.toHaveBeenCalled();

    await emitExtensionEvent("session_shutdown", ctx);
  });
});
