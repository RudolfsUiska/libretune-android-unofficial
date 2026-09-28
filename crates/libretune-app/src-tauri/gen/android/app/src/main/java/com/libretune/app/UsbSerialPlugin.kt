package com.libretune.app

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.os.Build
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class OpenDeviceArgs {
  lateinit var key: String
}

/**
 * Platform half of LibreTune's Android USB-serial transport.
 *
 * Android gives an app no tty node for a USB-serial adapter. Instead the app
 * asks UsbManager for permission, opens the device, and drives the bridge chip
 * itself. This plugin does the Android-only part - enumeration, the permission
 * dialog, and opening - and hands the Rust side a file descriptor, which
 * libretune-core's `AndroidUsbChannel` adopts through libusb.
 *
 * Opened connections are kept for the life of the process: libusb does not own
 * the descriptor, so closing it here while Rust is still using it would pull
 * the device out from under an active ECU session.
 */
@TauriPlugin
class UsbSerialPlugin(private val activity: Activity) : Plugin(activity) {
  private val usb = activity.getSystemService(Context.USB_SERVICE) as UsbManager
  private val connections = HashMap<String, UsbDeviceConnection>()

  @Command
  fun listDevices(invoke: Invoke) {
    val devices = JSArray()
    for ((key, device) in serialDevices()) {
      val entry = JSObject()
      entry.put("key", key)
      entry.put("label", label(device))
      devices.put(entry)
    }
    val ret = JSObject()
    ret.put("devices", devices)
    invoke.resolve(ret)
  }

  @Command
  fun openDevice(invoke: Invoke) {
    val key = invoke.parseArgs(OpenDeviceArgs::class.java).key
    val device = serialDevices()[key]
    if (device == null) {
      invoke.reject("USB adapter $key is not attached")
      return
    }
    connections[device.deviceName]?.let {
      resolveFd(invoke, it)
      return
    }
    if (usb.hasPermission(device)) {
      open(invoke, device)
      return
    }

    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        context.unregisterReceiver(this)
        if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
          open(invoke, device)
        } else {
          invoke.reject("USB permission denied for $key")
        }
      }
    }
    ContextCompat.registerReceiver(
      activity, receiver, IntentFilter(ACTION_USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED
    )
    // The system fills in the grant result, so the intent must be mutable;
    // Android 14 only allows that for an explicit (package-scoped) intent.
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    val intent = Intent(ACTION_USB_PERMISSION).setPackage(activity.packageName)
    usb.requestPermission(device, PendingIntent.getBroadcast(activity, 0, intent, flags))
  }

  private fun open(invoke: Invoke, device: UsbDevice) {
    val conn = usb.openDevice(device)
    if (conn == null) {
      invoke.reject("could not open ${device.deviceName}")
      return
    }
    connections[device.deviceName] = conn
    resolveFd(invoke, conn)
  }

  private fun resolveFd(invoke: Invoke, conn: UsbDeviceConnection) {
    val ret = JSObject()
    ret.put("fd", conn.fileDescriptor)
    invoke.resolve(ret)
  }

  /**
   * Attached devices that look like USB-serial adapters, keyed by vid:pid.
   * The key survives replugging, unlike the /dev/bus/usb path, so a saved
   * port selection keeps working; duplicates get the path appended.
   */
  private fun serialDevices(): Map<String, UsbDevice> {
    val found = usb.deviceList.values.filter(::isSerial).sortedBy { it.deviceName }
    val result = LinkedHashMap<String, UsbDevice>()
    for (device in found) {
      val base = "%04x:%04x".format(device.vendorId, device.productId)
      val key = if (result.containsKey(base)) "$base@${device.deviceName}" else base
      result[key] = device
    }
    return result
  }

  private fun isSerial(device: UsbDevice): Boolean {
    if (device.vendorId in BRIDGE_VENDORS) return true
    for (i in 0 until device.interfaceCount) {
      val cls = device.getInterface(i).interfaceClass
      if (cls == UsbConstants.USB_CLASS_COMM || cls == UsbConstants.USB_CLASS_CDC_DATA) return true
    }
    return false
  }

  private fun label(device: UsbDevice): String =
    device.productName?.trim()?.takeIf { it.isNotEmpty() }
      ?: device.manufacturerName?.trim()?.takeIf { it.isNotEmpty() }
      ?: "USB serial"

  companion object {
    private const val ACTION_USB_PERMISSION = "com.libretune.app.USB_PERMISSION"

    // FTDI, Silicon Labs CP210x, WCH CH34x/CH9102
    private val BRIDGE_VENDORS = setOf(0x0403, 0x10c4, 0x1a86)
  }
}
