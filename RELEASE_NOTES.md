# Synced Trash 1.0.0

The first stable release of the shared recoverable trash for Obsidian on Windows and iPhone.

## Stable release

- Validated through several weeks of daily use across multiple Windows PCs and iPhones.
- Covered by automated deletion, restoration, folder, migration, retention, pending-sync, safety-boundary, and failure-recovery tests.
- Declares the existing entry metadata v1 format stable. Future incompatible formats will use an explicit migration.
- Removes the testing-release label without changing deletion, restoration, cleanup, or synchronization behavior.

## Safety model

- Deleted files are moved intact into uniquely named folders inside the visible `Trash/` directory.
- Recovery metadata records the original path and deletion time without modifying note contents.
- Restoration never intentionally overwrites an existing file and chooses a distinct restored name on conflict.
- Pending entries are never removed automatically before their payload reaches the device.
- Permanent deletion and emptying Trash require explicit confirmation.
- Unsafe paths outside `Trash/` are rejected before recursive deletion.

## Upgrade notes

No migration or configuration changes are required when upgrading from 0.4.2. Existing trash entries remain fully compatible. Keep the visible `Trash/` folder included in your synchronization service and keep independent backups of important notes.
