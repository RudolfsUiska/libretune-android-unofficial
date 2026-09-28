import { useEffect, useState } from 'react';

/**
 * UI scale (View > UI Scale). Stored per device rather than in the synced
 * settings file, because the right size depends on the screen: a phone wants
 * 150-200% while the same user's desktop wants 100%.
 *
 * Applying it is done by `window.__applyUiScale`, defined in index.html so the
 * first paint is already at the right size.
 */
export const UI_SCALES = [1, 1.5, 2] as const;
export type UiScale = (typeof UI_SCALES)[number];

const STORAGE_KEY = 'libretune.uiScale';
const CHANGE_EVENT = 'libretune:ui-scale';

declare global {
  interface Window {
    __applyUiScale?: () => void;
  }
}

export function getUiScale(): UiScale {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return (UI_SCALES as readonly number[]).includes(stored) ? (stored as UiScale) : 1;
  } catch {
    return 1;
  }
}

export function setUiScale(scale: UiScale): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    // Storage unavailable: the scale still applies for this session below.
  }
  window.__applyUiScale?.();
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: scale }));
}

/** Current UI scale, re-rendering when it changes. */
export function useUiScale(): UiScale {
  const [scale, setScale] = useState<UiScale>(getUiScale);
  useEffect(() => {
    const onChange = () => setScale(getUiScale());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  return scale;
}
