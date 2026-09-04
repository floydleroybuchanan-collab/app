# CharmIPTV account referrals

This directory contains the deployable `charmiptv-account-api` Worker, its
additive D1 migration, and focused referral policy/service modules used by the
local tests. `worker.js` preserves the existing administrator, invitation,
login, session, and password-reset routes while adding user referrals and
privacy-preserving account cancellation.

Managed M3U and XMLTV addresses remain server-side Worker secrets and are never
compiled into the APK. `GET /content/access` releases them only to a currently
authenticated account in a non-cacheable HTTPS response. Android then downloads
the HTTP or HTTPS provider source directly, preserving the same provider-facing
network path and existing M3U/XMLTV parsers used by the last known-good build.
The app keeps the returned addresses in memory rather than persistent storage.

## Policy implemented

- Each active user can have at most two unused referral opportunities in a
  six-calendar-month cycle anchored to `users.created_at`.
- Allowances do not stack above two at renewal.
- Generating a code reserves a slot for exactly three days.
- An unused expired code automatically releases its slot.
- A user can have at most six active referred accounts. Redeemed codes occupy
  those numbered network positions while the referred accounts remain active.
- When a referred account expires or is canceled, its network position is
  released and up to one referral opportunity is returned, without exceeding
  the two-code allowance.
- A code still active at a boundary occupies one of the renewed slots until it
  is redeemed or expires.
- Referred accounts inherit the inviter's current `expires_at` and
  `max_sessions`; a referral can never grant more access than the inviter.
- Users can delete only inactive referral history rows; active accounts and
  unused codes cannot be hidden from their private referral status list.
- Account cancellation requires the current password and the exact phrase
  `please cancel me`. It immediately deletes the account, sessions, reset
  tokens, preferences, and attributable audit data. Only the anonymous referral
  status needed to release the inviter's allowance remains.
- Administrator invitations remain in the existing `invites` table and retain
  their existing behavior.

## Deployment sequence

1. Back up the bound D1 database before applying the migration.
2. Apply `migrations/0002_user_referrals.sql` to the same D1 database bound as
   `env.DB`.
3. Push the account Worker files on the RC-6 branch or manually run the
   `Deploy CharmIPTV Account Worker` workflow. Its checked-in Wrangler config
   preserves the existing encrypted secrets, D1 binding, minute cleanup trigger,
   and `workers.dev` address.
4. Configure a Cron Trigger for regular expired-account cleanup. Requests also
   perform a bounded cleanup so stale accounts are removed even without a cron
   invocation.
5. Verify the smoke-test cases below before releasing the APK.

## Required smoke tests

- An authenticated new user initially sees 2 available invitations.
- Three rapid generation requests result in two codes and one `409` response.
- A generated code expires three days after creation and its slot returns.
- Redeeming a code creates one account, marks the code used, and consumes one
  slot. A second redemption attempt fails without creating another account.
- At a six-month boundary, consumed slots renew without exceeding two total.
- An active code crossing the boundary still occupies one slot.
- Six active referred accounts prevent further generation; canceling or
  expiring one returns one network position and at most one opportunity.
- A referred account cannot outlive or exceed the inviter's current access.
- Disabled, expired, or inactive inviters cannot grant a usable referral.
- Existing administrator invitations still register accounts unchanged.
- Logging in above `max_sessions` still revokes the oldest session.
- `GET /me` returns `401` for expired, revoked, or logged-out sessions.
- Account cancellation rejects a wrong password or wrong confirmation phrase,
  and successful cancellation removes all personal account data immediately.

The app contains no device registration, device name, advertising identifier,
or location fields. Do not add any while integrating these routes.
