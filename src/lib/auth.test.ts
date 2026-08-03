import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import { quotaAuthStorage } from "./auth.js";

const tempDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("quotaAuthStorage", () => {
  it("preserves the legacy model registry auth storage", () => {
    const authStorage = {
      get: vi.fn(),
      getApiKey: vi.fn(),
    } as unknown as AuthStorage;

    expect(quotaAuthStorage({ authStorage })).toBe(authStorage);
  });

  it("adapts newer registries without discarding stored OAuth metadata", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-quotas-auth-"));
    tempDirectories.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    writeFileSync(
      join(agentDir, "auth.json"),
      JSON.stringify({
        "github-copilot": {
          type: "oauth",
          refresh: "github-token",
          access: "copilot-proxy-token",
          expires: Date.now() + 60_000,
        },
        "openai-codex": {
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: Date.now() + 60_000,
          accountId: "account-id",
        },
      }),
    );

    const getApiKeyForProvider = vi.fn(async (provider: string) =>
      `resolved:${provider}`,
    );
    const authStorage = quotaAuthStorage({ getApiKeyForProvider });

    await expect(authStorage.getApiKey("github-copilot")).resolves.toBe(
      "resolved:github-copilot",
    );
    expect(authStorage.get("github-copilot")).toMatchObject({
      refresh: "github-token",
    });
    expect(authStorage.get("openai-codex")).toMatchObject({
      accountId: "account-id",
    });
  });

  it("falls back to getProviderAuth when needed", async () => {
    const getProviderAuth = vi.fn(async () => ({
      auth: { apiKey: "resolved-token" },
    }));
    const authStorage = quotaAuthStorage({ getProviderAuth });

    await expect(authStorage.getApiKey("anthropic")).resolves.toBe(
      "resolved-token",
    );
  });

  it("extracts refreshed bearer auth when no API key is exposed", async () => {
    const getApiKeyForProvider = vi.fn(async () => undefined);
    const getProviderAuth = vi.fn(async () => ({
      auth: { headers: { Authorization: "Bearer refreshed-token" } },
    }));
    const authStorage = quotaAuthStorage({
      getApiKeyForProvider,
      getProviderAuth,
    });

    await expect(authStorage.getApiKey("kimi-coding")).resolves.toBe(
      "refreshed-token",
    );
    expect(getProviderAuth).toHaveBeenCalledWith("kimi-coding");
  });
});
