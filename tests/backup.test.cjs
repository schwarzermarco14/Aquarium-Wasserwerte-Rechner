const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(`${__dirname}/../index.html`, 'utf8');
const source = html.slice(html.indexOf('const BACKUP_APP_ID'), html.indexOf('// --- End backup ---'));

function app(options = {}) {
  const alerts = [], confirms = [], storage = {};
  let reloaded = false;
  const context = vm.createContext({
    alert: message => alerts.push(message),
    confirm: message => { confirms.push(message); return options.confirm !== false; },
    localStorage: { setItem: (k, v) => { storage[k] = v; } },
    location: { reload: () => { reloaded = true; } },
    navigator: options.navigator || {},
    currentLang: 'de',
    translations: {
      de: {
        msg_restore_confirm: 'Sicherung vom {date} einspielen?',
        msg_restore_invalid: 'ungültig',
        msg_restore_done: 'fertig'
      }
    },
    console
  });
  vm.runInContext(source, context);
  return { context, alerts, confirms, storage, wasReloaded: () => reloaded };
}

const tanks = { 'Becken A': { inputs: { volumen: '60', bodenArt_sand: true }, diary: { '2026-11-01': 'WW' } } };
const fileOf = text => ({ text: async () => text });

test('a built backup round-trips through parseBackup', () => {
  const { context } = app();
  const backup = context.buildBackup(tanks, 'de', new Date('2026-11-22T10:00:00Z'));
  const parsed = context.parseBackup(JSON.stringify(backup));
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.tanks)), tanks);
  assert.equal(parsed.exportedAt, '2026-11-22T10:00:00.000Z');
});

test('parseBackup rejects foreign or broken files', () => {
  const { context } = app();
  for (const text of [
    'kein json',
    '{}',
    JSON.stringify({ app: 'other', version: 1, tanks }),
    JSON.stringify({ app: 'aquadiagnose', version: 99, tanks }),
    JSON.stringify({ app: 'aquadiagnose', version: 1, tanks: {} }),
    JSON.stringify({ app: 'aquadiagnose', version: 1, tanks: [] }),
    JSON.stringify({ app: 'aquadiagnose', version: 1, tanks: { A: 'x' } })
  ]) {
    assert.equal(context.parseBackup(text), null, text);
  }
});

test('importBackup replaces stored data and reloads after confirmation', async () => {
  const a = app();
  const backup = a.context.buildBackup(tanks, 'en', new Date('2026-11-22T10:00:00Z'));
  await a.context.importBackup(fileOf(JSON.stringify(backup)));
  assert.deepEqual(JSON.parse(a.storage.awr_all_tanks), tanks);
  assert.equal(a.storage.awr_lang, 'en');
  assert.match(a.confirms[0], /22\.11\.2026/);
  assert.deepEqual(a.alerts, ['fertig']);
  assert.ok(a.wasReloaded());
});

test('importBackup keeps data when the user cancels', async () => {
  const a = app({ confirm: false });
  const backup = a.context.buildBackup(tanks, 'de', new Date());
  await a.context.importBackup(fileOf(JSON.stringify(backup)));
  assert.deepEqual(a.storage, {});
  assert.ok(!a.wasReloaded());
});

test('importBackup reports an invalid file without touching data', async () => {
  const a = app();
  await a.context.importBackup(fileOf('{"foo":1}'));
  assert.deepEqual(a.alerts, ['ungültig']);
  assert.deepEqual(a.storage, {});
});

test('requestPersistentStorage asks only when not yet persisted', async () => {
  let asked = 0;
  const storageApi = persisted => ({ storage: { persisted: async () => persisted, persist: async () => { asked++; return true; } } });
  await app({ navigator: storageApi(false) }).context.requestPersistentStorage();
  await app({ navigator: storageApi(true) }).context.requestPersistentStorage();
  await app({ navigator: {} }).context.requestPersistentStorage();
  assert.equal(asked, 1);
});
