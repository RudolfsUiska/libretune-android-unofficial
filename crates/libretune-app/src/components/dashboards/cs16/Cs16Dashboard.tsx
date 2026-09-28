import {
  LIMITS,
  Led,
  afrLed,
  batteryLed,
  boostLed,
  coolantLed,
  fmt,
  rpmLed,
  useEngineReadings,
} from '../engineReadings';
import './Cs16Dashboard.css';

/**
 * Engine dash in the Counter-Strike 1.6 menu (VGUI) style of cs16.css
 * (github.com/ekmas/cs16.css, MIT): a bevelled olive window, pixel font and
 * the segmented progress bar as the gauges. Shows RPM, boost, coolant, AFR
 * and battery (../engineReadings.ts); the warning lights are checkboxes.
 */

/** Fraction of a range, clamped to [0, 1]. */
export function fraction(value: number | undefined, min: number, max: number): number {
  if (value === undefined) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

interface RowProps {
  label: string;
  value: string;
  unit: string;
  fill: number;
  led: Led;
  big?: boolean;
}

/** A reading: label, segmented progress bar, value - red in its warning range. */
function Row({ label, value, unit, fill, led, big }: RowProps) {
  return (
    <div className={`cs16-row ${big ? 'cs16-row-big' : ''} ${led === 'warn' ? 'cs16-warn' : ''}`}>
      <div className="cs16-row-label">{label}</div>
      <div className="cs16-progress" role="progressbar" aria-label={label} aria-valuenow={Math.round(fill * 100)}>
        <div className="cs16-bars" style={{ width: `${fill * 100}%` }} />
      </div>
      <div className="cs16-row-value">
        {value}
        <span className="cs16-unit">{unit}</span>
      </div>
    </div>
  );
}

/** A read-only cs16 checkbox: ticked while its condition is fine. */
function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`cs16-check ${ok ? 'cs16-check-on' : ''}`} role="checkbox" aria-checked={ok} aria-label={label}>
      {label}
    </span>
  );
}

export default function Cs16Dashboard({ isConnected }: { isConnected: boolean }) {
  const { rpm, boost, coolant, afr, battery } = useEngineReadings(isConnected);
  const L = LIMITS;
  return (
    <div className="cs16-dash">
      <div className="cs16-window">
        <div className="cs16-heading">
          <span className="cs16-title">Engine Status</span>
          <span className="cs16-close" aria-hidden="true" />
        </div>
        <div className="cs16-content">
          <Row
            big
            label="Engine speed"
            value={fmt.rpm(rpm)}
            unit="rpm"
            fill={fraction(rpm, L.rpm.min, L.rpm.max)}
            led={rpmLed(rpm)}
          />
          <hr className="cs16-hr" />
          <Row
            label="Boost"
            value={fmt.boost(boost)}
            unit="bar"
            fill={fraction(boost, L.boost.min, L.boost.max)}
            led={boostLed(boost)}
          />
          <Row
            label="Coolant"
            value={fmt.coolant(coolant)}
            unit="°C"
            fill={fraction(coolant, L.coolant.min, L.coolant.max)}
            led={coolantLed(coolant)}
          />
          <Row
            label="Air/fuel"
            value={fmt.afr(afr)}
            unit="afr"
            fill={fraction(afr, L.afr.min, L.afr.max)}
            led={afrLed(afr)}
          />
          <Row
            label="Battery"
            value={fmt.battery(battery)}
            unit="V"
            fill={fraction(battery, L.battery.min, L.battery.max)}
            led={batteryLed(battery)}
          />
        </div>
        <div className="cs16-footer">
          <Check ok={isConnected} label="ECU connected" />
          <Check ok={coolantLed(coolant) === 'ok'} label="Coolant OK" />
          <Check ok={afrLed(afr) === 'ok'} label="Mixture OK" />
          <Check ok={batteryLed(battery) === 'ok'} label="Charging OK" />
        </div>
      </div>
    </div>
  );
}
