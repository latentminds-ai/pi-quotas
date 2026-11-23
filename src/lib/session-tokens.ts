import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/** Aggregated token counts */
export interface TokenBuckets {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotal: number;
}

export function emptyBuckets(): TokenBuckets {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costTotal: 0,
  };
}

export function addBuckets(a: TokenBuckets, b: TokenBuckets): TokenBuckets {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    costTotal: a.costTotal + b.costTotal,
  };
}

/** Per-model usage row */
export interface ModelUsage {
  provider: string;
  model: string;
  tokens: TokenBuckets;
  messageCount: number;
}

/** Per-session usage row */
export interface SessionUsage {
  sessionId: string;
  sessionPath: string;
  cwd: string;
  name?: string;
  created: Date;
  tokens: TokenBuckets;
  messageCount: number;
}

/** Full aggregation result */
export interface AggregateResult {
  totals: TokenBuckets;
  byModel: ModelUsage[];
  byProvider: Array<{
    provider: string;
    tokens: TokenBuckets;
    messageCount: number;
  }>;
  bySession: SessionUsage[];
  sessionCount: number;
  messageCount: number;
}

/** Minimal assistant message fields for extraction */
interface AssistantMessageData {
  role: string;
  provider?: string;
  model?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    cost?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
  };
}

interface SessionEntry {
  type: string;
  message?: AssistantMessageData;
  name?: string;
}

/**
 * Find the pi sessions directory. Scans ~/.pi/agent/sessions/ for subdirectories.
 */
function getSessionsBaseDir(): string {
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return join(agentDir, "sessions");
}

/**
 * Discover all JSONL session files across all project directories.
 */
async function discoverSessionFiles(): Promise<string[]> {
  const baseDir = getSessionsBaseDir();
  const files: string[] = [];

  let projectDirs: string[];
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  for (const projectDir of projectDirs) {
    const projectPath = join(baseDir, projectDir);
    try {
      const sessionEntries = await readdir(projectPath, {
        withFileTypes: true,
      });
      for (const entry of sessionEntries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(projectPath, entry.name));
        }
      }
    } catch {
      // skip inaccessible project dirs
    }
  }

  return files;
}

type ParsedSession = {
  session: SessionUsage;
  models: Map<string, ModelUsage>;
} | null;

/**
 * Parsed results keyed by file path. A session file only grows while its
 * session runs, so an unchanged mtime and size mean an unchanged result.
 */
const parseCache = new Map<
  string,
  { mtimeMs: number; size: number; result: ParsedSession }
>();

/**
 * Parse a session file unless it was last modified before `since`: a file
 * untouched since then was also created before then, so every window
 * starting at `since` excludes it. Unchanged files come from the cache.
 */
async function readSessionFile(
  filePath: string,
  since?: Date,
): Promise<ParsedSession> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    parseCache.delete(filePath);
    return null;
  }
  if (since && fileStat.mtime < since) return null;

  const cached = parseCache.get(filePath);
  if (
    cached &&
    cached.mtimeMs === fileStat.mtimeMs &&
    cached.size === fileStat.size
  ) {
    return cached.result;
  }
  const result = await parseSessionFile(filePath);
  parseCache.set(filePath, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    result,
  });
  return result;
}

/**
 * Parse a single JSONL session file and extract token usage from assistant messages.
 * Returns session metadata + per-model token aggregates.
 */
async function parseSessionFile(
  filePath: string,
): Promise<{ session: SessionUsage; models: Map<string, ModelUsage> } | null> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const lines = content.trim().split("\n");
  if (lines.length === 0) return null;

  const sessionTokens = emptyBuckets();
  const models = new Map<string, ModelUsage>();
  let sessionId = "";
  let cwd = "";
  let name: string | undefined;
  let created: Date | undefined;
  let messageCount = 0;

  for (const line of lines) {
    let entry: SessionEntry;
    try {
      entry = JSON.parse(line) as SessionEntry;
    } catch {
      continue;
    }

    // Extract session header
    if (entry.type === "session") {
      const header = entry as unknown as {
        id?: string;
        cwd?: string;
        timestamp?: string;
      };
      sessionId = header.id ?? "";
      cwd = header.cwd ?? "";
      if (header.timestamp) {
        created = new Date(header.timestamp);
      }
      continue;
    }

    // Extract session name
    if (entry.type === "session_info" && entry.name) {
      name = entry.name;
      continue;
    }

    // Process assistant messages
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const msg = entry.message;
      const usage = msg.usage;
      if (!usage) continue;

      const buckets: TokenBuckets = {
        input: usage.input ?? 0,
        output: usage.output ?? 0,
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: usage.cacheWrite ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        costTotal: usage.cost?.total ?? 0,
      };

      // Accumulate into session totals
      sessionTokens.input += buckets.input;
      sessionTokens.output += buckets.output;
      sessionTokens.cacheRead += buckets.cacheRead;
      sessionTokens.cacheWrite += buckets.cacheWrite;
      sessionTokens.totalTokens += buckets.totalTokens;
      sessionTokens.costTotal += buckets.costTotal;
      messageCount++;

      // Accumulate per-model
      const provider = msg.provider ?? "unknown";
      const model = msg.model ?? "unknown";
      const modelKey = `${provider}/${model}`;
      const existing = models.get(modelKey);
      if (existing) {
        existing.tokens = addBuckets(existing.tokens, buckets);
        existing.messageCount++;
      } else {
        models.set(modelKey, {
          provider,
          model,
          tokens: { ...buckets },
          messageCount: 1,
        });
      }
    }
  }

  if (messageCount === 0) return null;

  // Get file creation time as fallback
  let fileCreated = created ?? new Date(0);
  if (!created) {
    try {
      const fileStat = await stat(filePath);
      fileCreated = fileStat.birthtime;
    } catch {
      // keep default
    }
  }

  return {
    session: {
      sessionId,
      sessionPath: filePath,
      cwd,
      name,
      created: fileCreated,
      tokens: sessionTokens,
      messageCount,
    },
    models,
  };
}

/**
 * Aggregate token usage across all sessions.
 * Reads JSONL files directly for performance (avoids building session tree structures).
 */
export async function aggregateAllSessions(options?: {
  cwd?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}): Promise<AggregateResult> {
  const files = await discoverSessionFiles();
  const present = new Set(files);
  for (const cachedPath of parseCache.keys()) {
    if (!present.has(cachedPath)) parseCache.delete(cachedPath);
  }

  const totals = emptyBuckets();
  const byModelMap = new Map<string, ModelUsage>();
  const byProviderMap = new Map<
    string,
    { tokens: TokenBuckets; messageCount: number }
  >();
  const sessions: SessionUsage[] = [];
  let totalMessages = 0;

  // Parse files in parallel (bounded concurrency)
  const CONCURRENCY = 16;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((f) => readSessionFile(f, options?.since)),
    );

    for (const result of results) {
      if (!result) continue;
      const { session, models } = result;

      // Filter by cwd if specified
      if (options?.cwd && session.cwd !== options.cwd) continue;

      // Filter by time range
      if (options?.since && session.created < options.since) continue;
      if (options?.until && session.created > options.until) continue;

      sessions.push(session);

      // Accumulate totals
      totals.input += session.tokens.input;
      totals.output += session.tokens.output;
      totals.cacheRead += session.tokens.cacheRead;
      totals.cacheWrite += session.tokens.cacheWrite;
      totals.totalTokens += session.tokens.totalTokens;
      totals.costTotal += session.tokens.costTotal;
      totalMessages += session.messageCount;

      // Accumulate per-model
      for (const [key, modelUsage] of models) {
        const existing = byModelMap.get(key);
        if (existing) {
          existing.tokens = addBuckets(existing.tokens, modelUsage.tokens);
          existing.messageCount += modelUsage.messageCount;
        } else {
          byModelMap.set(key, { ...modelUsage });
        }

        // Accumulate per-provider
        const providerEntry = byProviderMap.get(modelUsage.provider);
        if (providerEntry) {
          providerEntry.tokens = addBuckets(
            providerEntry.tokens,
            modelUsage.tokens,
          );
          providerEntry.messageCount += modelUsage.messageCount;
        } else {
          byProviderMap.set(modelUsage.provider, {
            tokens: { ...modelUsage.tokens },
            messageCount: modelUsage.messageCount,
          });
        }
      }
    }
  }

  // Sort sessions by cost descending
  sessions.sort((a, b) => b.tokens.costTotal - a.tokens.costTotal);

  // Sort models by cost descending
  const byModel = Array.from(byModelMap.values()).sort(
    (a, b) => b.tokens.costTotal - a.tokens.costTotal,
  );

  // Sort providers by cost descending
  const byProvider = Array.from(byProviderMap.entries())
    .map(([provider, data]) => ({ provider, ...data }))
    .sort((a, b) => b.tokens.costTotal - a.tokens.costTotal);

  // Apply limit
  const limit = options?.limit;
  const limitedSessions = limit ? sessions.slice(0, limit) : sessions;

  return {
    totals,
    byModel,
    byProvider,
    bySession: limitedSessions,
    sessionCount: sessions.length,
    messageCount: totalMessages,
  };
}

/**
 * Format a number with commas for readability.
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1_000) return n.toLocaleString("en-US");
  return String(n);
}

/**
 * Format cost as USD string.
 */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Format token buckets as a compact summary line.
 */
export function formatTokenSummary(tokens: TokenBuckets): string {
  const parts: string[] = [];
  if (tokens.input > 0) parts.push(`${formatNumber(tokens.input)} in`);
  if (tokens.output > 0) parts.push(`${formatNumber(tokens.output)} out`);
  if (tokens.cacheRead > 0)
    parts.push(`${formatNumber(tokens.cacheRead)} cached`);
  if (tokens.costTotal > 0) parts.push(formatCost(tokens.costTotal));
  return parts.join(" · ");
}
