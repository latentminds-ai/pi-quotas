import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { aggregateAllSessions } from "../../lib/session-tokens.js";
import tokenStatusExtension from "./index.js";

const CONFIG_UPDATED = "quotas:config:updated";

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
  aggregateAllSessions: vi.fn(async () => ({
    totals: { costTotal: 3 },
    bySession: [
      { created: new Date(), tokens: { costTotal: 1 } },
      { created: new Date(0), tokens: { costTotal: 2 } },
    ],
  })),
  formatCost: (cost: number) => `$${cost.toFixed(2)}`,
}));

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function createFakePi() {
  const handlers = new Map<string, Handler[]>();
  const busHandlers = new Map<string, Array<(data: unknown) => void>>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    events: {
      on(event: string, handler: (data: unknown) => void) {
        busHandlers.set(event, [...(busHandlers.get(event) ?? []), handler]);
      },
      emit: vi.fn(),
    },
  } as unknown as ExtensionAPI;
  return {
    pi,
    async emit(event: string, ctx: ExtensionContext) {
      for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
    },
    broadcast(event: string, data: unknown) {
      for (const handler of busHandlers.get(event) ?? []) handler(data);
    },
  };
}

function createContext(provider: string) {
  return {
    hasUI: true,
    model: { provider },
    cwd: "/test",
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: vi.fn(),
    },
  } as unknown as ExtensionContext;
}

const aggregate = vi.mocked(aggregateAllSessions);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("token-status refresh", () => {
  it("never aggregates sessions for a non-Go provider, even after a config broadcast", async () => {
    const { pi, emit, broadcast } = createFakePi();
    await tokenStatusExtension(pi);
    const ctx = createContext("anthropic");

    await emit("session_start", ctx);
    // The core extension broadcasts the config on every session start.
    broadcast(CONFIG_UPDATED, { config: { tokenStatus: true } });
    await vi.advanceTimersByTimeAsync(3 * 60_000);

    expect(aggregate).not.toHaveBeenCalled();
  });

  it("aggregates once per refresh for a Go provider", async () => {
    const { pi, emit } = createFakePi();
    await tokenStatusExtension(pi);
    const ctx = createContext("opencode-go");

    await emit("session_start", ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(aggregate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(aggregate).toHaveBeenCalledTimes(2);
  });

  it("derives the narrower windows from the monthly pass", async () => {
    const { pi, emit } = createFakePi();
    await tokenStatusExtension(pi);
    const ctx = createContext("opencode-go");

    await emit("session_start", ctx);
    await vi.advanceTimersByTimeAsync(0);

    const status = vi.mocked(ctx.ui.setStatus).mock.calls.at(-1)?.[1];
    expect(status).toBe("5h:$1.00 · wk:$1.00 · mo:$3.00");
  });
});
