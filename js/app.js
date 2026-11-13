/*
 * The page. Wording comes from apps-script/Words.js.
 * Plain DOM, no framework. Every user-supplied string goes in as text (textContent), never as HTML.
 */
(function () {
  var A = window.GNApi;
  var STORE_USER = 'gn-user', STORE_GROUP = 'gn-group';
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MAX_WEEKS_AHEAD = 12;
  // What's being scheduled: change these in apps-script/Words.js, not here.
  var W = window.GN_WORDS;
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Per-style words. Modern is the default; Adventure and Arcade use "pick an action, then click a day".
  var STYLES = {
    modern: {
      name: 'Modern', retro: false, brand: W.appName,
      green: 'Everyone free', some: function (n, t) { return n + ' of ' + t + ' free'; }, none: 'Nobody yet',
      ribbon: cap(W.event), you: 'You', free: 'Free', not: '—'
    },
    adventure: {
      name: 'Adventure', retro: true, brand: W.appName.toUpperCase(),
      green: 'ALL ABOARD', some: function (n, t) { return n + ' OF ' + t + ' CREW'; }, none: 'NO ONE YET',
      ribbon: W.event.toUpperCase() + '!', you: 'You', free: 'free', not: '—',
      cannot: "That won't work.", ask: function (a) { return a + ' … which day?'; }, crew: 'Crew'
    },
    arcade: {
      name: 'Arcade', retro: true, brand: W.appName.toUpperCase(),
      green: 'ALL READY', some: function (n, t) { return n + '/' + t + ' READY'; }, none: 'INSERT PLAYER',
      ribbon: '★ ' + W.event.toUpperCase() + ' ★', you: 'P1 YOU', free: 'READY', not: '...',
      cannot: 'NOPE!', ask: function (a) { return a.toUpperCase() + ' > PICK A DAY'; }, crew: 'PLAYERS'
    }
  };
  var ACTIONS = [
    { id: 'mark', label: 'Mark free' },
    { id: 'flag', label: 'Flag ' + W.eventShort },
    { id: 'confirm', label: 'Confirm' },
    { id: 'poke', label: 'Poke' }
  ];

  var S = {
    userId: null, state: null, groupId: null, offset: 0, view: 'loading',
    action: 'mark', msg: '', focusDate: null, joinInfo: null, joinGroupId: null
  };

  // ---------- tiny helpers ----------
  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
    } catch (e) { return null; }
    return null;
  }

  // h('div', { class: 'x', onclick: fn }, 'text', childNode, [more]) → element. Strings become text nodes.
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function svg(markup) {
    // Only for fixed, hard-coded icons below. Never pass user data here.
    var t = document.createElement('template');
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  }
  var ICON_PAD = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="11" rx="5"></rect><path d="M7 11v3M5.5 12.5h3"></path><circle cx="16" cy="11.5" r="0.8" fill="currentColor"></circle><circle cx="18" cy="13.5" r="0.8" fill="currentColor"></circle></svg>';
  var SUNSET = '<svg class="band-island" viewBox="0 0 320 24" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true"><rect x="0" y="20" width="320" height="4"></rect><rect x="190" y="16" width="70" height="4"></rect><rect x="200" y="13" width="48" height="3"></rect><rect x="220" y="4" width="2" height="9"></rect><rect x="214" y="3" width="14" height="2"></rect><rect x="211" y="5" width="4" height="1"></rect><rect x="227" y="5" width="4" height="1"></rect><rect x="30" y="18" width="40" height="2"></rect></svg>';

  function addDays(d, n) { return A.addDays(d, n); }
  function dowIndex(d) { return (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7; }
  function dayNum(d) { return +d.slice(8, 10); }
  function monthName(d) { return MON[+d.slice(5, 7) - 1]; }
  function dayLabel(d) { return DOW[dowIndex(d)] + ' ' + dayNum(d) + ' ' + monthName(d); }
  function rangeLabel(a, b) {
    return dayNum(a) + (monthName(a) !== monthName(b) ? ' ' + monthName(a) : '') + ' – ' + dayNum(b) + ' ' + monthName(b);
  }
  function fmtTime(t) {
    if (!t) return '';
    var p = t.split(':'), hr = +p[0];
    return ((hr + 11) % 12 + 1) + ':' + p[1] + (hr < 12 ? ' am' : ' pm');
  }
  function joinNames(list) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
  }

  function me() { return S.state && S.state.me; }
  function style() { var s = me() && me().style; return STYLES[s] ? s : 'modern'; }
  function T() { return STYLES[style()]; }
  function group() {
    if (!S.state) return null;
    var gs = S.state.groups;
    for (var i = 0; i < gs.length; i++) if (gs[i].id === S.groupId) return gs[i];
    return gs[0] || null;
  }
  function nameOf(g, id) {
    for (var i = 0; i < g.members.length; i++) if (g.members[i].id === id) return g.members[i].name;
    return '?';
  }

  // ---------- toast + busy (outside #app so re-renders never wipe them) ----------
  var toastTimer = null;
  function toast(text, kind) {
    var el = document.getElementById('toast');
    el.textContent = text;
    el.className = 'toast show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, kind === 'error' ? 6000 : 3500);
  }
  var inflight = 0;
  function busy(delta) {
    inflight += delta;
    document.getElementById('busy').hidden = inflight === 0;
  }

  // ---------- server calls ----------
  // Saves run one after another, so a fast series of clicks can't arrive out of order.
  var queue = Promise.resolve();
  function save(action, payload) {
    busy(1);
    var p = queue.then(function () {
      return A.call(action, Object.assign({ userId: S.userId, withState: true }, payload));
    });
    queue = p.catch(function () {});
    return p.then(function (res) {
      busy(-1);
      // Apply the server's view only once the queue is empty, so optimistic clicks don't flicker.
      if (res && res.state && inflight === 0) { S.state = res.state; render(); }
      return res;
    }, function (err) {
      busy(-1);
      toast(err.message, 'error');
      if (inflight === 0) refresh();
      throw err;
    });
  }
  function refresh() {
    busy(1);
    return A.call('getState', { userId: S.userId }).then(function (st) {
      busy(-1);
      S.state = st;
      render();
    }, function (err) {
      busy(-1);
      if (/Unknown person/.test(err.message)) { forget(); return; }
      toast(err.message, 'error');
    });
  }
  function forget() {
    store(STORE_USER, null);
    S.userId = null; S.state = null; S.view = 'join';
    render();
  }

  // ---------- day logic ----------
  function dayInfo(g, date) {
    var ids = g.members.map(function (m) { return m.id; });
    var free = (g.avail[date] || []).filter(function (id) { return ids.indexOf(id) !== -1; });
    var n = free.length, total = ids.length;
    var st = total > 0 && n === total ? 'green' : n > 0 ? 'some' : 'none';
    var night = g.nights[date] || null;
    var meId = S.userId;
    var notFree = ids.filter(function (id) { return free.indexOf(id) === -1 && id !== meId; });
    var waitingFor = [];
    if (night && night.status === 'proposed') {
      waitingFor = ids.filter(function (id) { return id !== night.by && night.confirmedBy.indexOf(id) === -1; });
    }
    return {
      date: date, free: free, n: n, total: total, st: st, night: night,
      meFree: free.indexOf(meId) !== -1, past: date < S.state.today, notFree: notFree, waitingFor: waitingFor,
      canFlag: st === 'green' && !night && date >= S.state.today,
      canConfirm: !!night && night.status === 'proposed' && night.by !== meId && waitingFor.indexOf(meId) !== -1
    };
  }

  function toggleFree(g, d) {
    var free = !d.meFree;
    // Optimistic: show it straight away, the server's answer replaces it when the queue drains.
    var list = (g.avail[d.date] || []).filter(function (id) { return id !== S.userId; });
    if (free) list.push(S.userId); else delete g.nights[d.date];
    g.avail[d.date] = list;
    render();
    return save('setAvailability', { groupId: g.id, date: d.date, free: free });
  }
  function flag(g, d) {
    return save('flagNight', { groupId: g.id, date: d.date }).then(function () {
      var names = g.members.filter(function (m) { return m.id !== S.userId; }).map(function (m) { return m.name; });
      return 'Flagged ' + dayLabel(d.date) + '. Waiting for ' + (joinNames(names) || 'nobody') + '.';
    });
  }
  function confirmNight(g, d) {
    return save('confirmNight', { groupId: g.id, date: d.date }).then(function (res) {
      var n = res && res.state ? findGroup(res.state, g.id).nights[d.date] : null;
      return n && n.status === 'confirmed' ? cap(W.event) + ' on ' + dayLabel(d.date) + '!' : 'Confirmed. Waiting for the others.';
    });
  }
  function findGroup(st, id) { return st.groups.filter(function (x) { return x.id === id; })[0]; }

  // ---------- views ----------
  function render() {
    document.body.dataset.style = S.state ? style() : 'modern';
    var app = document.getElementById('app');
    var view = S.view === 'join' ? viewJoin() : S.view === 'settings' ? viewSettings() : S.view === 'loading' ? viewLoading() :
      S.view === 'error' ? viewError() : viewWeek();
    app.replaceChildren(demoBanner(), view);
  }

  function viewLoading() {
    return h('main', { class: 'center' }, h('p', { class: 'muted' }, 'Loading…'));
  }

  function demoBanner() {
    if (!A.demo) return null;
    return h('div', { class: 'demo-banner', role: 'note' },
      h('strong', null, 'Demo mode'),
      ' · Nothing leaves this browser and no email is sent. Sample friends: sam@demo.test, alex@demo.test, jo@demo.test. Use Settings → Switch to play as one of them. ',
      h('button', { type: 'button', class: 'link-btn', onclick: function () {
        A.resetDemo(); forget();
      } }, 'Reset demo'));
  }

  function brand() {
    return h('div', { class: 'brand' }, svg(ICON_PAD), h('span', { class: 'brand-name' }, S.state ? T().brand : W.appName));
  }

  // --- join ---
  function viewJoin() {
    var info = S.joinInfo;
    // Typed values live in S.draft so a re-render (e.g. invite details arriving) never wipes them.
    var draft = S.draft = S.draft || { name: '', email: '' };
    var nameIn = h('input', { type: 'text', id: 'join-name', autocomplete: 'name', maxlength: '40', required: true, placeholder: 'e.g. Sam',
      value: draft.name, oninput: function () { draft.name = nameIn.value; } });
    var emailIn = h('input', { type: 'email', id: 'join-email', autocomplete: 'email', required: true, placeholder: 'you@example.com',
      value: draft.email, oninput: function () { draft.email = emailIn.value; } });
    var submit = h('button', { type: 'submit', class: 'btn primary block' }, info ? 'Join ' + info.tag : 'Continue');
    var form = h('form', { class: 'join-form', onsubmit: function (e) {
      e.preventDefault();
      submit.disabled = true;
      busy(1);
      A.call('register', { name: nameIn.value, email: emailIn.value, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', withState: true })
        .then(function (res) {
          busy(-1);
          S.draft = null;
          S.userId = res.user.id;
          store(STORE_USER, S.userId);
          S.state = res.state;
          if (res.existing) toast('Welcome back, ' + res.user.name + '.');
          S.view = 'week';
          if (S.joinGroupId) return doJoin(S.joinGroupId);
          render();
        }, function (err) {
          busy(-1);
          submit.disabled = false;
          toast(err.message, 'error');
        });
    } },
      h('label', { for: 'join-name' }, 'Name'), nameIn,
      h('label', { for: 'join-email' }, 'Email (for pokes and reminders only)'), emailIn,
      submit,
      h('p', { class: 'hint' }, 'No password, no account. This browser remembers you after this. Used it before? Enter the same email to get back in.'));

    return h('main', { class: 'join' },
      brand(),
      h('section', { class: 'card join-card' },
        info
          ? h('div', null, h('div', { class: 'eyebrow' }, "You've been invited to"), h('h1', null, info.tag),
              h('p', { class: 'muted' }, (info.members.length ? 'with ' + joinNames(info.members) + ' · ' : '') + 'mark the days you can ' + W.verb + " and see when everyone's free."))
          : h('div', null, h('h1', null, 'Who are you?'),
              h('p', { class: 'muted' }, 'Mark the days you can ' + W.verb + ", and see when everyone's free.")),
        form));
  }

  function doJoin(groupId) {
    return save('joinGroup', { groupId: groupId }).then(function (res) {
      S.groupId = groupId;
      store(STORE_GROUP, groupId);
      S.joinGroupId = null;
      S.view = 'week';
      render();
      toast('You joined ' + res.group.tag + '. Mark the days you can ' + W.verb + '.');
    }, function () { S.joinGroupId = null; render(); });
  }

  // --- week ---
  function viewWeek() {
    var g = group();
    var wrap = h('div', { class: 'page' }, header(g));
    if (!g) {
      wrap.appendChild(h('main', { class: 'container' }, emptyState()));
      return wrap;
    }
    if (T().retro) wrap.appendChild(band(g));
    if (T().retro) wrap.appendChild(actionPanel(g));
    wrap.appendChild(h('main', { class: 'container' }, weekHead(g), weeks(g), footer()));
    return wrap;
  }

  function header(g) {
    var gs = S.state.groups;
    return h('header', { class: 'topbar' },
      brand(),
      h('nav', { class: 'group-tabs', 'aria-label': 'Groups' },
        gs.map(function (x) {
          var active = g && x.id === g.id;
          return h('button', { type: 'button', class: 'tab' + (active ? ' active' : ''), 'aria-pressed': active ? 'true' : 'false', onclick: function () {
            S.groupId = x.id; store(STORE_GROUP, x.id); S.msg = ''; S.focusDate = null; render();
          } }, h('span', { class: 'tab-tag' }, x.tag), h('span', { class: 'tab-count' }, x.members.length + ' ' + (x.members.length === 1 ? W.member : W.members)));
        }),
        h('button', { type: 'button', class: 'tab tab-new', onclick: openNewGroup }, '+ New group')),
      stylePicker(),
      h('button', { type: 'button', class: 'user-chip', onclick: function () { S.view = 'settings'; render(); }, 'aria-label': 'Settings for ' + me().name },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, me().name.slice(0, 1).toUpperCase()),
        h('span', { class: 'user-text' }, h('span', { class: 'user-name' }, me().name),
          h('span', { class: 'user-sub' }, me().remindersOn ? 'Reminders ' + fmtTime(me().reminderTime) : 'Reminders off'))));
  }

  function stylePicker() {
    return h('div', { class: 'style-picker', role: 'group', 'aria-label': 'Your style' },
      h('span', { class: 'label' }, 'Style:'),
      Object.keys(STYLES).map(function (k) {
        var active = k === style();
        return h('button', { type: 'button', class: 'tab small' + (active ? ' active' : ''), 'aria-pressed': active ? 'true' : 'false', onclick: function () {
          if (active) return;
          me().style = k; S.msg = ''; render();
          save('updateMe', { style: k });
        } }, STYLES[k].name);
      }));
  }

  function band(g) {
    if (style() === 'adventure') {
      var b = h('div', { class: 'band band-adventure', 'aria-hidden': 'true' }, h('div', { class: 'band-sun' }));
      b.appendChild(svg(SUNSET));
      return b;
    }
    return h('div', { class: 'band band-arcade' }, '★ ' + g.members.length + ' ' + W.members.toUpperCase() + ' · PICK YOUR ' + W.eventShort.toUpperCase() + ' · PRESS START ★');
  }

  function actionPanel(g) {
    var t = T();
    var current = ACTIONS.filter(function (a) { return a.id === S.action; })[0];
    return h('div', { class: 'action-panel' },
      h('div', { class: 'action-main' },
        h('div', { class: 'verbs', role: 'group', 'aria-label': 'Actions' },
          ACTIONS.map(function (a) {
            var active = a.id === S.action;
            return h('button', { type: 'button', class: 'verb' + (active ? ' active' : ''), 'aria-pressed': active ? 'true' : 'false', onclick: function () {
              S.action = a.id; S.msg = ''; render();
            } }, a.label);
          })),
        h('div', { class: 'sentence', role: 'status' }, S.msg || t.ask(current.label))),
      h('div', { class: 'crew' },
        h('span', { class: 'label' }, t.crew),
        h('div', { class: 'chips' }, g.members.map(function (m) { return h('span', { class: 'chip' }, m.id === S.userId ? 'You' : m.name); })),
        h('span', { class: 'label' }, 'Pick an action, then click a day.')));
  }

  function weekHead(g) {
    var others = g.members.filter(function (m) { return m.id !== S.userId; }).map(function (m) { return m.name; });
    var start = windowStart();
    return h('div', { class: 'week-head' },
      h('div', null,
        h('div', { class: 'eyebrow' }, 'Group'),
        h('h1', { class: 'group-title' }, g.tag),
        h('p', { class: 'muted' }, (others.length ? 'You, ' + others.join(', ') : 'Just you so far. Invite friends from Settings') + (T().retro ? '' : ' · mark the days you can ' + W.verb))),
      h('div', { class: 'week-tools' },
        T().retro ? null : h('div', { class: 'legend', 'aria-label': 'Legend' },
          h('span', null, h('i', { class: 'sw green' }), 'Everyone free'),
          h('span', null, h('i', { class: 'sw some' }), 'Some free'),
          h('span', null, h('i', { class: 'sw none' }), 'Nobody yet')),
        h('div', { class: 'week-nav' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous two weeks', disabled: S.offset <= 0, onclick: function () { S.offset = Math.max(0, S.offset - 2); render(); } }, '‹'),
          h('span', { class: 'range' }, rangeLabel(start, addDays(start, 13))),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next two weeks', disabled: S.offset >= MAX_WEEKS_AHEAD, onclick: function () { S.offset += 2; render(); } }, '›'))));
  }

  function windowStart() {
    var today = S.state.today;
    return addDays(addDays(today, -dowIndex(today)), S.offset * 7);
  }

  function weeks(g) {
    var start = windowStart();
    return [0, 1].map(function (w) {
      var first = addDays(start, w * 7), last = addDays(first, 6);
      var title = S.offset + w === 0 ? 'This week · ' + rangeLabel(first, last) : S.offset + w === 1 ? 'Next week · ' + rangeLabel(first, last) : rangeLabel(first, last);
      var days = [];
      for (var i = 0; i < 7; i++) days.push(dayCell(g, dayInfo(g, addDays(first, i))));
      return h('section', { class: 'week' }, h('h2', { class: 'week-title' }, title), h('div', { class: 'days' }, days));
    });
  }

  function statusText(d) { var t = T(); return d.st === 'green' ? t.green : d.st === 'some' ? t.some(d.n, d.total) : t.none; }

  function memberList(g, d) {
    var t = T();
    return h('ul', { class: 'members' }, g.members.map(function (m, i) {
      var isMe = m.id === S.userId;
      var name = isMe ? t.you : style() === 'arcade' ? 'P' + (i + 1) + ' ' + m.name.toUpperCase() : m.name;
      var free = d.free.indexOf(m.id) !== -1;
      return h('li', null, h('span', null, name), h('span', { class: free ? 'mark on' : 'mark' }, free ? t.free : t.not));
    }));
  }

  function nightNote(g, d) {
    var n = d.night;
    if (!n) return null;
    if (n.status === 'confirmed') return me().remindersOn ? 'Confirmed · reminder at ' + fmtTime(me().reminderTime) : 'Confirmed · reminders off';
    if (n.by === S.userId) return 'You flagged this. Waiting for ' + joinNames(d.waitingFor.map(function (id) { return nameOf(g, id); })) + '.';
    if (d.canConfirm) return nameOf(g, n.by) + ' flagged ' + W.event;
    return 'You confirmed. Waiting for ' + joinNames(d.waitingFor.map(function (id) { return nameOf(g, id); })) + '.';
  }

  function dayCell(g, d) {
    var t = T();
    var cls = 'day ' + d.st + (d.past ? ' past' : '') + (d.night && d.night.status === 'confirmed' ? ' confirmed' : '') +
      (d.date === S.state.today ? ' today' : '') + (d.date === S.focusDate ? ' focus' : '');
    var top = [
      d.night && d.night.status === 'confirmed' ? h('span', { class: 'ribbon' }, t.ribbon) : null,
      h('span', { class: 'day-head' }, h('span', { class: 'dow' }, DOW[dowIndex(d.date)]),
        h('span', { class: 'date' }, t.retro ? String(dayNum(d.date)) : dayNum(d.date) + ' ' + monthName(d.date))),
      h('span', { class: 'pill' }, statusText(d)),
      memberList(g, d)
    ];
    var note = nightNote(g, d);

    if (t.retro) {
      // The whole day is one button; what it does depends on the action picked in the bar.
      var label = dayLabel(d.date) + ', ' + d.n + ' of ' + d.total + ' free' + (d.night ? ', ' + W.event + ' ' + d.night.status : '');
      return h('button', { type: 'button', class: cls, 'aria-label': label, 'data-date': d.date, disabled: d.past,
        onclick: function () { retroClick(g, d); } },
        top, note ? h('span', { class: 'note' }, note) : null);
    }

    var actions = [];
    if (!d.past) {
      actions.push(h('button', { type: 'button', class: 'btn toggle' + (d.meFree ? ' on' : ''), 'aria-pressed': d.meFree ? 'true' : 'false',
        onclick: function () { toggleFree(g, d).catch(function () {}); } }, d.meFree ? "✓ I'm free" : 'Mark me free'));
      if (d.canFlag) actions.push(h('button', { type: 'button', class: 'btn primary', onclick: function (e) {
        e.currentTarget.disabled = true;
        flag(g, d).then(function (m) { toast(m); }, function () {});
      } }, 'Flag ' + W.event));
      if (d.canConfirm) actions.push(h('button', { type: 'button', class: 'btn primary', onclick: function (e) {
        e.currentTarget.disabled = true;
        confirmNight(g, d).then(function (m) { toast(m); }, function () {});
      } }, 'Confirm'));
      if (d.meFree && d.st !== 'green' && d.notFree.length) actions.push(h('button', { type: 'button', class: 'btn poke',
        onclick: function () { openPoke(g, d); } }, 'Poke ' + joinNames(d.notFree.map(function (id) { return nameOf(g, id); }))));
    }
    return h('article', { class: cls, 'data-date': d.date, 'aria-label': dayLabel(d.date) },
      top, note ? h('span', { class: 'note' }, note) : null, h('div', { class: 'day-actions' }, actions));
  }

  function retroClick(g, d) {
    var t = T();
    var say = function (m) { S.msg = m; render(); };
    if (S.action === 'mark') {
      var was = d.meFree;
      S.msg = (was ? 'Unmarked ' : 'Marked free on ') + dayLabel(d.date) + '.';
      toggleFree(g, d).catch(function () {});
    } else if (S.action === 'flag') {
      if (!d.canFlag) return say(t.cannot + ' ' + (d.st !== 'green' ? 'Not everyone is free.' : 'Already flagged.'));
      flag(g, d).then(say, function () {});
    } else if (S.action === 'confirm') {
      if (!d.canConfirm) return say(t.cannot + ' Nothing to confirm there.');
      confirmNight(g, d).then(say, function () {});
    } else if (S.action === 'poke') {
      if (d.st === 'green' || !d.notFree.length) return say(t.cannot + ' No one to poke.');
      if (!d.meFree) return say(t.cannot + ' Mark yourself free first.');
      openPoke(g, d);
    }
  }

  function footer() {
    return h('footer', { class: 'foot' },
      h('span', null, A.demo ? 'Demo · saved in this browser only' : 'Saved · friends see your changes next time they open or refresh'),
      h('button', { type: 'button', class: 'link-btn', onclick: refresh }, 'Refresh'));
  }

  function emptyState() {
    return h('section', { class: 'card empty' },
      h('h1', null, 'No groups yet'),
      h('p', { class: 'muted' }, W.groupHint + ', then send your friends the invite link from Settings. Got an invite link from a friend? Just open it.'),
      h('button', { type: 'button', class: 'btn primary', onclick: openNewGroup }, 'Create a group'));
  }

  // --- dialogs ---
  function dialog(title, body, actions) {
    var dlg = h('dialog', { class: 'dlg', 'aria-labelledby': 'dlg-title' },
      h('form', { method: 'dialog', class: 'dlg-form' }, h('h2', { id: 'dlg-title' }, title), body, h('div', { class: 'dlg-actions' }, actions)));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    return dlg;
  }

  function openPoke(g, d) {
    var boxes = d.notFree.map(function (id) {
      return { id: id, input: h('input', { type: 'checkbox', checked: true, value: id }) };
    });
    var note = h('textarea', { rows: '3', maxlength: '300', id: 'poke-note', placeholder: W.pokeExample });
    var send = h('button', { type: 'button', class: 'btn poke-send' }, 'Send poke');
    var dlg = dialog('Poke ' + joinNames(d.notFree.map(function (id) { return nameOf(g, id); })),
      [h('p', { class: 'muted' }, 'Ask if they can ' + W.verb + ' on ', h('strong', null, dayLabel(d.date)), ". They'll get an email with a link straight to that day."),
        boxes.length > 1 ? h('fieldset', { class: 'who' }, h('legend', null, 'Who'),
          boxes.map(function (b) { return h('label', { class: 'check' }, b.input, nameOf(g, b.id)); })) : null,
        h('label', { for: 'poke-note' }, 'Add a note (optional)'), note],
      [h('button', { type: 'submit', class: 'btn ghost', value: 'cancel' }, 'Cancel'), send]);
    send.addEventListener('click', function () {
      var to = boxes.filter(function (b) { return b.input.checked; }).map(function (b) { return b.id; });
      if (!to.length) { toast('Pick who to poke.', 'error'); return; }
      send.disabled = true;
      save('poke', { groupId: g.id, date: d.date, to: to, note: note.value }).then(function () {
        dlg.close();
        var m = 'Poke sent to ' + joinNames(to.map(function (id) { return nameOf(g, id); })) + '.';
        if (T().retro) { S.msg = m; render(); } else toast(m);
      }, function () { send.disabled = false; });
    });
  }

  function openNewGroup() {
    var tag = h('input', { type: 'text', id: 'new-tag', maxlength: '30', placeholder: 'e.g. ' + W.groupExample, required: true });
    var create = h('button', { type: 'button', class: 'btn primary' }, 'Create group');
    var dlg = dialog('New group', [
      h('label', { for: 'new-tag' }, W.groupLabel), tag,
      h('p', { class: 'muted small' }, "You'll get an invite link to send your friends, in Settings.")
    ], [h('button', { type: 'submit', class: 'btn ghost', value: 'cancel' }, 'Cancel'), create]);
    function go() {
      create.disabled = true;
      save('createGroup', { tag: tag.value }).then(function (res) {
        dlg.close();
        S.groupId = res.group.id; store(STORE_GROUP, res.group.id); S.view = 'week'; S.offset = 0;
        render();
        toast('Created ' + res.group.tag + '. Copy the invite link in Settings.');
      }, function () { create.disabled = false; });
    }
    create.addEventListener('click', go);
    tag.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  function showOutbox(mail) {
    var list = mail.map(function (m) {
      var frame = h('iframe', { class: 'mail-frame', sandbox: '', title: 'Email preview: ' + m.subject });
      frame.srcdoc = m.html; // generated by Core.js with all user text escaped; sandboxed regardless
      return h('div', { class: 'mail' },
        h('div', { class: 'mail-meta' }, h('div', null, h('strong', null, 'To: '), m.to), h('div', null, h('strong', null, 'Subject: '), m.subject)),
        frame);
    });
    dialog('Demo: this email would be sent', list, [h('button', { type: 'submit', class: 'btn primary' }, 'OK')]);
  }

  // --- settings ---
  function viewSettings() {
    var u = me();
    var nameIn = h('input', { type: 'text', id: 's-name', value: u.name, maxlength: '40' });
    var emailIn = h('input', { type: 'email', id: 's-email', value: u.email });
    var zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).slice();
    if (zones.indexOf(u.tz) === -1) zones.unshift(u.tz);
    var tzIn = h('select', { id: 's-tz' }, zones.map(function (z) { return h('option', { value: z, selected: z === u.tz }, z.replace(/_/g, ' ')); }));
    var remOn = h('input', { type: 'checkbox', id: 's-rem', checked: u.remindersOn });
    var remTime = h('input', { type: 'time', id: 's-time', value: u.reminderTime, step: '900' });
    var chosen = style();
    var styleCards = Object.keys(STYLES).map(function (k) {
      var input = h('input', { type: 'radio', name: 'style', value: k, checked: k === chosen, onchange: function () { chosen = k; } });
      return h('label', { class: 'style-card style-' + k }, h('span', { class: 'style-swatch', 'aria-hidden': 'true' }), h('span', { class: 'style-name' }, input, STYLES[k].name),
        h('span', { class: 'muted small' }, k === 'modern' ? 'Default' : k === 'adventure' ? 'Point & click' : '16-bit'));
    });
    var saveBtn = h('button', { type: 'submit', class: 'btn primary block' }, 'Save changes');
    var profile = h('form', { class: 'card stack', onsubmit: function (e) {
      e.preventDefault();
      saveBtn.disabled = true;
      save('updateMe', { name: nameIn.value, email: emailIn.value, tz: tzIn.value, remindersOn: remOn.checked, reminderTime: remTime.value, style: chosen })
        .then(function () { toast('Saved.'); }, function () { saveBtn.disabled = false; });
    } },
      h('div', null, h('h2', null, 'You'), h('p', { class: 'muted' }, 'No password. This is just who you are to your friends.')),
      h('label', { for: 's-name' }, 'Name'), nameIn,
      h('label', { for: 's-email' }, 'Email for pokes and reminders'), emailIn,
      h('label', { for: 's-tz' }, 'Time zone'), tzIn,
      h('p', { class: 'muted small' }, 'Your reminder fires at your local time, wherever your friends are.'),
      h('fieldset', { class: 'section' }, h('legend', null, 'Your style'),
        h('p', { class: 'muted small' }, 'Only changes how the app looks for you. Friends keep their own.'),
        h('div', { class: 'style-cards' }, styleCards)),
      h('fieldset', { class: 'section' }, h('legend', null, cap(W.event) + ' reminder'),
        h('label', { class: 'check' }, remOn, 'Email me on the day of a confirmed ' + W.event),
        h('label', { class: 'inline', for: 's-time' }, 'Send it at', remTime)),
      h('div', { class: 'section row' },
        h('div', null, h('div', { class: 'strong' }, 'This browser'), h('div', { class: 'muted small' }, 'Remembers you as ' + u.name)),
        h('button', { type: 'button', class: 'btn ghost', onclick: function () {
          store(STORE_GROUP, null); forget();
        } }, 'Not ' + u.name + '? Switch')),
      saveBtn);

    var groups = h('section', { class: 'card stack' }, h('h2', null, 'Your groups'),
      S.state.groups.length ? S.state.groups.map(function (g) {
        return h('div', { class: 'group-row' },
          h('div', null, h('div', { class: 'strong' }, g.tag), h('div', { class: 'muted small' }, g.members.map(function (m) { return m.id === S.userId ? 'You' : m.name; }).join(', '))),
          h('div', { class: 'row-actions' },
            h('button', { type: 'button', class: 'btn ghost', onclick: function () { copyInvite(g); } }, 'Copy invite link'),
            h('button', { type: 'button', class: 'btn ghost', onclick: function () {
              if (!window.confirm('Leave ' + g.tag + '? Your marked days in this group are removed.')) return;
              save('leaveGroup', { groupId: g.id }).then(function () { toast('You left ' + g.tag + '.'); });
            } }, 'Leave')));
      }) : h('p', { class: 'muted' }, 'None yet.'),
      h('button', { type: 'button', class: 'btn outline', onclick: openNewGroup }, '+ New group'));

    return h('div', { class: 'page' },
      h('header', { class: 'topbar' },
        h('button', { type: 'button', class: 'btn ghost', onclick: function () { S.view = 'week'; render(); } }, '‹ Back to calendar'),
        h('span', { class: 'brand-name' }, 'Settings')),
      h('main', { class: 'container settings' }, profile, groups));
  }

  function inviteUrl(g) {
    var keepDemo = /[?&]demo\b/.test(location.search) ? 'demo&' : '';
    return location.origin + location.pathname + '?' + keepDemo + 'join=' + encodeURIComponent(g.id);
  }
  function copyInvite(g) {
    var url = inviteUrl(g);
    var done = function () { toast('Invite link for ' + g.tag + ' copied. Send it to your friends.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this invite link:', url); });
    } else window.prompt('Copy this invite link:', url);
  }

  // ---------- boot ----------
  function boot() {
    document.title = W.appName;
    A.onDemoMail(showOutbox);
    var params = new URLSearchParams(location.search);
    var join = params.get('join'), gid = params.get('group'), date = params.get('date');
    // Keep the address bar clean once the link has done its job.
    if (join || gid) history.replaceState(null, '', location.pathname + (params.has('demo') ? '?demo' : ''));
    if (gid) { S.groupId = gid; store(STORE_GROUP, gid); }
    else S.groupId = store(STORE_GROUP);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) S.focusDate = date;

    S.userId = store(STORE_USER);
    if (!S.userId) {
      S.view = 'join';
      if (join) {
        S.joinGroupId = join;
        A.call('groupInfo', { groupId: join }).then(function (info) { S.joinInfo = info; render(); },
          function (err) { S.joinGroupId = null; toast(err.message, 'error'); });
      }
      render();
      return;
    }
    S.view = 'loading';
    render();
    A.call('getState', { userId: S.userId }).then(function (st) {
      S.state = st;
      S.view = 'week';
      if (S.focusDate) {
        var start = addDays(st.today, -dowIndex(st.today));
        var weeksAhead = Math.floor((Date.parse(S.focusDate) - Date.parse(start)) / (7 * 86400000));
        if (weeksAhead >= 0) S.offset = Math.min(MAX_WEEKS_AHEAD, weeksAhead - (weeksAhead % 2));
      }
      if (join) return doJoin(join);
      render();
    }, function (err) {
      if (/Unknown person/.test(err.message)) {
        store(STORE_USER, null); S.userId = null; S.view = 'join';
        if (join) { S.joinGroupId = join; A.call('groupInfo', { groupId: join }).then(function (info) { S.joinInfo = info; render(); }, function () {}); }
        render();
        return;
      }
      // A known person whose load failed (network, server busy): don't throw them back to "Who are you?".
      S.view = 'error';
      S.error = err.message;
      render();
    });
  }

  function viewError() {
    return h('main', { class: 'join' }, brand(),
      h('section', { class: 'card join-card' },
        h('h1', null, "Couldn't load " + W.appName),
        h('p', { class: 'muted' }, S.error || 'Something went wrong.'),
        h('button', { type: 'button', class: 'btn primary block', onclick: function () { location.reload(); } }, 'Try again')));
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
