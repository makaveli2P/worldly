// Local time for a place. No imports, so `node --experimental-strip-types` can test it directly.

/** A time zone: an IANA name (DST-correct) or, as a fallback, a fixed offset in minutes. */
export interface Zone {
  timeZone: string | null;
  offsetMinutes: number;
}

export interface ClockFace {
  time: string; // "14:32"
  weekday: string; // "Tuesday"
  date: string; // "20 Oct"
  offset: string; // "UTC+08", "UTC+05:30", "UTC−05"
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "UTC+05:30" -> 330; "UTC-03:00" -> -180; "UTC" -> 0; anything else -> null. */
export function parseUtcOffset(z: string): number | null {
  if (z === 'UTC' || z === 'GMT') return 0;
  const m = /^(?:UTC|GMT)([+\-−])(\d{1,2})(?::?(\d{2}))?$/.exec(z);
  if (!m) return null;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** 480 -> "UTC+08"; 330 -> "UTC+05:30"; -300 -> "UTC−05"; 0 -> "UTC+00". */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = abs % 60;
  return `UTC${sign}${hh}${mm ? `:${String(mm).padStart(2, '0')}` : ''}`;
}

/**
 * Best guess of the offset at a place, from the country's zone list ("UTC+08:00", ...):
 * the zone nearest to the solar offset of the longitude. With no longitude, the first zone.
 */
export function guessOffset(zones: string[], lng: number | null): number | null {
  const offsets = zones.map(parseUtcOffset).filter((o): o is number => o !== null);
  if (offsets.length === 0) return null;
  if (lng === null) return offsets[0];
  const solar = (lng / 15) * 60;
  return offsets.reduce((best, o) => (Math.abs(o - solar) < Math.abs(best - solar) ? o : best));
}

const AREAS = ['Europe', 'Asia', 'America', 'Africa', 'Australia', 'Pacific', 'Atlantic', 'Indian'];
const zoneGuesses = new Map<string, string | null>();

/**
 * An IANA zone named after the capital, if the engine knows one: "London" -> "Europe/London",
 * "Mexico City" -> "America/Mexico_City". Most capitals that use DST have such a zone.
 */
export function guessTimeZone(city: string | null, zones: string[] = []): string | null {
  if (!city) return null;
  const key = `${city}|${zones.join(',')}`;
  const hit = zoneGuesses.get(key);
  if (hit !== undefined) return hit;
  const name = city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_');
  let found: string | null = null;
  if (/^[A-Za-z_'-]+$/.test(name)) {
    for (const area of AREAS) {
      try {
        const id = `${area}/${name}`;
        new Intl.DateTimeFormat('en', { timeZone: id });
        if (!fitsZones(id, zones)) continue; // "Victoria" (Seychelles) is not "Australia/Victoria".
        found = id;
        break;
      } catch {
        // Not a zone in this area.
      }
    }
  }
  zoneGuesses.set(key, found);
  return found;
}

/** True if the zone's January or July offset is in the country's list (or the list is empty). */
function fitsZones(timeZone: string, zones: string[]): boolean {
  const listed = zones.map(parseUtcOffset).filter((o): o is number => o !== null);
  if (listed.length === 0) return true;
  return [Date.UTC(2026, 0, 15), Date.UTC(2026, 6, 15)].some((t) => {
    const name = formatter(timeZone).formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const off = parseUtcOffset(name);
    return off !== null && listed.includes(off);
  });
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'long',
      day: 'numeric',
      month: 'numeric',
      timeZoneName: 'longOffset',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The face of the clock at `now` in `zone`. An unknown IANA name falls back to the fixed offset. */
export function clockFace(now: Date, zone: Zone): ClockFace {
  if (zone.timeZone) {
    try {
      const parts = formatter(zone.timeZone).formatToParts(now);
      const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
      const offset = parseUtcOffset(get('timeZoneName'));
      return {
        time: `${get('hour')}:${get('minute')}`,
        weekday: get('weekday'),
        date: `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1]}`,
        offset: formatOffset(offset ?? zone.offsetMinutes),
      };
    } catch {
      // RangeError: the engine does not know this zone. Use the offset.
    }
  }
  const t = new Date(now.getTime() + zone.offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
    weekday: WEEKDAYS[t.getUTCDay()],
    date: `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`,
    offset: formatOffset(zone.offsetMinutes),
  };
}

/** Milliseconds until the next whole minute (every zone offset is a whole number of minutes). */
export function msToNextMinute(now: number): number {
  return 60_000 - (now % 60_000);
}

/**
 * The IANA zone of the capital for each country whose capital has no zone of its own name
 * (guessTimeZone() returns null for these). Without it, DST capitals such as Washington,
 * Ottawa, Wellington and Bern show standard time. For a country without a capital, the zone
 * covers its centroid. Keys are country ids from countries.json.
 */
export const CAPITAL_ZONES: Readonly<Record<string, string>> = {
  ABW: 'America/Aruba', AIA: 'America/Anguilla', ALB: 'Europe/Tirane', AND: 'Europe/Andorra',
  ARE: 'Asia/Dubai', ATF: 'Indian/Kerguelen', ATG: 'America/Antigua', BDI: 'Africa/Bujumbura',
  BHR: 'Asia/Bahrain', BLM: 'America/St_Barthelemy', BLZ: 'America/Belize', BMU: 'Atlantic/Bermuda',
  BOL: 'America/La_Paz', BRA: 'America/Sao_Paulo', BRB: 'America/Barbados', BRN: 'Asia/Brunei',
  CAN: 'America/Toronto', CHE: 'Europe/Zurich', CHN: 'Asia/Shanghai', CIV: 'Africa/Abidjan',
  CMR: 'Africa/Douala', COK: 'Pacific/Rarotonga', COM: 'Indian/Comoro', CPV: 'Atlantic/Cape_Verde',
  CRI: 'America/Costa_Rica', CUW: 'America/Curacao', CYM: 'America/Cayman', DMA: 'America/Dominica',
  ECU: 'America/Guayaquil', FJI: 'Pacific/Fiji', FRO: 'Atlantic/Faroe', FSM: 'Pacific/Pohnpei',
  GGY: 'Europe/Guernsey', GRD: 'America/Grenada', GTM: 'America/Guatemala', GUM: 'Pacific/Guam',
  GUY: 'America/Guyana', HKG: 'Asia/Hong_Kong', HMD: 'Indian/Kerguelen', IMN: 'Europe/Isle_of_Man',
  IND: 'Asia/Kolkata', IOT: 'Indian/Chagos', JAM: 'America/Jamaica', JEY: 'Europe/Jersey',
  KAZ: 'Asia/Almaty', KIR: 'Pacific/Tarawa', KNA: 'America/St_Kitts', KWT: 'Asia/Kuwait',
  LCA: 'America/St_Lucia', MAC: 'Asia/Macau', MAR: 'Africa/Casablanca', MDV: 'Indian/Maldives',
  MLT: 'Europe/Malta', MMR: 'Asia/Yangon', MSR: 'America/Montserrat', MUS: 'Indian/Mauritius',
  MWI: 'Africa/Blantyre', NFK: 'Pacific/Norfolk', NGA: 'Africa/Lagos', NIU: 'Pacific/Niue',
  NRU: 'Pacific/Nauru', NZL: 'Pacific/Auckland', PAK: 'Asia/Karachi', PAN: 'America/Panama',
  PCN: 'Pacific/Pitcairn', PLW: 'Pacific/Palau', PRI: 'America/Puerto_Rico', PSE: 'Asia/Hebron',
  PYF: 'Pacific/Tahiti', QAT: 'Asia/Qatar', SGS: 'Atlantic/South_Georgia', SHN: 'Atlantic/St_Helena',
  SLB: 'Pacific/Guadalcanal', SLV: 'America/El_Salvador', SMR: 'Europe/San_Marino', SPM: 'America/Miquelon',
  SWZ: 'Africa/Mbabane', SXM: 'America/Lower_Princes', SYC: 'Indian/Mahe', TCA: 'America/Grand_Turk',
  TCD: 'Africa/Ndjamena', TON: 'Pacific/Tongatapu', TUR: 'Europe/Istanbul', TZA: 'Africa/Dar_es_Salaam',
  USA: 'America/New_York', VAT: 'Europe/Vatican', VCT: 'America/St_Vincent', VGB: 'America/Tortola',
  VIR: 'America/St_Thomas', VNM: 'Asia/Ho_Chi_Minh', VUT: 'Pacific/Efate', WLF: 'Pacific/Wallis',
  'X-ashmore-and-cartier': 'Australia/Perth', 'X-indian-ocean-territories': 'Indian/Christmas',
  'X-kosovo': 'Europe/Belgrade', 'X-northern-cyprus': 'Asia/Nicosia', 'X-siachen-glacier': 'Asia/Kolkata',
  'X-somaliland': 'Africa/Mogadishu', YEM: 'Asia/Aden', ZAF: 'Africa/Johannesburg',
};

/** The capital's IANA zone: the override map first, then a zone named after the capital. */
export function capitalTimeZone(id: string, city: string | null, zones: string[] = []): string | null {
  return CAPITAL_ZONES[id] ?? guessTimeZone(city, zones);
}
