# RC17 account dialog and announcements audit

Baseline: `ed22cb45`. Reviewed `AccountSecurityDialog.tsx`, `AnnouncementCenter.tsx`, their account API call sites, announcement pause ownership, and focus tests.

## Challenge lifecycle

The previous dialog started a one-second interval for every challenge and stopped it only when the challenge object changed or the dialog unmounted. Terminal status and expiration stopped polling but kept the interval alive. The countdown now belongs to a foreground deadline and stops at expiry or teardown. Pending challenges poll only in the foreground. Approved reset and registration flows retain the deadline and recheck the wall clock before attempting completion. A confirmed access or Telegram link flow no longer needs an expiry countdown.

A late poll can publish only while its effect is current, the dialog is open and foregrounded, and its challenge has time left. A synchronous action guard prevents duplicate submissions before React applies the disabled button state. If an already requested challenge comes back after the dialog closes, it is canceled through the existing token cancellation endpoint.

## Announcement lifecycle

The old dismissal cooldown depended on unrelated renders or the next remote refresh. The client now schedules the next eligibility check from the current account's reminder history and cooldown, and ignores expired notices and installed update versions. A legacy policy update remains eligible for its reminder while the policy still advertises it. The foreground refresh effect owns its own in-flight guard, so an older account's request cannot suppress the new account's first refresh. Backgrounding stops refresh and expiry timers. Late link receipts or errors require the same active notice and account.

Verification: 17 targeted tests passed. Tests include executed fake-clock expiry, cancellation and foreground resume, approval deadline policy, and announcement cooldown/expiry cases. TypeScript and targeted lint passed. Native app background transitions and real account approval still require device verification.
