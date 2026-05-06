import { afterEach, describe, expect, it, vi } from "vitest";
import { formatWindowStatus, type WindowStatus } from "./format-status.js";
import type { SupportedQuotaProvider } from "../../types/quotas.js";
import { formatStatus, formatStatusForFooter, toStatusWindows, toWindowStatus } from "./index.js";

// Minimal fake theme that just returns text with markers for color assertions
function fakeTheme() {
  return {
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  };
}

describe("formatWindowStatus", () => {
  const theme = fakeTheme() as any;

  afterEach(() => {
    vi.useRealTimers();
  });

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
    expect(result).toContain("$215.00/$300.00");
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

  it("renders footer reset times with minute precision for every provider", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T05:28:37Z"));

    const providers: Array<{ provider: SupportedQuotaProvider; label: string }> = [
      { provider: "anthropic", label: "5h" },
      { provider: "openai-codex", label: "7d" },
      { provider: "github-copilot", label: "Premium / month" },
      { provider: "openrouter", label: "Monthly Budget" },
      { provider: "synthetic", label: "Subscription" },
    ];

    for (const { provider, label } of providers) {
      const status = toWindowStatus({
        provider,
        label,
        usedPercent: 50,
        resetsAt: new Date("2026-05-06T07:47:37Z"),
        windowSeconds: 5 * 60 * 60,
        usedValue: 50,
        limitValue: 100,
      });

      const result = formatStatus({ ui: { theme } } as any, [status]);

      expect(result).toContain("(↺in 2h19m)");
      expect(result).not.toContain("(↺in 3h)");
    }
  });

  it("omits footer reset tags for windows without a real reset time", () => {
    const result = formatStatus(
      { ui: { theme } } as any,
      [
        {
          label: "Spend cap",
          usedPercent: 0,
          severity: "none",
          resetsAt: null,
          limited: false,
          usedValue: 0,
          limitValue: 1,
        },
      ],
    );

    expect(result).toContain("cap:");
    expect(result).not.toContain("↺");
    expect(result).not.toContain("soon");
  });

  it("maps sentinel reset dates to null before rendering status for non-reset provider windows", () => {
    const windows: Array<{ provider: SupportedQuotaProvider; label: string; isCurrency?: boolean }> = [
      { provider: "openai-codex", label: "Spend cap" },
      { provider: "openai-codex", label: "Credits", isCurrency: true },
      { provider: "openrouter", label: "Credits Remaining", isCurrency: true },
    ];

    for (const { provider, label, isCurrency } of windows) {
      const status = toWindowStatus({
        provider,
        label,
        usedPercent: 0,
        resetsAt: new Date(0),
        windowSeconds: 0,
        usedValue: 0,
        limitValue: 1,
        limited: false,
        isCurrency,
      });

      expect(status.resetsAt).toBeNull();
    }
  });

  it("clears the footer status when filtering removes all windows", () => {
    expect(formatStatusForFooter({ ui: { theme } } as any, [])).toBeUndefined();
  });

  it("filters Anthropic subscription windows from footer status while keeping extra usage", () => {
    const windows = toStatusWindows([
      {
        provider: "anthropic",
        label: "5h",
        usedPercent: 10,
        resetsAt: new Date("2026-05-06T07:47:37Z"),
        windowSeconds: 5 * 60 * 60,
        usedValue: 10,
        limitValue: 100,
      },
      {
        provider: "anthropic",
        label: "7d Sonnet",
        usedPercent: 20,
        resetsAt: new Date("2026-05-06T07:47:37Z"),
        windowSeconds: 7 * 24 * 60 * 60,
        usedValue: 20,
        limitValue: 100,
      },
      {
        provider: "anthropic",
        label: "Extra (USD)",
        usedPercent: 30,
        resetsAt: new Date("2026-06-01T00:00:00Z"),
        windowSeconds: 30 * 24 * 60 * 60,
        usedValue: 30,
        limitValue: 100,
        isCurrency: true,
      },
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ label: "Extra (USD)" });
  });

  it("does not prefix elapsed reset times with in", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T05:28:37Z"));

    const result = formatStatus(
      { ui: { theme } } as any,
      [
        {
          label: "5h",
          usedPercent: 100,
          severity: "critical",
          resetsAt: "2026-05-06T05:28:37Z",
          limited: false,
          usedValue: 100,
          limitValue: 100,
        },
      ],
    );

    expect(result).toContain("(↺now)");
    expect(result).not.toContain("(↺in now)");
  });
});
