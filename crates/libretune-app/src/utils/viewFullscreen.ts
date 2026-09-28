import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * View fullscreen: a dashboard or tab covers the whole window, hiding menus,
 * toolbar, sidebar, tabs and status bar - e.g. the in-car gauge view, or a
 * whole VE table on a phone.
 *
 * This is a CSS overlay, not the Fullscreen API, which Android's WebView does
 * not support without host hooks. Entering pushes a history entry, so Back (the
 * Android button, or a mouse back button) leaves fullscreen rather than the
 * app; Esc does the same on desktop.
 *
 * "Open dashboards/tabs fullscreen" are stored per device, like the UI scale:
 * wanted on the phone in the car, not necessarily on the laptop.
 */
const HISTORY_FLAG = 'libretuneDashboardFullscreen';

/** An on/off preference stored per device (see above). */
function devicePref(key: string) {
  const event = `libretune:pref:${key}`;
  const get = (): boolean => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  };
  const set = (on: boolean): void => {
    try {
      localStorage.setItem(key, on ? '1' : '0');
    } catch {
      // Storage unavailable: the choice lasts only until the next launch.
    }
    window.dispatchEvent(new CustomEvent(event));
  };
  /** The preference, re-rendering when it changes. */
  const use = (): boolean => {
    const [on, setOn] = useState(get);
    useEffect(() => {
      const onChange = () => setOn(get());
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    }, []);
    return on;
  };
  return { get, set, use };
}

/** View > Open Dashboards Fullscreen. */
export const openDashboardsFullscreen = devicePref('libretune.openDashboardsFullscreen');
/** View > Open Tabs Fullscreen: newly opened tables, dialogs and curves. */
export const openTabsFullscreen = devicePref('libretune.openTabsFullscreen');

const entryOwner = () =>
  (window.history.state as Record<string, unknown> | null)?.[HISTORY_FLAG];

let nextViewId = 1;

/**
 * Fullscreen state for one view (a dashboard, or the active tab). Each view
 * tags its history entry with its own id, so Back only exits the view that
 * entered fullscreen. With `autoEnter`, the view opens fullscreen on mount.
 */
export function useFullscreenView(autoEnter = false) {
  const [fullscreen, setFullscreen] = useState(false);
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = nextViewId++;
  const mountedRef = useRef(false);

  const enter = useCallback(() => {
    if (entryOwner() !== idRef.current) {
      window.history.pushState({ ...window.history.state, [HISTORY_FLAG]: idRef.current }, '');
    }
    setFullscreen(true);
  }, []);

  // Leave through history when we own the entry, so it does not linger and
  // make a later Back appear to do nothing; popstate then clears the state.
  const exit = useCallback(() => {
    if (entryOwner() === idRef.current) {
      window.history.back();
    } else {
      setFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onPop = () => setFullscreen(entryOwner() === idRef.current);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && entryOwner() === idRef.current) exit();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  }, [exit]);

  useEffect(() => {
    mountedRef.current = true;
    if (autoEnter) enter();
    return () => {
      mountedRef.current = false;
      // Leaving the view must not strand its history entry. Deferred because
      // StrictMode remounts at once, and that remount keeps it.
      setTimeout(() => {
        if (!mountedRef.current && entryOwner() === idRef.current) window.history.back();
      }, 0);
    };
    // autoEnter only matters on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enter]);

  return { fullscreen, enter, exit };
}

/** Fullscreen state for a mounted dashboard; honours "open dashboards fullscreen". */
export function useDashboardFullscreen() {
  return useFullscreenView(openDashboardsFullscreen.get());
}
