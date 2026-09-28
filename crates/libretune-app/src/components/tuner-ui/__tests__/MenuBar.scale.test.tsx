import { act, fireEvent, render, screen } from '@testing-library/react';
import { MenuBar } from '../MenuBar';
import { MenuItem } from '../TunerLayout';
import { setUiScale } from '../../../utils/uiScale';

const items: MenuItem[] = [
  {
    id: 'file',
    label: '&File',
    items: [{ id: 'open', label: 'Open', onClick: vi.fn() }],
  },
  {
    id: 'view',
    label: '&View',
    items: [
      {
        id: 'theme',
        label: 'Theme',
        items: [{ id: 'dark', label: 'Dark', onClick: vi.fn() }],
      },
    ],
  },
];

// The accelerator letter is its own span, so jsdom computes names like
// "F ile ▶"; match ignoring whitespace.
const menuItem = (label: string) =>
  screen.getByRole('menuitem', { name: (name) => name.replace(/\s+/g, '').startsWith(label) });

describe('MenuBar UI scale', () => {
  afterEach(() => {
    act(() => setUiScale(1));
  });

  it('shows the menu row at 100%', () => {
    render(<MenuBar items={items} />);
    expect(screen.getByRole('menubar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Menu')).not.toBeInTheDocument();
  });

  it('collapses every menu behind a burger button when scaled up', () => {
    render(<MenuBar items={items} />);
    act(() => setUiScale(1.5));

    expect(screen.queryByRole('menubar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Menu'));
    expect(menuItem('File')).toBeInTheDocument();
    expect(menuItem('View')).toBeInTheDocument();
  });

  it('expands submenus in place on tap, without hover closing them again', () => {
    act(() => setUiScale(2));
    render(<MenuBar items={items} />);
    fireEvent.click(screen.getByLabelText('Menu'));

    // A touch tap fires mouseenter before click; the submenu must stay open.
    const view = menuItem('View');
    fireEvent.mouseEnter(view);
    fireEvent.click(view);
    const theme = menuItem('Theme');
    fireEvent.mouseEnter(theme);
    fireEvent.click(theme);

    const dark = screen.getByText('Dark');
    expect(dark.closest('.menu-dropdown-inline')).toBeTruthy();
    fireEvent.click(dark);
    expect(items[1].items![0].items![0].onClick).toHaveBeenCalled();
  });
});
