//! USB-serial adapters on Android.
//!
//! Android has no tty node for a USB-serial adapter, so both the port list and
//! the device itself come from the platform. A small Kotlin plugin
//! (`UsbSerialPlugin`, in `gen/android`) enumerates adapters through
//! `UsbManager`, asks the user for permission, and hands back the descriptor of
//! an opened `UsbDeviceConnection`. The core's `AndroidUsb` transport then
//! drives the bridge chip over that descriptor.
//!
//! Adapters appear in the ordinary serial-port list as `usb:<key> <label>`, so
//! the port picker, the connect wizard and auto-connect need no Android branch:
//! `connect_to_ecu` recognises the prefix and switches transport.

/// Port-name prefix that marks a USB adapter rather than a tty path.
pub const PORT_PREFIX: &str = "usb:";

/// True when `port_name` names an Android USB adapter.
pub fn is_usb_port(port_name: &str) -> bool {
    port_name.starts_with(PORT_PREFIX)
}

/// The key the Kotlin side opens a device by: the first word after the prefix.
/// The rest of the port name is a human-readable label for the picker.
fn port_key(port_name: &str) -> &str {
    port_name[PORT_PREFIX.len()..]
        .split_whitespace()
        .next()
        .unwrap_or_default()
}

#[cfg(target_os = "android")]
mod imp {
    use super::{port_key, PORT_PREFIX};
    use serde::Deserialize;
    use std::sync::OnceLock;
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::Wry;

    static PLUGIN: OnceLock<PluginHandle<Wry>> = OnceLock::new();

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct UsbDevice {
        key: String,
        label: String,
    }

    #[derive(Deserialize)]
    struct DeviceList {
        devices: Vec<UsbDevice>,
    }

    #[derive(Deserialize)]
    struct Opened {
        fd: i32,
    }

    pub fn init() -> TauriPlugin<Wry> {
        Builder::new("usbserial")
            .setup(|_app, api| {
                let handle = api.register_android_plugin("com.libretune.app", "UsbSerialPlugin")?;
                // Stored globally so plain functions can reach it without an
                // AppHandle being threaded through every call site.
                let _ = PLUGIN.set(handle);
                Ok(())
            })
            .build()
    }

    fn plugin() -> Result<&'static PluginHandle<Wry>, String> {
        PLUGIN
            .get()
            .ok_or_else(|| "USB serial plugin not initialised".to_string())
    }

    pub async fn list_ports() -> Vec<String> {
        let Ok(p) = plugin() else { return Vec::new() };
        match p
            .run_mobile_plugin_async::<DeviceList>("listDevices", serde_json::json!({}))
            .await
        {
            Ok(list) => list
                .devices
                .into_iter()
                .map(|d| format!("{PORT_PREFIX}{} {}", d.key, d.label).trim_end().to_string())
                .collect(),
            Err(e) => {
                tracing::warn!("USB device listing failed: {e}");
                Vec::new()
            }
        }
    }

    /// Resolves once the user has answered the permission dialog, if one was
    /// needed. The descriptor stays owned by the Kotlin side, which keeps the
    /// `UsbDeviceConnection` open for the rest of the process.
    pub async fn open(port_name: &str) -> Result<i32, String> {
        let key = port_key(port_name);
        plugin()?
            .run_mobile_plugin_async::<Opened>("openDevice", serde_json::json!({ "key": key }))
            .await
            .map(|o| o.fd)
            .map_err(|e| format!("could not open USB adapter {key}: {e}"))
    }
}

#[cfg(not(target_os = "android"))]
mod imp {
    use tauri::plugin::{Builder, TauriPlugin};
    use tauri::Wry;

    pub fn init() -> TauriPlugin<Wry> {
        Builder::new("usbserial").build()
    }

    pub async fn list_ports() -> Vec<String> {
        Vec::new()
    }

    pub async fn open(port_name: &str) -> Result<i32, String> {
        Err(format!(
            "{} ({}) is an Android USB adapter; this build has no Android USB support",
            port_name,
            super::port_key(port_name)
        ))
    }
}

pub use imp::{init, list_ports, open};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_usb_ports_and_extracts_key() {
        assert!(is_usb_port("usb:0403:6001 FT232R USB UART"));
        assert!(!is_usb_port("/dev/ttyUSB0"));
        assert!(!is_usb_port("COM3"));
        assert_eq!(port_key("usb:0403:6001 FT232R USB UART"), "0403:6001");
        assert_eq!(port_key("usb:1a86:7523@/dev/bus/usb/001/004"), "1a86:7523@/dev/bus/usb/001/004");
        assert_eq!(port_key("usb:"), "");
    }
}
