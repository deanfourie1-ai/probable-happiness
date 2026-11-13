/**
 * Game Night: Apps Script wrapper.
 * Loads the Sheet tabs into tables, runs the rules in Core.js, writes back what changed, sends mail.
 * Paste this as Code.gs in the Apps Script project bound to the Game Night Sheet (see docs/SETUP.md).
 *
 * @OnlyCurrentDoc
 */

// Health check: open the web-app URL in a browser and you should see {"ok":true,...}.
function doGet() {
  return json_({ ok: true, app: 'game-night' });
}

// Every browser call arrives here as a text/plain POST holding JSON: { action, ... }.
function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.' });
  }
  return withLock_(function () {
    try {
      var db = loadDb_();
      var out = GN.handle(db, req, ctx_());
      saveDb_(db, out.changed);
      sendMail_(out.mail);
      return json_({ ok: true, result: out.result });
    } catch (err) {
      if (!err.userFacing) console.error(err && err.stack ? err.stack : err);
      return json_({ ok: false, error: err.userFacing ? err.message : 'Something went wrong on the server.' });
    }
  });
}

// Time trigger (every 15 minutes): send any due "game night tonight" reminders.
function reminderSweep() {
  withLock_(function () {
    var db = loadDb_();
    var out = GN.handle(db, { action: 'runReminders' }, ctx_(), { internal: true });
    saveDb_(db, out.changed);
    sendMail_(out.mail);
  });
}

// Time trigger (daily): drop rows older than 60 days.
function dailyHousekeep() {
  withLock_(function () {
    var db = loadDb_();
    var out = GN.handle(db, { action: 'housekeep' }, ctx_(), { internal: true });
    saveDb_(db, out.changed);
  });
}

/**
 * Run this ONCE from the editor (select "setup" and press Run).
 * It creates the tabs and (re)creates the two triggers. Safe to run again.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(GN.TABLES).forEach(function (name) { sheet_(ss, name); });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'reminderSweep' || fn === 'dailyHousekeep') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reminderSweep').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('dailyHousekeep').timeBased().everyDays(1).atHour(4).create();
  var first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  console.log('Game Night is set up. Mail quota left today: ' + MailApp.getRemainingDailyQuota());
}

// ---------- internals ----------

function ctx_() {
  return {
    now: new Date(),
    newId: function () { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); },
    localParts: function (date, tz) {
      var s;
      try { s = Utilities.formatDate(date, tz || 'UTC', 'yyyy-MM-dd HH:mm'); }
      catch (e) { s = Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd HH:mm'); }
      var hm = s.slice(11).split(':');
      return { date: s.slice(0, 10), minutes: (+hm[0]) * 60 + (+hm[1]) };
    },
    appUrl: PropertiesService.getScriptProperties().getProperty('APP_URL') || ''
  };
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ ok: false, error: 'The server is busy. Try again in a moment.' });
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var cols = GN.TABLES[name];
    sh.getRange(1, 1, 1, cols.length).setNumberFormat('@').setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function loadDb_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var db = {};
  Object.keys(GN.TABLES).forEach(function (name) {
    var cols = GN.TABLES[name];
    var sh = sheet_(ss, name);
    var last = sh.getLastRow();
    var rows = last > 1 ? sh.getRange(2, 1, last - 1, cols.length).getValues() : [];
    db[name] = rows.filter(function (r) { return r.join('') !== ''; }).map(function (r) {
      var o = {};
      cols.forEach(function (c, i) {
        var v = r[i];
        // Cells are written as plain text, but a hand edit can turn them into dates/times/booleans.
        if (v instanceof Date) v = Utilities.formatDate(v, tz, c === 'reminderTime' ? 'HH:mm' : (c === 'date' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss'Z'"));
        else if (typeof v === 'boolean') v = v ? '1' : '0';
        o[c] = v === null || v === undefined ? '' : String(v);
      });
      return o;
    });
  });
  return db;
}

function saveDb_(db, changed) {
  if (!changed || !changed.length) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  changed.filter(function (n, i, a) { return a.indexOf(n) === i; }).forEach(function (name) {
    var cols = GN.TABLES[name];
    var sh = sheet_(ss, name);
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
    var rows = db[name].map(function (o) { return cols.map(function (c) { return o[c] === undefined ? '' : String(o[c]); }); });
    if (rows.length) sh.getRange(2, 1, rows.length, cols.length).setNumberFormat('@').setValues(rows);
  });
}

function sendMail_(mail) {
  (mail || []).forEach(function (m) {
    try {
      var opts = { to: m.to, subject: m.subject, htmlBody: m.html, name: 'Game Night' };
      if (m.replyTo) opts.replyTo = m.replyTo;
      MailApp.sendEmail(opts);
    } catch (err) {
      console.error('Mail to ' + m.to + ' failed: ' + err);
    }
  });
}
