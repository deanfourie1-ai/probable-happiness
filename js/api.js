/*
 * Talks to the Apps Script web app, or, when no URL is configured, runs the very same
 * rules (apps-script/Core.js) against a database kept in localStorage ("demo mode").
 */
window.GNApi = (function () {
  var cfg = window.GN_CONFIG || {};
  var apiUrl = (cfg.apiUrl || '').trim();
  var demo = !apiUrl || /[?&]demo\b/.test(location.search);
  var DEMO_KEY = 'gn-demo-db';
  var listeners = { mail: function () {} };

  function addDays(date, n) {
    var p = date.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }

  function localParts(date, tz) {
    var f;
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } catch (e) {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    }
    var p = {};
    f.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, minutes: (+p.hour) * 60 + (+p.minute) };
  }

  function newId() {
    var a = new Uint8Array(5);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function demoCtx() {
    return { now: new Date(), newId: newId, localParts: localParts, appUrl: location.origin + location.pathname };
  }

  // ---------- demo database ----------
  function loadDemo() {
    var db = null;
    try { db = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch (e) { db = null; }
    if (!db || !db.Users) { db = seedDemo(); saveDemo(db); }
    return db;
  }
  function saveDemo(db) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) { /* private window: keep in memory only */ }
    memoryDb = db;
  }
  var memoryDb = null;

  function seedDemo() {
    var db = GN.emptyDb();
    var ctx = demoCtx();
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    function reg(name, email) { return GN.handle(db, { action: 'register', name: name, email: email, tz: tz }, ctx).result.user; }
    var sam = reg('Sam', 'sam@demo.test'), alex = reg('Alex', 'alex@demo.test'), jo = reg('Jo', 'jo@demo.test');
    var hd = GN.handle(db, { action: 'createGroup', userId: sam.id, tag: 'Helldivers' }, ctx).result.group;
    var drg = GN.handle(db, { action: 'createGroup', userId: alex.id, tag: 'Deep Rock' }, ctx).result.group;
    GN.handle(db, { action: 'joinGroup', userId: jo.id, groupId: drg.id }, ctx);
    // Some availability over the coming two weeks, relative to today.
    var today = localParts(new Date(), tz).date;
    var dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0 = Monday
    var monday = addDays(today, -dow);
    function mark(u, g, offsets) {
      offsets.forEach(function (o) {
        var d = addDays(monday, o);
        if (d >= today) db.Availability.push({ groupId: g.id, date: d, userId: u.id });
      });
    }
    mark(sam, hd, [0, 1, 3, 5, 6, 8, 10, 12]);
    mark(alex, drg, [2, 4, 5, 9, 12]);
    mark(jo, drg, [0, 2, 4, 5, 9]);
    db.demoGroups = [hd.id, drg.id];
    return db;
  }

  function callDemo(action, payload) {
    var db = memoryDb || loadDemo();
    var req = Object.assign({ action: action }, payload);
    var ctx = demoCtx();
    // Same JSON round-trip as the network, so demo mode cannot rely on shared object references.
    var out = GN.handle(db, JSON.parse(JSON.stringify(req)), ctx);
    // Demo only: a brand-new person is dropped into the sample groups so there is something to see.
    if (action === 'register' && out.result && !out.result.existing && db.demoGroups) {
      db.demoGroups.forEach(function (gid) {
        GN.handle(db, { action: 'joinGroup', userId: out.result.user.id, groupId: gid }, ctx);
      });
      if (req.withState) out.result.state = GN.handle(db, { action: 'getState', userId: out.result.user.id }, ctx).result;
    }
    saveDemo(db);
    if (out.mail.length) listeners.mail(out.mail);
    return JSON.parse(JSON.stringify(out.result));
  }

  // ---------- public ----------
  function call(action, payload) {
    if (demo) {
      return new Promise(function (resolve, reject) {
        // A short delay so the UI's busy states are exercised the same way as with the real server.
        setTimeout(function () {
          try { resolve(callDemo(action, payload || {})); } catch (e) { reject(e); }
        }, 120);
      });
    }
    return fetch(apiUrl, {
      method: 'POST',
      // text/plain keeps this a "simple" request: no CORS preflight, which Apps Script cannot answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    }).then(function (r) {
      if (!r.ok) throw new Error('The server answered ' + r.status + '.');
      return r.json();
    }, function () {
      throw new Error("Couldn't reach the server. Check your connection.");
    }).then(function (body) {
      if (!body.ok) throw new Error(body.error || 'Something went wrong.');
      return body.result;
    });
  }

  function resetDemo() {
    try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* ignore */ }
    memoryDb = null;
  }

  return {
    demo: demo,
    call: call,
    onDemoMail: function (fn) { listeners.mail = fn; },
    resetDemo: resetDemo,
    addDays: addDays,
    localParts: localParts
  };
})();
