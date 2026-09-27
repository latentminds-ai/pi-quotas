import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import tokenStatusExtension from "./index.js";

vi.mock("../../config.js", () => ({
  QUOTAS_CONFIG_UPDATED_EVENT: "quotas:config:updated",
  QUOTAS_EXTENSIONS_REGISTER_EVENT: "quotas:extensions:register",
  QUOTAS_EXTENSIONS_REQUEST_EVENT: "quotas:extensions:request",
  configLoader: {
    load: vi.fn(async () => undefined),
    getConfig: vi.fn(() => ({ tokenStatus: true })),
  },
}));

vi.mock("../../lib/session-tokens.js", () => ({
  aggregateAllSessions: vi.fn(async () => ({ totals: { costTotal: 1 } })),
  formatCost: (cost: number) => `$${cost.toFixed(2)}`,
}));

const STALE_CONTEXT_ERROR = "This extension ctx is stale after session replacement.";
type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;

function createFakePi() {
  const handlers = new Map<string, EventHandler[]>();
  const pi = {
    on(event: string, handler: EventHandler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    events: { on: vi.fn(), emit: vi.fn() },
  } as unknown as ExtensionAPI;
  return {
    pi,
    async emit(event: string, ctx: ExtensionContext) {
      for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
    },
  };
}

function createContext() {
  let stale = false;
  const assertActive = () => {
    if (stale) throw new Error(STALE_CONTEXT_ERROR);
  };
  const ctx = {
    get hasUI() { assertActive(); return true; },
    get model() { assertActive(); return { provider: "opencode-go" }; },
    cwd: "/test",
    ui: {
      get theme() { assertActive(); return { fg: (_color: string, text: string) => text }; },
      setStatus: vi.fn(() => assertActive()),
    },
  } as unknown as ExtensionContext;
  return { ctx, invalidate: () => { stale = true; } };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("token-status session lifecycle", () => {
  it("does not use a replaced context from its periodic refresh", async () => {
    vi.useFakeTimers();
    const { pi, emit } = createFakePi();
    const first = createContext();
    await tokenStatusExtension(pi);
    await emit("session_start", first.ctx);
    const callsBeforeReplacement = (first.ctx.ui.setStatus as ReturnType<typeof vi.fn>).mock.calls.length;
    first.invalidate();

    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    await vi.runOnlyPendingTimersAsync();
    expect(first.ctx.ui.setStatus).toHaveBeenCalledTimes(callsBeforeReplacement);
  });
});
