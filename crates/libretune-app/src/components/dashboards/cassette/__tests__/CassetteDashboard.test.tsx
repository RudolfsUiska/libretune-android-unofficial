import { act, render, screen } from '@testing-library/react';
import CassetteDashboard from '../CassetteDashboard';
import { useRealtimeStore } from '../../../../stores/realtimeStore';
import {
  LIMITS,
  afrLed,
  batteryLed,
  boostBar,
  coolantLed,
  fmt,
  litSegments,
  redFromSegment,
} from '../../engineReadings';

describe('Cassette Futurism dash logic', () => {
  it('computes boost as MAP minus baro, in bar', () => {
    expect(boostBar(201.3, 101.3)).toBeCloseTo(1.0);
    expect(boostBar(40, 100)).toBeCloseTo(-0.6);
    // No (or nonsense) baro: standard atmosphere
    expect(boostBar(101.325, undefined)).toBeCloseTo(0);
    expect(boostBar(101.325, 0)).toBeCloseTo(0);
  });

  it('lights meter segments proportionally and clamps', () => {
    expect(litSegments(4000, 0, 8000, 32)).toBe(16);
    expect(litSegments(-5, 0, 8000, 32)).toBe(0);
    expect(litSegments(9000, 0, 8000, 32)).toBe(32);
    expect(redFromSegment(LIMITS.rpm.red, 0, 8000, 32)).toBe(26);
  });

  it('sets warning lights from the limits', () => {
    expect(coolantLed(90)).toBe('ok');
    expect(coolantLed(101)).toBe('caution');
    expect(coolantLed(106)).toBe('warn');
    expect(afrLed(14.7)).toBe('ok');
    expect(afrLed(18)).toBe('caution'); // lean on lift-off is normal: no red
    expect(batteryLed(13.8)).toBe('ok');
    expect(batteryLed(11.5)).toBe('warn');
    expect(coolantLed(undefined)).toBe('off');
  });

  it('formats LCD readouts, with dashes when there is no data', () => {
    expect(fmt.rpm(850)).toBe('0850');
    expect(fmt.boost(0.854)).toBe('+0.85');
    expect(fmt.boost(-0.6)).toBe('-0.60');
    expect(fmt.afr(14.72)).toBe('14.7');
    expect(fmt.rpm(undefined)).toBe('----');
  });
});

describe('CassetteDashboard', () => {
  afterEach(() => {
    act(() => useRealtimeStore.setState({ channels: {} }));
  });

  it('shows rusEFI readings for the five values', () => {
    act(() =>
      useRealtimeStore.setState({
        channels: {
          RPMValue: 3200,
          MAPValue: 181.3,
          baroPressure: 101.3,
          coolant: 88.4,
          AFRValue: 13.2,
          VBatt: 13.9,
        },
      }),
    );
    render(<CassetteDashboard isConnected={true} />);
    expect(screen.getByText('3200')).toBeInTheDocument();
    expect(screen.getByText('+0.80')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('13.2')).toBeInTheDocument();
    expect(screen.getByText('13.9')).toBeInTheDocument();
  });

  it('blanks stale values and flags the link when disconnected', () => {
    act(() => useRealtimeStore.setState({ channels: { RPMValue: 3200 } }));
    const { container } = render(<CassetteDashboard isConnected={false} />);
    expect(screen.getByText('----')).toBeInTheDocument();
    expect(screen.queryByText('3200')).not.toBeInTheDocument();
    expect(container.querySelector('.cf-led-warn')).toBeTruthy();
  });
});
