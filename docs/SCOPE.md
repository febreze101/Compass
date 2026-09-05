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
6. **Daily note.** Plain-text/Markdown, autosaved, one document per calendar day.

## 4. Architecture

One codebase, three targets:

```
        React + TypeScript UI  ·  shared, ~100% of the app
                     │
     ┌───────────────┼───────────────┐
  browser         Tauri 2         Capacitor 8
  (dev only)      (Windows)       (Android)
```

The shells differ in exactly three ways, and those are the only platform-specific
code in the project:

| Seam | Windows (Tauri) | Android (Capacitor) | Browser (dev) |
|---|---|---|---|
| **Secrets** — the Google refresh token | Windows Credential Manager | App-private storage | `sessionStorage` |
| **Notes** — where `2026-09-05.md` lives | `Documents\Compass\` (visible, openable) | Shared storage dir | IndexedDB (dev only) |
| **OAuth redirect** — catching Google's callback | Loopback HTTP server on `127.0.0.1` | Custom URL scheme | Page navigation |

Everything else — API clients, state, rendering, date logic — is written once.

**Source of truth:** Google owns events and tasks; Compass caches them locally so the
app opens instantly and reads offline. Compass owns notes; nothing else touches them.

## 5. Milestones

| | | Status |
|---|---|---|
| **M0** | Scaffold: Vite + React + TS, deps installed | done |
| **M1** | Google auth working in the browser; Today page reads real events + tasks | next |
| **M2** | Writes: complete/create/edit tasks, create/edit events | |
| **M3** | Daily note with local storage + autosave | |
| **M4** | Tauri shell: Windows app, credential manager, loopback OAuth | |
| **M5** | Capacitor shell: Android app, custom-scheme OAuth | blocked, see §7 |
| **M6** | Packaging: MSI installer, signed APK | |

M1–M3 are all browser-testable, which is why they come first — fast loop, no build
step, no shells to debug.

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

- **Android is blocked.** No Java, no `ANDROID_HOME`, no SDK on this machine. M5 needs
  Android Studio installed first. Everything through M4 is unaffected.
- **Rust is 1.79**, older than current Tauri dependency trees like. A `rustup update`
  is likely needed at M4.
- **Google Tasks has no due *time*, and there is no workaround.** Confirmed against
  the [current API reference](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks):
  *"Only date information is recorded; the time portion of the timestamp is discarded
  when setting this field. It isn't possible to read or write the time that a task is
  scheduled for using the API."* The Tasks **app** lets you set a time and shows it in
  Google Calendar — but that time lives somewhere no public API exposes. Checked
  empirically too: your calendar list contains only your primary calendar and US
  Holidays, no Tasks calendar, so the Calendar API can't reach them either. See §8.6
  for how v1 handles this.
- **Calendar recurring events** need `singleEvents=true` expansion; editing one
  instance of a recurring series is fiddly and may get deferred past v1.

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

## 9. Not decided yet, deliberately

Where notes sync eventually goes — **Supabase is the current lean**, but the decision
waits until v1 exists. NL capture and widgets likewise. All get easier once you've
lived with the app and know how you actually use it.