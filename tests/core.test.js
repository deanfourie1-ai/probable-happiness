// Run: node tests/core.test.js
const assert = require('assert');
const GN = require('../apps-script/Core.js');

function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour) * 60 + (+p.minute) };
}

let n = 0;
function ctxAt(isoString) {
  return { now: new Date(isoString), newId: () => 'id' + (++n), localParts, appUrl: 'https://example.test/' };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function throwsMsg(fn, re) {
  assert.throws(fn, (e) => re.test(e.message), 'expected error matching ' + re);
}

// A pair (Dean in Auckland, Sam in London) in one group, on Fri 13 Nov 2026, 09:00 UTC.
function setup() {
  n = 0;
  const db = GN.emptyDb();
  const ctx = ctxAt('2026-11-13T09:00:00Z');
  const call = (req, c) => GN.handle(db, req, c || ctx);
  const dean = call({ action: 'register', name: 'Dean', email: 'Dean@Example.com', tz: 'Pacific/Auckland' }).result.user;
  const sam = call({ action: 'register', name: 'Sam', email: 'sam@example.com', tz: 'Europe/London' }).result.user;
  const g = call({ action: 'createGroup', userId: dean.id, tag: 'Helldivers' }).result.group;
  call({ action: 'joinGroup', userId: sam.id, groupId: g.id });
  return { db, ctx, call, dean, sam, g };
}
const D = '2026-11-19';
const free = (s, who, date, f = true) => s.call({ action: 'setAvailability', userId: who.id, groupId: s.g.id, date, free: f });
const state = (s, who) => s.call({ action: 'getState', userId: who.id }).result;

console.log('core rules');

test('register normalises email and returns the existing user on repeat', () => {
  const s = setup();
  assert.strictEqual(s.dean.email, 'dean@example.com');
  const again = s.call({ action: 'register', name: 'Whoever', email: 'DEAN@example.com' }).result;
  assert.strictEqual(again.existing, true);
  assert.strictEqual(again.user.id, s.dean.id);
});

test('register rejects a bad email and an empty name', () => {
  const s = setup();
  throwsMsg(() => s.call({ action: 'register', name: 'X', email: 'nope' }), /valid email/);
  throwsMsg(() => s.call({ action: 'register', name: ' ', email: 'x@y.zz' }), /name/);
});

test('colours: green only when every member is free', () => {
  const s = setup();
  free(s, s.dean, D);
  let g = state(s, s.dean).groups[0];
  assert.deepStrictEqual(g.avail[D], [s.dean.id]);
  throwsMsg(() => s.call({ action: 'flagNight', userId: s.dean.id, groupId: s.g.id, date: D }), /everyone is free/);
  free(s, s.sam, D);
  s.call({ action: 'flagNight', userId: s.dean.id, groupId: s.g.id, date: D });
  g = state(s, s.dean).groups[0];
  assert.strictEqual(g.nights[D].status, 'proposed');
});

test('cannot flag the same day twice', () => {
  const s = setup();
  free(s, s.dean, D); free(s, s.sam, D);
  s.call({ action: 'flagNight', userId: s.dean.id, groupId: s.g.id, date: D });
  throwsMsg(() => s.call({ action: 'flagNight', userId: s.sam.id, groupId: s.g.id, date: D }), /already flagged/);
});

test('pair: the other person confirms; the proposer cannot', () => {
  const s = setup();
  free(s, s.dean, D); free(s, s.sam, D);
  s.call({ action: 'flagNight', userId: s.sam.id, groupId: s.g.id, date: D });
  throwsMsg(() => s.call({ action: 'confirmNight', userId: s.sam.id, groupId: s.g.id, date: D }), /others confirm/);
  s.call({ action: 'confirmNight', userId: s.dean.id, groupId: s.g.id, date: D });
  assert.strictEqual(state(s, s.dean).groups[0].nights[D].status, 'confirmed');
});

test('unmarking yourself removes the night on that day', () => {
  const s = setup();
  free(s, s.dean, D); free(s, s.sam, D);
  s.call({ action: 'flagNight', userId: s.dean.id, groupId: s.g.id, date: D });
  s.call({ action: 'confirmNight', userId: s.sam.id, groupId: s.g.id, date: D });
  free(s, s.sam, D, false);
  assert.strictEqual(state(s, s.dean).groups[0].nights[D], undefined);
});

test('group of three: confirmed only once both others confirm', () => {
  const s = setup();
  const jo = s.call({ action: 'register', name: 'Jo', email: 'jo@example.com', tz: 'UTC' }).result.user;
  s.call({ action: 'joinGroup', userId: jo.id, groupId: s.g.id });
  free(s, s.dean, D); free(s, s.sam, D); free(s, jo, D);
  s.call({ action: 'flagNight', userId: s.dean.id, groupId: s.g.id, date: D });
  s.call({ action: 'confirmNight', userId: s.sam.id, groupId: s.g.id, date: D });
  let night = state(s, s.dean).groups[0].nights[D];
  assert.strictEqual(night.status, 'proposed');
  assert.deepStrictEqual(night.confirmedBy, [s.sam.id]);
  s.call({ action: 'confirmNight', userId: jo.id, groupId: s.g.id, date: D });
  assert.strictEqual(state(s, s.dean).groups[0].nights[D].status, 'confirmed');
});

test('leaving: last non-confirmer leaving confirms the night; proposer leaving removes it', () => {
  const s = setup();
  const jo = s.call({ action: 'register', name: 'Jo', email: 'jo@example.com', tz: 'UTC' }).result.user;
  s.call({ action: 'joinGroup', userId: jo.id, groupId: s.g.id });
  free(s, s.dean, D); free(s, s.sam, D); free(s, jo, D);
  s.call({ action: 'flagNight', userId: s.dean.id, groupId: s.g.id, date: D });
  s.call({ action: 'confirmNight', userId: s.sam.id, groupId: s.g.id, date: D });
  s.call({ action: 'leaveGroup', userId: jo.id, groupId: s.g.id });
  assert.strictEqual(state(s, s.dean).groups[0].nights[D].status, 'confirmed');
  s.call({ action: 'leaveGroup', userId: s.dean.id, groupId: s.g.id });
  assert.strictEqual(state(s, s.sam).groups[0].nights[D], undefined);
});

test('past days cannot be changed (in the caller\'s own time zone)', () => {
  const s = setup();
  // 09:00 UTC on the 13th is already the 13th evening in Auckland, still the 13th morning in London.
  throwsMsg(() => free(s, s.dean, '2026-11-12'), /past/);
  free(s, s.sam, '2026-11-13');
});

test('non-members cannot touch a group', () => {
  const s = setup();
  const x = s.call({ action: 'register', name: 'X', email: 'x@example.com' }).result.user;
  throwsMsg(() => free(s, x, D), /not in that group/);
});

test('getState never returns other members\' emails', () => {
  const s = setup();
  const st = state(s, s.dean);
  const json = JSON.stringify(st.groups);
  assert.ok(!json.includes('sam@example.com'), 'leaked an email');
  assert.strictEqual(st.me.email, 'dean@example.com');
});

test('poke: emails only members who have not marked the day, with reply-to and escaped note', () => {
  const s = setup();
  free(s, s.dean, D);
  const out = s.call({ action: 'poke', userId: s.dean.id, groupId: s.g.id, date: D, to: [s.sam.id], note: '<b>keen?</b>' });
  assert.strictEqual(out.mail.length, 1);
  assert.strictEqual(out.mail[0].to, 'sam@example.com');
  assert.strictEqual(out.mail[0].replyTo, 'dean@example.com');
  assert.strictEqual(out.mail[0].subject, 'Dean wants to play Thu 19 Nov');
  assert.ok(out.mail[0].html.includes('&lt;b&gt;keen?&lt;/b&gt;'), 'note not escaped');
  assert.ok(out.mail[0].html.includes('group=' + s.g.id + '&amp;date=' + D), 'missing deep link');
  free(s, s.sam, D);
  throwsMsg(() => s.call({ action: 'poke', userId: s.dean.id, groupId: s.g.id, date: D, to: [s.sam.id] }), /already marked/);
  throwsMsg(() => s.call({ action: 'poke', userId: s.dean.id, groupId: s.g.id, date: D, to: [s.dean.id] }), /yourself/);
});

test('reminders: each person at their own local time, once', () => {
  const s = setup();
  free(s, s.dean, D); free(s, s.sam, D);
  s.call({ action: 'flagNight', userId: s.dean.id, groupId: s.g.id, date: D });
  s.call({ action: 'confirmNight', userId: s.sam.id, groupId: s.g.id, date: D });
  s.call({ action: 'updateMe', userId: s.sam.id, reminderTime: '15:00' });
  const run = (iso) => GN.handle(s.db, { action: 'runReminders' }, ctxAt(iso), { internal: true }).mail.map((m) => m.to);
  // Auckland is UTC+13 in November: 17:00 on the 19th there = 04:00 UTC on the 19th.
  assert.deepStrictEqual(run('2026-11-19T03:50:00Z'), []);
  assert.deepStrictEqual(run('2026-11-19T04:05:00Z'), ['dean@example.com']);
  assert.deepStrictEqual(run('2026-11-19T04:20:00Z'), [], 'sent twice');
  // London is UTC+0 in November: 15:00 there = 15:00 UTC.
  assert.deepStrictEqual(run('2026-11-19T14:45:00Z'), []);
  assert.deepStrictEqual(run('2026-11-19T15:10:00Z'), ['sam@example.com']);
  // Next day: nothing (date no longer matches anywhere).
  assert.deepStrictEqual(run('2026-11-20T16:00:00Z'), []);
});

test('reminders: none for proposed nights or when switched off', () => {
  const s = setup();
  free(s, s.dean, D); free(s, s.sam, D);
  s.call({ action: 'flagNight', userId: s.dean.id, groupId: s.g.id, date: D });
  const run = (iso) => GN.handle(s.db, { action: 'runReminders' }, ctxAt(iso), { internal: true }).mail.length;
  assert.strictEqual(run('2026-11-19T20:00:00Z'), 0);
  s.call({ action: 'confirmNight', userId: s.sam.id, groupId: s.g.id, date: D });
  s.call({ action: 'updateMe', userId: s.sam.id, remindersOn: false });
  assert.strictEqual(run('2026-11-19T20:00:00Z'), 0, 'Dean: 20:00 UTC is already the 20th in Auckland; Sam is off');
});

test('trigger-only actions are not callable from the browser', () => {
  const s = setup();
  throwsMsg(() => s.call({ action: 'runReminders' }), /Unknown action/);
  throwsMsg(() => s.call({ action: 'housekeep' }), /Unknown action/);
});

test('updateMe validates style and reminder time', () => {
  const s = setup();
  throwsMsg(() => s.call({ action: 'updateMe', userId: s.dean.id, style: 'terminal' }), /Unknown style/);
  throwsMsg(() => s.call({ action: 'updateMe', userId: s.dean.id, reminderTime: '5pm' }), /17:00/);
  const u = s.call({ action: 'updateMe', userId: s.dean.id, style: 'arcade', reminderTime: '18:30' }).result.user;
  assert.strictEqual(u.style, 'arcade');
  assert.strictEqual(u.reminderTime, '18:30');
});

test('withState returns the fresh state after a save, in one call', () => {
  const s = setup();
  const r = s.call({ action: 'setAvailability', userId: s.dean.id, groupId: s.g.id, date: D, free: true, withState: true }).result;
  assert.deepStrictEqual(r.state.groups[0].avail[D], [s.dean.id]);
  const reg = s.call({ action: 'register', name: 'Kim', email: 'kim@example.com', withState: true }).result;
  assert.strictEqual(reg.state.me.name, 'Kim');
  assert.deepStrictEqual(reg.state.groups, []);
});

test('housekeep drops rows older than 60 days', () => {
  const s = setup();
  s.db.Availability.push({ groupId: s.g.id, date: '2026-08-01', userId: s.dean.id });
  free(s, s.dean, D);
  GN.handle(s.db, { action: 'housekeep' }, s.ctx, { internal: true });
  assert.deepStrictEqual(s.db.Availability.map((a) => a.date), [D]);
});

test('wording from Words.js reaches the emails and errors (reuse for other kinds of scheduling)', () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const box = { GN_WORDS: Object.assign({}, require('../apps-script/Words.js'),
    { appName: 'Book Club', event: 'book night', verb: 'meet', when: 'today', reminderTitle: 'Book club is on today', groupLabel: 'Club name' }) };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Core.js'), 'utf8') + '\nthis.GN = GN;', box);
  const BC = box.GN;
  const db = BC.emptyDb(), ctx = ctxAt('2026-11-13T09:00:00Z');
  const call = (req, c) => BC.handle(db, req, c || ctx);
  const a = call({ action: 'register', name: 'Ana', email: 'ana@example.com', tz: 'UTC' }).result.user;
  const b = call({ action: 'register', name: 'Ben', email: 'ben@example.com', tz: 'UTC' }).result.user;
  throwsMsg(() => call({ action: 'createGroup', userId: a.id, tag: '' }), /Give the group a club name/);
  const g = call({ action: 'createGroup', userId: a.id, tag: 'Classics' }).result.group;
  call({ action: 'joinGroup', userId: b.id, groupId: g.id });
  call({ action: 'setAvailability', userId: a.id, groupId: g.id, date: D, free: true });
  throwsMsg(() => call({ action: 'flagNight', userId: a.id, groupId: g.id, date: D }), /can be book night/);
  const poke = call({ action: 'poke', userId: a.id, groupId: g.id, date: D, to: [b.id] }).mail[0];
  assert.strictEqual(poke.subject, 'Ana wants to meet Thu 19 Nov');
  assert.ok(poke.html.includes('Can you meet Thursday?') && poke.html.includes('Sent by Book Club'));
  call({ action: 'setAvailability', userId: b.id, groupId: g.id, date: D, free: true });
  call({ action: 'flagNight', userId: a.id, groupId: g.id, date: D });
  call({ action: 'confirmNight', userId: b.id, groupId: g.id, date: D });
  const sent = BC.handle(db, { action: 'runReminders' }, ctxAt(D + 'T18:00:00Z'), { internal: true }).mail;
  assert.strictEqual(sent[0].subject, 'Book night today: Classics');
  assert.ok(sent[0].html.includes('Book club is on today') && sent[0].html.includes('Open Book Club'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
