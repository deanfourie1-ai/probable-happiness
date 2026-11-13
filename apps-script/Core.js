/*
 * Core rules (the app ships as Game Night; wording is in Words.js).
 *
 * Pure functions over in-memory tables. The same file runs in three places:
 *   - Google Apps Script (Code.js loads the Sheet into tables and calls GN.handle)
 *   - the browser in demo mode (tables live in localStorage)
 *   - Node tests (loaded with vm)
 * Keep it free of any platform API: everything platform-specific comes in through `ctx`.
 *
 * ctx = {
 *   now:        Date,
 *   newId:      () => string,
 *   localParts: (date, tz) => { date: 'YYYY-MM-DD', minutes: number }   // wall clock in tz
 *   appUrl:     string                                                   // for links in emails
 * }
 *
 * Every action returns { result, changed: [tableNames], mail: [{ to, subject, html, replyTo }] }.
 */
var GN = (function () {
  var TABLES = {
    Users: ['id', 'name', 'email', 'tz', 'reminderTime', 'remindersOn', 'style', 'createdAt'],
    Groups: ['id', 'tag', 'createdBy', 'createdAt'],
    Members: ['groupId', 'userId', 'joinedAt'],
    Availability: ['groupId', 'date', 'userId'],
    Nights: ['groupId', 'date', 'status', 'by', 'confirmedBy', 'updatedAt'],
    Log: ['at', 'kind', 'groupId', 'date', 'userId', 'detail']
  };
  var STYLES = ['modern', 'adventure', 'arcade'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Wording lives in Words.js. Looked up on each use: in Apps Script, files load in the order they
  // appear in the editor, so GN_WORDS may not exist yet when this file first runs.
  function W() {
    if (typeof GN_WORDS !== 'undefined') return GN_WORDS;
    if (typeof require === 'function') return require('./Words.js');
    throw new Error('Words.js is missing. Add it next to Core.js (see docs/SETUP.md).');
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function fail(msg) { var e = new Error(msg); e.userFacing = true; throw e; }

  function emptyDb() {
    var db = {};
    Object.keys(TABLES).forEach(function (t) { db[t] = []; });
    return db;
  }

  // ---------- small helpers ----------
  function str(v) { return v === undefined || v === null ? '' : String(v).trim(); }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function isTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
  function on(v) { return v === true || v === '1' || v === 'true' || v === 'TRUE'; }
  function iso(ctx) { return ctx.now.toISOString(); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function dayLabel(date, long) {
    var p = date.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return (long ? DOW_LONG : DOW)[d.getUTCDay()] + ' ' + (+p[2]) + ' ' + MON[+p[1] - 1];
  }

  function userById(db, id) {
    for (var i = 0; i < db.Users.length; i++) if (db.Users[i].id === id) return db.Users[i];
    return null;
  }
  function groupById(db, id) {
    for (var i = 0; i < db.Groups.length; i++) if (db.Groups[i].id === id) return db.Groups[i];
    return null;
  }
  function memberIds(db, groupId) {
    return db.Members.filter(function (m) { return m.groupId === groupId; }).map(function (m) { return m.userId; });
  }
  function isMember(db, groupId, userId) { return memberIds(db, groupId).indexOf(userId) !== -1; }
  function freeIds(db, groupId, date) {
    return db.Availability.filter(function (a) { return a.groupId === groupId && a.date === date; })
      .map(function (a) { return a.userId; });
  }
  function isGreen(db, groupId, date) {
    var members = memberIds(db, groupId), free = freeIds(db, groupId, date);
    return members.length > 0 && members.every(function (id) { return free.indexOf(id) !== -1; });
  }
  function nightAt(db, groupId, date) {
    for (var i = 0; i < db.Nights.length; i++) {
      var n = db.Nights[i];
      if (n.groupId === groupId && n.date === date) return n;
    }
    return null;
  }
  function confirmedList(n) { return str(n.confirmedBy) ? str(n.confirmedBy).split(',') : []; }

  function requireUser(db, id) {
    var u = userById(db, str(id));
    if (!u) fail('Unknown person. Please join again.');
    return u;
  }
  function requireMember(db, groupId, userId) {
    var g = groupById(db, str(groupId));
    if (!g) fail('That group does not exist.');
    if (!isMember(db, g.id, userId)) fail('You are not in that group.');
    return g;
  }
  function todayFor(user, ctx) { return ctx.localParts(ctx.now, user.tz || 'UTC').date; }
  function requireFutureDate(date, user, ctx) {
    if (!isDate(date)) fail('Bad date.');
    if (date < todayFor(user, ctx)) fail('That day is in the past.');
  }

  /*
   * Bring every night in a group back in line with the rules:
   *  - a night only exists on a green day (unmarking removes it);
   *  - a night whose proposer left is removed;
   *  - a proposed night becomes confirmed once every member other than the proposer confirmed.
   */
  function reconcile(db, groupId, ctx) {
    var members = memberIds(db, groupId);
    db.Nights = db.Nights.filter(function (n) {
      if (n.groupId !== groupId) return true;
      if (members.indexOf(n.by) === -1) return false;
      if (!isGreen(db, groupId, n.date)) return false;
      var confirmed = confirmedList(n).filter(function (id) { return members.indexOf(id) !== -1; });
      n.confirmedBy = confirmed.join(',');
      var allIn = members.every(function (id) { return id === n.by || confirmed.indexOf(id) !== -1; });
      if (allIn && n.status !== 'confirmed') { n.status = 'confirmed'; n.updatedAt = iso(ctx); }
      return true;
    });
  }

  function publicUser(u) {
    return { id: u.id, name: u.name, email: u.email, tz: u.tz, reminderTime: u.reminderTime,
      remindersOn: on(u.remindersOn), style: u.style || 'modern' };
  }

  // ---------- email ----------
  function emailShell(title, bodyHtml, buttonLabel, url) {
    return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1A2030">' +
      '<h1 style="font-size:24px;margin:0 0 16px">' + escapeHtml(title) + '</h1>' + bodyHtml +
      '<p style="margin:24px 0"><a href="' + escapeHtml(url) + '" style="background:#3B4FCC;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">' +
      escapeHtml(buttonLabel) + '</a></p>' +
      '<p style="font-size:12px;color:#5A6478">Sent by ' + escapeHtml(W().appName) + '. Change reminders in Settings.</p></div>';
  }
  function link(ctx, groupId, date) {
    var base = str(ctx.appUrl) || '';
    return base + (base.indexOf('?') === -1 ? '?' : '&') + 'group=' + encodeURIComponent(groupId) + (date ? '&date=' + date : '');
  }

  // ---------- actions ----------
  var actions = {};

  actions.register = function (db, req, ctx) {
    var name = str(req.name), email = str(req.email).toLowerCase(), tz = str(req.tz) || 'UTC';
    if (!name) fail('Please enter your name.');
    if (name.length > 40) fail('That name is a bit long (40 characters max).');
    if (!isEmail(email)) fail('Please enter a valid email address.');
    var existing = db.Users.filter(function (u) { return u.email === email; })[0];
    if (existing) return { result: { user: publicUser(existing), existing: true }, changed: [] };
    var u = { id: ctx.newId(), name: name, email: email, tz: tz, reminderTime: '17:00', remindersOn: '1',
      style: 'modern', createdAt: iso(ctx) };
    db.Users.push(u);
    return { result: { user: publicUser(u), existing: false }, changed: ['Users'] };
  };

  actions.updateMe = function (db, req, ctx) {
    var u = requireUser(db, req.userId);
    if (req.name !== undefined) {
      var name = str(req.name);
      if (!name || name.length > 40) fail('Please enter a name (40 characters max).');
      u.name = name;
    }
    if (req.email !== undefined) {
      var email = str(req.email).toLowerCase();
      if (!isEmail(email)) fail('Please enter a valid email address.');
      if (db.Users.some(function (x) { return x.email === email && x.id !== u.id; })) fail('Someone already uses that email.');
      u.email = email;
    }
    if (req.tz !== undefined) u.tz = str(req.tz) || 'UTC';
    if (req.reminderTime !== undefined) {
      if (!isTime(str(req.reminderTime))) fail('Reminder time must look like 17:00.');
      u.reminderTime = str(req.reminderTime);
    }
    if (req.remindersOn !== undefined) u.remindersOn = on(req.remindersOn) ? '1' : '0';
    if (req.style !== undefined) {
      if (STYLES.indexOf(str(req.style)) === -1) fail('Unknown style.');
      u.style = str(req.style);
    }
    return { result: { user: publicUser(u) }, changed: ['Users'] };
  };

  actions.groupInfo = function (db, req) {
    var g = groupById(db, str(req.groupId));
    if (!g) fail('That invite link does not match any group.');
    var names = memberIds(db, g.id).map(function (id) { var u = userById(db, id); return u ? u.name : '?'; });
    return { result: { id: g.id, tag: g.tag, members: names }, changed: [] };
  };

  actions.createGroup = function (db, req, ctx) {
    var u = requireUser(db, req.userId);
    var tag = str(req.tag);
    if (!tag) fail('Give the group a ' + W().groupLabel.toLowerCase() + '.');
    if (tag.length > 30) fail('Keep the tag under 30 characters.');
    var g = { id: ctx.newId(), tag: tag, createdBy: u.id, createdAt: iso(ctx) };
    db.Groups.push(g);
    db.Members.push({ groupId: g.id, userId: u.id, joinedAt: iso(ctx) });
    return { result: { group: { id: g.id, tag: g.tag } }, changed: ['Groups', 'Members'] };
  };

  actions.joinGroup = function (db, req, ctx) {
    var u = requireUser(db, req.userId);
    var g = groupById(db, str(req.groupId));
    if (!g) fail('That invite link does not match any group.');
    if (!isMember(db, g.id, u.id)) db.Members.push({ groupId: g.id, userId: u.id, joinedAt: iso(ctx) });
    return { result: { group: { id: g.id, tag: g.tag } }, changed: ['Members'] };
  };

  actions.leaveGroup = function (db, req, ctx) {
    var u = requireUser(db, req.userId);
    var g = requireMember(db, req.groupId, u.id);
    db.Members = db.Members.filter(function (m) { return !(m.groupId === g.id && m.userId === u.id); });
    db.Availability = db.Availability.filter(function (a) { return !(a.groupId === g.id && a.userId === u.id); });
    reconcile(db, g.id, ctx);
    return { result: { ok: true }, changed: ['Members', 'Availability', 'Nights'] };
  };

  actions.getState = function (db, req, ctx) {
    var u = requireUser(db, req.userId);
    var groups = db.Members.filter(function (m) { return m.userId === u.id; }).map(function (m) {
      var g = groupById(db, m.groupId);
      if (!g) return null;
      var avail = {}, nights = {};
      db.Availability.forEach(function (a) {
        if (a.groupId !== g.id) return;
        (avail[a.date] = avail[a.date] || []).push(a.userId);
      });
      db.Nights.forEach(function (n) {
        if (n.groupId !== g.id) return;
        nights[n.date] = { status: n.status, by: n.by, confirmedBy: confirmedList(n) };
      });
      return {
        id: g.id, tag: g.tag,
        // names only: emails never leave the server (the API URL is public)
        members: memberIds(db, g.id).map(function (id) {
          var x = userById(db, id);
          return { id: id, name: x ? x.name : '?' };
        }),
        avail: avail, nights: nights
      };
    }).filter(Boolean);
    return { result: { me: publicUser(u), today: todayFor(u, ctx), groups: groups }, changed: [] };
  };

  actions.setAvailability = function (db, req, ctx) {
    var u = requireUser(db, req.userId);
    var g = requireMember(db, req.groupId, u.id);
    var date = str(req.date);
    requireFutureDate(date, u, ctx);
    var free = on(req.free);
    db.Availability = db.Availability.filter(function (a) {
      return !(a.groupId === g.id && a.date === date && a.userId === u.id);
    });
    if (free) db.Availability.push({ groupId: g.id, date: date, userId: u.id });
    reconcile(db, g.id, ctx);
    return { result: { ok: true }, changed: ['Availability', 'Nights'] };
  };

  actions.flagNight = function (db, req, ctx) {
    var u = requireUser(db, req.userId);
    var g = requireMember(db, req.groupId, u.id);
    var date = str(req.date);
    requireFutureDate(date, u, ctx);
    if (!isGreen(db, g.id, date)) fail('Only a day where everyone is free can be ' + W().event + '.');
    if (nightAt(db, g.id, date)) fail('That day is already flagged.');
    db.Nights.push({ groupId: g.id, date: date, status: 'proposed', by: u.id, confirmedBy: '', updatedAt: iso(ctx) });
    reconcile(db, g.id, ctx);
    return { result: { ok: true }, changed: ['Nights'] };
  };

  actions.confirmNight = function (db, req, ctx) {
    var u = requireUser(db, req.userId);
    var g = requireMember(db, req.groupId, u.id);
    var date = str(req.date);
    var n = nightAt(db, g.id, date);
    if (!n || n.status !== 'proposed') fail('There is nothing to confirm on that day.');
    if (n.by === u.id) fail('You flagged it, so the others confirm.');
    var list = confirmedList(n);
    if (list.indexOf(u.id) === -1) list.push(u.id);
    n.confirmedBy = list.join(',');
    n.updatedAt = iso(ctx);
    reconcile(db, g.id, ctx);
    return { result: { ok: true }, changed: ['Nights'] };
  };

  actions.poke = function (db, req, ctx) {
    var u = requireUser(db, req.userId);
    var g = requireMember(db, req.groupId, u.id);
    var date = str(req.date);
    requireFutureDate(date, u, ctx);
    var free = freeIds(db, g.id, date);
    var to = (req.to || []).map(str).filter(function (id, i, a) { return a.indexOf(id) === i; });
    if (!to.length) fail('Pick who to poke.');
    var note = str(req.note).slice(0, 300);
    var mail = [];
    to.forEach(function (id) {
      if (id === u.id) fail('You cannot poke yourself.');
      if (!isMember(db, g.id, id)) fail('That person is not in the group.');
      if (free.indexOf(id) !== -1) fail('They already marked that day free.');
      var target = userById(db, id);
      var body = '<p>' + escapeHtml(u.name) + ' is free on <strong>' + escapeHtml(dayLabel(date, true)) +
        '</strong> for <strong>' + escapeHtml(g.tag) + '</strong> and wants to know if you can ' + escapeHtml(W().verb) + '.</p>' +
        (note ? '<blockquote style="margin:0;padding:12px 16px;background:#F3F5F9;border-radius:8px">' + escapeHtml(note) + '</blockquote>' : '');
      mail.push({
        to: target.email,
        replyTo: u.email,
        subject: u.name + ' wants to ' + W().verb + ' ' + dayLabel(date, false),
        html: emailShell('Can you ' + W().verb + ' ' + DOW_LONG[new Date(date + 'T12:00:00Z').getUTCDay()] + '?', body, 'Mark ' + dayLabel(date, false), link(ctx, g.id, date))
      });
      db.Log.push({ at: iso(ctx), kind: 'poke', groupId: g.id, date: date, userId: id, detail: 'from ' + u.id });
    });
    return { result: { sent: to.length }, changed: ['Log'], mail: mail };
  };

  /*
   * Reminder sweep (runs on a time trigger every 15 minutes).
   * A member gets one email per confirmed night, on the night's date in THEIR time zone,
   * once their local clock has reached their reminder time.
   */
  actions.runReminders = function (db, req, ctx) {
    var mail = [];
    db.Nights.forEach(function (n) {
      if (n.status !== 'confirmed') return;
      var g = groupById(db, n.groupId);
      if (!g) return;
      var ids = memberIds(db, g.id);
      ids.forEach(function (id) {
        var u = userById(db, id);
        if (!u || !on(u.remindersOn) || !isTime(str(u.reminderTime))) return;
        var local = ctx.localParts(ctx.now, u.tz || 'UTC');
        if (local.date !== n.date) return;
        var t = u.reminderTime.split(':');
        if (local.minutes < (+t[0]) * 60 + (+t[1])) return;
        var already = db.Log.some(function (l) {
          return l.kind === 'reminder' && l.groupId === g.id && l.date === n.date && l.userId === id;
        });
        if (already) return;
        var others = ids.filter(function (x) { return x !== id; })
          .map(function (x) { var o = userById(db, x); return o ? o.name : '?'; });
        var body = '<p style="padding:16px;background:#EAF8F1;border:1px solid #9FDDBF;border-radius:10px"><strong>' +
          escapeHtml(g.tag) + ' · ' + escapeHtml(dayLabel(n.date, true)) + '</strong><br>With ' + escapeHtml(others.join(', ') || 'your group') + '</p>';
        mail.push({ to: u.email, subject: cap(W().event) + ' ' + W().when + ': ' + g.tag,
          html: emailShell(W().reminderTitle, body, 'Open ' + W().appName, link(ctx, g.id, n.date)) });
        db.Log.push({ at: iso(ctx), kind: 'reminder', groupId: g.id, date: n.date, userId: id, detail: '' });
      });
    });
    return { result: { sent: mail.length }, changed: mail.length ? ['Log'] : [], mail: mail };
  };

  // Deletes availability, nights and log rows older than `days` (default 60).
  actions.housekeep = function (db, req, ctx) {
    var days = +req.days || 60;
    var cutoff = new Date(ctx.now.getTime() - days * 86400000).toISOString().slice(0, 10);
    db.Availability = db.Availability.filter(function (a) { return a.date >= cutoff; });
    db.Nights = db.Nights.filter(function (n) { return n.date >= cutoff; });
    db.Log = db.Log.filter(function (l) { return str(l.at).slice(0, 10) >= cutoff; });
    return { result: { ok: true }, changed: ['Availability', 'Nights', 'Log'] };
  };

  // Actions a browser may call. runReminders and housekeep are trigger-only.
  var PUBLIC = ['register', 'updateMe', 'groupInfo', 'createGroup', 'joinGroup', 'leaveGroup', 'getState',
    'setAvailability', 'flagNight', 'confirmNight', 'poke'];

  function handle(db, req, ctx, opts) {
    req = req || {};
    var name = str(req.action);
    if (!actions[name] || (!(opts && opts.internal) && PUBLIC.indexOf(name) === -1)) fail('Unknown action.');
    var out = actions[name](db, req, ctx);
    out.changed = out.changed || [];
    out.mail = out.mail || [];
    // A save can ask for the fresh state in the same round trip (Apps Script calls take ~1s each).
    if (req.withState && name !== 'getState') {
      var uid = name === 'register' ? out.result.user.id : str(req.userId);
      if (userById(db, uid)) {
        out.result = out.result || {};
        out.result.state = actions.getState(db, { userId: uid }, ctx).result;
      }
    }
    return out;
  }

  return { words: W, TABLES: TABLES, STYLES: STYLES, emptyDb: emptyDb, handle: handle, dayLabel: dayLabel, escapeHtml: escapeHtml };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GN;
