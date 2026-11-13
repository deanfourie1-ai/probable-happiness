// Run: node tests/appsscript.test.js
// Runs apps-script/Code.js against in-memory fakes of the Apps Script services.
// This proves the Sheet round-trip and request flow; it is NOT a substitute for a real deployment.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeSheet(name) {
  const cells = []; // rows of values
  return {
    name, cells,
    getLastRow: () => { let n = cells.length; while (n > 0 && cells[n - 1].every((v) => v === '')) n--; return n; },
    getRange(r, c, nr, nc) {
      return {
        setNumberFormat() { return this; },
        setFontWeight() { return this; },
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((cells[r - 1 + i] || [])[c - 1 + j]) ?? ''); out.push(row); }
          return out;
        },
        setValues(vals) {
          vals.forEach((row, i) => { cells[r - 1 + i] = cells[r - 1 + i] || []; row.forEach((v, j) => { cells[r - 1 + i][c - 1 + j] = v; }); });
          return this;
        },
        clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (cells[r - 1 + i]) cells[r - 1 + i][c - 1 + j] = ''; return this; }
      };
    },
    setFrozenRows() {}
  };
}

const sheets = [fakeSheet('Sheet1')];
const sent = [];
const triggers = [];
const props = { APP_URL: 'https://example.github.io/game-night/' };
let clock = new Date('2026-11-13T09:00:00Z');

const ss = {
  getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
  insertSheet: (n) => { const s = fakeSheet(n); sheets.push(s); return s; },
  getSheets: () => sheets,
  deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
  getSpreadsheetTimeZone: () => 'Etc/UTC'
};

function formatDate(date, tz, pattern) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return pattern.replace("'T'", 'T').replace("'Z'", 'Z').replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
    .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
}

let uuid = 0;
const DateShim = class extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.getTime()); } };
const sandbox = {
  console,
  Date: DateShim,
  JSON,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  Utilities: { formatDate, getUuid: () => String(++uuid).padStart(8, '0') + '-aaaa-bbbb' },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
  MailApp: { sendEmail: (o) => sent.push(o), getRemainingDailyQuota: () => 100 },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) },
  ScriptApp: {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: (fn) => {
      const b = { timeBased: () => b, everyMinutes: () => b, everyDays: () => b, atHour: () => b,
        create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } };
      return b;
    }
  }
};
vm.createContext(sandbox);
for (const f of ['Core.js', 'Code.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), sandbox, { filename: f });

const post = (req) => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(req) } }).body);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); }
}

console.log('apps script wrapper (fakes)');

test('setup creates all tabs with headers, removes Sheet1, and creates two triggers', () => {
  sandbox.setup();
  sandbox.setup(); // idempotent
  const names = sheets.map((s) => s.name).sort();
  assert.deepStrictEqual(names, ['Availability', 'Groups', 'Log', 'Members', 'Nights', 'Users']);
  assert.deepStrictEqual(ss.getSheetByName('Users').cells[0], ['id', 'name', 'email', 'tz', 'reminderTime', 'remindersOn', 'style', 'createdAt']);
  assert.deepStrictEqual(triggers.map((t) => t.getHandlerFunction()).sort(), ['dailyHousekeep', 'reminderSweep']);
});

test('doGet health check', () => {
  assert.deepStrictEqual(JSON.parse(sandbox.doGet().body), { ok: true, app: 'game-night' });
});

let dean, sam, group;
test('full flow through doPost persists to the sheet tabs', () => {
  dean = post({ action: 'register', name: 'Dean', email: 'dean@example.com', tz: 'Pacific/Auckland' }).result.user;
  sam = post({ action: 'register', name: 'Sam', email: 'sam@example.com', tz: 'Europe/London' }).result.user;
  group = post({ action: 'createGroup', userId: dean.id, tag: 'Helldivers' }).result.group;
  assert.ok(post({ action: 'joinGroup', userId: sam.id, groupId: group.id }).ok);
  for (const u of [dean, sam]) assert.ok(post({ action: 'setAvailability', userId: u.id, groupId: group.id, date: '2026-11-19', free: true }).ok);
  assert.ok(post({ action: 'flagNight', userId: dean.id, groupId: group.id, date: '2026-11-19' }).ok);
  assert.ok(post({ action: 'confirmNight', userId: sam.id, groupId: group.id, date: '2026-11-19' }).ok);
  const nights = ss.getSheetByName('Nights').cells;
  assert.strictEqual(nights.length, 2);
  assert.strictEqual(nights[1][2], 'confirmed');
  assert.strictEqual(ss.getSheetByName('Availability').getLastRow(), 3);
});

test('state survives a reload from the sheet (nothing kept in memory between calls)', () => {
  const st = post({ action: 'getState', userId: sam.id }).result;
  assert.strictEqual(st.groups[0].tag, 'Helldivers');
  assert.strictEqual(st.groups[0].nights['2026-11-19'].status, 'confirmed');
  assert.deepStrictEqual(st.groups[0].members.map((m) => m.name), ['Dean', 'Sam']);
});

test('shrinking a table leaves no stale rows behind', () => {
  assert.ok(post({ action: 'setAvailability', userId: sam.id, groupId: group.id, date: '2026-11-19', free: false }).ok);
  assert.strictEqual(ss.getSheetByName('Availability').getLastRow(), 2);
  assert.strictEqual(ss.getSheetByName('Nights').getLastRow(), 1, 'night should be gone');
});

test('a hand-edited Date cell is read back as text', () => {
  const sh = ss.getSheetByName('Availability');
  sh.cells[2] = [group.id, new sandbox.Date('2026-11-21T00:00:00Z'), sam.id]; // same realm as the script, like real Sheets
  const st = post({ action: 'getState', userId: sam.id }).result;
  assert.deepStrictEqual(st.groups[0].avail['2026-11-21'], [sam.id]);
});

test('poke sends mail with sender name, reply-to and a link to the app', () => {
  sent.length = 0;
  const r = post({ action: 'poke', userId: dean.id, groupId: group.id, date: '2026-11-19', to: [sam.id], note: 'keen?' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].name, 'Game Night');
  assert.strictEqual(sent[0].replyTo, 'dean@example.com');
  assert.ok(sent[0].htmlBody.includes('https://example.github.io/game-night/?group='));
});

test('errors come back as { ok:false, error } and trigger-only actions are refused', () => {
  assert.deepStrictEqual(post({ action: 'runReminders' }), { ok: false, error: 'Unknown action.' });
  assert.strictEqual(post({ action: 'setAvailability', userId: 'nope' }).ok, false);
  assert.deepStrictEqual(JSON.parse(sandbox.doPost({ postData: { contents: '{not json' } }).body), { ok: false, error: 'Bad request.' });
});

test('reminderSweep sends at the person\'s local time and logs it', () => {
  post({ action: 'setAvailability', userId: sam.id, groupId: group.id, date: '2026-11-19', free: true });
  post({ action: 'flagNight', userId: sam.id, groupId: group.id, date: '2026-11-19' });
  post({ action: 'confirmNight', userId: dean.id, groupId: group.id, date: '2026-11-19' });
  sent.length = 0;
  clock = new Date('2026-11-19T04:05:00Z'); // 17:05 in Auckland
  sandbox.reminderSweep();
  sandbox.reminderSweep();
  assert.deepStrictEqual(sent.map((m) => m.to), ['dean@example.com']);
  assert.ok(ss.getSheetByName('Log').cells.some((r) => r[1] === 'reminder'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
