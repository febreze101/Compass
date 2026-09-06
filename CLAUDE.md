# Compass — working notes

One page for your day: Google Calendar events, Google Tasks, and a daily note,
on Windows and Android. A personal app for one Google account.

Two documents carry the intent, and they are the source of truth for *why*
anything is the way it is:

- **`docs/SCOPE.md`** — what's being built, what deliberately isn't, and the
  numbered decisions (§8) with their rejected alternatives. Read this before
  proposing a design change; most questions are already answered there.
- **`docs/google-setup.md`** — the one-time Google Cloud setup.

## Commands

```bash
npm run desktop      # the Windows app (Tauri) — the real target
npm run dev          # same UI in a browser, faster loop
npm run test:run     # tests once (npm test for watch)
npm run lint         # oxlint
npx tsc -b           # typecheck
npm run build        # production bundle
```

Run `npx tsc -b && npm run lint && npm run test:run` before committing. The
Vite build does **not** rebuild the Rust side — changes under `src-tauri/`,
including `capabilities/default.json`, only take effect on `npm run desktop`.

## Setup gotcha

`.env.local` holds the Google client id and secret and is **gitignored**, so it
does not travel between machines. A fresh clone needs it recreated from
`.env.example` before sign-in will work.

In the browser, open **`http://127.0.0.1:5173`**, not `localhost` — Google's
desktop OAuth clients accept the loopback IP and reject the hostname.

## Layout

```
src/lib/          pure logic, all of it tested
  date.ts         DayKey ("YYYY-MM-DD"); the app is anchored to local days
  capture.ts      the rule sending an entry to a task or an event
  notes.ts        debounced autosave for the daily note
  markdown.ts     the note preview parser
  session.ts      sign-in orchestration
  google/         API clients, OAuth transport, PKCE, normalization
src/platform/     the only code that knows which shell it's in
src/state/store.ts  one Zustand store; all Google calls go through it
src/ui/           components; no business logic
src-tauri/        Rust: OS keychain and the OAuth loopback server, nothing else
```

## Conventions

- **Tests live at the `lib/` level.** There are no component tests. When UI
  needs testable logic, extract it into `lib/` as a pure function — that is why
  `capture.ts` and `notes.ts` exist as separate modules.
- **Comments explain why, not what**, and earn their place. Where there's a
  trap, name it and say what breaks without the guard. Match the density of the
  surrounding file.
- **No hard-coded colours or sizes.** Everything is a token in `styles.css`;
  see SCOPE §8.5 — the design is meant to be re-skinnable.
- **Domain models are separate from Google's wire shapes.** `Raw*` types are
  what Google sends; `normalize.ts` resolves the quirks once so they never leak
  into components.

## Traps that have already bitten

- **Local days, not instants.** All-day events arrive as `YYYY-MM-DD` and task
  due dates as UTC-midnight. Routing either through `new Date()` shifts the day
  for anyone behind UTC. `normalize.ts` documents both.
- **The OAuth redirect URI must be identical** in the authorization request and
  the token exchange. Tauri binds a fresh ephemeral port per attempt, so it is
  resolved once and carried in `PendingAuth`. Recomputing it produces
  `invalid_grant`, which Google describes only as "Bad Request".
- **Event updates are PATCH, never PUT.** Compass models four fields; a PUT
  drops the guests, meeting links and reminders it knows nothing about. On a
  PATCH an omitted field keeps its old value, so clearing a location requires
  sending an empty string.
- **Read-only calendars reject writes.** Subscribed feeds come back with
  `accessRole: reader`; never offer an editor or a create target for one.
- **Scopes:** `calendar.events` does not cover listing calendars.
  `calendarList.list` needs its own scope. See `config.ts`.
- **Google Tasks has no due *time*** and no workaround exists. This is why
  capture routes a timed entry to the calendar instead (SCOPE §7, §8.6).
- **A note write must be keyed to the day it was typed on.** Changing days
  flushes first; otherwise a timer lands the text under the wrong date.
- **The note preview renders React elements, never HTML.** `invoke()` is on the
  other side of this webview, so there is no `dangerouslySetInnerHTML`
  anywhere, and link schemes are restricted to http/https/mailto.

## State

M1–M4 done: sign-in, the Today page, two-way tasks and events, the daily note
with Write/Preview, and the Windows shell. Remaining:

- **M5 — Android.** Blocked: no JDK or Android SDK on the dev machine. Needs
  Android Studio, then a Capacitor implementation of `src/platform/`, which is
  currently the only shell without one.
- **M6 — Packaging.** MSI installer, signed APK.

Deferred on purpose, not forgotten: note sync (Supabase is the lean, decided
after v1), an overdue view, natural-language capture, widgets, and editing a
recurring *series* rather than one occurrence.
