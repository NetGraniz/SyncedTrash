const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class MockFile {
  constructor(pathname) {
    this.path = pathname;
    this.name = pathname.split('/').pop();
  }
}

class MockFolder extends MockFile {}
class MockPlugin {}
class MockView {}
class MockModal {}
class MockSettings {}
class MockSettingTab {}
class MockNotice {}

const code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const moduleRef = { exports: {} };
vm.runInNewContext(code, {
  module: moduleRef,
  console,
  window: { setInterval },
  require(name) {
    assert.equal(name, 'obsidian');
    return {
      ItemView: MockView, Modal: MockModal, Notice: MockNotice,
      Plugin: MockPlugin, PluginSettingTab: MockSettingTab, Setting: MockSettings,
      TFile: MockFile, TFolder: MockFolder,
      normalizePath: pathname => pathname.replace(/\/+/g, '/'),
    };
  },
}, { filename: 'main.js' });
const SyncedTrashPlugin = moduleRef.exports;

function makeVault() {
  const files = new Map();
  const folders = new Map();
  const sidecars = new Map();

  const adapter = {
    async exists(p) { return p === '' || files.has(p) || folders.has(p) || sidecars.has(p); },
    async stat(p) {
      if (folders.has(p)) return { type: 'folder' };
      if (files.has(p) || sidecars.has(p)) return { type: 'file' };
      return null;
    },
    async write(p, data) { sidecars.set(p, data); },
    async read(p) {
      if (!sidecars.has(p)) throw new Error('Metadata not found');
      return sidecars.get(p);
    },
    async remove(p) { sidecars.delete(p); files.delete(p); },
    async rename(source, target) {
      const item = files.get(source) || folders.get(source);
      if (!item) throw new Error('Missing source for adapter rename');
      await vault.rename(item, target);
    },
    async rmdir(p, recursive = false) {
      const prefix = p + '/';
      if (!recursive && [...files.keys(), ...folders.keys(), ...sidecars.keys()].some(k => k.startsWith(prefix))) {
        throw new Error('Folder not empty');
      }
      if (recursive) {
        for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k);
        for (const k of [...folders.keys()]) if (k.startsWith(prefix)) folders.delete(k);
        for (const k of [...sidecars.keys()]) if (k.startsWith(prefix)) sidecars.delete(k);
      }
      folders.delete(p);
    },
    async list(p) {
      const prefix = p + '/';
      return {
        folders: [...folders.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')),
        files: [...files.keys(), ...sidecars.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')),
      };
    },
  };

  const vault = {
    adapter,
    async createFolder(p) {
      const parent = p.split('/').slice(0, -1).join('/');
      if (parent && !folders.has(parent)) throw new Error('Missing parent');
      if (await adapter.exists(p)) throw new Error('Already exists');
      const folder = new MockFolder(p);
      folders.set(p, folder);
      return folder;
    },
    async rename(item, target) {
      if (await adapter.exists(target)) throw new Error('Destination already exists');
      const original = item.path;
      if (files.has(original)) {
        files.delete(original);
        files.set(target, item);
      } else if (folders.has(original)) {
        for (const [p, obj] of [...folders]) {
          if (p === original || p.startsWith(original + '/')) {
            folders.delete(p);
            const renamed = target + p.slice(original.length);
            obj.path = renamed;
            obj.name = renamed.split('/').pop();
            folders.set(renamed, obj);
          }
        }
        for (const [p, obj] of [...files]) {
          if (p.startsWith(original + '/')) {
            files.delete(p);
            const renamed = target + p.slice(original.length);
            obj.path = renamed;
            obj.name = renamed.split('/').pop();
            files.set(renamed, obj);
          }
        }
      } else {
        throw new Error('Source not found');
      }
      item.path = target;
      item.name = target.split('/').pop();
    },
    async delete(item) {
      if (files.has(item.path)) files.delete(item.path);
      else if (folders.has(item.path)) {
        const prefix = item.path + '/';
        for (const p of [...files.keys()]) if (p.startsWith(prefix)) files.delete(p);
        for (const p of [...folders.keys()]) if (p === item.path || p.startsWith(prefix)) folders.delete(p);
        for (const p of [...sidecars.keys()]) if (p.startsWith(prefix)) sidecars.delete(p);
      }
    },
    async trash(item) { files.delete(item.path); },
    getAbstractFileByPath(p) { return files.get(p) || folders.get(p) || null; },
  };

  function addFile(p) {
    const obj = new MockFile(p);
    files.set(p, obj);
    return obj;
  }
  function addFolder(p) {
    const obj = new MockFolder(p);
    folders.set(p, obj);
    return obj;
  }

  return { adapter, vault, files, folders, sidecars, addFile, addFolder };
}

function setup() {
  const fs = makeVault();
  const plugin = new SyncedTrashPlugin();
  let nativeTrashCalls = 0;
  const fileManager = {
    async trashFile(item) {
      nativeTrashCalls++;
      return fs.vault.trash(item, false);
    },
  };
  plugin.app = {
    vault: fs.vault,
    fileManager,
    workspace: { getLeavesOfType: () => [] },
  };
  plugin.settings = { retentionDays: 0, interceptDelete: true };
  plugin.lockedIds = new Set();
  return { fs, plugin, fileManager, getNativeCalls: () => nativeTrashCalls };
}

test('standard file deletion gets intercepted and is recoverable', async () => {
  const { fs, plugin, fileManager, getNativeCalls } = setup();
  fs.addFolder('Notes');
  const file = fs.addFile('Notes/Example.md');
  plugin.installTrashHooks();
  await fileManager.trashFile(file);
  assert.equal(getNativeCalls(), 0);
  assert.equal(await fs.adapter.exists('Notes/Example.md'), false);
  const entries = await plugin.listEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].originalPath, 'Notes/Example.md');
  assert.equal(entries[0].available, true);
  const restored = await plugin.restoreEntry(entries[0]);
  assert.equal(restored, 'Notes/Example.md');
  assert.equal(await fs.adapter.exists(restored), true);
  assert.equal((await plugin.listEntries()).length, 0);
  plugin.restoreTrashHooks();
  assert.notEqual(fileManager.trashFile, undefined);
});

test('restoration never overwrites an existing file', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('Notes');
  const file = fs.addFile('Notes/Example.md');
  await plugin.trashItem(file);
  fs.addFile('Notes/Example.md');
  const [entry] = await plugin.listEntries();
  const path = await plugin.restoreEntry(entry);
  assert.equal(path, 'Notes/Example (restored).md');
  assert.equal(fs.files.has('Notes/Example.md'), true);
  assert.equal(fs.files.has(path), true);
});

test('folder deletion and restoration preserve nested items', async () => {
  const { fs, plugin } = setup();
  const folder = fs.addFolder('Projects');
  fs.addFile('Projects/Checklist.md');
  await plugin.trashItem(folder);
  const [entry] = await plugin.listEntries();
  assert.equal(await fs.adapter.exists(entry.storedPath + '/Checklist.md'), true);
  assert.equal(await plugin.restoreEntry(entry), 'Projects');
  assert.equal(fs.files.has('Projects/Checklist.md'), true);
});

test('auto cleanup respects disabled/30-day retention and skips pending entries', async () => {
  const { fs, plugin } = setup();
  const oldFile = fs.addFile('Old.md');
  await plugin.trashItem(oldFile);
  const [oldEntry] = await plugin.listEntries();
  const meta = JSON.parse(await fs.adapter.read(oldEntry.metadataPath));
  meta.deletedAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
  await fs.adapter.write(oldEntry.metadataPath, JSON.stringify(meta));
  const recentFile = fs.addFile('Recent.md');
  await plugin.trashItem(recentFile);
  await plugin.cleanupExpired();
  assert.equal((await plugin.listEntries()).length, 2, 'Disabled by default');
  plugin.settings.retentionDays = 30;
  await plugin.cleanupExpired();
  const remaining = await plugin.listEntries();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].originalPath, 'Recent.md');
});

test('an entry awaiting remote download can have its recovery metadata removed explicitly', async () => {
  const { fs, plugin } = setup();
  const file = fs.addFile('Example.md');
  await plugin.trashItem(file);
  const [entry] = await plugin.listEntries();
  fs.files.delete(entry.storedPath); // Simulate metadata syncing before payload.
  await plugin.purgeEntry(entry);
  assert.equal(await fs.adapter.exists(entry.metadataPath), false);
  assert.equal((await plugin.listEntries()).length, 0);
});

test('trash hook leaves existing trash content to native handling', async () => {
  const { fs, plugin, fileManager, getNativeCalls } = setup();
  fs.addFolder('Trash');
  const file = fs.addFile('Trash/Unmanaged.md');
  plugin.installTrashHooks();
  await fileManager.trashFile(file);
  assert.equal(getNativeCalls(), 1);
  assert.equal((await plugin.listEntries()).length, 0);
  plugin.restoreTrashHooks();
});

test('direct Vault.trash also redirects to the shared folder', async () => {
  const { fs, plugin } = setup();
  const file = fs.addFile('Direct.md');
  plugin.installTrashHooks();
  await fs.vault.trash(file, false);
  assert.equal((await plugin.listEntries())[0].originalPath, 'Direct.md');
  plugin.restoreTrashHooks();
});

test('retention dropdown thresholds 60 and 90 days are honored', async () => {
  const { fs, plugin } = setup();
  const file = fs.addFile('Old.md');
  await plugin.trashItem(file);
  const [entry] = await plugin.listEntries();
  const meta = JSON.parse(await fs.adapter.read(entry.metadataPath));
  meta.deletedAt = Date.now() - 75 * 24 * 60 * 60 * 1000;
  await fs.adapter.write(entry.metadataPath, JSON.stringify(meta));
  plugin.settings.retentionDays = 90;
  await plugin.cleanupExpired();
  assert.equal((await plugin.listEntries()).length, 1);
  plugin.settings.retentionDays = 60;
  await plugin.cleanupExpired();
  assert.equal((await plugin.listEntries()).length, 0);
});

test('legacy .trash migration moves a note and restores it to recovered folder', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('.trash');
  fs.addFile('.trash/Old note.md');
  assert.equal((await plugin.listLegacyTrashItems())[0], '.trash/Old note.md');
  const result = await plugin.importLegacyTrash();
  assert.equal(result.moved, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.remaining, 0);
  assert.equal(await fs.adapter.exists('.trash/Old note.md'), false);
  const [entry] = await plugin.listEntries();
  assert.equal(entry.importedFrom, '.trash/Old note.md');
  assert.equal(entry.originalPath, 'Recovered from Trash/Old note.md');
  assert.equal(entry.available, true);
  assert.equal(await plugin.restoreEntry(entry), 'Recovered from Trash/Old note.md');
  assert.equal(await fs.adapter.exists('Recovered from Trash/Old note.md'), true);
});

test('legacy .trash migration supports folders and nested contents', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('.trash');
  fs.addFolder('.trash/Old project');
  fs.addFile('.trash/Old project/Note.md');
  const result = await plugin.importLegacyTrash();
  assert.equal(result.moved, 1);
  const [entry] = await plugin.listEntries();
  assert.equal(await fs.adapter.exists(entry.storedPath + '/Note.md'), true);
  assert.equal(await plugin.restoreEntry(entry), 'Recovered from Trash/Old project');
  assert.equal(await fs.adapter.exists('Recovered from Trash/Old project/Note.md'), true);
});

test('failed legacy moves remain in .trash, successful ones move', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('.trash');
  fs.addFile('.trash/Fail.md');
  fs.addFile('.trash/Good.md');
  const realRename = fs.adapter.rename;
  fs.adapter.rename = async (source, target) => {
    if (source === '.trash/Fail.md') throw new Error('Simulated filesystem error');
    return realRename(source, target);
  };
  const result = await plugin.importLegacyTrash();
  assert.equal(result.moved, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.remaining, 1);
  assert.equal(await fs.adapter.exists('.trash/Fail.md'), true);
  assert.equal(await fs.adapter.exists('.trash/Good.md'), false);
  assert.equal((await plugin.listEntries()).length, 1);
});

test('hidden/underscored files are left unsynced in old .trash', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('.trash');
  fs.addFile('.trash/_private.md');
  const result = await plugin.importLegacyTrash();
  assert.equal(result.moved, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.remaining, 1);
  assert.equal(await fs.adapter.exists('.trash/_private.md'), true);
});

test('importing an item named entry.json does not overwrite its own metadata', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('.trash');
  fs.addFile('.trash/entry.json');
  const result = await plugin.importLegacyTrash();
  assert.equal(result.moved, 1);
  const [entry] = await plugin.listEntries();
  assert.equal(entry.storedName, 'payload-entry.json');
  assert.equal(entry.originalPath, 'Recovered from Trash/entry.json');
  assert.equal(await fs.adapter.exists(entry.metadataPath), true);
  assert.equal(await fs.adapter.exists(entry.storedPath), true);
});

test('already empty or absent legacy trash needs no migration', async () => {
  const { plugin } = setup();
  const result = await plugin.importLegacyTrash();
  assert.equal(result.moved, 0);
  assert.equal(result.remaining, 0);
});

test('restoring a migrated but not yet indexed file uses the adapter', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('.trash');
  fs.addFile('.trash/Mobile note.md');
  await plugin.importLegacyTrash();
  const [entry] = await plugin.listEntries();
  fs.vault.getAbstractFileByPath = () => null; // Simulates a delayed Obsidian index.
  assert.equal(await plugin.restoreEntry(entry), 'Recovered from Trash/Mobile note.md');
  assert.equal(await fs.adapter.exists('Recovered from Trash/Mobile note.md'), true);
});

test('permanent removal of a non-indexed imported file still works', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('.trash');
  fs.addFile('.trash/Unindexed.txt');
  await plugin.importLegacyTrash();
  const [entry] = await plugin.listEntries();
  fs.vault.getAbstractFileByPath = () => null;
  await plugin.purgeEntry(entry);
  assert.equal((await plugin.listEntries()).length, 0);
  assert.equal(await fs.adapter.exists(entry.storedPath), false);
});

test('permanently deleting a note also removes its now-empty managed folder', async () => {
  const { fs, plugin } = setup();
  const file = fs.addFile('Gone.md');
  await plugin.trashItem(file);
  const [entry] = await plugin.listEntries();
  await plugin.purgeEntry(entry);
  assert.equal(await fs.adapter.exists(entry.entryFolder), false);
});

test('empty trash also removes old empty generated folders', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('Trash');
  const leftover = 'Trash/mw8xgb7t-z3vzteqlz';
  fs.addFolder(leftover);
  const result = await plugin.emptyTrash();
  assert.equal(result.deleted, 1);
  assert.equal(result.remaining, 0);
  assert.equal(await fs.adapter.exists(leftover), false);
});

test('empty trash removes all nested content including untracked folders', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('Trash');
  fs.addFolder('Trash/Keep my folder');
  const nonEmpty = 'Trash/mw8xgb8a-itsh0qlwa0';
  fs.addFolder(nonEmpty);
  fs.addFile(nonEmpty + '/important.md');
  const pending = 'Trash/mw8xgb9r-h1473l1gx7';
  fs.addFolder(pending);
  await fs.adapter.write(pending + '/entry.json', '{}');
  fs.addFile('Do not delete.md');
  const result = await plugin.emptyTrash();
  assert.equal(result.deleted, 3);
  assert.equal(result.remaining, 0);
  assert.equal(await fs.adapter.exists('Trash/Keep my folder'), false);
  assert.equal(await fs.adapter.exists(nonEmpty + '/important.md'), false);
  assert.equal(await fs.adapter.exists(pending + '/entry.json'), false);
  assert.equal(await fs.adapter.exists('Do not delete.md'), true);
  assert.equal(await fs.adapter.exists('Trash'), true);
});

test('empty trash permanently removes a synced entry and its metadata', async () => {
  const { fs, plugin } = setup();
  const file = fs.addFile('Note.md');
  await plugin.trashItem(file);
  const [entry] = await plugin.listEntries();
  const result = await plugin.emptyTrash();
  assert.equal(result.deleted, 1);
  assert.equal(result.remaining, 0);
  assert.equal(await fs.adapter.exists(entry.storedPath), false);
  assert.equal(await fs.adapter.exists(entry.metadataPath), false);
  assert.equal(await fs.adapter.exists(entry.entryFolder), false);
});

test('adapter fallback removes folders when Vault.delete fails', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('Trash');
  fs.addFolder('Trash/mw8xgb7t-z3vzteqlz');
  fs.addFile('Trash/mw8xgb7t-z3vzteqlz/stale.md');
  fs.vault.delete = async () => { throw new Error('Simulated stale Vault index'); };
  const result = await plugin.emptyTrash();
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.remaining, 0);
});

test('empty trash reports failures without deleting outside the Trash root', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('Trash');
  const broken = 'Trash/mw8xgb7t-z3vzteqlz';
  fs.addFolder(broken);
  fs.addFile('Other note.md');
  fs.vault.delete = async () => { throw new Error('Simulated deletion error'); };
  fs.adapter.rmdir = async () => { throw new Error('Simulated filesystem failure'); };
  const result = await plugin.emptyTrash();
  assert.equal(result.failed, 1);
  assert.equal(result.remaining, 1);
  assert.equal(await fs.adapter.exists(broken), true);
  assert.equal(await fs.adapter.exists('Other note.md'), true);
});

test('empty trash rejects suspicious paths returned by an adapter listing', async () => {
  const { fs, plugin } = setup();
  fs.addFolder('Trash');
  fs.addFile('Outside.md');
  const list = fs.adapter.list;
  fs.adapter.list = async p => p === 'Trash'
    ? { files: ['Outside.md', 'Trash/../Outside.md'], folders: [] }
    : list(p);
  const result = await plugin.emptyTrash();
  assert.equal(result.deleted, 0);
  assert.equal(result.failed, 2);
  assert.equal(await fs.adapter.exists('Outside.md'), true);
});
