# Compass — Scope

*Drafted 2026-09-05. This is the agreement about what we're building. If something
isn't in here, it isn't in v1.*

## 1. What Compass is

One page for your day: **today's Google Calendar events, today's Google Tasks, and a
daily note**, together, on Windows and Android.

It's a rebuild of [Parchment](https://parchmentagenda.app/) — Christopher Lawley's
app, introduced in [*This Didn't Exist, So I Built It*](https://www.youtube.com/watch?v=cgG9abre3wM).
Parchment is Apple-only: EventKit, Reminders, iCloud, iPhone/iPad/Mac. Compass is the
same idea on the stack you actually use — Google services, Windows, Android.

It's a personal app for one Google account. That's a feature, not a limitation: it
removes multi-tenancy, accounts, billing, and most of the security surface.

## 2. What v1 is not

Naming these now so they don't creep in:

- **No natural-language capture.** "dentist thursday 3pm" → event is Parchment's
  signature input trick and it's deferred. Structured pickers in v1.
- **No note sync between devices.** Notes are local to each device. Your PC note and
  your phone note for the same day are different files and won't merge.
- **No handwriting, no Pencil, no photos in notes.**
- **No widgets** (Android home-screen widget is a natural v2).
- **No multi-account, no shared calendars from other people, no iOS, no Mac.**
- **No app store release.** Personal install: an MSI you run, an APK you sideload.
- **No offline writes.** Offline you can read cached data and edit your note; creating
  or completing a task requires a connection.
- **No times on tasks.** Google's API doesn't expose them (§7). Timed things are
  calendar events instead — see §8.6.

## 3. v1 features

1. **Sign in with Google, stay signed in.** One account. See §6 for the catch.
2. **Today page.** Events, tasks, and the day's note on one scrollable page.
3. **Date navigation.** Move to any day, jump back to today.
4. **Tasks, two-way.** Complete/uncomplete, create, rename, reschedule, delete —
   written back to Google Tasks.
5. **Events, two-way.** Create, edit time/title/location, delete — written back to
   Google Calendar.
6. **Daily note.** Markdown, autosaved, one document per calendar day, with a
   Write/Preview toggle. The file on disk is always the source — the preview
   renders it, it doesn't replace it. A true rich-text editor is still out: it
   would mean owning a document model that has to round-trip back to Markdown
   without drift, and the point of §8.4 is that the `.md` file stays the thing.

## 4. Architecture

One codebase, three targets:

```
        React + TypeScript UI  ·  shared, ~100% of the app
                     │
     ┌───────────────┼───────────────┐
  browser         Tauri 2         Capacitor 8
  (dev only)      (Windows)       (Android)
```

The shells differ in a handful of ways, and those are the only platform-specific
code in the project:

| Seam | Windows (Tauri) | Android (Capacitor) | Browser (dev) |
|---|---|---|---|
| **Secrets** — the Google refresh token | Windows Credential Manager | App-private storage | `localStorage` (dev only) |
| **Notes** — where `2026-09-05.md` lives | `Documents\Compass\` (visible, openable) | Shared storage dir | `localStorage` (dev only) |
| **OAuth redirect** — catching Google's callback | Loopback HTTP server on `127.0.0.1` | Custom URL scheme | Page navigation |
| **Opening a link** — a URL in a note | System browser | System browser | New tab |
| **Closing** — flushing the note first | Close held until the write lands | *(M5)* | Best-effort on unload |

The last two arrived with the note (M3): a link inside the webview would
navigate the app away from itself, and autosave on a delay needs somewhere to
finish when the window is closing.

Everything else — API clients, state, rendering, date logic — is written once.

**Source of truth:** Google owns events and tasks; Compass caches them locally so the
app opens instantly and reads offline. Compass owns notes; nothing else touches them.

## 5. Milestones

| | | Status |
|---|---|---|
| **M0** | Scaffold: Vite + React + TS, deps installed | done |
| **M1** | Google auth working in the browser; Today page reads real events + tasks | done |
| **M2** | Writes: complete/create/edit tasks, create/edit events | done |
| **M3** | Daily note with local storage + autosave | done |
| **M4** | Tauri shell: Windows app, credential manager, loopback OAuth | done |
| **M5** | Capacitor shell: Android app, custom-scheme OAuth | done — verified on a physical device |
| **M6** | Packaging: MSI installer, signed APK | |

M1–M3 were sequenced first because they are browser-testable — fast loop, no build
step, no shells to debug. M4 was pulled ahead of M3 deliberately: notes must be real
`.md` files (§8.4), and only the desktop shell can write them, so building the note UI
in the browser first would have meant a throwaway `localStorage` stub.

## 6. Google OAuth for a personal app

`calendar.events` and `tasks` are **sensitive scopes**, which Google gates. There are
three ways through, and which one applies depends on your account type:

- **Testing** status → **refresh tokens are revoked after 7 days.** You'd re-sign-in
  weekly, forever. ([docs](https://developers.google.com/identity/protocols/oauth2))
  Not acceptable.
- **Production, unverified** → one "unverified app" interstitial you click through,
  then tokens behave normally. ~100 user cap, irrelevant for one person. Full
  verification (privacy policy, homepage, demo video, weeks of review) is only needed
  for an app with real outside users.
- **Internal** user type → none of the above applies. No verification, no warning
  screen, no token expiry. **Requires a Google Workspace organisation.**

**Your connected calendar is `fabrice@fabricebokovi.com` — a custom domain, which
means this is very likely a Workspace account, so Internal should be available to
you.** That's strictly the best option: build the OAuth app inside that Workspace org
and set user type to Internal. Fall back to Production-unverified (your stated
preference, and still fine) if it turns out not to be a Workspace account.

Two OAuth clients are needed either way: a **Desktop** client (used by both Tauri and
browser dev, via loopback redirect) and an **Android** client (custom scheme, no
secret). PKCE protects both; the Desktop client's "secret" isn't meaningfully secret
in an installed app, which Google acknowledges.

## 7. Risks

- ~~Android is blocked.~~ Resolved at M5: JDK 17 + 21 and the Android SDK
  command-line tools (no Android Studio, no emulator) are installed — see
  `docs/android-setup.md`. Sign-in, the OAuth redirect, and the Today page
  reading real Calendar/Tasks data are all verified working on a physical
  Pixel 6 Pro over USB. Still open: no emulator on this machine, so nothing
  has been tried on any other device.
- ~~Rust 1.79 is too old for Tauri.~~ Resolved: updated to 1.98.1 at M4.
- **Google Tasks has no due *time*, and there is no workaround.** Confirmed against
  the [current API reference](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks):
  *"Only date information is recorded; the time portion of the timestamp is discarded
  when setting this field. It isn't possible to read or write the time that a task is
  scheduled for using the API."* The Tasks **app** lets you set a time and shows it in
  Google Calendar — but that time lives somewhere no public API exposes. Checked
  empirically too: your calendar list contains only your primary calendar and US
  Holidays, no Tasks calendar, so the Calendar API can't reach them either. See §8.6
  for how v1 handles this.
- ~~Calendar recurring events are fiddly to edit.~~ Partly resolved at M2.
  `singleEvents=true` returns each occurrence under its own instance id, and
  writing to that id changes only that occurrence — so editing and deleting a
  single day of a series works, and the editor says so on screen. Editing the
  **series** (this-and-following, or all events) is **out of v1**: it needs a
  scope prompt and recurrence-rule editing, neither of which earns its place in
  a one-page day view.

## 8. Decisions (resolved 2026-09-05)

1. **Calendars — show all, user picks.** Fetch the full calendar list, render each
   with its Google colour, and give the user checkboxes for which ones feed the Today
   page. Selection persists locally. (Currently that's 2 calendars: primary +
   US Holidays.)
2. **Task lists — same pattern.** Show all lists, user chooses which are active.
3. **OAuth — durable tokens.** Internal if the Workspace account allows it, otherwise
   Production-unverified. Never ship on Testing status. See §6.
4. **Notes are real `.md` files** in a folder openable by any other editor. This
   drives storage choices: on Windows a plain visible directory (not opaque app
   storage), on Android a location reachable by other apps, and it means the eventual
   sync story in §9 has real files to work with.
5. **Design — my call for now, revisited later.** Build something cohesive and good;
   the user will bring inspiration and direction in a later pass. Design work should
   therefore stay easy to re-skin: tokens for colour/type/spacing, no hard-coded
   values scattered through components.
6. **Task times — v1 shows tasks without times, and timed things become calendar
   events.** Since the time is unreachable (§7), the honest model is: *a thing with a
   time is a calendar event; a thing with only a day is a task.* Compass's capture UI
   will follow that — give it a time and it creates an event, leave the time blank and
   it creates a task. Rejected alternatives: storing times locally (drifts against the
   Tasks app, which would show a different time we can't read), and encoding times in
   the task `notes` field (round-trips, but pollutes the task in Google's own UI).
7. **Overdue tasks stay on the day they were due**, rather than following the user
   forward onto today. The day view stays an honest record of what was planned. A
   dedicated **overdue view** is planned but out of v1 — see §9.
8. **Compass always sets a due date on tasks it creates.** A task with no date has
   nowhere to live in a day-based app. Tasks created in Google's own apps can still
   arrive undated, so the Today page collects those under a "No date" heading —
   otherwise they'd be silently invisible here.

## 9. Not decided yet, deliberately

Where notes sync eventually goes — **Supabase is the current lean**, but the decision
waits until v1 exists. An **overdue view** (§8.7), NL capture, and widgets likewise.
All get easier once you've lived with the app and know how you actually use it.