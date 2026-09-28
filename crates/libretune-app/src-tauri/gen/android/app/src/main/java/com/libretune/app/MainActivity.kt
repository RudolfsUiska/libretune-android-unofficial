package com.libretune.app

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Truly fullscreen: draw into the camera cutout too, in either
    // orientation. Padding for it left a black bar along that edge; the
    // notch covering a sliver of the page is the lesser evil (owner's call).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.attributes.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    hideSystemBars()
    // The status/navigation bars are hidden (zero insets), but keep the page
    // clear of them if they are ever shown for good, and of the on-screen
    // keyboard, which would otherwise cover the field being typed into.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }

  // Fullscreen: every pixel goes to tables and gauges. A swipe from the edge
  // shows the bars briefly, over the app, without resizing it.
  private fun hideSystemBars() {
    WindowCompat.getInsetsController(window, window.decorView).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.systemBars())
    }
  }

  // Dialogs, the USB permission prompt and the folder picker can bring the
  // bars back; hide them again whenever the app regains focus.
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

  override fun onWebViewCreate(webView: WebView) {
    // LibreTune's UI is laid out for a desktop window (1024x700 minimum) and has
    // no phone layout yet. Honour the page's fixed viewport width (index.html)
    // so it renders as on desktop, scaled to fit, and allow pinch-zoom for the
    // small text that results. Desktop webviews ignore the viewport tag.
    webView.settings.useWideViewPort = true
    webView.settings.loadWithOverviewMode = true
    webView.settings.builtInZoomControls = true
    webView.settings.displayZoomControls = false

    // Back first walks the page's own history - a fullscreen dashboard pushes
    // an entry, so Back leaves fullscreen (utils/dashboardFullscreen.ts).
    // By default Back with no page history finishes the activity, and Tauri
    // exits the process with it - dropping any live ECU connection or unsaved
    // tune on one stray press. Send the app to the background instead, like
    // Home. Registered after Wry's own callback, so it takes precedence.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
      }
    })
  }
}
