# Android Development Setup

> **Objective**: Get from zero to `pnpm dev:android` running on your connected Android device.

## Prerequisites Overview

| Tool | Version | Purpose |
|------|---------|---------|
| JDK | 17+ | Compiles Kotlin/Java, runs Gradle |
| Android SDK | 36 (platform) | Target API for compileSdk / targetSdk |
| Android NDK | 27.0.x | Native Rust → ARM/x86 compilation |
| Rust Android targets | aarch64, armv7, i686, x86_64 | Cross-compilation to Android ABIs |
| ADB | any recent | Device communication (install, logcat, reverse) |

---

## 1. Install Android SDK & NDK

### Arch Linux

```bash
# Command-line tools (sdkmanager) + platform tools (adb)
yay -S android-sdk-cmdline-tools-latest android-sdk-platform-tools

# Then install the specific SDK/NDK versions Biblioteca needs
sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.0.12077973"
```

> **Note**: These packages install to `/opt/android-sdk`. If you already have SDK components elsewhere
> (Android Studio, etc.), adjust `ANDROID_HOME` accordingly.

### macOS

```bash
brew install --cask android-commandlinetools
# OR: download from https://developer.android.com/studio#command-line-tools-only
# Extract to ~/Library/Android/sdk

sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.0.12077973"
```

### Windows

1. Download command-line tools from [developer.android.com/studio#command-line-tools-only](https://developer.android.com/studio#command-line-tools-only)
2. Extract to `C:\android-sdk`
3. Open a terminal and run:

```powershell
cd C:\android-sdk\cmdline-tools\latest\bin
.\sdkmanager.bat "platforms;android-36" "build-tools;36.0.0" "ndk;27.0.12077973"
```

---

## 2. Environment Variables

Add these to your shell profile (`~/.profile`, `~/.zshrc`, or `~/.bashrc`):

```bash
export ANDROID_HOME="/opt/android-sdk"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk 2>/dev/null | sort -V | tail -1)"
export JAVA_HOME="/usr/lib/jvm/default"   # or your JDK path
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

After adding, reload: `source ~/.profile`

| OS | Typical `ANDROID_HOME` |
|----|----------------------|
| Arch (AUR) | `/opt/android-sdk` |
| macOS (brew) | `~/Library/Android/sdk` |
| macOS (manual) | `~/Library/Android/sdk` |
| Windows | `C:\android-sdk` |
| Android Studio | `~/Android/Sdk` |

---

## 3. Rust Android Targets

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Verify:

```bash
rustup target list --installed | grep android
# Expected output: 4 targets listed
```

---

## 4. USB Debugging Setup

### Enable on your device

1. **Settings → About phone → Build number** — tap 7 times to unlock Developer Options
2. **Settings → Developer options → USB debugging** — toggle ON
3. Connect device via USB cable
4. Accept the RSA key prompt on the device ("Always allow from this computer")

### Verify connectivity

```bash
adb devices
# List of devices attached
# XXXXXXXXX   device    ← must say "device", not "unauthorized"
```

> **unauthorized** means accept the RSA prompt on the phone screen.
> **offline** means unplug, re-plug, and re-run `adb devices`.

---

## 5. Network Setup

### Preferred: Same WiFi network

Ensure your dev machine and Android device are on the **same WiFi network**.
Tauri Auto-Discovery (`beforeDevCommand`) detects your machine's LAN IP and the device connects to it automatically.

### Fallback: USB reverse tunnel

If WiFi isn't an option (or you're on a restrictive network), use ADB reverse:

```bash
adb reverse tcp:3000 tcp:3000
```

Run this **before** `pnpm dev:android`. It tunnels port 3000 over USB so the device sees the
dev server at `localhost:3000`.

> Run this once per USB connection session. If you disconnect and reconnect, re-run it.

---

## 6. First Build Warning

The first `pnpm dev:android` run compiles:

- **Rust**: All 4 Android targets (arm64, armv7, x86, x86_64) — includes native libraries
- **Gradle**: Kotlin + Java bytecode + resource packaging

⏱️ **Expect 15–30 minutes** on the first run. Subsequent builds are incremental and take seconds.

---

## 7. Quick Start

```bash
# 1. Connect device via USB, enable debugging, authorize
adb devices

# 2. Start development
cd apps/readest-app
pnpm dev:android

# 3. Open devtools in the app (shake device or use Chrome DevTools)
```

> `pnpm dev:android` runs `tauri android dev --features devtools` which:
> - Starts Next.js dev server (`pnpm dev`) via `beforeDevCommand`
> - Compiles Rustaarch64 (debug) for the connected device's ABI
> - Installs the debug APK via `adb`
> - Launches the app connected to the dev server

---

## 8. Release Build

When you need a production APK (same as the old `dev-android`):

```bash
pnpm build:android
```

This runs a full release build (minified, ProGuard'd, signed) and installs it via `adb install -r`.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `adb: command not found` | platform-tools not in PATH | Add `$ANDROID_HOME/platform-tools` to PATH |
| `sdkmanager: command not found` | cmdline-tools not installed or not in PATH | `yay -S android-sdk-cmdline-tools-latest` and check PATH |
| `ANDROID_HOME not set` | env var missing | Add `export ANDROID_HOME=/opt/android-sdk` to `~/.profile` |
| `NDK not found` | NDK not installed via sdkmanager | `sdkmanager "ndk;27.0.12077973"` |
| Device shows white screen | Device can't reach dev server | Run `adb reverse tcp:3000 tcp:3000`, ensure same WiFi |
| `error: linker cc not found` | Missing Android NDK or wrong version | Verify `ls $ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin` |
| Gradle fails: `compileSdkVersion 36 not found` | Missing SDK platform | `sdkmanager "platforms;android-36"` |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Release APK installed, switching to debug | Uninstall app first: `adb uninstall io.github.Napster0x.biblioteca` |
| Build takes >5 min after first run | Rust incremental compilation issue | Check that `target/` directory wasn't cleaned; use `cargo clean` only as last resort |
| Emulator not detected | Emulator uses different adb server | Start emulator from AVD Manager, then `adb devices`; or use `adb connect localhost:5555` |

### SDK Not Found

If `tauri android dev` reports "Android SDK not found" even after setting env vars,
create a `local.properties` file in `src-tauri/gen/android/`:

```properties
sdk.dir=/opt/android-sdk
```

### Diagnostic Checklist

- [ ] `echo $ANDROID_HOME` outputs a valid path
- [ ] `ls $ANDROID_HOME/platforms/android-36` exists
- [ ] `ls $ANDROID_HOME/build-tools/36.0.0` exists
- [ ] `ls $ANDROID_NDK_HOME` exists
- [ ] `echo $JAVA_HOME` points to JDK 17+
- [ ] `rustup target list --installed | grep android` shows 4 targets
- [ ] `adb devices` shows at least one `device`
