# CharmIPTV account referrals

This directory contains the additive referral feature for the existing
`charmiptv-account-api` Cloudflare Worker. It deliberately does not contain a
replacement account Worker because the deployed Worker's current source and
password-hashing implementation must be preserved.

## Policy implemented

- Each active user has two referral slots in a rolling six-calendar-month
  period anchored to `users.created_at`.
- Allowances do not stack above two at renewal.
- Generating a code reserves a slot for exactly three days.
- An unused expired code automatically releases its slot.
- A redeemed code consumes the slot until the next six-month boundary.
- A code still active at a boundary occupies one of the renewed slots until it
  is redeemed or expires.
- Referred accounts inherit the inviter's current `expires_at` and
  `max_sessions`; a referral can never grant more access than the inviter.
- Administrator invitations remain in the existing `invites` table and retain
  their existing behavior.

## Deployment sequence

1. Export or copy the deployed Worker's current source from Cloudflare.
2. Back up the bound D1 database before applying the migration.
3. Apply `migrations/0002_user_referrals.sql` to the same D1 database bound as
   `env.DB`.
4. Add `referral-policy.js` and `referral-service.js` to the Worker project.
5. Route authenticated `GET /referrals` and `POST /referrals/invites` through
   `handleReferralRoutes` before the Worker's not-found response.
6. Extend `POST /auth/register` to check an administrator invitation first and
   then `findReferralInvitation`. Preserve the deployed password hashing and
   username/email validation exactly.
7. For a referral registration, create the new user with `referralGrant`, and
   consume the referral in the same atomic database operation. A failed user
   insert must not consume the invitation, and a failed invitation claim must
   not leave a user behind.
8. Preserve the existing login/session behavior, including maximum concurrent
   sessions and oldest-session revocation.
9. Deploy, then verify the smoke-test cases below before releasing the APK.

## Required smoke tests

- An authenticated new user initially sees 2 available invitations.
- Three rapid generation requests result in two codes and one `409` response.
- A generated code expires three days after creation and its slot returns.
- Redeeming a code creates one account, marks the code used, and consumes one
  slot. A second redemption attempt fails without creating another account.
- At a six-month boundary, consumed slots renew without exceeding two total.
- An active code crossing the boundary still occupies one slot.
- A referred account cannot outlive or exceed the inviter's current access.
- Disabled, expired, or inactive inviters cannot grant a usable referral.
- Existing administrator invitations still register accounts unchanged.
- Logging in above `max_sessions` still revokes the oldest session.
- `GET /me` returns `401` for expired, revoked, or logged-out sessions.

The app contains no device registration, device name, advertising identifier,
or location fields. Do not add any while integrating these routes.
