# Android Studio setup for Memories TV

## 1. Install Android Studio

1. Download: https://developer.android.com/studio  
2. Install with defaults (Android SDK, Emulator, Platform-Tools).

## 2. Install a TV system image

1. **Settings / More Actions → SDK Manager**
2. **SDK Platforms** tab → check **Android 14 (API 34)** or **15 (API 35)**
3. **SDK Tools** tab → enable:
   - Android SDK Build-Tools
   - Android Emulator
   - Android SDK Platform-Tools
4. Apply / OK

## 3. Create a TV emulator

1. **Device Manager** (phone icon in toolbar)
2. **Create Virtual Device**
3. Category: **TV**
4. Hardware: **Television (1080p)** (or 4K if your machine is strong)
5. System image: pick one with **Google APIs** for your installed API level → Download if needed
6. Finish → Start the emulator

## 4. Open this project

1. **File → Open**
2. Select `free_file/tv` (the folder that contains `settings.gradle.kts`)
3. Trust / wait for **Gradle Sync**
4. Top run config: **app**
5. Target device: your TV emulator
6. Press **Run ▶**

## 5. Physical Android TV / Google TV (optional)

1. On the TV: **Settings → Device Preferences → About → Build** (tap 7×) to unlock Developer options  
2. Enable **USB debugging** / **Network debugging**
3. Same Wi‑Fi as your PC → in Android Studio **Pair using Wi‑Fi** or `adb connect <tv-ip>:5555`

## Notes

- This project uses **Compose for TV** (rows + focus), not a phone layout stretched to TV.
- UI is mock-only; no Memories API yet.
- For **Apple TV**, use Xcode + Swift — see `APPLE_TV.md`.
