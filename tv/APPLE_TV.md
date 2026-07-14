# Apple TV (tvOS)

**Yes — use Swift (SwiftUI) in Xcode on a Mac.**  
Android Studio cannot build Apple TV apps.

## Why Swift?

| Platform | IDE | Language | UI |
|----------|-----|----------|----|
| Android TV / Google TV | Android Studio | Kotlin | Compose for TV / Leanback |
| Apple TV | Xcode (macOS only) | **Swift** | **SwiftUI** (recommended) or UIKit + TVUIKit |
| Fire TV | Android Studio | Kotlin | Same as Android TV |

Apple requires tvOS apps distributed through the App Store. That means:

1. A **Mac**
2. **Xcode**
3. An **Apple Developer** account (for device / store)
4. A **tvOS** target (not iOS-only)

## Create a tvOS project in Xcode

1. Open **Xcode** → **File → New → Project**
2. Choose **tvOS → App**
3. Product name: `MemoriesTV` (or similar)
4. Interface: **SwiftUI**, Language: **Swift**
5. Save it somewhere like `free_file/tv-apple/` (separate from this Android TV folder)

Focus / remote rules differ from phones:

- Design for the **Siri Remote** (focus engine, large hit targets)
- Prefer **10-foot UI** (big text, clear rows)
- Use `TabView`, `List`, and focus modifiers (`focusable`, `focused`)

## Suggested layout later

Keep platforms split:

```
free_file/
  desktop/     # Electron (Windows/macOS/Linux)
  tv/          # Android TV (this folder)
  tv-apple/    # SwiftUI tvOS (create on a Mac in Xcode)
  app/         # Web app
```

Do **not** try to ship one Android APK to Apple TV. They are different stores and runtimes.
