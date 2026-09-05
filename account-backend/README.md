# CharmIPTV accounts, referrals and delegated administration

## Owner administration update

- The verified original owner is anchored by user ID in migration 0003.
  Only that login can create staff, change permissions, reset staff passwords,
  or grant unlimited viewer access. Owner-password confirmation is required for
  every staff change. Administrator identities are disabled, not deleted.
- Staff logins are panel-only. They do not confer unlimited viewer access.
  Staff cannot modify any administrator through viewer-account routes.
- Staff have independently selectable create/time/session/suspend/delete/reset/
  logout/revoke/history/audit permissions; account scope defaults to their own
  attributed viewers. The owner can explicitly permit all-viewer scope.
- Duration is a resulting-remaining-time ceiling, not a per-click extension
  allowance. Lifetime direct-account budget, open direct-account budget, pending
  codes, sessions, and unused-code validity are independently bounded. Zero
  creation budgets deny creation. Pending valid codes reserve capacity.
- Creator attribution survives deleting invitation history. Anonymous creator
  totals survive viewer deletion, but viewer identity/attribution does not.
  Surviving historical invite records are backfilled; erased history is not guessed.
- Timed family referrals use the earlier of the expiry saved at generation and
  the inviter's current expiry at redemption. Expired, disabled, deleted, unlimited,
  or administrator inviters cannot grant usable family referrals.
- Unlimited viewer accounts remain owner-selectable, but have zero available
  family-and-friend invites and cannot generate codes. Existing viewer timers
  are not retroactively changed by the migration.
- Registration and one-use claim/attribution/slot consumption are transactional.
  Issuer permissions and expiry are checked again inside that transaction.
- The panel in ../admin-panel has 25/50/100-row pagination, search, sort, status
  and creator filters, owner-only Admins, scoped activity, and detailed controls.
  It migrates an existing panel token to sessionStorage; no passwords are stored.

### Deploying this update

Back up D1 privately, rehearse 0003 on a local copy, and verify the complete users
table is unchanged. Apply migrations/0003_owner_admin_controls.sql once to the
existing database (0002 is already installed), then deploy account-backend and
admin-panel. Verify exactly one anchored owner before deploying. Do not rerun
0003 or restore an older database over newer user activity.

Run node --test account-backend/test/accounts.test.mjs from the repository root,
the frontend test suite, and Wrangler dry runs for both Workers before release.
The dedicated account workflow tests and deploys both Workers; database migrations
remain explicit, reviewed operations. No APK rebuild is needed for this update.
Local UI fixtures are test/preview.mjs and must never be deployed.

Deletion removes data from the live application database. Cloudflare recovery
retention and private migration backups are separate from live data; do not
promise immediate erasure from infrastructure backups.

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
   preserves the D1 binding, minute cleanup trigger, and `workers.dev` address.
   The workflow fails closed unless all four repository source secrets
   (`M3U_URL`, `EPG_URL`, `M3U_URL_2`, and `EPG_URL_2`) are complete HTTP/HTTPS
   URLs, then synchronizes their masked values into the Worker. Its final health
   check reports only whether each playlist/Guide pair is present—never an
   address or credential.
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
