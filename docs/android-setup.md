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
cd android
./gradlew.bat assembleDebug --no-daemon
```

`JAVA_HOME` must point at the JDK 21 install for this to succeed (see above).
`--no-daemon` matters on this machine: a lingering Gradle daemon JVM is exactly
the kind of background memory pressure that got a background install killed
during this setup (see the memory note below) — better to pay Gradle's JVM
startup cost each time than keep one resident.

`android/gradle.properties` already caps daemon heap at `-Xmx1536m` and leaves
parallel mode off, matching the `.cargo/config.toml` job cap from M4's Tauri
build for the same reason: this machine has 7.8 GB and no room to spare.

## Memory during setup

Free memory on this machine sits around 0.8–1.1 GB with normal apps running
(VS Code, Obsidian, Windows Defender, a few Claude Code sessions). A `winget
install` run in the background got killed by the low-memory guard during this
setup — re-running it in the **foreground** succeeded (it had, in fact,
actually finished; the background kill just raced the tail of the process).
If a build or install mysteriously dies, check free memory before assuming the
command itself is broken.

## What's still missing

- **The Android OAuth client itself.** `VITE_GOOGLE_ANDROID_CLIENT_ID` is
  still empty in `.env.local` — see `docs/google-setup.md` §5, now unblocked
  since `keytool` exists. Until it's filled in, the OAuth redirect intent
  filter falls back to a placeholder scheme
  (`app.compass.agenda.oauth.unconfigured`) so the build still succeeds, but
  sign-in on Android won't work.
- **No emulator, no physical device tested against.** The debug build has only
  been verified to *build* (`assembleDebug`, `BUILD SUCCESSFUL`) on this
  machine — not installed or run. That needs either a physical device over USB
  debugging, or a machine that can run an emulator.
- **Release signing / M6.** This setup only covers debug builds.
