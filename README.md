# @latentminds/pi-quotas

Quota monitoring for Pi. Shows remaining usage and rate limits for Anthropic, OpenAI Codex, GitHub Copilot, OpenRouter, Synthetic, Grok, Z.ai, OpenCode Go, Kimi Code, and Ollama Cloud — directly in your Pi session.

## Screenshots


| `/quotas` dashboard | Footer status |
| ------------------- | ------------- |
| Quotas dashboard    | Footer status |


## Install

**From npm** (recommended):

```bash
pi install npm:@latentminds/pi-quotas
```

**From source:**

```bash
git clone https://github.com/latentminds-ai/pi-quotas.git
pi install ./pi-quotas
```

**Try without installing:**

```bash
pi -e npm:@latentminds/pi-quotas
```

## Commands


| Command              | Description                                |
| -------------------- | ------------------------------------------ |
| `/quotas`            | Combined quota dashboard for all providers |
| `/anthropic:quotas`  | Anthropic quotas only                      |
| `/codex:quotas`      | OpenAI Codex quotas only                   |
| `/github:quotas`     | GitHub Copilot quotas only                 |
| `/openrouter:quotas` | OpenRouter quotas only                     |
| `/synthetic:quotas`  | Synthetic quotas only                      |
| `/grok:quotas`       | Grok quotas only                           |
| `/zai:quotas`        | Z.ai quotas only                           |
| `/opencode-go:quotas`| OpenCode Go quotas only                    |
| `/kimi:quotas`       | Kimi Code quotas only                      |
| `/ollama:quotas`     | Ollama Cloud quotas only                   |
| `/tokens`            | Cross-session token/cost usage            |
| `/quotas:settings`   | Toggle individual features on or off       |


## Features

### Quota dashboard

Run `/quotas` to open a bordered TUI view showing all providers side by side, with progress bars, used/remaining counts, and reset times. Press `r` to refresh, `q` or `Esc` to close.

The combined dashboard hides providers with no configured subscription, credentials that cannot report subscription usage, and successful responses with no quota windows. Provider-specific commands remain available and show detailed authentication or API errors for troubleshooting.

### Footer status widget

When your active model is from a supported provider, the Pi footer shows real-time quota headroom - updated every 60 seconds and on each turn. Colours shift from green → amber → red as usage climbs.

### Quota warnings

Automatic notifications when projected usage is on track to exceed limits before the window resets. Warnings escalate from `warning` → `high` → `critical` based on your consumption pace.

### Per-feature toggles

Use `/quotas:settings` to enable or disable:

- Combined `/quotas` command
- Per-provider commands (`/anthropic:quotas`, `/codex:quotas`, `/github:quotas`, `/openrouter:quotas`, `/synthetic:quotas`, `/grok:quotas`, `/zai:quotas`, `/opencode-go:quotas`, `/kimi:quotas`, `/ollama:quotas`)
- Footer status widget
- Quota warning notifications
- **Defer to Synthetic** — when both pi-quotas and [pi-synthetic](https://www.npmjs.com/package/@aliou/pi-synthetic) are loaded, pi-quotas hides its own Synthetic footer to avoid showing duplicate quota information. Enabled by default; disable if you prefer to see both footers.

Settings can be saved globally (`~/.pi/agent/extensions/quotas.json`) or per-project (`.pi/quotas.json`). Run `/reload` after changing command visibility.

## Supported providers


| Provider       | Windows                                                        | Details                                                                                             |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Anthropic      | 5h, 7d, per-model 7d, extra usage                              | Utilization percentages; optional overage budget in local currency                                  |
| OpenAI Codex   | 5h, 7d, credits, spend cap                                     | Rate-limit percentages; credit balance; spend-cap reached/OK                                        |
| GitHub Copilot | Premium/chat/completions per month                             | Remaining/entitlement counts with overage indicators                                                |
| OpenRouter     | Monthly budget, daily/weekly/monthly usage                     | USD spending tracking with cents precision; optional per-key budget limits; UTC-based period resets |
| Synthetic      | Subscription, search/hour, free tools, weekly tokens, 5h limit | Request counts and token budgets; rolling five-hour rate limit; weekly token regen                  |
| Grok           | Weekly credits, per-product usage, on-demand spend              | SuperGrok credit usage from the xAI CLI billing endpoint                                             |
| Z.ai           | 5h, 7d, monthly web searches                                  | Token utilisation percentages (rolling 5h/7d windows); monthly web-search count limit               |
| OpenCode Go    | Rolling 5h, weekly, monthly                                   | Percent-of-limit utilisation from the official `/zen/go/v1/usage` endpoint; reset times from `resetsAt`    |
| Kimi Code      | Rolling 5h, weekly                                           | Coding Plan request allowances with reset times                                                        |
| Ollama Cloud   | 5h, 7d                                                       | Rolling session (5h) and weekly (7d) usage fractions from the `/api/usage` endpoint                  |


## Credentials

pi-quotas reads existing Pi auth entries from `~/.pi/agent/auth.json`:

- `anthropic` — Anthropic OAuth token
- `openai-codex` — Codex access token (also reads `~/.codex/auth.json` for the account ID)
- `github-copilot` — GitHub Copilot OAuth token (falls back to `gh auth token` if needed)
- `openrouter` — OpenRouter API key (Bearer token)
- `synthetic` — Synthetic API key (set the `SYNTHETIC_API_KEY` environment variable)
- `xai` — Grok/xAI OAuth access token
- `zai` — Z.ai (Zhipu AI / GLM Coding Plan) API key
- `opencode-go` — OpenCode Go API key (from `pi /login opencode-go`, or set `OPENCODE_GO_API_KEY`). Quotas come from the official `https://opencode.ai/zen/go/v1/usage` endpoint; a standalone `~/.config/opencode/opencode-quota/opencode-go.json` with an `"apiKey"` field also works, as does the OpenCode CLI `~/.local/share/opencode/auth.json`
- `kimi-coding` — Kimi Code OAuth access token
- `ollama-cloud` — Ollama Cloud API key (also reads `OLLAMA_API_KEY` if set)

No additional setup is required - if Pi can use the provider, pi-quotas can check its quotas. For Synthetic, export `SYNTHETIC_API_KEY` in your shell or Pi environment.

## Requirements

- [Pi](https://github.com/mariozechner/pi) >= 0.61.0

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes and recent changes.

## License

[MIT](LICENSE) © Latent Minds Pty Ltd

## Acknowledgements

This project was inspired by [@aliou/pi-synthetic](https://www.npmjs.com/package/@aliou/pi-synthetic).

