# CSS Android kiosk shell

This directory contains the native Android shell for the CSS trade kiosk.

## Current scope

The shell currently provides:

- portrait full-screen/immersive kiosk presentation;
- a hardened `WebView` that loads only `https://kiosk.csscdn.co.uk/`;
- JavaScript + DOM storage required by the Next.js kiosk UI;
- system-cookie support with third-party cookies disabled;
- cleartext HTTP and mixed-content blocking;
- TLS failures fail closed;
- no normal Android back-navigation escape;
- keep-screen-awake behaviour;
- a simple native network/WebView error screen with retry;
- standard Android `NfcAdapter` diagnostics when Android NFC is present;
- native capture of the TouchWo-installed Sycreader USB HID RFID reader;
- consumption of Sycreader keyboard-wedge events before they can reach WebView inputs;
- a same-origin `css-kiosk:rfid-card` event carrying the opaque card identifier into the kiosk UI;
- eligibility to act as the Android HOME application so a commissioned TouchWo can boot directly into CSS Kiosk;
- a P-256 Android Keystore device key scaffold and stable key-derived device id.

## TouchWo hardware acceptance

The commissioned TouchWo unit reports:

```text
Android:          12
Model/board:      rk3588
Physical size:    1080x1920
Physical density: 160
Override density: 186
Android NFC:      no system NFC service
```

The fitted card reader is visible through Android USB host mode as:

```text
Manufacturer: Sycreader RFID Technology Co., Ltd
Product:      SYC ID&IC USB Reader
USB VID:      0xFFFF
USB PID:      0x0035
Interface 0:  USB Standard Keyboard / HID boot keyboard
Interface 1:  USB Vendor HID
```

Android exposes the keyboard interface as an input device. A real card scan was confirmed to emit a numeric identifier followed by `KEY_ENTER` at keyboard-wedge speed.

`MainActivity` therefore filters key events by the exact Sycreader VID/PID, buffers only numeric keys, consumes both key-down and key-up events so the value cannot land in a focused email/password/search field, and emits the completed value only after the reader sends Enter. Leading zeroes are preserved and the value is treated as an opaque `uid` credential.

For development testing, the web kiosk listens for `css-kiosk:rfid-card` and feeds the physical card into the existing trusted-device development signer and `/api/nfc/resolve` flow. Production native enrollment/request signing remains a separate step; the physical reader bridge does not weaken the existing server-side device/session validation.

## Remaining K4 work

- native production device enrollment using the Android Keystore public key;
- native request signing for trusted kiosk API requests;
- replace the browser development signer in production;
- Android device-owner / lock-task provisioning;
- signed release APK/update process;
- remote update/recovery strategy;
- physical locker control.

## Open in Android Studio

Open the `android-shell` directory as an Android project.

The scaffold targets:

- Java 17;
- Android SDK 35;
- minimum Android API 23;
- Android Gradle Plugin 8.9.1.

On the first workstation sync, let Android Studio download the required SDK/Gradle components. If it offers a broad AGP upgrade, get the first debug build working before accepting upgrades.

## Install and test on the TouchWo

With USB or network ADB connected:

```powershell
adb devices
adb shell wm size
adb shell wm density
adb shell dumpsys usb
```

Build/install the debug APK from this directory:

```powershell
.\gradlew.bat installDebug
```

Keep the native shell log open while scanning:

```powershell
adb logcat -s CSSKioskShell
```

A successful physical card read should log only the capture length, not the card value:

```text
Sycreader RFID card captured length=...
```

The WebView should then move from `Tap your card to sign in` to the existing registered/unregistered card flow. Because the current physical-reader web bridge uses the development trusted-device signer, `kiosk.csscdn.co.uk` must be running the matching development branch for this acceptance test.

To inspect raw reader events during hardware diagnostics only:

```powershell
adb shell getevent -lt /dev/input/event10
```

Do not depend on `/dev/input/event10` in application code; Linux event numbers can change between boots. The app identifies the reader using Android `InputDevice` VID/PID instead.

## Make CSS Kiosk the permanent Home app

The manifest exposes `MainActivity` as both the normal launcher activity and an Android HOME activity. This deliberately uses the Android Home mechanism rather than a `BOOT_COMPLETED` activity launch: after Android has selected CSS Kiosk as its default Home application, the operating system returns to it naturally during boot.

After installing this build on the TouchWo, set it as Home over ADB:

```powershell
adb shell cmd package set-home-activity --user 0 uk.co.csscdn.kiosk/.MainActivity
```

Verify Android resolves HOME to CSS Kiosk:

```powershell
adb shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME
```

Then perform the real acceptance test:

```powershell
adb reboot
```

After Android finishes booting, CSS Kiosk should appear without manually opening the app. Verify the WebView reconnects, the customer card screen is visible and a Sycreader scan is still captured.

If the vendor firmware rejects `set-home-activity`, open Android's Home-app settings and select CSS Kiosk manually:

```powershell
adb shell am start -a android.settings.HOME_SETTINGS
```

That same Home-app settings screen is the commissioning recovery route if the stock launcher needs to be restored.

Being the default Home app is not the same as full Android kiosk lockdown. It gives us reliable boot-to-kiosk behaviour, but device-owner/Lock Task provisioning is still required before the unit is considered customer-proof against system navigation/settings access.

## WebView debugging

Debug builds enable WebView inspection. With the kiosk connected over ADB, desktop Chrome can inspect the native WebView at:

```text
chrome://inspect/#devices
```

The shell blocks navigation away from `kiosk.csscdn.co.uk`, so external links do not escape into a browser.

## Security note

The Android Keystore private key never leaves the device. Only the public key may be enrolled with the kiosk server. Native production enrollment/signing is still pending, so the current commissioning build deliberately keeps physical RFID authentication behind the existing development trusted-device signer rather than bypassing trust checks.
