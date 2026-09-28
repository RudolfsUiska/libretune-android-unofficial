import { act, renderHook, waitFor } from '@testing-library/react';
import { openDashboardsFullscreen, useDashboardFullscreen, useFullscreenView } from '../viewFullscreen';

describe('useDashboardFullscreen', () => {
  // An unmounted fullscreen dashboard releases its history entry on a timer;
  // start each test from a clean history.
  beforeEach(async () => {
    await waitFor(() =>
      expect((window.history.state as Record<string, unknown> | null)?.libretuneDashboardFullscreen).toBeFalsy(),
    );
  });

  afterEach(() => {
    openDashboardsFullscreen.set(false);
  });

  it('starts windowed unless the preference is on', () => {
    const { result } = renderHook(() => useDashboardFullscreen());
    expect(result.current.fullscreen).toBe(false);
  });

  it('opens fullscreen when "open dashboards fullscreen" is on', () => {
    openDashboardsFullscreen.set(true);
    const { result } = renderHook(() => useDashboardFullscreen());
    expect(result.current.fullscreen).toBe(true);
  });

  it('leaves fullscreen on Back, via the history entry it pushed', async () => {
    const { result } = renderHook(() => useDashboardFullscreen());
    act(() => result.current.enter());
    expect(result.current.fullscreen).toBe(true);
    // Back has something of ours to pop instead of leaving the app.
    expect((window.history.state as Record<string, unknown>).libretuneDashboardFullscreen).toBeTruthy();

    act(() => window.history.back());
    await waitFor(() => expect(result.current.fullscreen).toBe(false));
  });

  it('leaves fullscreen on Escape', async () => {
    const { result } = renderHook(() => useDashboardFullscreen());
    act(() => result.current.enter());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await waitFor(() => expect(result.current.fullscreen).toBe(false));
  });

  it('enters and leaves only the view that asked (tab vs dashboard)', async () => {
    const tab = renderHook(() => useFullscreenView());
    const dash = renderHook(() => useFullscreenView());
    act(() => tab.result.current.enter());
    expect(tab.result.current.fullscreen).toBe(true);
    expect(dash.result.current.fullscreen).toBe(false);

    act(() => window.history.back());
    await waitFor(() => expect(tab.result.current.fullscreen).toBe(false));
    expect(dash.result.current.fullscreen).toBe(false);
  });
});
