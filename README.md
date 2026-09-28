# LibreTune for Android — unofficial port

> **Unofficial.** This is a community port of [LibreTune](https://github.com/RallyPat/LibreTune)
> by RallyPat and the LibreTune contributors. It is not affiliated with or endorsed by the
> LibreTune project. Upstream's own README is kept as [README.upstream.md](README.upstream.md).

LibreTune is open-source ECU tuning software (rusEFI, FOME, epicEFI, Speeduino, MegaSquirt INI
definitions). This port runs it **on an Android phone**, talking to the ECU directly over a USB OTG
cable, with no root and no PC.

There is a sister edition with the whole interface redone in the Windows Phone 8.1 style:
**[libretune-wp81-unofficial](https://github.com/RudolfsUiska/libretune-wp81-unofficial)**. The two
install side by side.

## Download

Get the APK from **[Releases](https://github.com/RudolfsUiska/libretune-android-unofficial/releases)**.

- Android 7.0 or newer, **arm64** phones (practically every phone from the last several years).
- It's a sideloaded app: allow installing from your browser or file manager when Android asks.
- Plug in the ECU with an OTG cable. Android offers to open LibreTune and grants USB access.

## What the port adds

- **USB serial driver in the app.** Android has no `/dev/ttyUSB*`, so LibreTune drives the USB
  bridge itself over raw USB (`crates/libretune-core/src/protocol/android_usb.rs`):
  - **CDC-ACM** (STM32/rusEFI, Teensy, Arduino 16U2) is tested on a rusEFI uaEFI, connecting,
    live data and logging.
  - **FTDI, CP210x and CH34x** are implemented and unit-tested, but not yet tried on real
    hardware.
- **Android glue**: USB permission flow and a device filter, so plugging in offers to open the app.
  A folder picker imports TunerStudio projects. `$HOME` is set so settings and projects have a place
  to live. Back sends the app to the background instead of killing a live ECU session.
- **Phone layout**: UI scale (100/150/200%) with a burger menu, fullscreen dashboards and tabs,
  and a table *Fit* mode that sizes a whole VE table to the screen.
- **Built-in dashboards**: see below.

Details, design notes and the test history are in [ANDROID_USB_HANDOFF.md](ANDROID_USB_HANDOFF.md).

## Dashboards

Besides LibreTune's own dashboards and any TunerStudio `.dash` you import, three built-in dashboards
come with the app. Pick one from the dashboard's **Change ▼** menu, under *Built-in*:

| Dashboard | Look |
|---|---|
| **Cassette Futurism** | Amber phosphor on scorched brown: stepped RPM meter, LCD readouts, warning LEDs (after NovusGFX's retro design system, MIT) |
| **Montego LCD** | The 1984 MG Montego's LCD cluster: diagonal ramp tacho, seven-segment readouts, bar gauges |
| **CS 1.6** | A Counter-Strike 1.6 style game window (after ekmas/cs16.css, MIT) |

They show RPM, boost, coolant, AFR and battery, read from rusEFI channel names with Speeduino
fallbacks. The warning limits are in `crates/libretune-app/src/components/dashboards/engineReadings.ts`.
The CS 1.6 dashboard was designed with a pixel font that is not included (its licence is
undocumented), so it uses Verdana.

## Build it yourself

On Windows with Git Bash, with Rust (`rustup target add aarch64-linux-android`), Node.js, a JDK 17,
and the Android SDK with NDK 27:

```bash
cd crates/libretune-app && npm ci && cd ../..
export JAVA_HOME=/path/to/jdk-17 ANDROID_HOME=/path/to/Android/Sdk
bash scripts/build-android.sh            # debug APK
bash scripts/build-android.sh --release  # release APK (set KEYSTORE/KEYSTORE_PASS to sign)
```

The script's header explains a Windows-specific step: Tauri symlinks the native library, and
Windows refuses that without Developer Mode.

## Status and safety

Tested on a Samsung Galaxy A34 (Android 14) with a rusEFI uaEFI. Writing a tune to an ECU can
stop an engine from running or damage it. This is early, unofficial software with no warranty. Keep
restore points and know how to recover your ECU.

## License

GPL-2.0-only, the same as upstream ([LICENSE](LICENSE)). Third-party notices, including the
dashboard design sources, are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). All credit for
LibreTune itself goes to its authors.
