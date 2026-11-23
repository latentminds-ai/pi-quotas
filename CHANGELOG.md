# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
- **Grok quota visibility**: zero-usage billing periods now remain visible when xAI omits the zero-valued percentage, and billing requests include the required xAI token-auth marker.

## [0.5.0] - 2026-08-31

### Added
- **Grok (xAI) provider**: SuperGrok credit usage from the xAI CLI billing endpoint — weekly/monthly credit period, per-product usage windows, and on-demand spend — with the `/grok:quotas` command, dashboard, footer status, and quota warnings. Contributed by @LJC-god in #25.
- **Hide inactive quota providers**: dashboard and `/quotas` output now hide providers with nothing to report (no windows, or config/not-applicable errors) instead of showing a wall of unconfigured providers. Contributed by @LJC-god in #26.
- **Ollama Cloud provider**: rolling 5-hour session and 7-day weekly usage windows from the undocumented `/api/usage` endpoint, with the `/ollama:quotas` command, dashboard, footer status, and quota warnings. Reads the `ollama-cloud` API key from `auth.json` (falls back to `OLLAMA_API_KEY`). Contributed by @tdslot in #24.

### Fixed
- **OAuth refresh failures crash Pi**: a failed OAuth token refresh (e.g. an expired Anthropic refresh token) threw a `ModelsError` out of the quota fetch and surfaced as an `uncaughtException`, killing the whole Pi process when running `/quotas` or refreshing the footer. Fetcher errors are now contained and rendered as a per-provider failure ("re-authenticate with /login") instead.
- **Anthropic OAuth token prefix**: OAuth subscription tokens (`sk-ant-oat...`) were misclassified as direct API keys, so subscription usage was never fetched. Only `sk-ant-api...` keys are now treated as direct API keys. Contributed by @shaharyair in #28.
- **Synthetic API key source**: the Synthetic provider now prefers the key stored via `pi /login` (auth storage) and falls back to the `SYNTHETIC_API_KEY` env var. Contributed by @tdslot in #22.
- **Reset-time readability**: adjacent time units are now separated by a space (`2h 19m`, `1d 2h 19m` instead of `2h19m`, `1d2h19m`). Contributed by @shaharyair in #31.

## [0.4.0] - 2026-08-04

### Added
- **Kimi Code provider**: rolling five-hour and weekly Coding Plan usage windows, with the `/kimi:quotas` command, dashboard, footer status, and quota warnings. Contributed by @tdslot in #19.

### Fixed
- **Modern Pi authentication compatibility**: quota checks now resolve provider credentials through `ModelRegistry` instead of relying on its removed public `authStorage` property. This restores footer quota status, quota warnings, and `/codex:quotas` on newer Pi releases while remaining compatible with older releases, preserving stored OAuth metadata (GitHub Copilot `refresh`, Codex `accountId`) and adding `getProviderAuth()` header-based Bearer extraction. Contributed by @tdslot in #18.
- **Codex quota window labels**: footer and dashboard labels now follow the server-provided window duration instead of assuming every primary window is 5h. Weekly-only responses now correctly show `7d` alongside their reset countdown. Contributed by @tdslot in #20.

## [0.3.1] - 2026-07-09

### Fixed
- **Direct Anthropic API key users**: quota monitoring no longer fails for users who registered a direct API key (`sk-ant-...`) via `pi /login` rather than an OAuth subscription token. The `/api/oauth/usage` endpoint requires OAuth credentials, so the fetch is now skipped for direct keys with a silent "not applicable" result — the footer shows nothing instead of a persistent "usage unavailable" warning, and the dashboard shows a dim note instead of a raw JSON error body. Fixes #14 (reported by @vkarasen).
- **Raw JSON error bodies**: HTTP error responses that return a JSON object (e.g. `{"error":{"message":"..."}}`) are now reduced to a clean, human-readable message across all providers, so the dashboard and notifications no longer leak raw JSON.
- **Non-interactive `/quotas` fallback**: when the TUI custom view is unavailable, the command now renders a readable per-provider summary instead of dumping raw JSON snapshots (which previously included raw HTTP error bodies).

## [0.3.0] - 2026-07-09

### Added
- **Z.ai (GLM Coding Plan) provider**: 5h/7d rolling token windows and a monthly web-search count window, with the `/zai:quotas` command and footer status. Contributed by @tdslot in #15.
- **OpenCode Go provider**: dashboard scraper for rolling 5h / weekly / monthly USD usage against Go tier limits, with the `/opencode-go:quotas` command and a token-status footer for `opencode-go*` models. Configured via `OPENCODE_GO_WORKSPACE_ID` + `OPENCODE_GO_AUTH_COOKIE` (env or config file). Contributed by @gretel (DO2THX) in #11.
- **Token usage tracking**: `/tokens` command with cross-session token/cost aggregation from JSONL session files. Contributed by @gretel (DO2THX) in #11.
- **Token usage status** footer extension and a per-feature toggle in `/quotas:settings`.
- ESLint linting is now part of the repo (`npm run lint` / `npm run lint:fix`), codifying the existing 2-space / double-quote / semicolon style as the enforced default.

### Fixed
- **Stale usage-status context**: the footer no longer repaints stale provider data after a session reload or a switch to a deferred Synthetic footer, using a generation token to cancel in-flight fetches and guarding status writes against stale-context errors. Fix contributed by @aserper in #13, with an independent approach by @Fadouse in #12 (superseded by #13 and credited here).
- Quota warning labels now use `PROVIDER_LABELS` instead of a hardcoded Anthropic label. Contributed by @gretel in #11.
- `formatTimeRemaining` now shows days when the remaining time is >= 24h (e.g. `649h30m` → `27d1h30m`). Contributed by @gretel in #11.

### Changed
- Lint conformance is now required before merge; PR #11 was converted from tab to 2-space indentation to match the repo style.

## [0.2.6] - 2026-05-14

### Added
- Quotas dashboard footer now shows the running `pi-quotas` package version.
- Dashboard render tests cover version display and pace-marker edge cases.

### Fixed
- Pace-aware quota windows now still switch to warning/high/critical colors at absolute 80%/90%/100% usage thresholds, preventing high-usage monthly quotas from staying green.
- Quotas dashboard progress bars no longer show stray accent-colored pace markers inside filled warning bars or on zero-usage bars.

## [0.2.5] - 2026-05-14

### Fixed
- Pi startup and turn handling no longer wait for footer quota refreshes or quota warning checks; remote quota requests now run in the background.
- GitHub Copilot quota checks now use Pi's stored GitHub OAuth token for the `/copilot_internal/user` endpoint, fixing `401 Bad credentials` failures with Pi 0.74 auth credentials. Reported by @6aKa in #8.

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
