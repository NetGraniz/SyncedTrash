# Synced Trash 0.4.0

Shared, recoverable trash for Obsidian on Windows and iPhone.

## Changes

- The **Empty trash** action permanently removes every item inside the visible `Trash/` folder, including leftover technical folders.
- Entries whose content has not arrived on this device now offer **Remove pending entry** after a clear warning. This removes local recovery metadata only; it does not claim that another device's unsynced payload was deleted.
- Retains recovery paths, deletion timestamps, and optional retention after 30/60/90 days.
- Works alongside Synced Vault. Updated author metadata and added MIT license.

## GitHub release instructions

Create a **published** GitHub Release with tag **`0.4.0`** (NOT `v0.4.0`). Upload **`main.js`**, **`manifest.json`**, and **`styles.css`** as three separate release assets, without renaming them. The repository's root `manifest.json` must also contain `"version": "0.4.0"`.

Backup your vault and test first. Deleted files cannot be recovered after permanent removal.
