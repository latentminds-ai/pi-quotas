import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import usageStatusExtension from "./index.js";
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
      quotaWarnings: true,
      deferToSynthetic: true,
    })),
  },
}));

vi.mock("../../lib/quotas.js", () => ({
  resolveQuotaProvider: (provider: string | undefined) => {
    if (provider === "anthropic") return "anthropic";
    if (provider === "minimax") return "minimax-global";
    return undefined;
  },
  fetchProviderQuotas: vi.fn(async () => ({
    success: true,
    data: { provider: "anthropic", windows: [] },
  })),
}));

const STALE_CONTEXT_ERROR =
  "This extension ctx is stale after session replacement or reload.";

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
          eventBusHandlers.set(channel, current.filter((entry) => entry !== handler));
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
    listenerCount(channel: string) {
      return eventBusHandlers.get(channel)?.length ?? 0;
    },
  };
}

function createContext(provider: string) {
  let stale = false;
  const setStatus = vi.fn(() => {
    if (stale) throw new Error(STALE_CONTEXT_ERROR);
  });

  const ctx = {
    get hasUI() {
      if (stale) throw new Error(STALE_CONTEXT_ERROR);
      return true;
    },
    get model() {
      if (stale) throw new Error(STALE_CONTEXT_ERROR);
      return { provider };
    },
    modelRegistry: { authStorage: {} },
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus,
    },
  } as unknown as ExtensionContext;

  return {
    ctx,
    setStale() {
      stale = true;
    },
    setStatus,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("usage-status extension lifecycle", () => {
  it("ignores interval refreshes for stale session contexts", async () => {
    vi.useFakeTimers();
    const { pi, emitExtensionEvent } = createFakePi();
    const { ctx, setStale } = createContext("unsupported-provider");

    await usageStatusExtension(pi);
    await emitExtensionEvent("session_start", ctx);

    setStale();

    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    await vi.runOnlyPendingTimersAsync();
  });

  it("does not throw when event-bus callbacks see a stale session context", async () => {
    const { pi, emitExtensionEvent, emitBusEvent } = createFakePi();
    const { ctx, setStale } = createContext("synthetic");

    await usageStatusExtension(pi);
    await emitExtensionEvent("session_start", ctx);

    setStale();

    expect(() => {
      emitBusEvent("synthetic:extensions:register", { feature: "usageStatus" });
      emitBusEvent("quotas:config:updated", {
        config: { usageStatus: true, deferToSynthetic: true },
      });
    }).not.toThrow();
  });

  it("unsubscribes event-bus listeners during session shutdown", async () => {
    const { pi, emitExtensionEvent, listenerCount } = createFakePi();
    const { ctx } = createContext("unsupported-provider");

    await usageStatusExtension(pi);
    expect(listenerCount("quotas:config:updated")).toBe(1);
    expect(listenerCount("synthetic:extensions:register")).toBe(1);
    expect(listenerCount("quotas:extensions:request")).toBe(1);

    await emitExtensionEvent("session_shutdown", ctx);

    expect(listenerCount("quotas:config:updated")).toBe(0);
    expect(listenerCount("synthetic:extensions:register")).toBe(0);
    expect(listenerCount("quotas:extensions:request")).toBe(0);
  });

  it("resolves pi's minimax provider to the minimax-global quota provider", async () => {
    const { pi, emitExtensionEvent } = createFakePi();
    const { ctx } = createContext("minimax");

    await usageStatusExtension(pi);
    await emitExtensionEvent("session_start", ctx);

    await vi.waitFor(() => {
      expect(fetchProviderQuotas).toHaveBeenCalledWith(
        expect.anything(),
        "minimax-global",
      );
    });
  });

  it("clears the footer silently for not_applicable credentials instead of warning", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchProviderQuotas).mockResolvedValueOnce({
      success: false,
      error: { kind: "not_applicable", message: "Direct API key" },
    } as any);

    const { pi, emitExtensionEvent } = createFakePi();
    const { ctx, setStatus } = createContext("anthropic");

    await usageStatusExtension(pi);
    await emitExtensionEvent("session_start", ctx);
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(0);

    const calls = setStatus.mock.calls as unknown as Array<[string, string | undefined]>;
    const last = calls[calls.length - 1]?.[1];
    expect(last).toBeUndefined();
    expect(calls.some((c) => c[1] === "usage unavailable")).toBe(false);
  });
});
