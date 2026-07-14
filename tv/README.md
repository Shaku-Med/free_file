# Memories TV

Android TV app for Memories. **UI/layout only** for now (mock data, no API).

Apple TV is a **separate** project (Swift / SwiftUI in Xcode) — see `APPLE_TV.md`.

## Open in Android Studio

1. Install [Android Studio](https://developer.android.com/studio) (Hedgehog or newer).
2. **More Actions → SDK Manager**
   - SDK Platforms: install a recent API (34 or 35)
   - SDK Tools: Android SDK Build-Tools, Android Emulator, Android SDK Platform-Tools
3. **File → Open** → select this folder: `free_file/tv`
4. Wait for Gradle sync.
5. **Device Manager → Create Device → TV**
   - Pick **Television** → e.g. `Television (1080p)` → system image with Google APIs
6. Run the `app` configuration on the TV emulator.

## Run from CLI (optional)

```bash
cd free_file/tv
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

On Windows use `gradlew.bat`.
