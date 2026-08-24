# @reprojs/expo

Expo SDK for [Repro](https://github.com/Ripwords/reprojs) — submit annotated screenshots, logs, and device context to your self-hosted Repro dashboard.

## Before you install

Grab two values from your Repro dashboard:

1. **Project key** — project → **Settings** → **Security** → **Public SDK key**. A new project shows `(not generated)`; click **Rotate key** once (owner-only) to mint the first `rp_pk_…`.
2. **Intake URL** — your dashboard origin + `/api/intake`.

Leave the project's origin allowlist **empty**. Mobile apps send no `Origin` header, and intake accepts reports whose context is `source: "expo"` without one.

## Install

```bash
npx expo install @reprojs/expo \
  react-native-view-shot react-native-svg react-native-gesture-handler \
  @react-native-async-storage/async-storage @react-native-community/netinfo \
  expo-device expo-constants \
  expo-document-picker expo-image-picker
```

Add the config plugin to `app.json`:

```json
{
  "expo": {
    "plugins": ["@reprojs/expo"]
  }
}
```

## EAS builds

`EXPO_PUBLIC_*` values are inlined at build time and EAS scopes variables per environment. If the pair is set for `development`/`preview` but not for the environment your release profile declares, the SDK sees empty strings, **silently disables itself, and the launcher never renders**.

```bash
eas env:list --environment production
```

Rebuild after adding them — an OTA update cannot change a baked-in value.

## Usage

```tsx
import { ReproProvider, ReproLauncher, useRepro } from "@reprojs/expo"
import { GestureHandlerRootView } from "react-native-gesture-handler"

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ReproProvider
        config={{
          projectKey: "rp_pk_...",
          intakeUrl: "https://your-dashboard.com/api/intake",
        }}
      >
        <YourApp />
        <ReproLauncher />
      </ReproProvider>
    </GestureHandlerRootView>
  )
}

function MyScreen() {
  const repro = useRepro()
  return <Button title="Report" onPress={() => repro.open()} />
}
```

## Pointing at a local dashboard

`localhost` resolves to the *device*, not your laptop:

| Running on | `intakeUrl` host |
| --- | --- |
| iOS Simulator | `http://localhost:3000` |
| Android Emulator | `http://10.0.2.2:3000` |
| Physical device | `http://<your-LAN-IP>:3000` |

Plain `http://` only works in debug builds (Expo's generated iOS `Info.plist` sets `NSAllowsLocalNetworking`; the Android **debug** manifest sets `usesCleartextTraffic="true"`). Release builds must use `https://`.

## Expo SDK 56+

Expo SDK 56 replaced the global `fetch` with its WinterCG implementation, which does not accept React Native's `{ uri, name, type }` file parts. Versions up to 0.3.2 therefore lost **every report carrying a screenshot**, silently — the wizard reported success and the report was discarded after 10 retries. Fixed in the release following 0.3.2; the stopgap is `EXPO_PUBLIC_USE_RN_FETCH=1` plus a rebuild.

## Expo Go

This SDK depends on `react-native-view-shot`, which requires a development build. It will no-op in Expo Go with a dev-mode warning. Run `npx expo run:ios` or `npx expo run:android` to use the full SDK.

Those are native builds: iOS needs Xcode **plus its iOS platform component** (Xcode → Settings → Components, or `xcodebuild -downloadPlatform iOS`) and a simulator runtime; Android needs an AVD created in Android Studio's Device Manager. Without them `run:ios` / `run:android` fails to find any destination.

## What gets captured

Every report bundles:

- Annotated screenshot (PNG)
- Console logs (last 200 entries)
- Fetch network requests (last 100)
- User breadcrumbs (`repro.log(event, data)`)
- Device context: OS, version, model, app version, locale, connectivity

Session replay is **not** supported in the mobile SDK.

## License

MIT
