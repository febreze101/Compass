# Compass

Your calendar, your tasks, and today's note — on one page.

Compass pulls Google Calendar events and Google Tasks together with a daily note,
for Windows and Android. It's a rebuild of the Apple-only
[Parchment](https://parchmentagenda.app/) on a Google and Windows stack.

- **[docs/SCOPE.md](docs/SCOPE.md)** — what's being built, what isn't, and why
- **[docs/google-setup.md](docs/google-setup.md)** — one-time Google Cloud setup

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in from docs/google-setup.md
```

Google credentials are required before sign-in will work. The setup guide takes
about 15 minutes and is a one-time thing.

## Running

```bash
npm run desktop      # the Windows app (Tauri) — the real target
npm run dev          # the same UI in a browser, for a faster loop
```

For browser development, open **`http://127.0.0.1:5173`**, not `localhost`.
Google's desktop OAuth clients accept the loopback IP and reject the hostname.

The desktop app has no such constraint: it catches the OAuth redirect on its own
loopback server, on an ephemeral port.

## Testing

```bash
npm run test         # watch mode
npm run test:run     # once
npm run lint
npx tsc -b           # typecheck
```

Tests run on Node by default for speed. A test needing a DOM opts in with a
`// @vitest-environment jsdom` docblock at the top of the file.

## Layout

```
src/
  lib/
    date.ts          local-day handling; the app is anchored to calendar days
    capture.ts       the rule that sends an entry to a task or an event
    notes.ts         debounced autosave for the daily note
    prefs.ts         which calendars and task lists feed the day view
    session.ts       sign-in orchestration and the stored session
    google/          API clients, OAuth transport, PKCE, normalization
  platform/          the seam between shells — see below
  state/store.ts     application state
  ui/                components
src-tauri/           the Windows shell (Rust)
```

### The platform seam

One web codebase runs in three places. They differ in six ways, and
`src/platform/` is the only place that knows about it:

| | Windows (Tauri) | Android (Capacitor) | Browser (dev) |
|---|---|---|---|
| Refresh token | Windows Credential Manager | *not yet built* | `localStorage` |
| Notes | `Documents\Compass\*.md` | *not yet built* | `localStorage` |
| OAuth redirect | Loopback server on `127.0.0.1` | *not yet built* | Page navigation |
| OAuth client | Desktop | Android | Desktop |
| Opening a link | System browser, via opener | *not yet built* | New tab |
| Closing the app | Held open until the note is saved | *not yet built* | Best-effort unload |

Everything above that layer — API clients, state, rendering, date logic — is
written once.

## Status

M1–M4 are done: sign-in, the Today page, two-way tasks and events, the daily
note, and the Windows shell. What's left is M5 (Android, blocked on the SDK)
and M6 (packaging). See [docs/SCOPE.md §5](docs/SCOPE.md).

Notes are plain `.md` files in `Documents\Compass\`, one per day, autosaved a
moment after you stop typing. Nothing else touches them — open them in any
editor you like. **Write** shows the Markdown source, **Preview** renders it;
what lands on disk is the source either way.

Adding something uses one box: give it a time and it becomes a calendar event,
leave the time blank and it becomes a task. Google Tasks cannot store a time,
so that split is forced rather than chosen — see [§7 and §8.6](docs/SCOPE.md).
