import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type ResolvedOpenCodeGoApiKey =
  | { state: "configured"; apiKey: string; source: string }
  | { state: "none" }
  | { state: "invalid"; source: string; error: string };

function getApiKeyCandidatePaths(): string[] {
  const home = homedir();
  return [
    join(home, ".config", "opencode", "opencode-quota", "opencode-go.json"),
    join(home, ".config", "opencode-go", "config.json"),
    join(home, ".local", "share", "opencode", "auth.json"),
    join(home, ".config", "opencode", "auth.json"),
  ];
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readJson(
  path: string,
): Promise<
  | { state: "missing" }
  | { state: "loaded"; data: Record<string, unknown> }
  | { state: "invalid"; error: string }
> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { state: "invalid", error: "Config file must contain a JSON object" };
    }
    return { state: "loaded", data: parsed as Record<string, unknown> };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { state: "missing" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { state: "invalid", error: `Failed to read config file: ${message}` };
  }
}

/** Extract an API key from a quota config file or an OpenCode auth.json. */
export function apiKeyFromConfigData(
  data: Record<string, unknown>,
): { apiKey: string } | { legacy: true } | null {
  const direct =
    pickString(data.apiKey) || pickString(data.key) || pickString(data.OPENCODE_GO_API_KEY);
  if (direct) return { apiKey: direct };

  const entry = data["opencode-go"];
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>;
    const key = pickString(record.key) || pickString(record.apiKey);
    if (key) return { apiKey: key };
  }

  if (pickString(data.workspaceId) || pickString(data.authCookie)) {
    return { legacy: true };
  }
  return null;
}

export function resolveOpenCodeGoApiKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Extract<ResolvedOpenCodeGoApiKey, { state: "configured" }> | null {
  const apiKey = env.OPENCODE_GO_API_KEY?.trim();
  if (!apiKey) return null;
  return { state: "configured", apiKey, source: "env" };
}

export async function resolveOpenCodeGoApiKeyFromFiles(): Promise<ResolvedOpenCodeGoApiKey> {
  for (const path of getApiKeyCandidatePaths()) {
    const fileResult = await readJson(path);
    if (fileResult.state === "missing") continue;
    if (fileResult.state === "invalid") {
      return { state: "invalid", source: path, error: fileResult.error };
    }

    const extracted = apiKeyFromConfigData(fileResult.data);
    if (!extracted) continue;
    if ("legacy" in extracted) {
      return {
        state: "invalid",
        source: path,
        error:
          "workspaceId/authCookie scraping is no longer supported." +
          " Replace them with an \"apiKey\" field (OpenCode Go API key)",
      };
    }
    return { state: "configured", apiKey: extracted.apiKey, source: path };
  }
  return { state: "none" };
}

let cached: ResolvedOpenCodeGoApiKey | null = null;
let cachedAt = 0;

const CACHE_MAX_AGE_MS = 30_000;

/** Test hook: drop the memoized file-resolution result. */
export function resetOpenCodeGoApiKeyCache(): void {
  cached = null;
  cachedAt = 0;
}

export async function resolveOpenCodeGoApiKeyFromFilesCached(params?: {
  maxAgeMs?: number;
}): Promise<ResolvedOpenCodeGoApiKey> {
  const maxAgeMs = Math.max(0, params?.maxAgeMs ?? CACHE_MAX_AGE_MS);
  const now = Date.now();
  if (cached && now - cachedAt < maxAgeMs) return cached;
  cached = await resolveOpenCodeGoApiKeyFromFiles();
  cachedAt = now;
  return cached;
}
