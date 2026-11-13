# Game Night: build plan (v1)

Tracking document for the first build. It records *why* each rule exists, including the dead ends, so nobody re-derives them.

## What it is

Gaming friends mark the whole days they're free over the next two weeks, per group (a group is tagged by its game). Days are shown green when everyone is free, orange when some are, and blank when nobody is. A green day can be flagged as game night, and the others confirm. Two emails exist: a **poke** about a specific day, and a **tonight reminder** at each person's own local time. Desktop only. Requirements come from an interview on 2026-11-13. The mockup is at https://claude.ai/artifact/GXyWwtwMJwGpE7sy6jt3en.

## Architecture

```
GitHub Pages (static: index.html, css/, js/)
        │  fetch POST text/plain JSON  { action, ... }
        ▼
Google Apps Script web app (apps-script/)  ── MailApp ──▶ Gmail (pokes, reminders)
        │  read/modify/write under LockService
        ▼
Google Sheet (one tab per table)        ◀── time trigger every 15 min (reminders)
```

**One copy of the rules.** All domain logic lives in `apps-script/Core.js`: pure functions over in-memory tables. The same file is loaded by:
- Apps Script, where `Code.js` loads the Sheet tabs into tables, calls Core, writes back the tables that changed, and sends mail;
- the browser in **demo mode** (no API URL configured), where the tables live in `localStorage`. This lets the whole UI run and be tested with no Google setup;
- Node tests (`tests/core.test.js`), via `vm`.

*Why:* the alternative was writing the rules twice (server plus a mock), and those two copies drift apart. That has happened on other projects ("the preview and the export quietly drifted apart").

### Why Apps Script (decision log)
1. **GitHub-only** (Pages + Actions + JSON in the repo): rejected. A static page can't write to a repo without a per-user token. A "Sign in with GitHub" button needs a server, because GitHub's token endpoint doesn't allow browser (CORS) calls. Every friend would need a GitHub account. Free Pages needs a public repo, so everyone's email address would be public.
2. **Cloudflare Workers + D1** (most robust) and **Supabase** (open source, but free projects pause after about a week of inactivity) were both considered.
3. **Apps Script + Sheet** was chosen for simplicity: Gmail sending is built in with no app password, the Sheet is private and easy to inspect, and friends need no accounts.

## Data (Sheet tabs = tables)

| Tab | Columns | Notes |
|---|---|---|
| Users | id, name, email, tz, reminderTime, remindersOn, style, createdAt | `reminderTime` is `HH:MM` local time; `style` is modern / adventure / arcade |
| Groups | id, tag, createdBy, createdAt | |
| Members | groupId, userId, joinedAt | |
| Availability | groupId, date, userId | A row means "free". `date` is `YYYY-MM-DD` and is never converted between time zones |
| Nights | groupId, date, status, by, confirmedBy, updatedAt | status = proposed / confirmed; `confirmedBy` is comma-separated user ids |
| Log | at, kind, groupId, date, userId, detail | Pokes sent and reminders sent. Reminder rows prevent double-sends |

## Rules (and why)

- **Identity is open.** There are no passwords: a browser stores a user id. Registering with an email that already exists returns that user, so you can get back in from a new browser. *Why:* "completely open" was an explicit choice. The trade-off is that anyone who knows your email can act as you. That's accepted for a few friends.
- **Emails never leave the server.** `getState` returns member names only, plus the caller's own profile. *Why:* the API URL is public (it's in the page source), so the API must not leak addresses.
- **Flag only on green.** The server checks that every member is free. Unmarking yourself from a day deletes any night on that date, because it's no longer green.
- **Confirming (judgment call for groups of 3 or more):** a proposed night becomes *confirmed* once **every** member other than the proposer has confirmed. For a pair, that means the other person. *Why:* in a group of three or more, "anyone confirms" could lock in a night that someone never agreed to.
- **Poke** goes to chosen members who haven't marked that day free, with an optional note. It's sent immediately from the script owner's Gmail, display name "Game Night", with reply-to set to the poker's email.
- **Reminder:** every 15 minutes the trigger looks for confirmed nights where `date` = today *in the member's time zone*, the member's local time is at or past `reminderTime`, reminders are on, and nothing has been sent yet. *Why the 15-minute window:* triggers aren't exact. A reminder can arrive up to about 15 minutes late, which is fine.
- **Past days** are shown but can't be changed.
- **Writes** run under `LockService` so two simultaneous saves can't overwrite each other.
- **Housekeeping:** the trigger deletes Availability, Nights and Log rows older than 60 days.

## Frontend

Vanilla JS and CSS. No build step and no dependencies, so it publishes straight to Pages. Every user-supplied string is shown as text, never as HTML. There are three styles, set per person (`data-style` on `<body>`):
- **Modern** (default): action buttons on each day.
- **Adventure** / **Arcade:** an action bar at the top (Mark free · Flag night · Confirm · Poke). You pick an action, then click a day. The mockup reviewer chose to keep this difference.

Screens: Join (name + email, or `?join=<groupId>` invite) · Week view (two weeks, with group tabs) · Settings (profile, time zone, reminder, style, groups, invite link, new group, switch person) · Poke dialog.

## Phases

| # | Phase | Must satisfy before commit |
|---|---|---|
| 1 | Plan + skeleton | This document is committed |
| 2 | Core rules + Node tests | `node tests/core.test.js` is green: flag only on green, unmark deletes night, multi-member confirm, poke targets, reminder due/not-due across time zones, no emails in state |
| 3 | Apps Script wrapper + setup guide | `docs/SETUP.md` takes Dean from an empty Sheet to a working URL. **Not verifiable here:** needs Dean's Google account |
| 4 | Frontend: Modern + Join + Settings in demo mode | Driven in a real browser (Playwright): join, create group, mark, flag, confirm via a second user, poke dialog, settings save. Screenshots looked at |
| 5 | Adventure + Arcade styles | Same flows driven in each style. Screenshots looked at |
| 6 | Pages readiness | `.nojekyll`, README, config documented |

Not in v1: mobile layout, chat, time slots, calendar sync, Discord (all non-goals).
