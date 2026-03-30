# 📱 KelionAI — Mobile Build Guide (iOS & Android)

## ✅ Status Configurare
- [x] Capacitor 8.x instalat
- [x] `capacitor.config.json` configurat cu Railway URL
- [x] Android folder generat
- [x] iOS folder generat
- [x] AndroidManifest.xml cu deep linking + permissions
- [x] Info.plist cu toate permisiunile iOS
- [x] Network Security Config (Android)
- [x] PWA Service Worker activ

---

## 🤖 ANDROID — Build & Publish

### Cerințe
- Android Studio Hedgehog+ (2023.1.1+)
- JDK 17+
- Android SDK 34

### Pași Build

```bash
# 1. Sync Capacitor (din root proiect)
cd /workspace/kelionai-v2
npx cap sync android

# 2. Deschide în Android Studio
npx cap open android

# 3. SAU build direct APK/AAB
cd android
./gradlew assembleRelease        # APK pentru test
./gradlew bundleRelease          # AAB pentru Play Store
```

### Semnare APK (Release)
```bash
# Generează keystore (o singură dată)
keytool -genkey -v -keystore kelionai-release.keystore \
  -alias kelionai -keyalg RSA -keysize 2048 -validity 10000

# În android/app/build.gradle adaugă:
# signingConfigs {
#   release {
#     storeFile file('../kelionai-release.keystore')
#     storePassword 'YOUR_STORE_PASSWORD'
#     keyAlias 'kelionai'
#     keyPassword 'YOUR_KEY_PASSWORD'
#   }
# }
```

### Google Play Store
1. Creează cont Google Play Developer ($25 one-time)
2. Creează aplicație nouă → "KelionAI"
3. Upload AAB din `android/app/build/outputs/bundle/release/`
4. Completează: descriere, screenshots, privacy policy
5. Submit pentru review (1-3 zile)

---

## 🍎 iOS — Build & Publish

### Cerințe
- Mac cu macOS 13+ (Ventura sau mai nou)
- Xcode 15+
- Apple Developer Account ($99/an)

### Pași Build

```bash
# 1. Sync Capacitor
cd /workspace/kelionai-v2
npx cap sync ios

# 2. Deschide în Xcode
npx cap open ios
```

### În Xcode:
1. Selectează target "App"
2. Signing & Capabilities → Team: selectează Apple Developer Account
3. Bundle Identifier: `com.kelionai.app`
4. Product → Archive
5. Distribute App → App Store Connect

### App Store Connect
1. Creează app nou pe https://appstoreconnect.apple.com
2. Bundle ID: `com.kelionai.app`
3. Upload build din Xcode Organizer
4. Completează metadata, screenshots, privacy
5. Submit pentru review (1-7 zile)

---

## 🔔 Push Notifications Setup

### Android (Firebase)
1. Creează proiect pe https://console.firebase.google.com
2. Add Android app → `com.kelionai.app`
3. Download `google-services.json` → pune în `android/app/`
4. În `android/build.gradle` adaugă: `classpath 'com.google.gms:google-services:4.4.0'`
5. În `android/app/build.gradle` adaugă: `apply plugin: 'com.google.gms.google-services'`

### iOS (APNs)
1. Apple Developer → Certificates → Push Notifications
2. Generează .p8 key
3. În Firebase Console → iOS app → upload .p8

---

## 🔗 Deep Linking

App răspunde la:
- `kelionai://chat` → deschide chat
- `kelionai://settings` → deschide settings
- `https://kelionai-v2-production.up.railway.app/*` → App Links

---

## 📊 App Store Assets Necesare

### Android (Google Play)
- Icon: 512x512 PNG
- Feature Graphic: 1024x500 PNG
- Screenshots: min 2, max 8 (phone + tablet)
- Short description: max 80 chars
- Full description: max 4000 chars

### iOS (App Store)
- Icon: 1024x1024 PNG (no alpha)
- Screenshots: 6.7" (1290x2796), 6.5" (1242x2688), 5.5" (1242x2208)
- Description + keywords
- Privacy Policy URL (OBLIGATORIU)

---

## 🚀 Quick Deploy Checklist

- [ ] `npx cap sync` rulat după ultimele modificări
- [ ] Server URL în capacitor.config.json corect
- [ ] google-services.json adăugat (Android)
- [ ] Signing certificate configurat
- [ ] Privacy Policy URL disponibil
- [ ] Screenshots pregătite
- [ ] App icons în toate dimensiunile

