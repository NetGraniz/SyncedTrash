# Synced Trash 0.4.2

Reliability and release-quality update for the shared recoverable trash on Windows and iPhone.

## Changes

- Preserved recovery metadata when Obsidian completes a physical move but reports a late indexing or event error.
- Made parent-folder creation tolerant of safe races with a sync provider or another operation.
- Added regression coverage for late move errors.
- Added reproducible build input under `src/`, `versions.json`, CI, release asset verification, release notes, and GitHub artifact attestations.
- Added a repository ignore rule so local plugin `data.json` files cannot be committed accidentally.

There are no data-format changes. Existing trash entries remain compatible. Back up the vault and verify deletion and restoration on a test note after updating.
