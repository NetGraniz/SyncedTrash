/* Synced Trash — plain JavaScript, no build step or desktop-only APIs. */
const {
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  normalizePath,
} = require('obsidian');

const VIEW_TYPE = 'synced-trash-view';
const TRASH_FOLDER = 'Trash'; // Ordinary folder: Remotely Save does not skip it.
const LEGACY_TRASH_FOLDER = '.trash';
const LEGACY_RESTORE_FOLDER = 'Recovered from Trash';
const METADATA_FILE = 'entry.json';
// Only folders created by makeId() are eligible for orphan cleanup.
const MANAGED_FOLDER_ID = /^[a-z0-9]{8,}-[a-z0-9]{6,12}$/;
const DEFAULT_SETTINGS = {
  retentionDays: 0, // 0 = never automatically delete.
  interceptDelete: true,
};

function validOriginalPath(path) {
  return typeof path === 'string' && path.length > 0 &&
    !path.startsWith('/') && !path.includes('\\') &&
    !path.split('/').some(part => !part || part === '.' || part === '..') &&
    path !== TRASH_FOLDER && !path.startsWith(TRASH_FOLDER + '/');
}

function isTrashedPath(path) {
  return path === TRASH_FOLDER || path.startsWith(TRASH_FOLDER + '/');
}

function makeId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

class ConfirmDialog extends Modal {
  constructor(app, title, description, confirmLabel, onConfirm) {
    super(app);
    this.title = title;
    this.description = description;
    this.confirmLabel = confirmLabel;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: this.title });
    this.contentEl.createEl('p', { text: this.description });
    const actions = this.contentEl.createDiv({ cls: 'synced-trash-dialog-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const confirm = actions.createEl('button', { text: this.confirmLabel, cls: 'mod-warning' });
    confirm.addEventListener('click', () => {
      this.close();
      Promise.resolve().then(this.onConfirm).catch(error =>
        new Notice('Synced Trash: ' + errorText(error)));
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class SyncedTrashView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.opened = false;
    this.rendering = false;
    this.renderAgain = false;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Synced Trash'; }
  getIcon() { return 'trash-2'; }

  async onOpen() {
    this.opened = true;
    await this.refresh();
  }

  async onClose() {
    this.opened = false;
  }

  async refresh() {
    if (!this.opened) return;
    if (this.rendering) {
      this.renderAgain = true;
      return;
    }
    this.rendering = true;
    try {
      const [entries, contents] = await Promise.all([
        this.plugin.listEntries(),
        this.plugin.listTrashContents(),
      ]);
      this.paint(entries, contents.files.length + contents.folders.length);
    } catch (error) {
      this.contentEl.empty();
      this.contentEl.createEl('p', { text: 'Cannot read trash: ' + errorText(error) });
    } finally {
      this.rendering = false;
      if (this.renderAgain) {
        this.renderAgain = false;
        void this.refresh();
      }
    }
  }

  paint(entries, trashItemCount = 0) {
    const root = this.contentEl;
    root.empty();
    root.addClass('synced-trash-view');
    const header = root.createDiv({ cls: 'synced-trash-header' });
    header.createEl('h3', { text: 'Synced Trash' });
    const refreshButton = header.createEl('button', { text: 'Refresh', cls: 'synced-trash-small-button' });
    refreshButton.addEventListener('click', () => void this.refresh());

    const description = root.createEl('p', {
      text: entries.length + (entries.length === 1 ? ' item' : ' items') +
        ' · Synced through your normal vault sync service.',
      cls: 'synced-trash-hint',
    });
    description.setAttribute('aria-live', 'polite');

    if (!entries.length) {
      root.createEl('p', {
        text: trashItemCount ? 'No recoverable entries are indexed.' : 'Trash is empty.',
        cls: 'synced-trash-empty',
      });
    }
    if (trashItemCount > entries.length) {
      root.createEl('p', {
        text: trashItemCount + ' files/folders are physically present in Trash, including untracked items.',
        cls: 'synced-trash-hint',
      });
    }

    for (const entry of entries) {
      const row = root.createDiv({ cls: 'synced-trash-row' });
      row.createDiv({ cls: 'synced-trash-name', text: entry.originalPath.split('/').pop() });
      row.createDiv({ cls: 'synced-trash-path', text: entry.originalPath });
      row.createDiv({ cls: 'synced-trash-date', text: new Date(entry.deletedAt).toLocaleString() });
      if (entry.importedFrom) {
        row.createDiv({
          cls: 'synced-trash-imported',
          text: 'Imported from ' + entry.importedFrom + ' · original location unknown',
        });
      }
      if (!entry.available) {
        row.createDiv({ cls: 'synced-trash-pending', text: 'Waiting for file to sync…' });
      }
      const actions = row.createDiv({ cls: 'synced-trash-actions' });
      const restore = actions.createEl('button', { text: 'Restore' });
      restore.disabled = !entry.available;
      restore.addEventListener('click', async () => {
        restore.disabled = true;
        try {
          const restored = await this.plugin.restoreEntry(entry);
          new Notice('Restored to ' + restored);
        } catch (error) {
          new Notice('Restore failed: ' + errorText(error));
        } finally {
          await this.refresh();
        }
      });
      const remove = actions.createEl('button', { text: 'Delete permanently' });
      remove.disabled = !entry.available;
      remove.addEventListener('click', () => new ConfirmDialog(
        this.app,
        'Permanently delete this item?',
        'This cannot be undone. Make sure your other devices have synced.',
        'Delete permanently',
        async () => {
          await this.plugin.purgeEntry(entry);
          await this.refresh();
        },
      ).open());
    }

    if (trashItemCount) {
      const footer = root.createDiv({ cls: 'synced-trash-footer' });
      const empty = footer.createEl('button', { text: 'Empty trash', cls: 'mod-warning' });
      empty.addEventListener('click', () => new ConfirmDialog(
        this.app,
        'Permanently empty ALL of Trash?',
        'This will permanently delete EVERY file and folder inside Trash (' + trashItemCount +
          ' top-level items), including notes, untracked files, and technical folders. ' +
          'This cannot be undone. Back up your vault and ensure your devices have synced first.',
        'Delete everything inside Trash',
        async () => {
          const result = await this.plugin.emptyTrash();
          new Notice('Removed ' + result.deleted + ' top-level items; ' +
            result.remaining + ' remain' +
            (result.failed ? '; ' + result.failed + ' failed' : '') + '.', 10000);
          await this.refresh();
        },
      ).open());
    }
  }
}

class SyncedTrashSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const container = this.containerEl;
    container.empty();
    container.createEl('h2', { text: 'Synced Trash' });

    new Setting(container)
      .setName('Capture standard Delete')
      .setDesc('Redirect Obsidian trash actions into the synced Trash folder. Disable other trash-replacement plugins to prevent conflicts.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.interceptDelete)
        .onChange(async value => {
          this.plugin.settings.interceptDelete = value;
          await this.plugin.saveSettings();
        }));

    new Setting(container)
      .setName('Automatically delete old items')
      .setDesc('Disabled by default. Cleanup runs while Obsidian is open. Permanent deletions sync to other devices on their next sync.')
      .addDropdown(dropdown => dropdown
        .addOption('0', 'Never (recommended)')
        .addOption('30', 'After 30 days')
        .addOption('60', 'After 60 days')
        .addOption('90', 'After 90 days')
        .setValue(String(this.plugin.settings.retentionDays))
        .onChange(async value => {
          this.plugin.settings.retentionDays = Number(value);
          await this.plugin.saveSettings();
          void this.plugin.cleanupExpired();
        }));

    new Setting(container)
      .setName('Open trash')
      .setDesc('The files are stored in the ordinary Trash folder in your vault.')
      .addButton(button => button.setButtonText('Open').onClick(() => this.plugin.openTrashView()));

    new Setting(container)
      .setName('Import old Obsidian trash')
      .setDesc('Move everything currently in local .trash to the synced Trash folder. Only successfully moved items leave .trash. Old deletion dates and original paths cannot be recovered.')
      .addButton(button => {
        button.setButtonText('Import from .trash…');
        button.buttonEl.addClass('mod-warning');
        button.onClick(async () => {
          try {
            if (this.plugin.importingLegacyTrash) {
              new Notice('An import is already running.');
              return;
            }
            const items = await this.plugin.listLegacyTrashItems();
            if (!items.length) {
              new Notice('The local .trash folder is empty.');
              return;
            }
            new ConfirmDialog(
              this.app,
              'Import and empty local .trash?',
              'This will MOVE ' + items.length + ' top-level item(s), including contents of any folders, to the synced Trash folder. Obsidian usually loses their original paths and deletion dates; restoration will default to "' + LEGACY_RESTORE_FOLDER + '". Make a backup first. Items that fail to move stay in .trash.',
              'Import and empty .trash',
              async () => {
                const result = await this.plugin.importLegacyTrash();
                new Notice('Imported ' + result.moved + ' item(s). ' +
                  result.failed + ' failed, ' + result.remaining + ' remain in .trash.', 10000);
                this.plugin.refreshOpenViews();
              },
            ).open();
          } catch (error) {
            new Notice('Cannot inspect .trash: ' + errorText(error));
          }
        });
      });

    container.createEl('p', {
      text: 'Install and enable this plugin on both Windows and iPhone. Remotely Save should sync the ordinary Trash folder; it does not sync .trash.',
      cls: 'synced-trash-hint',
    });
  }
}

class SyncedTrashPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.lockedIds = new Set();
    this.installTrashHooks();

    this.registerView(VIEW_TYPE, leaf => new SyncedTrashView(leaf, this));
    this.addRibbonIcon('trash-2', 'Open Synced Trash', () => void this.openTrashView());
    this.addSettingTab(new SyncedTrashSettings(this.app, this));
    this.addCommand({
      id: 'open-synced-trash',
      name: 'Open synced trash',
      callback: () => void this.openTrashView(),
    });
    this.addCommand({
      id: 'trash-active-note',
      name: 'Move current note to synced trash',
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.canCapture(file)) return false;
        if (!checking) void this.trashItem(file).catch(error => new Notice(errorText(error)));
        return true;
      },
    });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!this.canCapture(file)) return;
      menu.addItem(item => item
        .setTitle('Move to Synced Trash')
        .setIcon('trash-2')
        .onClick(() => void this.trashItem(file).catch(error => new Notice(errorText(error)))));
    }));
    for (const name of ['create', 'delete', 'rename']) {
      this.registerEvent(this.app.vault.on(name, () => this.refreshOpenViews()));
    }
    this.registerInterval(window.setInterval(() => {
      void this.cleanupExpired();
      this.refreshOpenViews();
    }, 60 * 60 * 1000));
    this.registerInterval(window.setInterval(() => this.refreshOpenViews(), 15000));
    void this.cleanupExpired();
  }

  onunload() {
    // Another plugin may have wrapped our hook after we installed it.
    // Such a wrapper may still call our function; always delegate when unloaded.
    this.unloading = true;
    this.restoreTrashHooks();
  }

  async loadSettings() {
    const saved = (await this.loadData()) || {};
    this.settings = {
      retentionDays: [0, 30, 60, 90].includes(saved.retentionDays) ? saved.retentionDays : 0,
      interceptDelete: saved.interceptDelete !== false,
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  canCapture(file) {
    return Boolean(file && typeof file.path === 'string' &&
      (file instanceof TFile || file instanceof TFolder) && !isTrashedPath(file.path) &&
      validOriginalPath(file.path));
  }

  // Obsidian exposes deletion methods but no official pre-delete event.
  // Wrapping these methods catches normal UI deletion in current builds.
  // Deliberately DO NOT wrap vault.delete(): sync engines call it when applying
  // remote deletions; intercepting it would resurrect files across devices.
  installTrashHooks() {
    this.hooks = [];
    const wrap = (owner, key) => {
      if (!owner || typeof owner[key] !== 'function') return;
      const previous = owner[key];
      const plugin = this;
      const wrapped = async function (file, ...args) {
        if (plugin.unloading || !plugin.settings.interceptDelete || !plugin.canCapture(file)) {
          return previous.call(this, file, ...args);
        }
        try {
          await plugin.trashItem(file);
        } catch (error) {
          new Notice('Synced Trash did not delete the file: ' + errorText(error));
          throw error; // Safer than silently falling back to permanent deletion.
        }
      };
      try {
        owner[key] = wrapped;
        if (owner[key] === wrapped) this.hooks.push({ owner, key, previous, wrapped });
      } catch (error) {
        console.warn('Synced Trash: could not wrap ' + key, error);
      }
    };
    wrap(this.app.fileManager, 'trashFile');
    wrap(this.app.vault, 'trash');
  }

  restoreTrashHooks() {
    for (const hook of (this.hooks || []).reverse()) {
      if (hook.owner[hook.key] === hook.wrapped) hook.owner[hook.key] = hook.previous;
    }
    this.hooks = [];
  }

  async openTrashView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view && typeof leaf.view.refresh === 'function') await leaf.view.refresh();
  }

  refreshOpenViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view && typeof leaf.view.refresh === 'function') void leaf.view.refresh();
    }
  }

  async ensureFolder(path) {
    if (!path) return;
    const parts = path.split('/');
    let cursor = '';
    for (const part of parts) {
      cursor = cursor ? cursor + '/' + part : part;
      if (!(await this.app.vault.adapter.exists(cursor))) {
        await this.app.vault.createFolder(cursor);
      }
    }
  }

  async trashItem(file) {
    if (this.emptyingTrash) throw new Error('Trash is being emptied. Try again shortly.');
    if (!this.canCapture(file)) throw new Error('This item cannot be moved to Synced Trash.');
    const originalPath = file.path;
    const storedName = file.name === METADATA_FILE ? 'payload-' + file.name : file.name;
    await this.ensureFolder(TRASH_FOLDER);
    let id;
    do { id = makeId(); } while (await this.app.vault.adapter.exists(TRASH_FOLDER + '/' + id));
    const entryFolder = TRASH_FOLDER + '/' + id;
    const metadataPath = entryFolder + '/' + METADATA_FILE;
    await this.app.vault.createFolder(entryFolder);
    const metadata = { version: 1, id, originalPath, storedName, deletedAt: Date.now() };
    let moved = false;
    try {
      await this.app.vault.adapter.write(metadataPath, JSON.stringify(metadata, null, 2));
      // Do not use FileManager.renameFile: it would rewrite links in other notes.
      await this.app.vault.rename(file, entryFolder + '/' + storedName);
      moved = true;
    } finally {
      if (!moved) {
        // The original file stays at its original path if the move failed.
        try { if (await this.app.vault.adapter.exists(metadataPath)) await this.app.vault.adapter.remove(metadataPath); } catch (_) {}
        try { await this.app.vault.adapter.rmdir(entryFolder, false); } catch (_) {}
      }
    }
    this.refreshOpenViews();
    return metadata;
  }

  // Obsidian's native .trash is hidden from Vault.getFiles() on desktop and
  // iOS. Read it through DataAdapter, which supports hidden vault paths.
  async listLegacyTrashItems() {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(LEGACY_TRASH_FOLDER))) return [];
    const listing = await adapter.list(LEGACY_TRASH_FOLDER);
    const paths = [...listing.files, ...listing.folders];
    return paths.filter(path => {
      const name = path.slice(LEGACY_TRASH_FOLDER.length + 1);
      return path.startsWith(LEGACY_TRASH_FOLDER + '/') &&
        Boolean(name) && !name.includes('/') && !name.includes('\\');
    }).sort();
  }

  async containsRemotelySaveExcludedNames(path) {
    const adapter = this.app.vault.adapter;
    const name = path.split('/').pop();
    if (name.startsWith('.') || name.startsWith('_')) return true;
    const stat = await adapter.stat(path);
    if (!stat) throw new Error('Cannot inspect ' + path);
    if (stat.type !== 'folder') return false;
    const listing = await adapter.list(path);
    for (const child of [...listing.files, ...listing.folders]) {
      if (await this.containsRemotelySaveExcludedNames(child)) return true;
    }
    return false;
  }

  async importLegacyItem(sourcePath) {
    const adapter = this.app.vault.adapter;
    const sourceName = sourcePath.slice(LEGACY_TRASH_FOLDER.length + 1);
    if (!sourcePath.startsWith(LEGACY_TRASH_FOLDER + '/') || !sourceName ||
        sourceName.includes('/') || sourceName.includes('\\') ||
        !(await adapter.exists(sourcePath))) throw new Error('Invalid or missing legacy trash item.');
    if (await this.containsRemotelySaveExcludedNames(sourcePath)) {
      throw new Error('Contains a hidden/underscored name that Remotely Save may not sync.');
    }

    await this.ensureFolder(TRASH_FOLDER);
    let id;
    do { id = makeId(); } while (await adapter.exists(TRASH_FOLDER + '/' + id));
    const entryFolder = TRASH_FOLDER + '/' + id;
    // A payload named entry.json must not replace its own metadata file.
    const storedName = sourceName === METADATA_FILE ? 'payload-' + sourceName : sourceName;
    const metadataPath = entryFolder + '/' + METADATA_FILE;
    const destination = entryFolder + '/' + storedName;
    await this.app.vault.createFolder(entryFolder);
    const importedAt = Date.now();
    const metadata = {
      version: 1,
      id,
      originalPath: LEGACY_RESTORE_FOLDER + '/' + sourceName,
      storedName,
      deletedAt: importedAt, // Obsidian's native .trash has no deletion date.
      importedAt,
      importedFrom: sourcePath,
    };
    let verifiedMoved = false;
    try {
      await adapter.write(metadataPath, JSON.stringify(metadata, null, 2));
      // rename() handles both files and whole folders. It is a move on the
      // same vault filesystem, not a copy followed by a destructive delete.
      await adapter.rename(sourcePath, destination);
      if (!(await adapter.exists(destination))) {
        throw new Error('Moved item could not be verified at its destination.');
      }
      verifiedMoved = true;
      return metadata;
    } finally {
      if (!verifiedMoved && await adapter.exists(sourcePath)) {
        // If the source is still present, undo the incomplete metadata entry.
        // If it vanished, KEEP metadata in case the move actually succeeded.
        try { if (await adapter.exists(metadataPath)) await adapter.remove(metadataPath); } catch (_) {}
        try { await adapter.rmdir(entryFolder, false); } catch (_) {}
      }
    }
  }

  async importLegacyTrash() {
    if (this.emptyingTrash) throw new Error('Trash is being emptied. Import later.');
    if (this.importingLegacyTrash) throw new Error('An import is already running.');
    this.importingLegacyTrash = true;
    let moved = 0;
    let failed = 0;
    try {
      const items = await this.listLegacyTrashItems();
      for (const sourcePath of items) {
        try {
          await this.importLegacyItem(sourcePath);
          moved++;
        } catch (error) {
          failed++;
          console.error('Synced Trash: could not import ' + sourcePath, error);
        }
      }
      return { moved, failed, remaining: (await this.listLegacyTrashItems()).length };
    } finally {
      this.importingLegacyTrash = false;
      this.refreshOpenViews();
    }
  }

  async listEntries() {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(TRASH_FOLDER))) return [];
    const listing = await adapter.list(TRASH_FOLDER);
    const possible = await Promise.all(listing.folders.map(async folder => {
      const id = folder.slice(TRASH_FOLDER.length + 1);
      if (!id || id.includes('/')) return null;
      const metadataPath = folder + '/' + METADATA_FILE;
      try {
        if (!(await adapter.exists(metadataPath))) return null;
        const data = JSON.parse(await adapter.read(metadataPath));
        if (!data || data.version !== 1 || data.id !== id ||
            !validOriginalPath(data.originalPath) ||
            typeof data.storedName !== 'string' || !data.storedName ||
            data.storedName.includes('/') || data.storedName.includes('\\') ||
            data.storedName === '.' || data.storedName === '..' ||
            !Number.isFinite(data.deletedAt) || data.deletedAt <= 0) return null;
        const storedPath = folder + '/' + data.storedName;
        return {
          ...data, entryFolder: folder, metadataPath, storedPath,
          available: await adapter.exists(storedPath),
        };
      } catch (error) {
        console.warn('Synced Trash: ignored unreadable entry ' + id, error);
        return null;
      }
    }));
    return possible.filter(Boolean).sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async withEntryLock(id, operation) {
    if (this.emptyingTrash) throw new Error('Trash is being emptied. Try again when it finishes.');
    if (this.lockedIds.has(id)) throw new Error('This item is already being processed.');
    this.lockedIds.add(id);
    try { return await operation(); }
    finally { this.lockedIds.delete(id); }
  }

  isManagedEntryFolder(path) {
    const prefix = TRASH_FOLDER + '/';
    return typeof path === 'string' && path.startsWith(prefix) &&
      MANAGED_FOLDER_ID.test(path.slice(prefix.length));
  }

  async listTrashContents() {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(TRASH_FOLDER))) return { files: [], folders: [] };
    return adapter.list(TRASH_FOLDER);
  }

  async removeEmptyManagedFolder(folderPath) {
    if (!this.isManagedEntryFolder(folderPath)) return false;
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(folderPath))) return false;
    const contents = await adapter.list(folderPath);
    // Never recursively remove a folder with files, unknown metadata, or
    // nested folders. They may still be downloading from another device.
    if (contents.files.length || contents.folders.length) return false;

    // Vault.delete updates Obsidian's file tree, unlike adapter.rmdir.
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      try { await this.app.vault.delete(folder, false); }
      catch (error) { console.warn('Synced Trash: Vault could not remove empty folder', error); }
    }
    // Fallback for folders created via Adapter or not indexed on mobile.
    if (await adapter.exists(folderPath)) {
      const recheck = await adapter.list(folderPath);
      if (recheck.files.length || recheck.folders.length) return false;
      await adapter.rmdir(folderPath, false);
    }
    return !(await adapter.exists(folderPath));
  }

  async removeEntryMetadata(entry) {
    const adapter = this.app.vault.adapter;
    if (await adapter.exists(entry.metadataPath)) {
      const metadataFile = this.app.vault.getAbstractFileByPath(entry.metadataPath);
      if (metadataFile instanceof TFile) await this.app.vault.delete(metadataFile, false);
      else await adapter.remove(entry.metadataPath);
    }
    try { await this.removeEmptyManagedFolder(entry.entryFolder); }
    catch (error) { console.warn('Synced Trash: empty entry folder will be retried on cleanup', error); }
  }

  async restoreEntry(entry) {
    return this.withEntryLock(entry.id, async () => {
      const item = this.app.vault.getAbstractFileByPath(entry.storedPath);
      if (!item && !(await this.app.vault.adapter.exists(entry.storedPath))) {
        throw new Error('The trashed item is not yet available locally. Sync again.');
      }
      if (!validOriginalPath(entry.originalPath)) throw new Error('Invalid original path.');
      const parentPath = entry.originalPath.split('/').slice(0, -1).join('/');
      await this.ensureFolder(parentPath);
      let destination = entry.originalPath;
      if (await this.app.vault.adapter.exists(destination)) {
        // Never overwrite a newer note or attachment when restoring.
        const name = entry.originalPath.split('/').pop();
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const suffix = dot > 0 ? name.slice(dot) : '';
        let counter = 1;
        do {
          destination = normalizePath((parentPath ? parentPath + '/' : '') +
            stem + ' (restored' + (counter > 1 ? ' ' + counter : '') + ')' + suffix);
          counter++;
        } while (await this.app.vault.adapter.exists(destination));
      }
      // An item imported from hidden .trash may not yet be indexed by Vault,
      // particularly on mobile. DataAdapter can still move the real file.
      if (item) await this.app.vault.rename(item, destination);
      else await this.app.vault.adapter.rename(entry.storedPath, destination);
      await this.removeEntryMetadata(entry);
      this.refreshOpenViews();
      return destination;
    });
  }

  async purgeEntry(entry) {
    return this.withEntryLock(entry.id, async () => {
      const item = this.app.vault.getAbstractFileByPath(entry.storedPath);
      const adapter = this.app.vault.adapter;
      if (!item && !(await adapter.exists(entry.storedPath))) {
        throw new Error('File not yet synced; refusing to erase its recovery information.');
      }
      if (item) {
        await this.app.vault.delete(item, true); // Intentionally bypass trash hooks.
      } else {
        const stat = await adapter.stat(entry.storedPath);
        if (!stat) throw new Error('Cannot inspect the trash item.');
        if (stat.type === 'folder') await adapter.rmdir(entry.storedPath, true);
        else await adapter.remove(entry.storedPath);
      }
      await this.removeEntryMetadata(entry);
      this.refreshOpenViews();
    });
  }

  async emptyTrash() {
    if (this.emptyingTrash) throw new Error('Trash is already being emptied.');
    if (this.importingLegacyTrash) throw new Error('Wait until import from .trash finishes.');
    if (this.lockedIds.size) throw new Error('Wait for the current restore/delete operation to finish.');
    this.emptyingTrash = true;
    const adapter = this.app.vault.adapter;
    let deleted = 0;
    let failed = 0;
    try {
      const contents = await this.listTrashContents();
      for (const path of [...contents.files, ...contents.folders]) {
        // The listing should contain only direct children. Validate every
        // path before recursive deletion; never touch Trash itself or a peer.
        const prefix = TRASH_FOLDER + '/';
        const name = typeof path === 'string' && path.startsWith(prefix)
          ? path.slice(prefix.length) : '';
        if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
          failed++;
          console.error('Synced Trash: refused unsafe empty-trash path', path);
          continue;
        }
        try {
          const item = this.app.vault.getAbstractFileByPath(path);
          if (item) {
            try { await this.app.vault.delete(item, true); }
            catch (error) {
              // The index can be stale after a sync. Verify the disk state
              // and fall back to DataAdapter only for this validated child.
              console.warn('Synced Trash: Vault deletion failed, checking adapter', error);
            }
          }
          if (await adapter.exists(path)) {
            // Also handle hidden/unindexed files left over from old versions.
            const stat = await adapter.stat(path);
            if (!stat) throw new Error('Cannot inspect remaining item.');
            if (stat.type === 'folder') await adapter.rmdir(path, true);
            else await adapter.remove(path);
          }
          if (await adapter.exists(path)) throw new Error('Item still exists after deletion.');
          deleted++;
        } catch (error) {
          failed++;
          console.error('Synced Trash: failed to remove ' + path, error);
        }
      }
      const remaining = await this.listTrashContents();
      return { deleted, failed, remaining: remaining.files.length + remaining.folders.length };
    } finally {
      this.emptyingTrash = false;
      this.refreshOpenViews();
    }
  }

  async cleanupExpired() {
    const days = this.settings.retentionDays;
    if (![30, 60, 90].includes(days)) return;
    try {
      const now = Date.now();
      const entries = await this.listEntries();
      for (const entry of entries) {
        if (!entry.available || entry.deletedAt > now ||
            now - entry.deletedAt < days * 24 * 60 * 60 * 1000 ||
            this.lockedIds.has(entry.id)) continue;
        try { await this.purgeEntry(entry); }
        catch (error) { console.error('Synced Trash: automatic cleanup failed', error); }
      }
    } catch (error) {
      console.error('Synced Trash: could not scan entries for cleanup', error);
    }
  }
}

module.exports = SyncedTrashPlugin;
