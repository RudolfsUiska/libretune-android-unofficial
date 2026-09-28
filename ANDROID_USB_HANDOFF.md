# Handoff — Android USB-serial transport for LibreTune

Status (2026-09-26, session 2): **driver compiled and unit-tested on Linux; Android app layer
written; APK builds (see §9). Nothing tested against a real adapter or ECU yet.**

> Sections 1-8 are the original handoff, kept for context. Where they disagree with
> §9, **§9 is current** - several claims in §3-§5 were wrong and are corrected there.

Work sits on upstream `037e4856ebb7722ee53525de213bce0c051f03d9` (2026-09-25), an
unmodified `--depth 1` clone of https://github.com/RallyPat/LibreTune (GPL-2.0).
Working copy: `C:\Users\Rudolfs\Documents\android7\work\LibreTune`.

---

## 1. The problem being solved

LibreTune talks to ECUs through the Rust `serialport` crate, which opens a **path**
like `/dev/ttyUSB0`. **Android has no such node.** An unrooted Android process is
not allowed to enumerate USB or bind a kernel serial driver, so `serialport` can
never reach an ECU there. This is not a permissions bug to work around — the device
node does not exist.

How apps like RealDash and Shadow Dash MS do it instead:

1. Ask `UsbManager` for permission (the dialog that appears when you plug in an adapter)
2. Get a `UsbDeviceConnection`, claim the interface
3. Drive the bridge chip with **raw USB bulk transfers**, implementing the
   FTDI/CP210x/CH34x/CDC-ACM protocol in their own code

**The app is the serial driver.** No kernel driver, no root. That is what this work
implements for LibreTune.

Outside an APK the same descriptor is obtainable via `termux-usb -r`, and a Linux
process can adopt it with `libusb_wrap_sys_device()` — exposed by `rusb` as
`Context::open_device_with_fd()`.

---

## 2. Why this was cheap: the codebase already had the seam

`crates/libretune-core/src/protocol/stream.rs` defines:

```rust
pub trait CommunicationChannel: Read + Write + Send {
    fn set_timeout(&mut self, timeout: Duration) -> io::Result<()>;
    fn clear_input_buffer(&mut self) -> io::Result<()>;
    fn clear_output_buffer(&mut self) -> io::Result<()>;
    fn try_clone(&self) -> io::Result<Box<dyn CommunicationChannel>>;
    fn bytes_to_read(&mut self) -> io::Result<u32>;
}
```

Already implemented by `SerialChannel` and `TcpChannel`, and selected by a `match`
in `Connection::connect()`. Adding a transport means **implementing this one trait
and adding a match arm** — no refactor of the 96k-line codebase.

`Box<dyn SerialPort>` appears only 8 times, confined to `serial.rs` and `stream.rs`.

---

## 3. What was changed

```
?? crates/libretune-core/src/protocol/android_usb.rs   (new, 402 lines)
 M crates/libretune-core/src/protocol/connection.rs    (+30)
 M crates/libretune-core/src/protocol/mod.rs           (+1)
 M crates/libretune-core/Cargo.toml                    (+10)
 M Cargo.lock                                          (+23)
```

### `android_usb.rs` — the driver

`AndroidUsbChannel`, implementing `CommunicationChannel`. Entry point:

```rust
AndroidUsbChannel::from_fd(fd: i32, baud: u32) -> io::Result<Self>
```

It **never opens a device by VID/PID** — on Android that is not permitted. The
descriptor must be supplied by the platform.

Bridges supported, each with its own line-configuration path:

| Bridge  | Seen on                                      |
|---------|----------------------------------------------|
| CDC-ACM | Arduino Mega (16U2), Teensy, STM32 / rusEFI  |
| FTDI    | FT232R and relatives                         |
| CP210x  | Silicon Labs                                 |
| CH34x   | CH340/CH341, common on Arduino clones        |

Design decisions worth preserving:

- **Packet→stream buffering.** Bulk reads return packets; `Read` callers expect a
  byte stream. Leftovers are held in `pending`.
- **FTDI status bytes.** FTDI prepends two modem-status bytes to *every* IN packet.
  They are stripped via `strip_status_bytes`. Forgetting this corrupts every read.
- **`try_clone()` deliberately returns `Unsupported`.** A USB interface claim is
  exclusive; a second handle on the same endpoints would interleave transfers and
  corrupt framing. An explicit error beats silent corruption. **Check whether any
  caller relies on `try_clone()` succeeding** — `TcpChannel` and `SerialChannel`
  both support it, so a code path may assume it.
- **Timeouts mirror `serialport` semantics** (timeout → `ErrorKind::TimedOut`) so the
  protocol layer's existing retry logic behaves the same across all three transports.
- CDC-ACM and FTDI paths raise **DTR|RTS**; many boards never transmit otherwise.

### Wiring

- `ConnectionType::AndroidUsb` variant
- `ConnectionConfig.usb_fd: Option<i32>`
- Match arm in `Connection::connect()` (`connection.rs`, in the
  `match self.config.connection_type` block)
- `pub mod android_usb;` in `protocol/mod.rs`
- `rusb = { version = "0.9", optional = true }` in `[dependencies]`, plus
  `[features] usb-serial = ["dep:rusb"]`

### Feature gating — read this before changing it

The backend is gated on **`cfg(all(feature = "usb-serial", unix))`**, not on
`target_os = "android"`. Two reasons:

1. `rusb::Context::open_device_with_fd` is compiled **only on Linux and Android**.
   File-descriptor adoption has no Windows equivalent.
2. `std::os::unix::io::RawFd` does not exist on Windows, so `from_fd` takes a plain
   `i32` (which is what JNI hands over anyway).

The feature is **off by default**, so existing desktop builds gain no libusb
dependency. A non-matching build gets a stub `from_fd` returning `Unsupported`,
which is what lets `connection.rs` reference the variant without `cfg` sprinkling.

Gating on a feature rather than the target also means desktop Linux can use this
backend — useful when you would rather not depend on tty nodes and `dialout`
membership.

---

## 4. Verification status — be precise about this

| Check | Result |
|---|---|
| `cargo check -p libretune-core` (host, feature off) | **PASS**, 2m33s |
| `cargo check -p libretune-core --features usb-serial` (host) | **PASS**, 16.6s |
| `cargo check --target aarch64-linux-android` | **FAILED — not on this code** |
| The actual USB driver body | **NEVER COMPILED** |

Two things a successor must understand:

**The Android target failure is pre-existing.** It dies in `zstd-sys`, a transitive
**C** dependency of LibreTune, with
`cc-rs: failed to find tool "clang.exe"` — there is no Android NDK on this machine.
It never reached `android_usb.rs`. Any Android build of this project needs the NDK
regardless of this work.

**The Windows pass does not validate the driver.** Everything inside
`cfg(all(feature = "usb-serial", unix))` is excluded on Windows, so the host build
only ever compiles the stub. The endpoint discovery, interface claim and all four
chip configuration paths **have not been compiled even once.** Assume they contain
errors until proven otherwise.

### How to close that gap (either works)

**Docker** — installed here (v29.6.1) but the daemon was not running:

```bash
docker run --rm -v "$PWD":/src -w /src rust:slim \
  sh -c "apt-get update && apt-get install -y pkg-config libusb-1.0-0-dev && \
         cargo check -p libretune-core --features usb-serial"
```

**Or a standalone crate on any Linux box.** Copy `android_usb.rs` plus a stub
`CommunicationChannel` trait into a fresh crate with `rusb`. Compiles in minutes
even on weak hardware, and avoids building all of LibreTune.

---

## 5. What is NOT done

### 5a. The Android app layer — the largest remaining piece

LibreTune is a **Tauri 2** app and has **no Android scaffolding**: `gen/android`
returns 404 in every expected location, and no release asset is an APK. Required:

1. `npm run tauri android init` to generate the scaffolding
2. Android SDK **and NDK**, plus `cargo-ndk`; Rust targets `aarch64-linux-android`
   etc. The NDK is mandatory — the project has C dependencies (`zstd-sys` at minimum)
3. A Kotlin shim that:
   - filters for USB-serial devices (or uses a `device_filter.xml` intent-filter so
     plugging in the adapter offers to launch the app)
   - calls `UsbManager.requestPermission()`
   - opens the device and calls `UsbDeviceConnection.getFileDescriptor()`
4. JNI plumbing to hand that `int` to Rust and set `ConnectionConfig.usb_fd`, then
   connect with `ConnectionType::AndroidUsb`
5. UI: the connection dialog needs an Android-USB option and a device picker

**Do not `dup()` or close the descriptor on the Kotlin side while in use.** libusb
takes ownership. Keep the `UsbDeviceConnection` alive for the session's lifetime.

### 5b. Hardware testing — nothing has touched a real ECU

The parts to distrust most, because they are transcriptions of hardware quirks
rather than logic:

- **`ftdi_divisor()`** — 3 MHz base clock with sub-integer divisors packed into the
  top three bits. A wrong divisor produces a connection that looks healthy and
  returns garbage.
- **`ch34x_divisor()`** — prescaler search; the init sequence before the divisor
  takes effect is order-sensitive.
- **CH34x support generally** is the least confident of the four.

Test order suggestion: CDC-ACM first (simplest, no vendor requests, and covers
rusEFI/Teensy), then FTDI, then CP210x, then CH34x.

There are three unit tests at the bottom of the file covering bridge identification
and the divisor maths. They are pure-logic tests and run without hardware, but they
only pass with `--features usb-serial` on a unix target.

---

## 6. Upstream contribution

This is a clone, not a fork — no remote configured for pushing, no branch created.
If upstreaming:

- License is **GPL-2.0**; contributions must match
- See `CONTRIBUTING.md` and `AGENTS.md` in the repo root
- The feature-gated approach was chosen partly to be upstream-friendly: default
  builds are unaffected, and the backend is useful beyond Android
- Worth raising as an issue first — the maintainer may have opinions about Android
  support direction before a large PR appears

---

## 7. Environment notes

- Rust 1.98.1 installed at `~/.cargo` via rustup (host `x86_64-pc-windows-msvc`;
  `aarch64-linux-android` target added, though unusable without the NDK)
- A host C toolchain exists — `zstd-sys` and `libusb1-sys` both build for Windows
- Docker Desktop installed, daemon stopped. WSL present but only the
  `docker-desktop` distro, which is not a general-purpose build environment
- `adb` at `C:\Users\Rudolfs\Documents\android7\platform-tools\adb.exe`; the target
  phone is a Samsung SM-A346B (Galaxy A34 5G), Android 14, `arm64-v8a`

## 8. If the goal is just "tune from the phone today"

This work is worthwhile but unfinished. The pragmatic alternative, unchanged:
**Shadow Dash MS** (EFI Analytics' native Android app) for gauges and logging, with
actual tuning on an x86 Linux machine where `serialport` works normally.

---

## 9. Session 2 (2026-09-26): what is now true

### 9a. Driver: compiled, fixed, unit-tested

First real compile of the `usb-serial` body happened in Docker (`rust:slim`,
`cargo test -p libretune-core --features usb-serial --lib android_usb`): **4/4 tests
pass.** Before that, a review found bugs that would each have broken a chip:

| Bug | Effect | Fix |
|---|---|---|
| libusb timeout `0` means **infinite** | `bytes_to_read()` blocked forever on an idle link | `MIN_USB_TIMEOUT` (1 ms) clamp on every transfer |
| FTDI status bytes stripped once per *transfer* | a 512-byte read spans 8 full-speed packets; 7 headers leaked into the data | strip per `max_packet_size` chunk |
| CP210x used request `0x03` for DTR/RTS, request type `0x40` | line never set to 8N1; DTR/RTS never raised | `0x41` (vendor/interface); `SET_LINE_CTL 0x0800`, `SET_MHS 0x0303` |
| CH34x wrote legacy register `0x0F2C` with a mixed encoding | wrong baud | ported Linux `ch341_get_divisor`; test pins 115200→`0xCC03`, 9600→`0xB202` |
| CDC-ACM line coding sent to the *data* interface | ignored by strict devices; bound `cdc_acm` never detached | find + claim the comm interface (class 2/2) |
| no `disable_device_discovery()` | `libusb_init` fails under Android SELinux (netlink, bus scan) | called before `Context::new()` |

Also added: FTDI latency timer → 1 ms (default 16 ms stalls short replies),
multi-port FTDI index encoding, `NoDevice` → `ErrorKind::NotConnected`.

**Correction to §3/§5a:** libusb does **not** take ownership of a wrapped fd (rusb
docs say so explicitly). The Kotlin side keeps it open.

`try_clone()` returning `Unsupported` is safe: no caller in the connection path uses it.

### 9b. Android app layer: done, runs on the A34

- **Toolchain** (not in the repo): JDK 17 at `C:\Users\Rudolfs\Android\jdk-17.0.20.1+1`,
  SDK at `C:\Users\Rudolfs\Android\Sdk` (platforms 34+36, build-tools 34+35,
  NDK 27.2.12479018). The §4 `zstd-sys` failure was only the missing NDK.
- **`src-tauri/gen/android/`**: generated by `tauri android init`, then edited:
  - `UsbSerialPlugin.kt`: `listDevices` / `openDevice` (permission dialog → fd).
    Port keys are `vid:pid`, so they survive a replug; duplicates get `@/dev/bus/usb/...`.
  - `AndroidManifest.xml`: `usb.host` feature (not required), and a
    `USB_DEVICE_ATTACHED` filter (`res/xml/usb_device_filter.xml`: FTDI, CP210x,
    WCH, any CDC class 2). Plugging in offers to open LibreTune, which pre-grants permission.
  - `MainActivity.kt`: applies system-bar insets (edge-to-edge hid the menu bar),
    enables wide viewport and pinch-zoom.
- **`src-tauri/src/android_usb.rs`**: the Rust half of the plugin. Adapters join
  the normal port list as `usb:<key> <label>`; `connect_to_ecu` sees the prefix,
  awaits `openDevice`, and connects with `ConnectionType::AndroidUsb`.
  **No frontend change was needed** for this.
- `Cargo.toml`: `tauri-plugin-window-state` made desktop-only (`#[cfg(desktop)]`
  in `lib.rs` and `tune_io.rs`); `libretune-core/usb-serial` enabled for Android.
- `lib.rs` setup: sets `$HOME` to the app data dir on Android. Without it every
  `dirs::` call returned `None` and startup failed with *"Could not find app data directory"*.
- **Layout**: `index.html` lays the page out at 1100 CSS px in landscape and 640 in
  portrait, scaled to fit. The toolbar has a new first button that hides and shows the
  sidebar, wired to the existing (previously unused) `onSidebarToggle` and saved
  `sidebar_visible` setting. Desktop webviews ignore the viewport tag.

### 9c. Building

```bash
bash scripts/build-android.sh --install     # debug arm64 APK, installs + launches
```

`tauri android build` fails on Windows when it tries to **symlink** the `.so` into
`jniLibs`, because symlinks need Developer Mode. The script lets that step fail, copies a
stripped `.so` itself, and runs `gradlew assembleArm64Debug -x rustBuildArm64Debug`.
Turning on Developer Mode makes plain `npx tauri android build` work too.

### 9d. Verified on the SM-A346B

App launches and initialises. The UI works in both orientations and the sidebar
toggle works. Opening the connect dialog makes a full **Rust → Kotlin → Rust
round-trip** (`usbserial.listDevices`), which returned an empty list because no
adapter was attached.

### 9e. Not yet done

1. **Hardware test.** No adapter or ECU has been attached yet. Suggested order is still CDC-ACM →
   FTDI → CP210x → CH34x. Watch `adb logcat | grep -E "USB serial|usbserial"`: the
   driver logs the detected bridge, interfaces, endpoints and packet size.
2. **Release build.** The debug APK is ~150 MB (unoptimised Rust). `--release`
   needs signing (apksigner with a keystore) before it installs.
3. **Phone-first UI.** The scaled desktop layout is a stopgap.
4. Opened `UsbDeviceConnection`s are never closed. That is harmless per process, and one fd
   leaks per replug.
5. Nothing is committed. Changes sit on top of upstream `037e485`.

### 9f. Session 2, later additions

- **Folder picker (Android):** `FolderPickerPlugin.kt` + `src-tauri/src/folder_picker.rs` +
  `src/utils/pickFolder.ts`. It uses the SAF tree picker and copies the folder into
  `cache/picked-folders/`, because Rust can't open `content://` URIs. For TS import it
  copies only top-level files plus `projectCfg/` and `restorePoints/`; `DataLogs` is skipped.
  Verified on the phone: a real rusEFI project imported with its tune, INI and 10 restore points.
- **Upstream bug fixed:** `ImportProjectWizard` passed the whole `CurrentProjectInfo`
  object as `path` to `open_project`, so every TS import failed to open the new project
  on desktop too.
- **Back button:** it now backgrounds the app instead of exiting the process (Tauri's
  default killed any live ECU session). Page history is honoured first.
- **UI scale** (View → UI Scale 100/150/200%, `src/utils/uiScale.ts`): it divides the
  viewport layout width on Android and uses CSS zoom on desktop. Above 100%, `MenuBar`
  collapses into a ☰ burger with inline (accordion) submenus.
- **Fullscreen:** the app is immersive on Android (swipe from an edge shows the bars
  briefly). Dashboards have a ⤢ header button, and View → Open Dashboards Fullscreen
  makes that the default. It's a CSS overlay; Back and Esc exit through a pushed history entry
  (`src/utils/dashboardFullscreen.ts`).
- Tab pop-out is hidden on Android, since it can't open a second window.
- Other file pickers (open tune/INI, CSV import) still use the dialog plugin, which returns
  `content://` URIs on Android. Those probably fail the same way the folder picker did;
  not yet checked.

### 9g. First hardware result (2026-09-26)

**CDC-ACM works on real hardware.** A rusEFI **uaEFI** (`0483:5740`, STM32 native USB)
connected from the SM-A346B at 115200 baud, and live data and datalogging worked. The driver
logged `CdcAcm iface 2 (ctrl 1) in 0x82 out 0x02 mps 64`: a composite device whose comm
interface is separate from its data interface. FTDI, CP210x and CH34x are still untested.

UI follow-ups from using it on the phone:
- **Tab fullscreen:** a ⤢ button in the main toolbar fullscreens any tab.
  `useFullscreenView` (renamed from `dashboardFullscreen.ts` to `viewFullscreen.ts`) tags
  its history entry per view, so Back exits only the view that entered.
- **Table Fit:** a "Fit" toggle in the table editor zooms the grid until the whole table
  is visible. It's on by default above 100% UI scale. The table toolbar now wraps on narrow screens.
- Above 100%, the back/title bars of dialogs, tables and curves are hidden (tabs
  navigate), and the burger sits at the right end of the toolbar instead of on its own row.
- Scaled up, the table toolbar is one row of icons (labels hidden via
  `.table-toolbar-compact`; the row scrolls sideways if still too wide).
- **View → Open Tabs Fullscreen:** a tab opened while this is on goes straight to
  fullscreen. Tabs already open at startup don't, and the dashboard follows its own
  option. Both options use the per-device `devicePref` helper in `viewFullscreen.ts`.
- `App.integration.test.tsx` failed once in a full run and then passed alone and in a
  full re-run: a flaky 6 s test, not a regression.

### 9h. PSP "UG2" dashboard port, and table Fit that grows

- **Built-in dashboard `builtin:psp-ug2`**, "PSP UG2 (32PSI)" in the selector's "Built-in"
  category. It's a port of github.com/32PSI/Speeduino-Compatible-PSP-display
  (`src/render/render_manager.c` and `src/gauges/*`, commit 5ecf941), rendered like the
  original on a **480×272 canvas with nearest-neighbour sampling**, scaled up with
  `image-rendering: pixelated`. Code: `src/components/dashboards/psp/`, with the constants
  and maths in `pspDashLogic.ts` (unit-tested against values derived from the C).
  Channels are rusEFI's `RPMValue`/`MAPValue`/`coolant`/`oilTemp`, falling back to
  Speeduino's `rpm`/`map`.
- **Do not upstream the PSP dash.** `psp/assets/` holds images extracted from a repo with no
  licence file, and the tacho is *NFS: Underground 2* artwork. See `psp/assets/README.md`.
- **Table Fit** now also grows (up to 3×) to fill the space, e.g. in fullscreen. In Fit mode
  the cells drop their padding and minimum width, and the axis corner wraps, so the numbers
  get as large as the width allows; spare height goes to taller rows.
- The fullscreen exit button moved to the bottom right.

### 9i. Cassette Futurism dashboard

- A second built-in dashboard, `builtin:cassette-futurism` ("Cassette Futurism"), in the
  style of NovusGFX/retro-design-system style 15 (MIT; notice added to
  `THIRD_PARTY_NOTICES.md`). It shows RPM (stepped meter), boost (MAP − baro, in bar),
  coolant, AFR and battery, with LED warning lights. It's plain DOM/CSS using
  container-query units, so it fills any size and orientation.
- Fonts: VT323 and Orbitron, bundled through `@fontsource` (OFL) so they work offline.
- Limits (RPM redline 6500, boost red 1.5 bar, coolant 100/105 °C, AFR amber band
  10.5–16.5, battery 11.8–15.2 V) sit in `LIMITS` at the top of `cassetteLogic.ts`.
- When the ECU is disconnected, readouts show dashes rather than stale store values.
- The built-in registry moved to `src/components/dashboards/builtinDashes.ts`.

### 9j. Montego LCD dashboard, cutout fullscreen

- A third built-in dashboard, `builtin:montego-lcd` ("Montego LCD"), after the 1984 MG
  Montego's LCD instruments. It has a diagonal ramp tacho, orange seven-segment readouts
  (`montego/SevenSegment.tsx`: all segments drawn, unlit ones at 7% opacity), vertical
  bar gauges for coolant and battery, and warning squares, all on a graph-paper grid.
  The same five readings as Cassette Futurism; both now share `dashboards/engineReadings.ts`
  (limits, channels and the `useEngineReadings` hook).
- The Cassette Futurism brand line now reads "Šķieneru Sniegums Engine Management Systems". It's set in VT323, because Orbitron has no latin-ext glyphs (Š, Ķ).
- **Cutout:** `MainActivity` now sets `LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS` and no longer
  pads for the display cutout, which had left a black bar on the notch side. The notch
  can now cover a sliver of the page on that edge; this was the owner's choice.
