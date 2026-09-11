# Releasing Compass

*Written for M6. How to cut a "v1" release of both shells — this is a
single-person, single-machine release, not a CI pipeline, so it's a checklist
to run by hand.*

## Windows — MSI / NSIS

Windows-signing decision (see `docs/SCOPE.md` §2 — no app store, personal
install only): **ship unsigned.** Windows SmartScreen shows an "Unknown
publisher" warning on first run; for a personal app installed on Fabrice's own
machine(s) that's a click-through, not real friction. Revisit only if Compass
ever leaves being a single-machine personal install — see the cost breakdown
in the M6 handoff for the alternatives (self-signed cert, a real code-signing
cert).

```bash
npx tsc -b && npm run lint && npm run test:run   # CLAUDE.md's pre-commit gate
npm run desktop:build
```

Must run on the Windows dev machine — `tauri build` bundles an MSI/NSIS
installer, which this repo's Linux/CI environments can't produce. Output
lands under `src-tauri/target/release/bundle/msi/` and `bundle/nsis/`.

Before calling a release done:

- [ ] Bumped `version` in `src-tauri/tauri.conf.json` **and** `package.json`
      (kept in sync — done for 1.0.0, see §"Versioning" below).
- [ ] Installed the MSI on a clean account/machine — confirms the installer
      doesn't assume dev-machine state (Rust toolchain, `node_modules`,
      `.env.local` sitting in the repo).
- [ ] Signed in, read real Calendar/Tasks data, wrote/read a note from the
      **installed** app, not a dev build.
- [ ] Confirmed the OAuth loopback flow resolves outside a dev environment
      (CLAUDE.md's ephemeral-port trap).
- [ ] Confirmed notes land in `Documents\Compass\` from the installed app.

## Android — signed APK

### One-time: the release keystore

```bash
keytool -genkeypair -v -keystore compass-release.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias compass
```

**This is the one artifact in the whole project that is unrecoverable if
lost.** Losing it means every future release is a new, differently-signed
APK Android treats as a different app — no seamless update, no carried-over
data. Store the `.jks` file and its passwords in a password manager, outside
the repo and outside any single machine. `android/.gitignore` excludes
`*.jks` and `keystore.properties` as a backstop, not the plan.

`android/keystore.properties` (gitignored, create by hand):

```properties
storeFile=/absolute/path/to/compass-release.jks
storePassword=...
keyAlias=compass
keyPassword=...
```

`android/app/build.gradle` already reads this file and wires it into the
`release` signing config (M6) — if the file is absent the release build type
falls back to unsigned, which still builds but produces an APK Android
refuses to install.

### Build

Same sequence `docs/android-setup.md` documents for debug, with
`assembleRelease`, on the Windows dev machine (JDK 21 as `JAVA_HOME`,
`--no-daemon` — see that doc's "Memory during setup"):

```bash
npm run build
npx cap sync android          # not optional — see android-setup.md
cd android
./gradlew.bat assembleRelease --no-daemon
```

Output: `android/app/build/outputs/apk/release/app-release.apk`.

Before calling a release done:

- [ ] `versionCode` / `versionName` in `android/app/build.gradle` bumped
      alongside the Tauri version (done for 1.0.0/`versionCode 1` as the
      first release).
- [ ] Installed over the existing debug build first to confirm no
      regression, then uninstalled debug (different signature, can't
      coexist) and did a clean install of the signed release APK.
- [ ] Re-verified sign-in end to end on the release build specifically.
- [ ] Confirmed "Enable Custom URI scheme" is still on for the Android OAuth
      client in Google Cloud Console (`docs/android-setup.md`) — a per-client
      setting this build can't break, but worth checking since it's the kind
      of thing that silently reverts.

## Versioning

Both shells carry the same version string for a given release, checked by
eye — there's no CI enforcing it:

- `src-tauri/tauri.conf.json` → `version`
- `package.json` → `version`
- `android/app/build.gradle` → `versionName` (plus `versionCode`, which just
  increments per release regardless of the version string)

v1 (M1–M6) ships as `1.0.0` / `versionCode 1`.

## Never commit

`*.jks`, `keystore.properties`, and Tauri's `src-tauri/target/` bundle output
never go in git. Ship the MSI/APK to the install target by hand.
