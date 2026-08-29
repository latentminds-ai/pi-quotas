import { assert, describe, expect, it } from "vitest";
import {
  assessWindow,
  getPacePercent,
  getProjectedPercent,
  getSeverityColor,
  formatTimeRemaining,
  type QuotaWindow,
  safePercent,
} from "./quotas-severity.js";

function makeWindow(
  overrides: Partial<QuotaWindow> & Pick<QuotaWindow, "usedPercent">,
): QuotaWindow {
  const windowSeconds = overrides.windowSeconds ?? 3600;
  const resetsAt =
    overrides.resetsAt ?? new Date(Date.now() + windowSeconds * 500);
  return {
    provider: "anthropic",
    label: "Test Window",
    resetsAt,
    windowSeconds,
    usedValue: 0,
    limitValue: 100,
    ...overrides,
  };
}

describe("safePercent", () => {
  it("returns 0 for zero/invalid limit", () => {
    expect(safePercent(50, 0)).toBe(0);
    expect(safePercent(50, -1)).toBe(0);
    expect(safePercent(50, NaN)).toBe(0);
    expect(safePercent(NaN, 100)).toBe(0);
  });

  it("computes correct percentage", () => {
    expect(safePercent(50, 100)).toBe(50);
    expect(safePercent(75, 100)).toBe(75);
    expect(safePercent(1, 3)).toBeCloseTo(33.33);
  });
});

describe("getPacePercent", () => {
  it("returns null for zero window", () => {
    const w = makeWindow({ usedPercent: 50, windowSeconds: 0 });
    expect(getPacePercent(w)).toBeNull();
  });

  it("returns ~50 for a window 50% elapsed", () => {
    const w = makeWindow({
      usedPercent: 50,
      windowSeconds: 3600,
      resetsAt: new Date(Date.now() + 1800 * 1000),
    });
    const pace = getPacePercent(w);
    assert(pace, "pace should not be null");
    expect(pace).toBeCloseTo(50, 0);
  });
});

describe("getProjectedPercent", () => {
  it("returns usedPercent when no pace", () => {
    expect(getProjectedPercent(42, null)).toBe(42);
  });

  it("projects based on pace", () => {
    expect(getProjectedPercent(50, 25)).toBe(200);
  });
});

describe("assessWindow", () => {
  it("returns critical for limited window regardless of usage", () => {
    const w = makeWindow({ usedPercent: 5, showPace: false, limited: true });
    expect(assessWindow(w).severity).toBe("critical");
  });

  it("warns for pace-aware windows once absolute usage reaches 80%", () => {
    const now = Date.now();
    const monthSeconds = 31 * 24 * 3600;
    const w = makeWindow({
      provider: "github-copilot",
      label: "Premium / month",
      usedPercent: 83,
      usedValue: 249,
      limitValue: 300,
      showPace: true,
      windowSeconds: monthSeconds,
      // Screenshot repro: 51/300 left with reset in about 428h35m in a 31-day
      // monthly window. Dynamic pace alone projects just under warning, but
      // only 17% remains, so low-quota color should still be amber.
      resetsAt: new Date(now + ((428 * 60 + 35) * 60 * 1000)),
    });

    expect(assessWindow(w).severity).toBe("warning");
  });

  it("returns warning when projected exceeds dynamic warn threshold", () => {
    const w = makeWindow({
      usedPercent: 79,
      showPace: true,
      paceScale: 1,
      windowSeconds: 3600,
      resetsAt: new Date(Date.now() + 2520 * 1000),
    });
    expect(assessWindow(w).severity).toBe("warning");
  });

  it("uses paceScale to normalize pace", () => {
    const w = makeWindow({
      usedPercent: 95,
      showPace: true,
      paceScale: 1 / 7,
      windowSeconds: 7 * 24 * 3600,
      resetsAt: new Date(Date.now() + 6 * 24 * 3600 * 1000),
    });
    const result = assessWindow(w);
    assert(result.pacePercent, "pacePercent should not be null");
    expect(result.pacePercent).toBeLessThan(15);
    expect(result.projectedPercent).toBeGreaterThan(500);
    expect(result.severity).toBe("critical");
  });
});

describe("formatTimeRemaining", () => {
  it("separates adjacent time units", () => {
    expect(formatTimeRemaining(new Date(Date.now() + (2 * 60 + 19) * 60_000))).toBe("2h 19m");
    expect(formatTimeRemaining(new Date(Date.now() + (26 * 60 + 19) * 60_000))).toBe("1d 2h 19m");
  });
});

describe("getSeverityColor", () => {
  it("maps severity levels to display colors", () => {
    expect(getSeverityColor("none")).toBe("success");
    expect(getSeverityColor("warning")).toBe("warning");
    expect(getSeverityColor("high")).toBe("error");
    expect(getSeverityColor("critical")).toBe("error");
  });
});
