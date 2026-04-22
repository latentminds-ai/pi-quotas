# OpenRouter Integration

## Status

Completed and released in `v0.2.0`.

## Overview

OpenRouter quota monitoring has been added to pi-quotas for pay-as-you-go and budget-limited API keys.

## What shipped

### Provider support
- Added `openrouter` to supported quota providers
- Added fetch support for `GET https://openrouter.ai/api/v1/key`
- Added parsing for OpenRouter key usage and optional budget limits

### Commands and UI
- Added `/openrouter:quotas`
- Included OpenRouter in `/quotas`
- Added footer status support for active OpenRouter sessions
- Updated OpenRouter tracking windows to show:
  - `Daily`
  - `Weekly`
  - `Monthly`
- Currency values now display with cents precision throughout the UI

### OpenRouter window behavior
OpenRouter is credit-based, not subscription-quota-based.

Because of that, the usage windows are shown as tracking periods rather than traditional quota buckets:
- **Monthly Budget** — shown only when a per-key spending limit is configured
- **Credits Remaining** — shown when a remaining spend/balance value is available
- **Daily / Weekly / Monthly** — tracking-only windows that show how much has been spent in each period

Tracking-only windows display as `$X.XX used` instead of `$X.XX / $0.00`.

### Time handling
OpenRouter tracking periods now use UTC-based rollovers:
- Daily → next UTC midnight
- Weekly → next UTC Monday
- Monthly → first day of the next UTC month

## Verification

- Tests passing: `46`
- Type checking: clean
- npm package dry-run: verified

## User setup

Add your OpenRouter API key to Pi auth:

```bash
pi auth add openrouter <your-openrouter-api-key>
```

Then use either:

```bash
/quotas
```

or:

```bash
/openrouter:quotas
```

## Related files

- `src/types/quotas.ts`
- `src/providers/providers.ts`
- `src/providers/fetch.ts`
- `src/lib/quotas.ts`
- `src/extensions/command-quotas/provider-commands.ts`
- `src/extensions/command-quotas/components/quotas-display.ts`
- `src/extensions/usage-status/format-status.ts`
- `README.md`
- `CHANGELOG.md`

## References

- [OpenRouter Pricing](https://openrouter.ai/pricing)
- [OpenRouter FAQ](https://openrouter.ai/docs/faq)
- [OpenRouter API Authentication](https://openrouter.ai/docs/api/reference/authentication)
- [OpenRouter API Key Endpoint](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
