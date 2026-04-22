import type { Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Loader, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { PROVIDER_LABELS } from "../../../lib/quotas.js";
import type { QuotasResult, SupportedQuotaProvider } from "../../../types/quotas.js";
import {
  assessWindow,
  formatTimeRemaining,
  getSeverityColor,
} from "../../../utils/quotas-severity.js";

type Snapshot = {
  provider: SupportedQuotaProvider;
  result: QuotasResult;
};

type QuotasState =
  | { type: "loading" }
  | { type: "loaded"; snapshots: Snapshot[] };

function fgAnsiToBg(fgAnsi: string): string {
  return fgAnsi.split("[38;").join("[48;").replace(/\[3([0-9])m/g, "[4$1m");
}

function renderProgressBar(
  percent: number,
  width: number,
  theme: Theme,
  fillColor: "success" | "warning" | "error",
  pacePercent?: number | null,
): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * width);
  const showPace =
    pacePercent !== null &&
    pacePercent !== undefined &&
    pacePercent >= 5 &&
    Math.abs(pacePercent - percent) >= 5;
  const paceIndex = showPace
    ? Math.min(width - 1, Math.round((Math.max(0, Math.min(100, pacePercent ?? 0)) / 100) * width))
    : null;
  const reset = "\x1b[0m";
  const parts: string[] = [];
  for (let idx = 0; idx < width; idx++) {
    if (paceIndex !== null && idx === paceIndex) {
      const markerColor = idx < filled ? "accent" : fillColor;
      if (idx < filled) {
        parts.push(`${fgAnsiToBg(theme.getFgAnsi(fillColor))}${theme.getFgAnsi(markerColor)}|${reset}`);
      } else {
        parts.push(theme.fg(markerColor, "|"));
      }
    } else if (idx < filled) {
      parts.push(theme.fg(fillColor, "█"));
    } else {
      parts.push(theme.fg("dim", "░"));
    }
  }
  return parts.join("");
}

export class QuotasComponent implements Component {
  private state: QuotasState = { type: "loading" };
  private loader: Loader | null = null;

  constructor(
    private theme: Theme,
    private tui: any,
    private title: string,
    private onClose: () => void,
    private onRefetch: () => void,
  ) {
    this.startLoader();
  }

  private startLoader(): void {
    this.loader = new Loader(
      this.tui,
      (s: string) => this.theme.fg("accent", s),
      (s: string) => this.theme.fg("muted", s),
      "Fetching quotas...",
    );
  }

  destroy(): void {
    this.loader?.stop();
    this.loader = null;
  }

  setState(state: QuotasState): void {
    if (state.type === "loading") {
      this.loader?.stop();
      this.startLoader();
    } else if (this.state.type === "loading") {
      this.loader?.stop();
      this.loader = null;
    }
    this.state = state;
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, "escape") || data === "q") {
      this.onClose();
      return true;
    }
    if (data === "r") {
      this.onRefetch();
      return true;
    }
    return false;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const border = new DynamicBorder((s: string) => this.theme.fg("border", s));
    lines.push(...border.render(width));
    lines.push(truncateToWidth(` ${this.theme.fg("accent", this.theme.bold(this.title))}`, width));

    if (this.state.type === "loading") {
      lines.push(...(this.loader ? this.loader.render(width) : [this.theme.fg("muted", "  Fetching quotas...")]));
    } else {
      lines.push(...this.renderLoaded(this.state.snapshots, width));
    }

    lines.push("");
    lines.push(this.theme.fg("dim", "  r to refresh  q/Esc to close"));
    lines.push(...border.render(width));
    return lines;
  }

  private renderLoaded(snapshots: Snapshot[], maxWidth: number): string[] {
    const lines: string[] = [""];
    for (const snapshot of snapshots) {
      lines.push(...this.renderProvider(snapshot, maxWidth));
      lines.push("");
    }
    if (lines.at(-1) === "") lines.pop();
    return lines;
  }

  private renderProvider(snapshot: Snapshot, maxWidth: number): string[] {
    const lines: string[] = [];
    const title = PROVIDER_LABELS[snapshot.provider];
    lines.push(truncateToWidth(`  ${this.theme.fg("accent", title)}`, maxWidth));

    if (!snapshot.result.success) {
      lines.push(truncateToWidth(`  ${this.theme.fg("warning", snapshot.result.error.message)}`, maxWidth));
      return lines;
    }

    const windows = snapshot.result.data.windows;
    if (windows.length === 0) {
      lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No quota windows available")}`, maxWidth));
      return lines;
    }

    const barWidth = Math.min(42, Math.max(18, maxWidth - 28));
    for (const window of windows) {
      const assessment = assessWindow(window);
      const color = getSeverityColor(assessment.severity);
      const bar = renderProgressBar(window.usedPercent, barWidth, this.theme, color, assessment.pacePercent);
      const usedStr = `${Math.round(window.usedPercent)}%/${window.limitValue}`;
      lines.push(truncateToWidth(`    ${this.theme.fg("dim", `${window.label}:`)}`, maxWidth));
      lines.push(truncateToWidth(`    ${bar} ${this.theme.fg(color, usedStr)}`, maxWidth));
      lines.push(
        truncateToWidth(
          `    ${this.theme.fg("dim", `${window.nextLabel ?? "Resets"} in ${formatTimeRemaining(window.resetsAt)}`)}`,
          maxWidth,
        ),
      );
    }

    return lines;
  }

  invalidate(): void {}
}
