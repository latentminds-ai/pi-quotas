import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Keychain service under which Claude Code stores its login on macOS. */
export const CLAUDE_CODE_KEYCHAIN_SERVICE = "Claude Code-credentials";

export type ClaudeCodeLoginSource = "keychain" | "file";

export type ClaudeCodeLogin =
  | { status: "ok"; accessToken: string; source: ClaudeCodeLoginSource }
  | { status: "expired"; source: ClaudeCodeLoginSource }
  | { status: "missing" };

export interface ClaudeCodeAuthDeps {
  platform: NodeJS.Platform;
  homeDir: () => string;
  /** Claude Code's `CLAUDE_CONFIG_DIR`, which replaces `~/.claude` when set. */
  configDir: () => string | undefined;
  now: () => number;
  readFile: (path: string) => string | undefined;
  readKeychain: () => string | undefined;
}

function readKeychain(): string | undefined {
  try {
    return (
      execFileSync(
        "security",
        ["find-generic-password", "-s", CLAUDE_CODE_KEYCHAIN_SERVICE, "-w"],
        {
          timeout: 5000,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

function readFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

const defaultDeps: ClaudeCodeAuthDeps = {
  platform: process.platform,
  homeDir: homedir,
  configDir: () => process.env.CLAUDE_CONFIG_DIR || undefined,
  now: Date.now,
  readFile,
  readKeychain,
};

function parseLogin(
  raw: string | undefined,
  source: ClaudeCodeLoginSource,
  now: number,
): ClaudeCodeLogin {
  if (!raw) return { status: "missing" };
  let oauth: any;
  try {
    oauth = (JSON.parse(raw) as any)?.claudeAiOauth;
  } catch {
    return { status: "missing" };
  }
  const accessToken = oauth?.accessToken;
  if (typeof accessToken !== "string" || !accessToken) {
    return { status: "missing" };
  }
  const expiresAt = Number(oauth.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now) {
    return { status: "expired", source };
  }
  return { status: "ok", accessToken, source };
}

/**
 * Read the OAuth login that Claude Code itself uses (the credential behind
 * pi-claude-bridge models). On macOS it lives in the keychain; elsewhere, and
 * as a fallback, in `.credentials.json` under `CLAUDE_CONFIG_DIR` (default
 * `~/.claude`).
 *
 * The token is never refreshed here: refreshing rotates the refresh token and
 * would invalidate the copy Claude Code holds. An expired token is reported as
 * such so the user can open Claude Code to refresh it.
 */
export function readClaudeCodeLogin(
  deps: ClaudeCodeAuthDeps = defaultDeps,
): ClaudeCodeLogin {
  const now = deps.now();
  const candidates: ClaudeCodeLogin[] = [];
  if (deps.platform === "darwin") {
    candidates.push(parseLogin(deps.readKeychain(), "keychain", now));
  }
  candidates.push(
    parseLogin(
      deps.readFile(
        join(deps.configDir() ?? join(deps.homeDir(), ".claude"), ".credentials.json"),
      ),
      "file",
      now,
    ),
  );

  return (
    candidates.find((login) => login.status === "ok") ??
    candidates.find((login) => login.status === "expired") ?? {
      status: "missing",
    }
  );
}
