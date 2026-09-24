# EvacuAid Frontend

EvacuAid's mobile app for iOS and Android, built with Expo (SDK 57), React Native, and Expo Router.

The app uses a **development build** (`expo-dev-client`), so it does not run in Expo Go. You build the native app once, then Metro serves your JavaScript changes to it.

## Prerequisites

- **Node.js** 22 LTS or newer, with npm
- **Git**
- **The backend running.** See [`../backend/README.md`](../backend/README.md). The short version, from the repository root, is `docker compose up --build`.

For **Android**:

- [Android Studio](https://developer.android.com/studio) with the Android SDK and one emulator (AVD), or a physical device with USB debugging turned on
- JDK 17 (Android Studio bundles one)
- `ANDROID_HOME` set to your SDK location
- A Google Maps API key, if you need the map to render on Android

For **iOS** (macOS only):

- Xcode with the iOS Simulator
- CocoaPods (`brew install cocoapods`)

## Setup

From `frontend`:

```bash
npm install
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

Then edit `.env`:

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | Backend URL, as seen from your device (see below) |
| `ANDROID_GOOGLE_MAPS_API_KEY` | Google Maps key for Android. Leave it empty to skip the map. |
| `IOS_BUNDLE_IDENTIFIER` | iOS bundle ID (default `dev.evacuaid.foundation`) |
| `ANDROID_PACKAGE` | Android package name (default `dev.evacuaid.foundation`) |

Choose `EXPO_PUBLIC_API_BASE_URL` for the device you're running on:

| Device | URL |
| --- | --- |
| Android emulator | `http://10.0.2.2:8000` |
| iOS Simulator | `http://localhost:8000` |
| Physical phone (same Wi-Fi) | `http://<your-computer-LAN-IP>:8000` |

## Run

The first time you run the app, and again whenever native dependencies, `app.config.ts`, or native `.env` values change, build and install the native app:

```bash
npm run android     # builds, installs, and launches on an emulator or device
npm run ios         # macOS only
```

After that, start the dev server and open the installed app:

```bash
npm start
```

Press `a` (Android) or `i` (iOS) in the terminal, or open the EvacuAid app on your device. JavaScript changes hot-reload.

> `EXPO_PUBLIC_*` values are bundled at start time. If you change the API URL, restart `npm start`.
> The theme is generated from `scripts/generate-theme.cjs` before each start, build, lint, and typecheck, so you don't need to run it yourself.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Start Metro for the development build |
| `npm run android` / `npm run ios` | Build and run the native app |
| `npm run typecheck` | Type-check with TypeScript |
| `npm run lint` | Lint with ESLint (Expo config) |
| `npm test` | Run Jest tests |
| `npm run check:dependencies` | Check that dependency versions match the Expo SDK |
| `npm run doctor` | Run `expo-doctor` to diagnose project issues |

## Troubleshooting

- **The app can't reach the API.** Check that the backend answers at `http://<host>:8000/health`, that `EXPO_PUBLIC_API_BASE_URL` matches your device (table above), and that a physical phone is on the same Wi-Fi as your computer. Restart `npm start` after editing `.env`.
- **"No development build installed" or the app opens in Expo Go.** Run `npm run android` or `npm run ios` first.
- **The map is blank on Android.** Set `ANDROID_GOOGLE_MAPS_API_KEY`, then rebuild with `npm run android`.
- **Native build errors after pulling changes.** Run `npm install`, then rebuild the native app.
