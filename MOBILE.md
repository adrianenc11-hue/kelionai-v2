# Kelion — Native Mobile Apps (iOS + Android)

This repo includes native iOS and Android projects built with [Capacitor](https://capacitorjs.com).

## Approach: Remote-Web Wrapper

The native app is a thin WebView shell that loads `https://kelionai.app` directly.
All UI updates ship instantly to every installed app the moment Railway redeploys —
you do **not** need to resubmit to the App Store / Play Store for normal feature
changes. You only need to rebuild + resubmit when:

- Native permissions change (edit `ios/App/App/Info.plist` or
  `android/app/src/main/AndroidManifest.xml`)
- Capacitor plugins are added/removed
- App icon / splash screen / bundle id / version changes

See `capacitor.config.json` for the `server.url` and allowed-navigation list
(currently permits `kelionai.app`, `checkout.stripe.com`, Google OAuth domains).

---

## Android

### Build a debug APK (installable on phone via USB)

```bash
# one-time: install JDK 21 and Android SDK (36)
sudo apt install -y openjdk-21-jdk-headless
# then install Android cmdline-tools + platforms;android-36 + build-tools;36.0.0
# (see scripts/android-sdk-setup.sh for a working recipe)

export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=$HOME/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

### Install on a phone via USB

1. Enable Developer Options → USB debugging on the device
2. `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`

### Release (Play Store)

1. Generate a keystore once:
   ```bash
   keytool -genkey -v -keystore kelion-release.jks -alias kelion \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
   Store it safely — losing it = can never update the same Play listing.
2. Add credentials to `android/keystore.properties` (gitignored):
   ```
   storeFile=../kelion-release.jks
   storePassword=…
   keyAlias=kelion
   keyPassword=…
   ```
3. Build:
   ```bash
   cd android
   ./gradlew bundleRelease
   # AAB: android/app/build/outputs/bundle/release/app-release.aab
   ```
4. Upload `app-release.aab` to Google Play Console → Internal testing first.

---

## iOS

**iOS builds require macOS + Xcode.** You cannot build/sign iOS apps from Linux —
this is an Apple restriction.

1. On a Mac, clone the repo and run:
   ```bash
   cd ios/App
   pod install   # or: npx cap sync ios
   open App.xcworkspace
   ```
2. In Xcode:
   - Signing & Capabilities → pick your Apple Developer team
   - Bundle Identifier: `app.kelionai.mobile` (or change it — make sure it matches
     App Store Connect)
   - Product → Archive
   - Distribute App → App Store Connect
3. In App Store Connect, submit for review.

---

## Syncing web changes into the native shells

If the web bundle ever changes in a way that affects the fallback (only relevant
if you stop using `server.url`), regenerate the native assets:

```bash
npm run build          # builds Vite → dist/
npx cap sync           # copies dist/ into android + ios native projects
```

---

## Permissions (already configured)

### Android (`AndroidManifest.xml`)
- `INTERNET`, `ACCESS_NETWORK_STATE`
- `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`
- `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`
- `READ_EXTERNAL_STORAGE` (≤ SDK 32), `READ_MEDIA_IMAGES`

### iOS (`Info.plist`)
- `NSCameraUsageDescription`
- `NSMicrophoneUsageDescription`
- `NSLocationWhenInUseUsageDescription`
- `NSPhotoLibrary{,Add}UsageDescription`

Edit the strings in those files to tweak the wording shown to the user in the
OS permission prompts.
