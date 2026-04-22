import type { QuotaWindow } from "../types/quotas.js";
export type { QuotaWindow } from "../types/quotas.js";

export type RiskSeverity = "none" | "warning" | "high" | "critical";

export interface WindowProjection {
  pacePercent: number | null;
  progress: number | null;
  projectedPercent: number;
  usedPercent: number;
}

export interface RiskAssessment extends WindowProjection {
  usedFloorPercent: number | null;
  warnProjectedPercent: number | null;
  highProjectedPercent: number | null;
  criticalProjectedPercent: number | null;
  severity: RiskSeverity;
}

const MIN_PACE_PERCENT = 5;
const THRESHOLDS = {
  usedFloor: { start: 33, end: 8 },
  warnProjected: { start: 260, end: 120 },
  highProjected: { start: 320, end: 145 },
  criticalProjected: { start: 400, end: 170 },
};

function interpolate(start: number, end: number, progress: number): number {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  return start + (end - start) * clampedProgress;
}

export function safePercent(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

export function getPacePercent(window: QuotaWindow): number | null {
  const totalMs = window.windowSeconds * 1000;
  if (totalMs <= 0) return null;
  const remainingMs = window.resetsAt.getTime() - Date.now();
  const elapsedMs = totalMs - remainingMs;
  return Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100));
}

export function getProjectedPercent(
  usedPercent: number,
  pacePercent: number | null,
): number {
  if (pacePercent === null) return usedPercent;
  const effectivePace = Math.max(MIN_PACE_PERCENT, pacePercent);
  return Math.max(0, (usedPercent / effectivePace) * 100);
}

export function assessWindow(window: QuotaWindow): RiskAssessment {
  const rawPace = window.showPace ? getPacePercent(window) : null;
  const pacePercent =
    rawPace !== null ? rawPace * (window.paceScale ?? 1) : null;
  const projectedPercent = getProjectedPercent(window.usedPercent, pacePercent);

  let progress: number | null = null;
  if (pacePercent !== null) progress = pacePercent / 100;

  const base: WindowProjection = {
    pacePercent,
    progress,
    projectedPercent,
    usedPercent: window.usedPercent,
  };

  if (progress === null) {
    let severity: RiskSeverity = "none";
    if (window.limited || projectedPercent >= 100) severity = "critical";
    else if (projectedPercent >= 90) severity = "high";
    else if (projectedPercent >= 80) severity = "warning";

    return {
      ...base,
      usedFloorPercent: null,
      warnProjectedPercent: 80,
      highProjectedPercent: 90,
      criticalProjectedPercent: 100,
      severity,
    };
  }

  const usedFloorPercent = interpolate(
    THRESHOLDS.usedFloor.start,
    THRESHOLDS.usedFloor.end,
    progress,
  );
  const warnProjectedPercent = interpolate(
    THRESHOLDS.warnProjected.start,
    THRESHOLDS.warnProjected.end,
    progress,
  );
  const highProjectedPercent = interpolate(
    THRESHOLDS.highProjected.start,
    THRESHOLDS.highProjected.end,
    progress,
  );
  const criticalProjectedPercent = interpolate(
    THRESHOLDS.criticalProjected.start,
    THRESHOLDS.criticalProjected.end,
    progress,
  );

  let severity: RiskSeverity = "none";
  if (window.limited) {
    severity = "critical";
  } else if (window.usedPercent >= usedFloorPercent) {
    if (projectedPercent >= criticalProjectedPercent) severity = "critical";
    else if (projectedPercent >= highProjectedPercent) severity = "high";
    else if (projectedPercent >= warnProjectedPercent) severity = "warning";
  }

  return {
    ...base,
    usedFloorPercent,
    warnProjectedPercent,
    highProjectedPercent,
    criticalProjectedPercent,
    severity,
  };
}

export function formatTimeRemaining(date: Date): string {
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return "now";
  const totalMins = Math.ceil(ms / (1000 * 60));
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours >= 1) return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  const totalSecs = Math.ceil(ms / 1000);
  return totalMins >= 1 ? `${totalMins}m` : `${totalSecs}s`;
}

export function getSeverityColor(
  severity: RiskSeverity,
): "success" | "warning" | "error" {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "warning":
      return "warning";
    default:
      return "success";
  }
}
