import { afterEach, describe, expect, it, vi } from "vitest";
import {
  queryOpenCodeGoQuota,
  queryOpenCodeGoQuotaWithApiKey,
} from "./opencode-go.js";

const CONFIG = {
  workspaceId: "wrk_test/value",
  authCookie: "cookie-value",
};

const USAGE_HTML = [
  "rollingUsage:$R[1]={usagePercent:25,resetInSec:3600}",
  "weeklyUsage:$R[2]={resetInSec:7200,usagePercent:40}",
  "monthlyUsage:$R[3]={usagePercent:55.5,resetInSec:10800}",
].join(";");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("queryOpenCodeGoQuota", () => {
  it("uses the new console dashboard URL first", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(USAGE_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryOpenCodeGoQuota(CONFIG);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://opencode.ai/console/wrk_test%2Fvalue/go",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Accept: "text/html",
      Cookie: "auth=cookie-value",
    });
    if (!result.success) return;
    expect(result.rolling?.usagePercent).toBe(25);
    expect(result.weekly?.usagePercent).toBe(40);
    expect(result.monthly?.usagePercent).toBe(55.5);
  });

  it("falls back to the legacy workspace URL when console is unavailable", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(USAGE_HTML, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryOpenCodeGoQuota(CONFIG);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://opencode.ai/workspace/wrk_test%2Fvalue/go",
    );
  });

  it("falls back when the console page no longer contains usage hydration data", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("<html>redesigned page</html>", { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(USAGE_HTML, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryOpenCodeGoQuota(CONFIG);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("queryOpenCodeGoQuotaWithApiKey", () => {
  it("fetches and normalizes all windows from the official usage API", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T08:00:00.000Z"));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            rolling: {
              status: "ok",
              percent: 12.5,
              resetsAt: "2026-09-22T09:00:00.000Z",
            },
            weekly: {
              status: "ok",
              percent: 34,
              resetsAt: "2026-09-25T08:00:00.000Z",
            },
            monthly: {
              status: "ok",
              percent: 56,
              resetsAt: "2026-10-01T08:00:00.000Z",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryOpenCodeGoQuotaWithApiKey("oc-test-key");

    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://opencode.ai/zen/go/v1/usage",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer oc-test-key",
      Accept: "application/json",
    });
    if (!result.success) return;
    expect(result.rolling).toMatchObject({
      usagePercent: 12.5,
      resetInSec: 3600,
      percentRemaining: 87.5,
    });
    expect(result.weekly?.usagePercent).toBe(34);
    expect(result.monthly?.usagePercent).toBe(56);
  });

  it("surfaces the API error message without exposing the key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "error",
          error: { type: "AuthError", message: "Unauthorized" },
        }),
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryOpenCodeGoQuotaWithApiKey("secret-key");

    expect(result).toEqual({
      success: false,
      error: "OpenCode Go usage API error 401: Unauthorized",
    });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });
});
