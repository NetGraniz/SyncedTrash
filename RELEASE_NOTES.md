# Synced Trash 0.4.1

Shared, recoverable trash for Obsidian on Windows and iPhone.

## Changes

- Committed a JavaScript lockfile so automated build verification can reproduce dependency resolution.
- Added a GitHub Actions workflow that checks the tag, runs tests, attests the three installable files, and publishes release notes.
- No changes to the deletion, restoration, or retention behavior from 0.4.0.

## GitHub release instructions

Commit this source and push tag **`0.4.1`** (NOT `v0.4.1`). GitHub Actions will run tests, create provenance attestations, and publish a Release containing **`main.js`**, **`manifest.json`**, and **`styles.css`** with these notes as its description. Do not manually create the Release first.

Backup your vault and test first. Deleted files cannot be recovered after permanent removal.
