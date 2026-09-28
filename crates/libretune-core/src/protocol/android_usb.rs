//! Android USB-serial transport.
//!
//! Android never exposes a USB-serial adapter as `/dev/ttyUSB0`: there is no
//! kernel tty node for an unrooted app to open, which is why the `serialport`
//! crate cannot reach an ECU there. Android instead hands an app a *file
//! descriptor* for the claimed USB device (via `UsbManager`, or `termux-usb`
//! outside an APK), and the app is expected to drive the chip itself with raw
//! bulk transfers. This module is that driver.
//!
//! It implements [`CommunicationChannel`], so the rest of the protocol stack is
//! unchanged - this is a third transport alongside serial and TCP.
//!
//! Supported bridges:
//!   * **CDC-ACM** - Arduino Mega (16U2), Teensy, STM32 native USB (rusEFI)
//!   * **FTDI**    - FT232R and friends
//!   * **CP210x**  - Silicon Labs
//!   * **CH34x**   - CH340/CH341, common on Arduino clones
//!
//! The file descriptor must come from the Android side; this module never opens
//! a device by VID/PID, because on Android it is not permitted to.

// The chip protocols, USB constants and endpoint state are reachable only when
// the usb-serial backend is compiled in. On desktop builds the type exists purely so call
// sites compile without cfg-gating, so that support code is legitimately dead.
#![cfg_attr(not(all(feature = "usb-serial", unix)), allow(dead_code))]

use std::io::{self, Read, Write};
use std::time::Duration;

use super::stream::CommunicationChannel;

/// Which USB-serial bridge we are talking to.
///
/// They agree on bulk data transfer but each has its own way of being told the
/// baud rate, so line configuration has to branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsbSerialKind {
    CdcAcm,
    Ftdi,
    Cp210x,
    Ch34x,
}

impl UsbSerialKind {
    /// Identify the bridge from USB ids.
    ///
    /// CDC-ACM is detected from the interface descriptor rather than guessed
    /// from the vendor, so unknown CDC devices still work.
    pub fn from_ids(vendor_id: u16, product_id: u16) -> Option<Self> {
        match (vendor_id, product_id) {
            (0x0403, _) => Some(Self::Ftdi),            // FTDI
            (0x10c4, _) => Some(Self::Cp210x),          // Silicon Labs
            (0x1a86, 0x7523) | (0x1a86, 0x5523) => Some(Self::Ch34x), // CH340/341
            (0x1a86, 0x55d4) => Some(Self::CdcAcm),     // CH9102 in CDC mode
            _ => None,
        }
    }
}

/// USB-serial channel backed by a descriptor supplied by Android.
pub struct AndroidUsbChannel {
    #[cfg(all(feature = "usb-serial", unix))]
    handle: rusb::DeviceHandle<rusb::Context>,
    kind: UsbSerialKind,
    /// Interface carrying the bulk data endpoints.
    iface: u8,
    /// Interface that receives line-configuration requests. For CDC-ACM this
    /// is the separate communication interface; for vendor bridges it is the
    /// data interface itself.
    ctrl_iface: u8,
    /// FTDI addresses its vendor requests to a port: 0 on single-port chips,
    /// interface number + 1 on multi-port ones (FT2232/FT4232).
    ftdi_port: u16,
    ep_in: u8,
    ep_out: u8,
    /// Max packet size of the IN endpoint. FTDI status bytes repeat once per
    /// packet, so stripping them needs the packet boundaries.
    in_packet: usize,
    timeout: Duration,
    /// Bulk reads arrive in packets, but callers expect a byte stream, so
    /// whatever a packet delivers beyond the caller's buffer is kept here.
    pending: Vec<u8>,
    /// FTDI prepends two modem-status bytes to every IN packet; they are not
    /// payload and must be stripped.
    strip_status_bytes: usize,
}

// USB control-transfer constants
const REQ_TYPE_OUT_CLASS_IFACE: u8 = 0x21;
const REQ_TYPE_OUT_VENDOR_DEV: u8 = 0x40;
const REQ_TYPE_OUT_VENDOR_IFACE: u8 = 0x41;
const REQ_TYPE_IN_VENDOR_DEV: u8 = 0xC0;
const CDC_SET_LINE_CODING: u8 = 0x20;
const CDC_SET_CONTROL_LINE_STATE: u8 = 0x22;

/// libusb treats a zero timeout as "wait forever", which is never what a
/// caller asking for a non-blocking poll wants.
const MIN_USB_TIMEOUT: Duration = Duration::from_millis(1);

/// Endpoint layout discovered from the configuration descriptor.
#[derive(Debug, Clone, Copy)]
struct Layout {
    kind: UsbSerialKind,
    iface: u8,
    ctrl_iface: u8,
    ep_in: u8,
    ep_out: u8,
    in_packet: usize,
    num_ifaces: u8,
}

impl AndroidUsbChannel {
    /// Adopt a USB device from a descriptor Android has already opened.
    ///
    /// `fd` must come from `UsbDeviceConnection.getFileDescriptor()` (in an
    /// APK) or `termux-usb -r` (outside one). libusb does *not* take ownership:
    /// the caller must keep the descriptor open for the channel's lifetime.
    #[cfg(all(feature = "usb-serial", unix))]
    pub fn from_fd(fd: i32, baud: u32) -> io::Result<Self> {
        use rusb::UsbContext as _;

        // Android owns enumeration. Without this, libusb_init scans the bus
        // and opens a netlink socket, both of which SELinux denies to apps.
        // It must precede context creation; it is harmless on desktop Linux
        // because this transport only ever adopts descriptors.
        let _ = rusb::disable_device_discovery();

        let ctx = rusb::Context::new().map_err(usb_err)?;
        // Adopt the already-open device rather than scanning the bus.
        let handle = unsafe { ctx.open_device_with_fd(fd) }.map_err(usb_err)?;

        let dev = handle.device();
        let desc = dev.device_descriptor().map_err(usb_err)?;
        let layout = Self::probe(&dev, desc.vendor_id(), desc.product_id())?;

        // The kernel may already have bound a driver (cdc_acm, ftdi_sio...)
        // to these interfaces; detach it or the claim fails with EBUSY.
        let _ = handle.set_auto_detach_kernel_driver(true);
        handle.claim_interface(layout.iface).map_err(usb_err)?;
        if layout.ctrl_iface != layout.iface {
            // Best effort: usbfs auto-claims on first control request anyway,
            // but an explicit claim is what detaches a bound cdc_acm.
            let _ = handle.claim_interface(layout.ctrl_iface);
        }

        let kind = layout.kind;
        let mut ch = Self {
            handle,
            kind,
            iface: layout.iface,
            ctrl_iface: layout.ctrl_iface,
            ftdi_port: if layout.num_ifaces > 1 { layout.iface as u16 + 1 } else { 0 },
            ep_in: layout.ep_in,
            ep_out: layout.ep_out,
            in_packet: layout.in_packet.max(8),
            timeout: Duration::from_millis(1000),
            pending: Vec::with_capacity(1024),
            strip_status_bytes: if kind == UsbSerialKind::Ftdi { 2 } else { 0 },
        };
        ch.configure(baud)?;
        tracing::info!(
            "USB serial: {:?} iface {} (ctrl {}) in 0x{:02x} out 0x{:02x} mps {} @ {} baud",
            kind,
            ch.iface,
            ch.ctrl_iface,
            ch.ep_in,
            ch.ep_out,
            ch.in_packet,
            baud
        );
        Ok(ch)
    }

    /// Find the data interface, its bulk endpoints, and the interface that
    /// takes line-configuration requests.
    #[cfg(all(feature = "usb-serial", unix))]
    fn probe(dev: &rusb::Device<rusb::Context>, vid: u16, pid: u16) -> io::Result<Layout> {
        let cfg = dev.active_config_descriptor().map_err(usb_err)?;
        let num_ifaces = cfg.num_interfaces();

        // CDC communication interface (class 0x02, ACM subclass 0x02). The data
        // interface normally follows it directly.
        let mut comm_iface: Option<u8> = None;

        for iface in cfg.interfaces() {
            for d in iface.descriptors() {
                let class = d.class_code();
                if class == 0x02 && d.sub_class_code() == 0x02 {
                    comm_iface.get_or_insert(d.interface_number());
                    continue;
                }
                // CDC data class (0x0A) carries the bulk pipes; vendor-specific
                // (0xFF) is how FTDI/CP210x/CH34x present themselves.
                if class != 0x0A && class != 0xFF {
                    continue;
                }
                let mut ep_in = None;
                let mut ep_out = None;
                for ep in d.endpoint_descriptors() {
                    if ep.transfer_type() != rusb::TransferType::Bulk {
                        continue;
                    }
                    match ep.direction() {
                        rusb::Direction::In => {
                            ep_in.get_or_insert((ep.address(), ep.max_packet_size() as usize));
                        }
                        rusb::Direction::Out => {
                            ep_out.get_or_insert(ep.address());
                        }
                    }
                }
                if let (Some((i, mps)), Some(o)) = (ep_in, ep_out) {
                    let kind = UsbSerialKind::from_ids(vid, pid).unwrap_or(if class == 0x0A {
                        UsbSerialKind::CdcAcm
                    } else {
                        UsbSerialKind::Ftdi
                    });
                    let data = d.interface_number();
                    let ctrl_iface = if kind == UsbSerialKind::CdcAcm {
                        // Some boards omit the comm interface from where we
                        // would find it; the one before the data interface is
                        // the conventional fallback.
                        comm_iface.unwrap_or(data.saturating_sub(1))
                    } else {
                        data
                    };
                    return Ok(Layout {
                        kind,
                        iface: data,
                        ctrl_iface,
                        ep_in: i,
                        ep_out: o,
                        in_packet: mps,
                        num_ifaces,
                    });
                }
            }
        }
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            "no USB bulk endpoints found - is this a USB-serial adapter?",
        ))
    }

    /// Set the line rate, 8N1, and raise DTR|RTS. Every bridge spells this
    /// differently; the sequences follow the Linux kernel drivers.
    #[cfg(all(feature = "usb-serial", unix))]
    fn configure(&mut self, baud: u32) -> io::Result<()> {
        match self.kind {
            UsbSerialKind::CdcAcm => {
                // 8N1: baud LE, stop bits = 1 (0), parity = none (0), 8 data bits
                let mut line = [0u8; 7];
                line[..4].copy_from_slice(&baud.to_le_bytes());
                line[6] = 8;
                let idx = self.ctrl_iface as u16;
                self.ctrl(REQ_TYPE_OUT_CLASS_IFACE, CDC_SET_LINE_CODING, 0, idx, &line)?;
                // Raise DTR|RTS, or many boards never start transmitting.
                self.ctrl(REQ_TYPE_OUT_CLASS_IFACE, CDC_SET_CONTROL_LINE_STATE, 0x03, idx, &[])?;
            }
            UsbSerialKind::Ftdi => {
                let port = self.ftdi_port;
                self.ctrl(REQ_TYPE_OUT_VENDOR_DEV, 0x00, 0x0000, port, &[])?; // SIO_RESET
                let div = ftdi_divisor(baud);
                let index = if port == 0 {
                    (div >> 16) as u16
                } else {
                    // Multi-port chips carry the port in the low byte.
                    ((div >> 8) as u16 & 0xFF00) | port
                };
                self.ctrl(REQ_TYPE_OUT_VENDOR_DEV, 0x03, div as u16, index, &[])?; // SET_BAUDRATE
                self.ctrl(REQ_TYPE_OUT_VENDOR_DEV, 0x04, 0x0008, port, &[])?; // SET_DATA 8N1
                self.ctrl(REQ_TYPE_OUT_VENDOR_DEV, 0x02, 0x0000, port, &[])?; // no flow control
                self.ctrl(REQ_TYPE_OUT_VENDOR_DEV, 0x01, 0x0303, port, &[])?; // DTR|RTS high
                // The default 16 ms latency timer stalls every short reply.
                self.ctrl(REQ_TYPE_OUT_VENDOR_DEV, 0x09, 0x0001, port, &[])?;
            }
            UsbSerialKind::Cp210x => {
                let idx = self.iface as u16;
                self.ctrl(REQ_TYPE_OUT_VENDOR_IFACE, 0x00, 0x0001, idx, &[])?; // IFC_ENABLE
                self.ctrl(REQ_TYPE_OUT_VENDOR_IFACE, 0x1E, 0, idx, &baud.to_le_bytes())?; // SET_BAUDRATE
                self.ctrl(REQ_TYPE_OUT_VENDOR_IFACE, 0x03, 0x0800, idx, &[])?; // SET_LINE_CTL 8N1
                self.ctrl(REQ_TYPE_OUT_VENDOR_IFACE, 0x07, 0x0303, idx, &[])?; // SET_MHS DTR|RTS
            }
            UsbSerialKind::Ch34x => {
                // The version read primes the chip; its value is not needed.
                let mut ver = [0u8; 2];
                let _ = self
                    .handle
                    .read_control(REQ_TYPE_IN_VENDOR_DEV, 0x5F, 0, 0, &mut ver, self.timeout);
                self.ctrl(REQ_TYPE_OUT_VENDOR_DEV, 0xA1, 0, 0, &[])?; // SERIAL_INIT
                // Bit 7: pass every byte on at once instead of waiting for a
                // full 32-byte packet.
                let div = ch34x_divisor(baud)? | 0x0080;
                self.ctrl(REQ_TYPE_OUT_VENDOR_DEV, 0x9A, 0x1312, div, &[])?; // divisor|prescaler
                // LCR: RX and TX enabled, 8 data bits, no parity, 1 stop bit
                self.ctrl(REQ_TYPE_OUT_VENDOR_DEV, 0x9A, 0x2518, 0x00C3, &[])?;
                // Modem control is active-low: DTR = 0x20, RTS = 0x40
                self.ctrl(REQ_TYPE_OUT_VENDOR_DEV, 0xA4, !0x0060u16, 0, &[])?;
            }
        }
        Ok(())
    }

    #[cfg(all(feature = "usb-serial", unix))]
    fn ctrl(&self, req_type: u8, request: u8, value: u16, index: u16, data: &[u8]) -> io::Result<()> {
        self.handle
            .write_control(req_type, request, value, index, data, self.timeout)
            .map(|_| ())
            .map_err(usb_err)
    }

    /// Pull one bulk transfer into `pending`, stripping bridge status bytes.
    #[cfg(all(feature = "usb-serial", unix))]
    fn fill(&mut self, timeout: Duration) -> io::Result<usize> {
        // Whole packets only: a buffer that is not a multiple of the packet
        // size overflows when the device sends a full one.
        let len = (4096 / self.in_packet).max(1) * self.in_packet;
        let mut buf = vec![0u8; len];
        match self.handle.read_bulk(self.ep_in, &mut buf, timeout.max(MIN_USB_TIMEOUT)) {
            Ok(n) => {
                let before = self.pending.len();
                if self.strip_status_bytes == 0 {
                    self.pending.extend_from_slice(&buf[..n]);
                } else {
                    // One transfer can span several packets, each with its own
                    // status header. A status-only packet means idle, not error.
                    for pkt in buf[..n].chunks(self.in_packet) {
                        if pkt.len() > self.strip_status_bytes {
                            self.pending.extend_from_slice(&pkt[self.strip_status_bytes..]);
                        }
                    }
                }
                Ok(self.pending.len() - before)
            }
            // A timeout with no data is normal for a polled link.
            Err(rusb::Error::Timeout) => Ok(0),
            Err(e) => Err(usb_err(e)),
        }
    }

    fn take_pending(&mut self, buf: &mut [u8]) -> usize {
        let n = self.pending.len().min(buf.len());
        buf[..n].copy_from_slice(&self.pending[..n]);
        self.pending.drain(..n);
        n
    }
}

/// FTDI baud divisor for the 3 MHz base clock (FT232R/BM), packed as a 14-bit
/// integer part with a 3-bit fraction code above it. Mirrors
/// `ftdi_232bm_baud_base_to_divisor` in the Linux ftdi_sio driver.
fn ftdi_divisor(baud: u32) -> u32 {
    if baud == 0 {
        return 0;
    }
    const FRAC: [u32; 8] = [0, 3, 2, 4, 1, 5, 6, 7];
    // Divisor in eighths, rounded to nearest.
    let div8 = (24_000_000 + baud / 2) / baud;
    let value = (div8 >> 3) | (FRAC[(div8 & 0x7) as usize] << 14);
    // Divisors 1 and 1.5 have dedicated encodings.
    match value {
        1 => 0,
        0x4001 => 1,
        v => v,
    }
}

/// CH34x divisor/prescaler word for register pair 0x13/0x12, without the
/// "pass bytes immediately" bit. Mirrors `ch341_get_divisor` in the Linux
/// driver: `(0x100 - div) << 8 | fact << 2 | ps`.
fn ch34x_divisor(baud: u32) -> io::Result<u16> {
    const CLK: u32 = 48_000_000;
    let clk_div = |ps: u32, fact: u32| 1u32 << (12 - 3 * ps - fact);
    let min_rate = |ps: u32| CLK / (clk_div(ps, 1) * 512);
    let unreachable = || {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("baud rate {baud} not representable on CH34x"),
        )
    };
    if !(46..=3_000_000).contains(&baud) {
        return Err(unreachable());
    }

    // Highest base clock (fact = 1) that gives a divisor under 512.
    let ps = (0..=3u32).rev().find(|&ps| baud > min_rate(ps)).ok_or_else(unreachable)?;
    let mut fact = 1;
    let mut cd = clk_div(ps, fact);
    let mut div = CLK / (cd * baud);
    if !(9..=255).contains(&div) {
        div /= 2;
        cd *= 2;
        fact = 0;
    }
    if div < 2 {
        return Err(unreachable());
    }
    // Take div + 1 if it lands closer; scaled by 16 against truncation.
    if 16 * CLK / (cd * div) - 16 * baud >= 16 * baud - 16 * CLK / (cd * (div + 1)) {
        div += 1;
    }
    // Prefer the lower base clock when the divisor is even.
    if fact == 1 && div % 2 == 0 {
        div /= 2;
        fact = 0;
    }
    Ok((((0x100 - div) << 8) | (fact << 2) | ps) as u16)
}

#[cfg(all(feature = "usb-serial", unix))]
fn usb_err(e: rusb::Error) -> io::Error {
    match e {
        rusb::Error::Timeout => io::Error::new(io::ErrorKind::TimedOut, "usb: timed out"),
        rusb::Error::NoDevice => io::Error::new(io::ErrorKind::NotConnected, "usb: device unplugged"),
        e => io::Error::other(format!("usb: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Non-Android builds: keep the type present so call sites compile everywhere,
// but refuse to construct. This is what lets the connection code reference the
// variant unconditionally instead of sprinkling cfgs through the protocol stack.
// ---------------------------------------------------------------------------
#[cfg(not(all(feature = "usb-serial", unix)))]
impl AndroidUsbChannel {
    pub fn from_fd(_fd: i32, _baud: u32) -> io::Result<Self> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "USB-serial transport needs the `usb-serial` feature on a unix target",
        ))
    }

    #[allow(dead_code)]
    fn fill(&mut self, _timeout: Duration) -> io::Result<usize> {
        Ok(0)
    }
}

impl Read for AndroidUsbChannel {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if !self.pending.is_empty() {
            return Ok(self.take_pending(buf));
        }
        let got = self.fill(self.timeout)?;
        if got == 0 && self.pending.is_empty() {
            // Mirror serialport semantics so the protocol layer's retry logic
            // behaves identically across transports.
            return Err(io::Error::new(io::ErrorKind::TimedOut, "usb read timed out"));
        }
        Ok(self.take_pending(buf))
    }
}

impl Write for AndroidUsbChannel {
    #[cfg(all(feature = "usb-serial", unix))]
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.handle
            .write_bulk(self.ep_out, buf, self.timeout.max(MIN_USB_TIMEOUT))
            .map_err(usb_err)
    }

    #[cfg(not(all(feature = "usb-serial", unix)))]
    fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
        Err(io::Error::new(io::ErrorKind::Unsupported, "not Android"))
    }

    fn flush(&mut self) -> io::Result<()> {
        // Bulk writes are already handed to the host controller; there is no
        // intermediate buffer of ours to drain.
        Ok(())
    }
}

impl CommunicationChannel for AndroidUsbChannel {
    fn set_timeout(&mut self, timeout: Duration) -> io::Result<()> {
        self.timeout = timeout;
        Ok(())
    }

    fn clear_input_buffer(&mut self) -> io::Result<()> {
        self.pending.clear();
        // Drain whatever the bridge still holds, with a short deadline so this
        // cannot stall the caller.
        let deadline = Duration::from_millis(20);
        for _ in 0..16 {
            if self.fill(deadline)? == 0 {
                break;
            }
            self.pending.clear();
        }
        Ok(())
    }

    fn clear_output_buffer(&mut self) -> io::Result<()> {
        Ok(())
    }

    fn try_clone(&self) -> io::Result<Box<dyn CommunicationChannel>> {
        // A USB interface claim is exclusive: handing out a second handle to
        // the same endpoints would interleave transfers and corrupt framing.
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Android USB channel cannot be cloned; the interface claim is exclusive",
        ))
    }

    fn bytes_to_read(&mut self) -> io::Result<u32> {
        if self.pending.is_empty() {
            // Near non-blocking peek. `fill` never hands libusb a zero
            // timeout, which would mean "block forever".
            self.fill(MIN_USB_TIMEOUT)?;
        }
        Ok(self.pending.len() as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_known_bridges() {
        assert_eq!(UsbSerialKind::from_ids(0x0403, 0x6001), Some(UsbSerialKind::Ftdi));
        assert_eq!(UsbSerialKind::from_ids(0x10c4, 0xea60), Some(UsbSerialKind::Cp210x));
        assert_eq!(UsbSerialKind::from_ids(0x1a86, 0x7523), Some(UsbSerialKind::Ch34x));
        assert_eq!(UsbSerialKind::from_ids(0x2341, 0x0042), None); // Arduino: CDC by descriptor
    }

    #[test]
    fn ftdi_divisor_matches_known_rates() {
        // 3 MHz base: 115200 -> 26.04, rounds to integer 26
        assert_eq!(ftdi_divisor(115_200), 26);
        // 9600 -> 312.5: integer 312, half-step fraction code 1
        assert_eq!(ftdi_divisor(9600), 312 | (1 << 14));
        // 3 Mbaud and 2 Mbaud use the dedicated encodings
        assert_eq!(ftdi_divisor(3_000_000), 0);
        assert_eq!(ftdi_divisor(2_000_000), 1);
    }

    #[test]
    fn ch34x_divisor_matches_linux_driver() {
        // What the Linux ch341 driver writes, before OR-ing in bit 7
        assert_eq!(ch34x_divisor(115_200).unwrap(), 0xCC03);
        assert_eq!(ch34x_divisor(9600).unwrap(), 0xB202);
    }

    #[test]
    fn ch34x_rejects_unreachable_rates() {
        assert!(ch34x_divisor(115_200).is_ok());
        assert!(ch34x_divisor(1).is_err());
        assert!(ch34x_divisor(4_000_000).is_err());
    }
}
