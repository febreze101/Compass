# Google Cloud setup

One-time setup so Compass can read and write your calendar and tasks. Budget
15 minutes. You need to be signed in as **fabrice@fabricebokovi.com** — not the
Gmail account.

Google reorganised this console in 2025; the old "APIs & Services → OAuth consent
screen" now lives under **Google Auth Platform**. Both namings are noted below in
case your console differs.

---

## 1. Create the project

1. Go to <https://console.cloud.google.com/projectcreate>.
2. Name it `Compass`. Leave location as-is (or pick your org if offered — see the
   note in step 3, it matters).
3. Create, then make sure `Compass` is the selected project in the top bar.

## 2. Enable the two APIs

Enable both, one at a time:

- <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>
- <https://console.cloud.google.com/apis/library/tasks.googleapis.com>

Click **Enable** on each. Nothing else on these pages matters.

## 3. Configure the auth platform — the step that decides everything

Go to **Google Auth Platform → Branding** (older consoles: *APIs & Services →
OAuth consent screen*) and fill in an app name (`Compass`) and your email as
support + developer contact. Nothing here is user-visible for an internal app.

Then go to **Audience**. This is the important choice:

**If "Internal" is available** — take it. It means the project sits inside your
`fabricebokovi.com` Workspace org. No verification, no warning screen, and
crucially **no 7-day refresh-token expiry**. You're done with this step.

**If only "External" is available** — the project isn't in the Workspace org.
Either recreate the project under the org (worth doing), or continue with
External and:

1. Add yourself under **Test users**.
2. Then click **Publish app** to move from *Testing* to *In production*.
3. Confirm the dialog. You will **not** need to complete verification — an
   unverified production app works fine, capped at ~100 users.

> **Do not leave the app in Testing status.** Google revokes refresh tokens after
> 7 days in Testing, which means re-authenticating every week forever. This is
> the single most common way to get this wrong. See `SCOPE.md` §6.

Under **Data access**, add these three scopes:

```
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/tasks
https://www.googleapis.com/auth/userinfo.email
```

The first two are marked *sensitive*. That's expected and fine for Internal or
unverified-production.

## 4. Create the Desktop OAuth client

**Google Auth Platform → Clients → Create client**

- Application type: **Desktop app**
- Name: `Compass Desktop`

Create it, then copy the **Client ID** and **Client secret**.

You don't register redirect URIs for a Desktop client — Google automatically
accepts `http://127.0.0.1:<any port>`, which is exactly what both the Tauri shell
and browser development use.

> The "secret" for a Desktop client isn't genuinely secret; it ships inside the
> installed app and Google's own CLI tools do the same. PKCE is what actually
> secures this flow. Still, keep it out of git — `.env.local` is gitignored.

## 5. Create the Android OAuth client — *defer this*

This one needs a JDK to compute your signing certificate's SHA-1 fingerprint, and
this machine has no Java yet. Come back after installing Android Studio, at
milestone M5.

When you do:

1. Get the debug fingerprint:
   ```
   keytool -list -v -alias androiddebugkey -keystore "$env:USERPROFILE\.android\debug.keystore" -storepass android -keypass android
   ```
2. **Create client** → Application type **Android**
   - Package name: `app.compass.agenda`
   - SHA-1: from the command above
3. Android clients have no secret. The redirect is a custom scheme derived from
   the client ID; Compass handles that automatically.

## 6. Put the values in `.env.local`

In the project root:

```
cp .env.example .env.local
```

Then fill in what you copied in step 4:

```
VITE_GOOGLE_DESKTOP_CLIENT_ID=…apps.googleusercontent.com
VITE_GOOGLE_DESKTOP_CLIENT_SECRET=GOCSPX-…
```

Leave `VITE_GOOGLE_ANDROID_CLIENT_ID` empty until step 5.

`.env.local` is gitignored. Restart `npm run dev` after editing it — Vite only
reads env files at startup.

---

## Checking it worked

Once the auth layer lands (M1), `npm run dev` and sign in. Signs you'd got a step
wrong:

| Symptom | Cause |
|---|---|
| `Error 400: redirect_uri_mismatch` | Client type isn't **Desktop app** |
| `Access blocked: … has not completed the Google verification process` | Still in *Testing* without being a test user — see step 3 |
| Signed out roughly weekly | App left in *Testing* status — the §6 trap |
| `insufficient authentication scopes` on tasks | Scopes not added under **Data access**, or you consented before adding them (revoke at <https://myaccount.google.com/permissions> and retry) |
