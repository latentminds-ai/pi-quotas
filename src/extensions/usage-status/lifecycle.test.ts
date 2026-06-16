import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviderQuotas } from "../../lib/quotas.js";
import type { QuotasResult } from "../../types/quotas.js";
import { createStatusRefresher } from "./index.js";

vi.mock("../../lib/quotas.js", () => ({
  fetchProviderQuotas: vi.fn(),
  isSupportedProvider: (provider: string) => provider === "anthropic",
}));

const STALE_CONTEXT_ERROR = "This extension ctx is stale after session replacement or reload.";
const REFRESH_INTERVAL_MS = 60_000;

function successResult(): QuotasResult {
  return {
    success: true,
    data: {
      provider: "anthropic",
      windows: [
        {
          provider: "anthropic",
          label: "5h",
          usedPercent: 10,
          resetsAt: new Date("2026-05-06T07:47:37Z"),
          windowSeconds: 5 * 60 * 60,
          usedValue: 10,
          limitValue: 100,
        },
      ],
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeContext() {
  let stale = false;
  let staleAccesses = 0;
  const setStatus = vi.fn();
  const theme = { fg: (color: string, text: string) => `[${color}]${text}[/${color}]` };
  const throwIfStale = () => {
    if (stale) {
      staleAccesses += 1;
      throw new Error(STALE_CONTEXT_ERROR);
    }
  };

  const ctx = {
    get hasUI() {
      throwIfStale();
      return true;
    },
    get model() {
      throwIfStale();
      return { provider: "anthropic" };
    },
    get modelRegistry() {
      throwIfStale();
      return { authStorage: {} };
    },
    get ui() {
      throwIfStale();
      return { setStatus, theme };
    },
  } as unknown as ExtensionContext;

  return {
    ctx,
    setStatus,
    markStale: () => {
      stale = true;
    },
    staleAccesses: () => staleAccesses,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("usage status lifecycle", () => {
  it("drops queued refreshes after shutdown instead of reusing a stale context", async () => {
    vi.useFakeTimers();
    const firstFetch = createDeferred<QuotasResult>();
    const fetchMock = vi.mocked(fetchProviderQuotas);
    fetchMock.mockReturnValueOnce(firstFetch.promise).mockResolvedValue(successResult());
    const { ctx, markStale, staleAccesses } = createFakeContext();
    const refresher = createStatusRefresher();

    const refresh = refresher.refreshFor(ctx);
    refresher.start();

    vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
    markStale();
    refresher.stop();
    firstFetch.resolve(successResult());

    await refresh;
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(staleAccesses()).toBe(0);
  });

  it("deactivates a leaked interval when its captured context is stale", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetchProviderQuotas).mockResolvedValue(successResult());
    const { ctx, markStale, staleAccesses } = createFakeContext();
    const refresher = createStatusRefresher();

    await refresher.refreshFor(ctx);
    refresher.start();
    markStale();

    vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
    await flushMicrotasks();
    vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(staleAccesses()).toBe(1);
  });
});
