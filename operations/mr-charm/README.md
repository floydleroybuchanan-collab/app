# Mr Charm production correction — 9 October 2026

The live Telegram API contains conversational response handlers and other features absent from the repository's older account backend. Rebuilding that older backend would remove live functionality. These guarded patches apply to the downloaded production Worker instead, preserving all unrelated code and current panel assets.

## Changes deployed

- Keep all 225 existing non-command fallback replies and 50 existing phrase replies. Add 72 varied replies, for 122 phrase replies across 38 triggers. Deduplicate each pool. Existing kick/mute responses remain intact.
- Conversational humor applies to prefixed non-command messages only. Prefix is case-insensitive `Mr Charm` or `Mr. Charm` with a word boundary. Bare slash commands, mentions, unaddressed replies and concatenated names stay silent. Existing app commands and button actions keep their content.
- `/start help` and verified `flow_` onboarding/security deep links remain supported. Other slash start command payloads no longer dispatch commands. Automated join notifications remain enabled.
- Human-directed violence and explicit self-harm statements use calm safety text and create a `credible_threat_review` bot event referencing the original Telegram message, rather than echoing the threat or firing an automatic punishment. This deterministic check cannot establish intent with certainty.
- Add `bot_invitation_sources`: system provenance is separate from the existing administrator authorization relationship. Bot-origin records carry source `bot_telegram` and creator label `Mr Charm`. No fake administrator account, password, or session is created.
- Backfill only invitations with matching `token_created` Telegram identity and creation timestamp: 84 invitations, 63 redeemed accounts. The one panel-created invitation linked to Telegram remains human-attributed. All other manual records retain their creator.
- New token events and redemptions record provenance atomically through D1 triggers. Token messages, creator filters, user/invitation listings, registration audit displays, per-user activity and supported admin report projections use the system label. Real human authorization IDs and historical audit rows remain unchanged.
- Admin report projections subtract confirmed bot-origin records from human creator totals. Stored authorization counters are retained for existing quota rules. Older deleted records without surviving provenance cannot be confidently reassigned.

## Validation

Twelve tests cover response preservation, randomness, strict prefix handling, slash/reply/mention silence, unchanged app commands/buttons, threat triage, provenance backfill and idempotence, atomic token assignment, Telegram recipient approval, genuine manual attribution, creator filtering, audit/activity display, authentication, automated welcome/token-before-approval ordering, and verified Telegram-admin invitation issuance with source-forgery rejection. Telegram transport is mocked; no test sends a live user a message.

Live smoke checks: API health and D1 connection return 200; unauthenticated admin requests return 401; unauthenticated Telegram webhook returns 403. All ten panel resources return 200. Deployed panel text matches the tested patch, preserves View Activity, and both images match the original bytes. The deployed API SHA-256 exactly matches the tested source; all nine bindings, secrets, compatibility settings, scheduling and existing functions are preserved. D1 confirms 84 source audit entries and zero inconsistent source labels.

Actual delivery to a real Telegram recipient was not exercised. The original Savage Response Pack attachment was unavailable; the live response catalog was used, as requested.

## Production versions and rollback

| Worker | Previous version | Deployed version |
| --- | --- | --- |
| charmiptv-account-api | 2fc9ed8b-fff3-493b-948c-f7e1cc55f2b1 | b9e00f43-aa20-4ab4-bb28-515a069acf0b |
| charmiptv-admin | 46526ab5-21ff-4025-972b-75e0adf3ef17 | e5a64044-2449-41e9-86c8-ca4cbf07b324 |

Rollback by deploying the previous Worker versions at 100%. The additive provenance table/triggers are compatible with the previous API, so retain them and their audit history. Do not delete historical audit entries. Account passwords, verification challenges, permissions, tokens and genuine human invitation ownership were not changed.

## Reproducing the tests

The fixtures contain only pre-change Worker code and database schema, with no production account data or credentials. From the repository root, run:

```sh
node --test operations/mr-charm/verify.test.mjs
```

`patch-live-worker.mjs` rejects unexpected anchors. The actual rollout also guarded the original source hash and active deployment versions, used version uploads before activation, inherited all bindings, and preserved binary panel modules. Before any future deployment, reconcile the live Worker with the repository's older modular backend; do not rebuild and deploy that older backend as a replacement for this live version.
