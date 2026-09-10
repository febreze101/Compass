# Android toolchain setup

M5 needs a JDK and the Android SDK to build the Capacitor shell. No Android
Studio here — command-line tools only, to keep this within an 8 GB machine's
means (see `docs/SCOPE.md` §7, `compass-machine-constraints` in memory).

## What's installed

- **JDK 17** (`EclipseAdoptium.Temurin.17.JDK` via winget) — the Android
  Gradle Plugin's own minimum.
- **JDK 21** (`EclipseAdoptium.Temurin.21.JDK` via winget) — Capacitor's core
  Android module (`capacitor-android`) compiles against a JDK 21 source level.
  Gradle needs 21 as the JVM actually running the build, not just available as
  a discoverable toolchain — `JAVA_HOME` has to point at 21 when invoking
  `gradlew`. Both JDKs coexist under `C:\Program Files\Eclipse Adoptium\`; 17
  is registered as the system default, 21 is used explicitly for Android
  builds.
- **Android SDK command-line tools** (`commandlinetools-win`, latest), at
  `%USERPROFILE%\AndroidSdk`, with `platform-tools`, `platforms;android-35`,
  and `build-tools;35.0.0` installed via `sdkmanager`. No Android Studio, no
  emulator (AVD) — building and installing to a physical device over `adb` is
  the only path this machine supports.
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` and the `cmdline-tools\latest\bin` /
  `platform-tools` directories are on the **user** `PATH`, set persistently via
  `[System.Environment]::SetEnvironmentVariable(...)`. A **new** shell picks
  these up automatically; a shell open from before the install won't.

## Building

```
npm run build
npx cap sync android
cd android
./gradlew.bat assembleDebug --no-daemon
```

**`npx cap sync android` is not optional.** `gradlew` builds whatever's already
sitting in `android/app/src/main/assets/public` — it does not re-copy `dist/`
for you. Running `npm run build` then jumping straight to `gradlew` installs a
*stale* APK that still passes `BUILD SUCCESSFUL` (Gradle has no way to know the
web bundle is old) and fails confusingly at runtime instead — that's exactly
what happened testing M5's sign-in flow the first time: the installed app was
still running the pre-Capacitor web-only code path against a live device, sending
an OAuth request built for the browser instead of Android.

`JAVA_HOME` must point at the JDK 21 install for this to succeed (see above).
`--no-daemon` matters on this machine: a lingering Gradle daemon JVM is exactly
the kind of background memory pressure that got a background install killed
during this setup (see the memory note below) — better to pay Gradle's JVM
startup cost each time than keep one resident.

`android/gradle.properties` already caps daemon heap at `-Xmx1536m` and leaves
parallel mode off, matching the `.cargo/config.toml` job cap from M4's Tauri
build for the same reason: this machine has 7.8 GB and no room to spare.

## Installing to a physical device

```
adb devices -l                                            # confirm it's connected & authorized
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.compass.agenda/.MainActivity
```

Needs USB debugging on in Developer Options, and tapping "Allow" on the
on-device RSA-key-authorization prompt the first time. No emulator on this
machine — see "What's still missing" below.

## Memory during setup

Free memory on this machine sits around 0.8–1.1 GB with normal apps running
(VS Code, Obsidian, Windows Defender, a few Claude Code sessions). A `winget
install` run in the background got killed by the low-memory guard during this
setup — re-running it in the **foreground** succeeded (it had, in fact,
actually finished; the background kill just raced the tail of the process).
If a build or install mysteriously dies, check free memory before assuming the
command itself is broken.

## The "Enable Custom URI scheme" setting

Creating the Android OAuth client (`docs/google-setup.md` §5) is not enough by
itself. Google now ships Android OAuth clients with custom-scheme redirects
**disabled by default** — the sign-in flow reaches Google, but fails with:

> Error 400: invalid_request — Custom URI scheme is not enabled for your
> Android client.

Fix it in **Google Cloud Console → Credentials** (or **Google Auth Platform →
Clients**) → the Android client → **Advanced settings** → enable **"Enable
Custom URI scheme"** (Google flags it as deprecated/not recommended — that's
fine; it's the standard installed-app PKCE pattern this whole setup already
uses, not a legacy workaround). This is a one-time, per-client setting, not
something the app or this repo can configure.

## Verified end to end (2026-09-09, Pixel 6 Pro over USB)

Sign-in, the custom-scheme OAuth redirect, and the Today page loading real
Calendar/Tasks data all work on a physical device. What's still open:

- **No emulator on this machine.** Only a physical device over `adb` has been
  tried. A machine with an AVD hasn't been used for M5 at all.
- **Release signing / M6.** This setup only covers debug builds.
