# Game Night

Find the nights everyone in your gaming group can play.

- Mark the whole days you're free over the next two weeks, per group (one group per game).
- Days go **green** when everyone is free, **orange** when some are, and stay blank when nobody is.
- Flag a green day as **game night**, and the others confirm.
- **Poke** a friend by email about a specific day.
- Get a **"we're playing tonight"** email at your own chosen time, in your own time zone.
- Pick your style: **Modern** (default), **Adventure** or **Arcade**.

Desktop only. No accounts or passwords: you enter a name and email and your browser remembers you.

## How it's built

- **Frontend:** a static page (`index.html`, `css/`, `js/`) served by GitHub Pages. No build step and no dependencies.
- **Backend:** a Google Apps Script web app (`apps-script/`) with a Google Sheet as the database. Emails go out through the script owner's Gmail.
- **One copy of the rules:** `apps-script/Core.js` is used by the Apps Script backend, by the browser's demo mode and by the tests.

See [docs/PLAN.md](docs/PLAN.md) for the design decisions and why.

## Try it

Open `index.html` through any static server (e.g. `npx serve .`). With no API URL in `js/config.js`, it runs in **demo mode**, with sample friends and nothing leaving the browser.

## Set it up for real

Follow [docs/SETUP.md](docs/SETUP.md) (about 15 minutes): create the Sheet, paste the script, deploy it as a web app, put its URL in `js/config.js`, and turn on GitHub Pages.

## Tests

```
npm test
```

This runs the rules tests and the Apps Script wrapper tests (against in-memory fakes of Google's services). Neither needs a Google account.
