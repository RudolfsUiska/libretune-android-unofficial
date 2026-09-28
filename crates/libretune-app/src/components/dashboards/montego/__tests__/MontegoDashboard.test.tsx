import { act, render, screen } from '@testing-library/react';
import MontegoDashboard, { CONTENT, GRID, TACHO, lcd, tachoPoint, viewFor } from '../MontegoDashboard';
import { SEGMENTS_FOR, toCells } from '../SevenSegment';
import { useRealtimeStore } from '../../../../stores/realtimeStore';

describe('SevenSegment cells', () => {
  it('uses the standard segment patterns', () => {
    expect(SEGMENTS_FOR['8']).toBe('abcdefg');
    expect(SEGMENTS_FOR['1']).toBe('bc');
    expect(SEGMENTS_FOR['-']).toBe('g');
  });

  it('attaches decimal points to the digit before and right-aligns', () => {
    expect(toCells('14.7', 4)).toEqual([
      { segments: '', dp: false }, // blank cell: all segments unlit
      { segments: 'bc', dp: false },
      { segments: 'bcfg', dp: true },
      { segments: 'abc', dp: false },
    ]);
    expect(toCells('-0.60', 3).map((c) => c.segments)).toEqual(['abcdef', 'acdefg', 'abcdef']);
  });

  it('keeps only the last digits when the text is too long', () => {
    expect(toCells('12345', 4).map((c) => c.segments)).toEqual(['abdeg', 'abcdg', 'bcfg', 'acdfg']);
  });
});

describe('MontegoDashboard', () => {
  afterEach(() => {
    act(() => useRealtimeStore.setState({ channels: {} }));
  });

  it('formats readouts for 7-segment digits', () => {
    expect(lcd.boost(0.85)).toBe('0.85');
    expect(lcd.boost(-0.6)).toBe('-0.60');
    expect(lcd.rpm(undefined)).toBe('----');
  });

  it('shows the five readings', () => {
    act(() =>
      useRealtimeStore.setState({
        channels: { RPMValue: 3200, MAPValue: 181.3, baroPressure: 101.3, coolant: 88.4, AFRValue: 13.2, VBatt: 13.9 },
      }),
    );
    render(<MontegoDashboard isConnected={true} />);
    for (const label of ['3200', '0.80', '13.2', 'CLT 88', 'BOOST 0.80', '13.9', 'tachometer 3200 rpm']) {
      expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
    }
  });

  it('flags a lost ECU link and blanks readings', () => {
    act(() => useRealtimeStore.setState({ channels: { RPMValue: 3200 } }));
    const { container } = render(<MontegoDashboard isConnected={false} />);
    expect(screen.getByRole('img', { name: '----' })).toBeInTheDocument();
    expect(container.querySelector('.mg-square-warn')).toBeTruthy();
  });
});

describe('Montego layout on the grid', () => {
  it('keeps the content origin on whole grid cells for any screen shape', () => {
    for (const aspect of [2340 / 1080, 16 / 9, 4 / 3, 1080 / 2340, 1]) {
      const v = viewFor(aspect);
      expect(v.ox % GRID).toBe(0);
      expect(v.oy % GRID).toBe(0);
      // The view always holds the content, and matches the screen's shape
      expect(v.ox + CONTENT.w).toBeLessThanOrEqual(v.w);
      expect(v.oy + CONTENT.h).toBeLessThanOrEqual(v.h);
      expect(v.w / v.h).toBeCloseTo(aspect);
    }
  });

  it('sweeps the tacho from the lower left up and over the top', () => {
    const start = tachoPoint(0);
    const top = tachoPoint((270 - TACHO.from) / (TACHO.to - TACHO.from));
    expect(start.x).toBeCloseTo(TACHO.cx - TACHO.rx);
    expect(start.y).toBeCloseTo(TACHO.cy);
    expect(top.x).toBeCloseTo(TACHO.cx);
    expect(top.y).toBeCloseTo(TACHO.cy - TACHO.ry);
    // Pushed outward means further from the ellipse centre
    const out = tachoPoint(0.5, 3);
    const on = tachoPoint(0.5);
    expect(Math.hypot(out.x - TACHO.cx, out.y - TACHO.cy)).toBeGreaterThan(Math.hypot(on.x - TACHO.cx, on.y - TACHO.cy));
  });
});
