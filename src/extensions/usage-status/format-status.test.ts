import { describe, expect, it } from "vitest";
import { formatWindowStatus, type WindowStatus } from "./format-status.js";

// Minimal fake theme that just returns text with markers for color assertions
function fakeTheme() {
  return {
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  };
}

describe("formatWindowStatus", () => {
  const theme = fakeTheme() as any;

  it("shows remaining/limit for windows with known limits (GitHub premium)", () => {
    const w: WindowStatus = {
      label: "Premium / month",
      usedPercent: 2.3,
      severity: "none",
      resetsAt: "2026-05-01T00:00:00Z",
      limited: false,
      usedValue: 7,
      limitValue: 300,
    };
    const result = formatWindowStatus(theme, w);
    expect(result).toContain("293/300");
    expect(result).toContain("[success]");
  });

  it("shows remaining % for percentage-only windows (Anthropic 5h)", () => {
    const w: WindowStatus = {
      label: "5h",
      usedPercent: 9,
      severity: "none",
      resetsAt: "2026-04-22T18:00:00Z",
      limited: false,
      usedValue: 9,
      limitValue: 100,
    };
    const result = formatWindowStatus(theme, w);
    expect(result).toContain("91% left");
    expect(result).toContain("[success]");
  });

  it("shows currency for isCurrency windows (Anthropic extra)", () => {
    const w: WindowStatus = {
      label: "Extra (AUD)",
      usedPercent: 71.8,
      severity: "warning",
      resetsAt: "2026-05-01T00:00:00Z",
      limited: false,
      isCurrency: true,
      usedValue: 215,
      limitValue: 300,
    };
    const result = formatWindowStatus(theme, w);
    expect(result).toContain("$215/$300");
    expect(result).toContain("[warning]");
  });

  it("shows REACHED for spend cap", () => {
    const w: WindowStatus = {
      label: "Spend cap",
      usedPercent: 100,
      severity: "critical",
      resetsAt: null,
      limited: true,
      usedValue: 1,
      limitValue: 1,
    };
    const result = formatWindowStatus(theme, w);
    expect(result).toContain("REACHED");
    expect(result).toContain("[error]");
  });

  it("colors label when severity is warning or worse", () => {
    const w: WindowStatus = {
      label: "7d",
      usedPercent: 85,
      severity: "high",
      resetsAt: "2026-04-23T23:00:00Z",
      limited: false,
      usedValue: 85,
      limitValue: 100,
    };
    const result = formatWindowStatus(theme, w);
    // label should be colored with error (high maps to error)
    expect(result).toContain("[error]7d:");
    expect(result).toContain("15% left");
  });

  it("keeps label dim when severity is none", () => {
    const w: WindowStatus = {
      label: "5h",
      usedPercent: 10,
      severity: "none",
      resetsAt: "2026-04-22T18:00:00Z",
      limited: false,
      usedValue: 10,
      limitValue: 100,
    };
    const result = formatWindowStatus(theme, w);
    expect(result).toContain("[dim]5h:");
  });
});
