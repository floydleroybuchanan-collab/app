# RC17 backup safety audit

Full backup capture and restore rollback now share one bounded catalog reader. It accepts an absent playlist directory as empty and rejects directory access errors, disappeared files, and reads exceeding the aggregate 12 MiB memory budget. Capture and rollback preparation stop before writing when this reader fails.

The v2 format is unchanged. Restore checks the decoded text budget, checksum, settings and customization types, personal source addresses, active catalog references, allowed private filenames, row shape, and the catalog budget before presenting confirmation or changing data. Favorites imports check file metadata before reading and check the returned text size before parsing.

Capture and restore compare the saved playlist registry after taking their file snapshots to detect a revision change during preparation. The guide cache maintenance barrier covers source cache writers and does not cover direct playlist registry changes, native customization, and backup writes together. The revision comparison narrows that race but is not a transaction across files, preferences, SecureStore, and Room. Backup and restore still require quiescent settings and the existing restart after restore. Existing backup files remain untouched.

Executed fixtures cover absent versus unreadable directories, aggregate pre-read refusal, rejected paths and malformed catalogs, customization validation, and oversized external favorites import without a body read.
