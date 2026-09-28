/** True inside the Android build's WebView. */
export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}
