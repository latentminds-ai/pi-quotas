# @latentminds/pi-quotas

Pi extension package for showing remaining quota/usage for:

- Anthropic
- OpenAI Codex
- GitHub Copilot

## Features

- `/quotas` command for a combined quota dashboard
- `/anthropic:quotas`, `/codex:quotas`, `/github:quotas`
- `/quotas:settings` interactive toggles
- Footer status widget for the currently selected provider
- Quota warnings when projected usage is risky

## Install

```bash
pi install /absolute/path/to/quotas
```

Or for local development:

```bash
pi -e ./src/extensions/command-quotas/index.ts \
   -e ./src/extensions/usage-status/index.ts \
   -e ./src/extensions/quota-warnings/index.ts
```

## Credentials

This package reads existing Pi auth entries from `~/.pi/agent/auth.json`:

- `anthropic`
- `openai-codex`
- `github-copilot`

For Codex, it also reads `~/.codex/auth.json` to resolve the ChatGPT account id when needed.

## Usage

```text
/quotas
/anthropic:quotas
/codex:quotas
/github:quotas
/quotas:settings
```

When one of the supported providers is the active model provider, the footer shows current quota headroom.

Use `/quotas:settings` to enable or disable:
- combined command
- provider-specific commands
- usage footer status
- warning notifications

After changing command visibility, run `/reload` to fully apply command registration changes.
