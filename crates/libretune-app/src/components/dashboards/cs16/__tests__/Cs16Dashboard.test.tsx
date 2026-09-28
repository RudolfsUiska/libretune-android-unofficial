import { act, render, screen } from '@testing-library/react';
import Cs16Dashboard, { fraction } from '../Cs16Dashboard';
import { useRealtimeStore } from '../../../../stores/realtimeStore';

describe('Cs16Dashboard', () => {
  afterEach(() => {
    act(() => useRealtimeStore.setState({ channels: {} }));
  });

  it('fills progress bars by fraction of each range, clamped', () => {
    expect(fraction(4000, 0, 8000)).toBe(0.5);
    expect(fraction(-1, 0, 8000)).toBe(0);
    expect(fraction(9000, 0, 8000)).toBe(1);
    expect(fraction(undefined, 0, 8000)).toBe(0);
  });

  it('shows the five readings with bars, and ticks the OK checkboxes', () => {
    act(() =>
      useRealtimeStore.setState({
        channels: { RPMValue: 3200, MAPValue: 181.3, baroPressure: 101.3, coolant: 88.4, AFRValue: 13.2, VBatt: 13.9 },
      }),
    );
    render(<Cs16Dashboard isConnected={true} />);
    for (const text of ['3200', '+0.80', '88', '13.2', '13.9']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByRole('progressbar', { name: 'Engine speed' })).toHaveAttribute('aria-valuenow', '40');
    for (const label of ['ECU connected', 'Coolant OK', 'Mixture OK', 'Charging OK']) {
      expect(screen.getByRole('checkbox', { name: label })).toHaveAttribute('aria-checked', 'true');
    }
  });

  it('turns a reading red in its warning range', () => {
    act(() => useRealtimeStore.setState({ channels: { coolant: 110 } }));
    const { container } = render(<Cs16Dashboard isConnected={true} />);
    expect(screen.getByText('110').closest('.cs16-row')).toHaveClass('cs16-warn');
    expect(container.querySelectorAll('.cs16-warn')).toHaveLength(1);
  });

  it('unticks ECU connected and blanks readings when the link is down', () => {
    act(() => useRealtimeStore.setState({ channels: { RPMValue: 3200 } }));
    render(<Cs16Dashboard isConnected={false} />);
    expect(screen.getByRole('checkbox', { name: 'ECU connected' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('----')).toBeInTheDocument();
  });
});
