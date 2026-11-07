# Account, local state, and maintenance audit

Baseline: RC17 build 224, commit ed22cb45. These are source changes after the delivered APK, not changes already installed on members' devices.

## Corrections and evidence

| Finding | Correction | Executed verification |
|---|---|---|
| An account restore/login response could arrive after logout or a newer login, restore managed sources, or overwrite a newer secure token. | Session epochs guard every asynchronous acceptance; secure writes/removals are serialized. Superseded newly issued tokens are revoked. Referral/cancellation responses cannot clear a newer session. | Deferred restore, reversed login completion, delayed secure persistence, and stale referral 401 fixtures. |
| Account validation could run repeatedly while the application was backgrounded. | Periodic validation requires active AppState; foreground revalidation remains. | Background/foreground fixture. |
| Exact/prefix local logo hits bypassed eviction; a late folder scan could repopulate a cleared folder; initial misses survived successful indexing. | All lookup writes share a 512-entry LRU, folder scans have generation ownership, and successful indexing invalidates misses and notifies mounted consumers. | 2,000 successful lookups stay bounded; delayed folder result after clear is rejected; initial miss resolves after indexing. |
| PIN/group changes could display success before secure persistence, lose hydrated settings, or retain prior session unlocks after a PIN change. | Serialize after hydration, publish after successful persistence, report errors, and relock on PIN change. Unlock IDs are limited to configured groups. | Failed writes preserve prior state; changed PIN relocks; early group edit retains stored PIN. |
| Android's UI_HIDDEN value was caught by the generic running-low threshold, so the intended background cleanup branch was unreachable. | A pure range policy distinguishes running pressure, UI hidden, background and complete trim levels. | Kotlin/JUnit range fixture. |
| Manual cache cleanup could recursively remove files owned by an active image/HTTP cache, including its journal. | Use Glide's cleanup API off the bridge thread. Only known old loose scratch filenames are eligible for direct deletion; canonical-parent checks exclude nested/external files. Coalesce maintenance requests and handle a closed executor. | Kotlin/JUnit preservation/deletion fixture. |
| A backup encryption call racing module shutdown could throw executor rejection outside its Promise handling. | Reject the Promise explicitly and release the busy flag. | Native compilation gate; not a device recreation test. |
| Automatic guide scheduling excluded the live player but still ran in provider playback, Multiview, and embedded VOD. | Defer automatic source work on every playback route; resume the existing schedule when returning to a safe route. | Executed scheduler fixture for all four playback routes and Guide return. |
| A future/raw diagnostic error could violate the export's promise to omit provider addresses. | Redact ordinary/JSON-escaped provider URLs, credential labels and bearer tokens at the final text-export boundary. | Synthetic private-address and credential export fixture; measurements remain present. |

## Ownership and limitations

- AuthProvider owns its validation listener and interval. Its epoch invalidates late results on unmount. SecureStore is the durable session owner; encryption/access guarantees depend on the device. A storage-device failure cannot be made impossible by this queue.
- The local logo directory is capped at 5,000 entries; the resolution cache is separate. Fuzzy lookup may still inspect many names and needs device profiling if local-logo folders are large.
- The memory coordinator keeps process-lifetime listeners for process-owned caches; view/module listeners unregister with their owner. Playback startup can defer noncritical trim; critical pressure is still dispatched.
- Bounded entry counts are not whole-process RAM budgets. Bitmaps, native decoders, bridges, SQLite page caches, parsed strings and temporary copies all contribute independently. Android may kill the process without delivering a useful cleanup callback.
- User-created backups and diagnostic exports are persistent user artifacts, not disposable caches. This pass does not automatically delete them. A storage-management screen would make their retention visible.
- The parental PIN provides an application control, not an OS security boundary. Settings currently permits PIN changes without a separate administrator-unlock flow. An explicit locked Settings design is a separate product change.
- Backup/restore details and cross-store transaction limits are documented in audit-rc17-backup.md. Notification/challenge timer findings are documented with the guide/control audit.
