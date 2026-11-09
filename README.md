# Synced Trash for Obsidian

**A shared, recoverable trash for your Obsidian vault.** Made for desktop and mobile, including Windows and iPhone. Works with existing file-based sync services such as Remotely Save + Dropbox — no Dropbox integration or token is needed.

**Version:** 0.3.0 (testing preview). **Please back up your vault and verify the behavior on two test notes before relying on this plugin.** The plugin has not yet been tested inside Obsidian on Windows or iOS.

## How it works

Remotely Save does not sync Obsidian's hidden `.trash` directory. Synced Trash instead moves deleted notes, attachments, and folders into an **ordinary** vault folder named `Trash`. Remotely Save should sync this folder like other vault content, as long as it isn't excluded in its settings.

Example of the files in your vault:

```text
My Vault/
  Notes/
  Projects/
  Trash/
    mb5p1dhc-k4f7w4z56v/
      entry.json
      My deleted note.md
```

Each entry has a unique directory to avoid filename collisions. Its `entry.json` stores the original vault-relative path and deletion timestamp. The note's contents are not modified.

The plugin moves items using `Vault.rename()`, rather than `FileManager.renameFile()`, to **avoid rewriting links** elsewhere in your vault to point into the trash. After restoration, original links can resolve again.

## Features

- Trash sidebar (ribbon trash icon) on desktop and mobile.
- One-click **Restore**, preserving the original path when possible.
- Non-destructive conflict handling: if the original path is already occupied, restores to `name (restored).md` instead of overwriting.
- Confirmation before permanent deletion. **Empty trash** permanently removes everything physically inside `Trash/`, including old technical folders, unknown files, and notes the plugin cannot index.
- Automatic removal of empty entry directories after individual permanent deletion.
- Optional automatic deletion after **30, 60 or 90 days**, disabled by default.
- One-time **Import from .trash…** action in Settings. Shows a warning and confirmation before moving existing local Obsidian trash items into the synced folder.
- Standard Obsidian trash methods redirected to synced Trash when the plugin is enabled, with a separate **Move current note to synced trash** command and file context-menu action as a fallback.
- Handles Obsidian-managed notes, attachments, and folders.
- Pure JavaScript plugin; **no Node.js, Electron or build tools at runtime**, so it can load on iOS.

## Installation on Windows

Copy these three files into your vault directory:

```text
<your vault>/.obsidian/plugins/synced-trash/
  main.js
  manifest.json
  styles.css
```

In Obsidian, open **Settings → Community plugins**, enable the plugin, then open its view with the trash icon. No npm install or build step is required.

## Installation on iPhone

The iOS Obsidian app can run community plugins, but the `.obsidian` directory is harder to access with the default Files app. For a public GitHub release, the simplest installation method is to use **BRAT** on the iPhone and add your GitHub plugin repository. Publish `manifest.json`, `main.js`, and `styles.css` in the repository or a release as required by the BRAT version you use. You must **enable this plugin on both devices** to intercept deletions on both.

Do not assume Remotely Save automatically syncs the plugin itself: it normally skips `.obsidian` unless you explicitly enable its experimental config sync. This plugin does **not** require that option.

## Recommended configuration

In Obsidian **Settings → Files and links → Deleted files**, select **Move to Obsidian trash** for a safe fallback if this plugin is temporarily disabled. With the plugin enabled, its `FileManager.trashFile()` / `Vault.trash()` hooks redirect standard trash actions to `Trash/`.

In Remotely Save, check that `Trash/` isn't excluded. Do not use the hidden `.trash` as the synced directory. Sync on Windows, then sync on iPhone. The deleted file should appear in the Synced Trash sidebar on both devices after sync completes.

For the first test, turn automatic cleanup off and create two throwaway notes. Delete one from Windows, sync both devices and restore it from the iPhone. Repeat in the other direction. Test an attachment and a folder as well before trusting the plugin with important notes.

## Import existing `.trash` items

Open **Settings → Synced Trash → Import from .trash…**. The plugin counts the **top-level items** inside your local hidden `.trash` and displays a confirmation warning. A folder counts as one item and its contents are moved together.

On confirmation, each item is moved directly into a uniquely named directory under the synced `Trash/`, and gets an `entry.json` with its import time and original `.trash` source. **Items are removed from `.trash` only if their move succeeds**; failures stay in `.trash`, and the result reports their count. The empty `.trash` directory itself is left intact.

**Important:** Obsidian normally flattens deleted items when moving them into `.trash`, so the original folder and deletion date can no longer be reconstructed. Imported items therefore restore into `Recovered from Trash/<name>` (avoiding name collisions), and the displayed date reflects the **import date**, not the original deletion. Auto-cleanup retention also starts from the import date.

**Back up your vault before importing.** Close Obsidian on other devices during the import, and sync this device with Remotely Save afterwards. The import operates on the **local device's** `.trash` only; repeat separately on another device if it contains different old deleted items.

Files or folders containing names starting with `.` or `_` are conservatively **left in `.trash`** when they could be excluded by Remotely Save. These entries are reported as failed rather than quietly moving material that may not sync. Move those by hand after reviewing your sync settings.

## Important limitations

**The default-Delete interception is best-effort.** Obsidian has no documented, official plugin pre-delete interception event. This plugin wraps the public `FileManager.trashFile()` and `Vault.trash()` methods, and unwinds those hooks when unloaded. If Obsidian changes its internal deletion implementation, some Delete actions may still use its native `.trash`. The explicit **Move to Synced Trash** command and context-menu item are safer fallbacks. Another plugin that wraps these methods may conflict; disable other trash replacement plugins.

**The plugin deliberately does not wrap `Vault.delete()`.** Synchronizers and other plugins use that method to apply genuine remote deletions. Intercepting it could cause removed files to reappear or create sync loops.

**Sync is eventual, not immediate.** Files only reach other devices after Remotely Save has successfully synced. The trash view shows *Waiting for file to sync…* for an entry whose metadata arrived before its content. Such entries are never auto-purged.

**Check before emptying.** The manual **Empty trash** button is intentionally destructive: after an explicit confirmation, it permanently removes *every file and folder inside `Trash/`*, including notes or attachments not shown as recoverable entries, folders awaiting sync, and unfamiliar user-created items. It does not delete the `Trash/` folder itself or anything outside it. Automatic 30/60/90-day cleanup still processes only known entries. Remotely Save subsequently synchronizes the removals. Back up your vault, avoid simultaneous offline edits/restores, and verify that both devices have successfully synced before emptying.

**The `Trash` folder remains visible** inside the vault. This is necessary for ordinary Remotely Save syncing and means trashed notes may be discoverable by other plugins and search tools.

**Leftover folders from old versions:** Obsidian may show technical folders with IDs such as `mw8xgb7t-z3vzteqlz` after earlier versions deleted notes. These are now removed by the main **Empty trash** action, even if the folders contain other files. The action is offered whenever there is any content under `Trash/`, even if the plugin shows zero indexed entries. If Remotely Save reports a sync failure, resolve it before clearing: old remote data may otherwise reappear during a later synchronization.

**Restore conflicts** are handled without overwriting: `Notes/name.md` becomes `Notes/name (restored).md` if the original path is occupied. Metadata files are never stored inside hidden folders.

## Development

The entry point is [`main.js`](main.js), with no runtime dependencies besides Obsidian. This deliberately keeps the project small and usable without an SDK.

Run `npm test` to execute the Node.js unit tests. They mock the Obsidian filesystem; passing them does **not** guarantee compatibility with the real Windows and iOS applications. Validate the manual checklist above in both apps.

## Privacy

Synced Trash does not send information to any server. All data is stored in the current Obsidian vault; your existing sync plugin controls transfer.
