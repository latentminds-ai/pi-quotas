import { describe, expect, it, vi } from "vitest";
import {
  readClaudeCodeLogin,
  type ClaudeCodeAuthDeps,
} from "./claude-code-auth.js";

const NOW = Date.parse("2026-09-29T12:00:00Z");
const CREDENTIALS_PATH = "/home/user/.claude/.credentials.json";

function credentials(accessToken: string, expiresAt = NOW + 60_000): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken,
      refreshToken: "sk-ant-ort01-refresh",
      expiresAt,
    },
  });
}

function deps(overrides: Partial<ClaudeCodeAuthDeps>): ClaudeCodeAuthDeps {
  return {
    platform: "linux",
    homeDir: () => "/home/user",
    configDir: () => undefined,
    now: () => NOW,
    readFile: vi.fn(() => undefined),
    readKeychain: vi.fn(() => undefined),
    ...overrides,
  };
}

describe("readClaudeCodeLogin", () => {
  it("reads the macOS keychain first", () => {
    const readFile = vi.fn(() => credentials("sk-ant-oat01-file"));
    const login = readClaudeCodeLogin(
      deps({
        platform: "darwin",
        readKeychain: () => credentials("sk-ant-oat01-keychain"),
        readFile,
      }),
    );

    expect(login).toEqual({
      status: "ok",
      accessToken: "sk-ant-oat01-keychain",
      source: "keychain",
    });
  });

  it("falls back to the credentials file when the keychain has no login", () => {
    const readFile = vi.fn((path: string) =>
      path === CREDENTIALS_PATH ? credentials("sk-ant-oat01-file") : undefined,
    );
    const login = readClaudeCodeLogin(
      deps({ platform: "darwin", readKeychain: () => undefined, readFile }),
    );

    expect(login).toEqual({
      status: "ok",
      accessToken: "sk-ant-oat01-file",
      source: "file",
    });
  });

  it("reads only the credentials file off macOS", () => {
    const readKeychain = vi.fn(() => credentials("sk-ant-oat01-keychain"));
    const login = readClaudeCodeLogin(
      deps({
        platform: "linux",
        readKeychain,
        readFile: () => credentials("sk-ant-oat01-file"),
      }),
    );

    expect(login).toMatchObject({ status: "ok", source: "file" });
    expect(readKeychain).not.toHaveBeenCalled();
  });

  it("reads the credentials file from CLAUDE_CONFIG_DIR when set", () => {
    const readFile = vi.fn((path: string) =>
      path === "/custom/claude/.credentials.json"
        ? credentials("sk-ant-oat01-custom")
        : undefined,
    );
    const login = readClaudeCodeLogin(
      deps({ configDir: () => "/custom/claude", readFile }),
    );

    expect(login).toMatchObject({ status: "ok", accessToken: "sk-ant-oat01-custom" });
    expect(readFile).toHaveBeenCalledWith("/custom/claude/.credentials.json");
  });

  it("reports an expired login instead of refreshing it", () => {
    const login = readClaudeCodeLogin(
      deps({ readFile: () => credentials("sk-ant-oat01-old", NOW - 1) }),
    );

    expect(login).toEqual({ status: "expired", source: "file" });
  });

  it("prefers a valid login over an expired one", () => {
    const login = readClaudeCodeLogin(
      deps({
        platform: "darwin",
        readKeychain: () => credentials("sk-ant-oat01-old", NOW - 1),
        readFile: () => credentials("sk-ant-oat01-file"),
      }),
    );

    expect(login).toMatchObject({
      status: "ok",
      accessToken: "sk-ant-oat01-file",
    });
  });

  it("reports a missing login when nothing is stored", () => {
    expect(readClaudeCodeLogin(deps({}))).toEqual({ status: "missing" });
  });

  it("treats unreadable or tokenless credentials as missing", () => {
    expect(
      readClaudeCodeLogin(deps({ readFile: () => "not json" })),
    ).toEqual({ status: "missing" });
    expect(
      readClaudeCodeLogin(
        deps({ readFile: () => JSON.stringify({ claudeAiOauth: {} }) }),
      ),
    ).toEqual({ status: "missing" });
  });
});
