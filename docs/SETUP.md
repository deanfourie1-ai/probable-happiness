# Setting up your own copy

About 15 minutes. You need a Google account (it will own the data and send the emails) and your own copy of this repo on GitHub: press **Fork** at the top of the repo page, or **Use this template** if it's offered.

Everything here is free. Your copy is completely separate from anyone else's: your own Sheet, your own emails, your own website.

> Scheduling something other than game nights? Change the words in [`apps-script/Words.js`](../apps-script/Words.js) **before** step 1, so you paste the right version. See "Make it your own" in the [README](../README.md#make-it-your-own).

## 1. The Sheet and the script

1. Go to [sheets.new](https://sheets.new) and give the spreadsheet a name (e.g. **Game Night**).
2. Open **Extensions → Apps Script**. A script editor opens that is attached to this Sheet.
3. In the editor:
   - Rename the default `Code.gs` file if you like, then replace its contents with [`apps-script/Code.js`](../apps-script/Code.js).
   - Click **+ → Script** and name it `Core`. Paste in [`apps-script/Core.js`](../apps-script/Core.js).
   - Click **+ → Script** again and name it `Words`. Paste in [`apps-script/Words.js`](../apps-script/Words.js).
   - Open **Project Settings (gear icon)**, tick **Show "appsscript.json" manifest file in editor**, go back, and replace `appsscript.json` with [`apps-script/appsscript.json`](../apps-script/appsscript.json).
   - Press **Save** (disk icon).
4. Choose **`setup`** in the function dropdown at the top and press **Run**.
   - Google asks for permission. Because this is your own unpublished script, you'll see a "Google hasn't verified this app" warning: click **Advanced → Go to (your project name) (unsafe)** → **Allow**. The script asks for access to *this spreadsheet only*, to send email as you, and to run on a timer.
   - When it's done, the Sheet has six tabs (Users, Groups, Members, Availability, Nights, Log), and **Triggers** (clock icon) lists `reminderSweep` (every 15 min) and `dailyHousekeep`.

## 2. Publish the script as a web app

1. **Deploy → New deployment → gear icon → Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**.
3. Press **Deploy** and copy the **Web app URL** (ending in `/exec`).
4. Check it works: open the URL in a browser. You should see `{"ok":true,"app":"game-night"}`.

> "Anyone" means anyone with the URL can call the API. You chose "completely open" for this group of friends. The Sheet itself stays private to you, and the API never returns anyone's email address.

## 3. Point the website at the script

1. In your copy of the repo, open [`js/config.js`](../js/config.js) and replace the URL that's there with yours. (The one already there belongs to the original author's copy: if you leave it, your site will talk to their backend, not yours.)
   ```js
   window.GN_CONFIG = { apiUrl: 'https://script.google.com/macros/s/XXXX/exec' };
   ```
2. Commit and push to `main`.
3. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** → Save. After a minute or two the site is live at `https://<your-user>.github.io/<repo>/`.

## 4. Tell the script where the website lives

Links in emails point here.

1. In the Apps Script editor: **Project Settings → Script properties → Add script property**.
2. Property: `APP_URL`. Value: your Pages URL, e.g. `https://<your-user>.github.io/<repo>/`.

## 5. First use

1. Open the site, enter your name and email, and create a group (e.g. *Helldivers*).
2. In **Settings**, copy the group's invite link and send it to your friend.
3. Poke yourself a test? You can't poke yourself, so ask your friend to poke you about a day you haven't marked.

## Updating the script later

Paste the new code (`Code`, `Core` and `Words`, whichever changed), then **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. The URL stays the same. Saving the code alone does **not** update the live web app.

## Limits worth knowing

- Gmail sends about **100 emails a day** from a normal Google account. That's far more than pokes and reminders need.
- Reminders arrive **up to ~15 minutes after** each person's chosen time, because the trigger runs every 15 minutes.
- Each save takes about a second, since Apps Script isn't instant. Friends see changes when they refresh.
- Emails come from **your** Gmail address, with the app name from `Words.js` as the display name. Replies to a poke go to whoever sent the poke.

## Demo mode

If `apiUrl` in `js/config.js` is empty, the site runs entirely in your browser with made-up friends. Nothing is saved to Google and no email is sent. Emails that *would* go out are shown in a box instead. It's useful for trying styles or showing someone the idea.
