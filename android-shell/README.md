# CSS Android kiosk shell

This directory is the first native Android shell for the CSS trade kiosk.

## Current scope

The first slice deliberately stays small so it can be validated on the real TouchWo hardware before we commit to any vendor-specific integration.

It currently provides:

- portrait full-screen/immersive kiosk presentation;
- a hardened `WebView` that loads only `https://kiosk.csscdn.co.uk/`;
- JavaScript + DOM storage required by the Next.js kiosk UI;
- system-cookie support with third-party cookies disabled;
- cleartext HTTP and mixed-content blocking;
- TLS failures fail closed;
- no normal Android back-navigation escape;
- keep-screen-awake behaviour;
- a simple native network/WebView error screen with retry;
- standard Android `NfcAdapter` reader mode diagnostics;
- NFC tag UID/technology logging under `CSSKioskShell`;
- a diagnostic same-origin `css-kiosk:nfc-tag` WebView event;
- a P-256 Android Keystore device key scaffold and stable key-derived device id.

The NFC event is **diagnostic only**. It does not bypass the existing trusted-device/session boundary and it is not yet used to authenticate a customer.

## Intentionally not implemented yet

These are the pieces to decide after the TouchWo hardware inspection:

- native production device enrollment;
- native request signing for the kiosk API;
- wiring real NFC reads into `/api/nfc/resolve`;
- Android device-owner / lock-task provisioning;
- boot receiver / managed auto-launch;
- TouchWo-specific NFC, USB, serial or GPIO SDK integration if standard Android NFC is not exposed;
- physical locker control.

## Open in Android Studio

Open the `android-shell` directory as an Android project.

The scaffold currently targets:

- Java 17;
- Android SDK 35;
- minimum Android API 23;
- Android Gradle Plugin 8.9.1.

On the first workstation sync, let Android Studio download the required SDK/Gradle components. If it offers a broad AGP upgrade, get the first debug build working before accepting upgrades.

## Tomorrow: hardware acceptance

Connect the TouchWo unit over USB and verify:

```powershell
adb devices
adb shell getprop ro.product.manufacturer
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk
adb shell wm size
adb shell wm density
adb shell pm list features | findstr /i nfc
adb shell dumpsys nfc
adb shell dumpsys usb
```

Run the debug build from Android Studio, then keep this log open:

```powershell
adb logcat -s CSSKioskShell
```

Expected startup messages include a Keystore device id and one of:

```text
Android NFC adapter present; enabled=true
```

or:

```text
No Android NFC adapter reported by this device
```

If standard NFC is available, present a real tag/card. We want to see:

```text
NFC tag discovered uid=... tech=...
```

That tells us whether K4 can use Android `NfcAdapter` directly or whether the TouchWo unit needs a vendor SDK/peripheral path.

## WebView debugging

Debug builds enable WebView inspection. With the kiosk connected over ADB, desktop Chrome can inspect the native WebView at:

```text
chrome://inspect/#devices
```

The shell blocks navigation away from `kiosk.csscdn.co.uk`, so external links do not escape into a browser.

## Security note

The Android Keystore private key never leaves the device. Only the public key may be enrolled with the kiosk server. The current shell does not yet enroll or trust that key server-side; that is the next native-device slice after real hardware acceptance.
