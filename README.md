# @latentminds/pi-quotas

Quota monitoring for the [Pi coding agent](https://github.com/mariozechner/pi). Shows remaining usage and rate limits for Anthropic, OpenAI Codex, GitHub Copilot, and OpenRouter — directly in your Pi session.

## Screenshots

| `/quotas` dashboard | Footer status |
|---|---|
| ![Quotas dashboard](docs/quotas-dashboard.png) | ![Footer status](docs/footer-status.png) |

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

| Command | Description |
|---------|-------------|
| `/quotas` | Combined quota dashboard for all providers |
| `/anthropic:quotas` | Anthropic quotas only |
| `/codex:quotas` | OpenAI Codex quotas only |
| `/github:quotas` | GitHub Copilot quotas only |
| `/openrouter:quotas` | OpenRouter quotas only |
| `/quotas:settings` | Toggle individual features on or off |

## Features

### Quota dashboard

Run `/quotas` to open a bordered TUI view showing all providers side by side, with progress bars, used/remaining counts, and reset times. Press `r` to refresh, `q` or `Esc` to close.

### Footer status widget

When your active model is from a supported provider, the Pi footer shows real-time quota headroom - updated every 60 seconds and on each turn. Colours shift from green → amber → red as usage climbs.

### Quota warnings

Automatic notifications when projected usage is on track to exceed limits before the window resets. Warnings escalate from `warning` → `high` → `critical` based on your consumption pace.

### Per-feature toggles

Use `/quotas:settings` to enable or disable:
- Combined `/quotas` command
- Per-provider commands (`/anthropic:quotas`, `/codex:quotas`, `/github:quotas`, `/openrouter:quotas`)
- Footer status widget
- Quota warning notifications

Settings can be saved globally (`~/.pi/agent/extensions/quotas.json`) or per-project (`.pi/quotas.json`). Run `/reload` after changing command visibility.

## Supported providers

| Provider | Windows | Details |
|----------|---------|---------|
| Anthropic | 5h, 7d, per-model 7d, extra usage | Utilization percentages; optional overage budget in local currency |
| OpenAI Codex | 5h, 7d, credits, spend cap | Rate-limit percentages; credit balance; spend-cap reached/OK |
| GitHub Copilot | Premium/chat/completions per month | Remaining/entitlement counts with overage indicators |
| OpenRouter | Monthly budget, daily/weekly/monthly usage | USD spending tracking with cents precision; optional per-key budget limits; UTC-based period resets |

## Credentials

pi-quotas reads existing Pi auth entries from `~/.pi/agent/auth.json`:

- `anthropic` — Anthropic OAuth token
- `openai-codex` — Codex access token (also reads `~/.codex/auth.json` for the account ID)
- `github-copilot` — GitHub Copilot OAuth token (falls back to `gh auth token` if needed)
- `openrouter` — OpenRouter API key (Bearer token)

No additional setup is required - if Pi can use the provider, pi-quotas can check its quotas.

## Requirements

- [Pi](https://github.com/mariozechner/pi) >= 0.61.0

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes and recent changes.

## License

[MIT](LICENSE) © Latent Minds Pty Ltd

## Acknowledgements

This project was inspired by [@aliou/pi-synthetic](https://www.npmjs.com/package/@aliou/pi-synthetic).

<p align="center">
  <img src="docs/latent-minds@2x.png" alt="Latent Minds" width="320" />
</p>