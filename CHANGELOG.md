# Changelog

All notable changes to this project will be documented in this file.

## [0.2.4] - 2026-05-06

### Added
- **Defer to Synthetic**: When pi-synthetic's usage footer is active, pi-quotas now hides its own Synthetic footer to avoid duplicate quota displays. This behavior is enabled by default and can be toggled via `/quotas:settings` → "Defer to Synthetic".

## [0.2.3] - 2026-05-06

### Changed
- Version bump only.

## [0.2.2] - 2026-05-06

### Fixed
- Anthropic subscription quota windows are hidden from the footer status line while remaining available in quota dashboards and warnings.
- README updated with Synthetic provider commands, quota windows, and credential setup.

## [0.2.1] - 2026-05-06

### Added
- Synthetic quota monitoring support, including the `/synthetic:quotas` command.
- Synthetic quota parsing for subscription requests, hourly search limits, free tool calls, weekly tokens, and rolling five-hour limits.
- Synthetic API quota fetching via the `SYNTHETIC_API_KEY` environment variable.

### Fixed
- Footer reset times now use minute precision across supported providers, matching quota warning output.
- Footer status no longer shows misleading reset tags for non-reset windows such as Codex spend cap and credit balances.
- Elapsed reset times render as `now` instead of `in now`.

## [0.2.0] - 2026-04-22

### Added
- OpenRouter quota monitoring support
- `/openrouter:quotas` command
- OpenRouter footer usage status for active OpenRouter sessions
- OpenRouter daily, weekly, and monthly USD usage tracking
- Optional OpenRouter monthly budget display when per-key spending limits are configured
- OpenRouter fetch and parser test coverage

### Improved
- Currency values now display with cents precision across the UI
- Tracking-only usage windows now show `$X.XX used` instead of confusing `$X.XX/$0.00`
- OpenRouter tracking labels are clearer: `Daily`, `Weekly`, `Monthly`
- OpenRouter period rollover times use UTC-based calculations
- README updated with OpenRouter commands, credentials, and provider details

### Fixed
- Footer status formatting for OpenRouter currency windows
- Clarity of OpenRouter tracking window presentation in the TUI
- Package lockfile version synced for the 0.2.0 release
