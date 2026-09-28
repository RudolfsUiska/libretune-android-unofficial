import { act, render, waitFor } from '@testing-library/react';
import { TunerLayout, TunerLayoutProps } from '../TunerLayout';
import { Tab } from '../TabBar';
import { openTabsFullscreen } from '../../../utils/viewFullscreen';

const dashboard: Tab = { id: 'dashboard', title: 'Dashboard', closable: false };
const veTable: Tab = { id: 'table:veTable', title: 'VE Table' };

function layout(tabs: Tab[], activeTabId: string): TunerLayoutProps {
  return {
    menuItems: [],
    toolbarItems: [],
    tabs,
    activeTabId,
    onTabSelect: vi.fn(),
    onTabClose: vi.fn(),
    sidebarItems: [],
    sidebarVisible: false,
    onSidebarToggle: vi.fn(),
    onSidebarItemSelect: vi.fn(),
    statusItems: [],
    connected: false,
    children: <div>content</div>,
  };
}

const content = (c: HTMLElement) => c.querySelector('.tuner-layout-content')!;

describe('TunerLayout: Open Tabs Fullscreen', () => {
  beforeAll(() => {
    // jsdom has no scrollIntoView; the tab bar scrolls the active tab into view.
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(async () => {
    // A previous test's fullscreen entry is released on a timer.
    await waitFor(() =>
      expect((window.history.state as Record<string, unknown> | null)?.libretuneDashboardFullscreen).toBeFalsy(),
    );
  });

  afterEach(() => {
    act(() => openTabsFullscreen.set(false));
  });

  it('opens a newly opened tab fullscreen when the option is on', () => {
    act(() => openTabsFullscreen.set(true));
    const { container, rerender } = render(<TunerLayout {...layout([dashboard], 'dashboard')} />);
    expect(content(container)).not.toHaveClass('tuner-layout-content-fullscreen');

    rerender(<TunerLayout {...layout([dashboard, veTable], veTable.id)} />);
    expect(content(container)).toHaveClass('tuner-layout-content-fullscreen');
  });

  it('leaves tabs windowed when the option is off', () => {
    const { container, rerender } = render(<TunerLayout {...layout([dashboard], 'dashboard')} />);
    rerender(<TunerLayout {...layout([dashboard, veTable], veTable.id)} />);
    expect(content(container)).not.toHaveClass('tuner-layout-content-fullscreen');
  });

  it('does not fullscreen tabs already open at startup', () => {
    act(() => openTabsFullscreen.set(true));
    const { container } = render(<TunerLayout {...layout([dashboard, veTable], veTable.id)} />);
    expect(content(container)).not.toHaveClass('tuner-layout-content-fullscreen');
  });
});
