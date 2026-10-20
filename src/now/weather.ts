// Current weather and time zone at a point, from Open-Meteo (free, no key, CORS allowed).

export interface CurrentWeather {
  tempC: number;
  feelsC: number;
  windKmh: number;
  humidity: number | null; // %
  code: number; // WMO weather code
  isDay: boolean;
  timeZone: string; // IANA, e.g. "Asia/Shanghai"
  utcOffsetSeconds: number;
  fetchedAt: number; // ms since epoch
}

interface OpenMeteoResponse {
  timezone?: string;
  utc_offset_seconds?: number;
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    is_day?: number;
    relative_humidity_2m?: number;
  };
}

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const FIELDS = 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day,relative_humidity_2m';

export function weatherUrl(lat: number, lng: number): string {
  return `${ENDPOINT}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=${FIELDS}&timezone=auto`;
}

/** Throws on a network error, a non-2xx status or a response with no current conditions. */
export async function fetchCurrentWeather(lat: number, lng: number, signal?: AbortSignal): Promise<CurrentWeather> {
  const res = await fetch(weatherUrl(lat, lng), { signal });
  if (!res.ok) throw new Error(`open-meteo: ${res.status}`);
  const data = (await res.json()) as OpenMeteoResponse;
  const c = data.current;
  if (!c || typeof c.temperature_2m !== 'number' || typeof c.weather_code !== 'number' || !data.timezone) {
    throw new Error('open-meteo: no current conditions');
  }
  return {
    tempC: c.temperature_2m,
    feelsC: c.apparent_temperature ?? c.temperature_2m,
    windKmh: c.wind_speed_10m ?? 0,
    humidity: c.relative_humidity_2m ?? null,
    code: c.weather_code,
    isDay: c.is_day !== 0,
    timeZone: data.timezone,
    utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    fetchedAt: Date.now(),
  };
}

const TTL_MS = 10 * 60_000;
const cache = new Map<string, CurrentWeather>();
const zones = new Map<string, string>();

/** Cached weather for a key, if it is less than 10 minutes old. */
export function cachedWeather(key: string, now = Date.now()): CurrentWeather | null {
  const w = cache.get(key);
  return w && now - w.fetchedAt < TTL_MS ? w : null;
}

/** The IANA zone that an earlier response gave for this key. It does not expire. */
export function knownTimeZone(key: string): string | null {
  return zones.get(key) ?? null;
}

/** Weather for a key (a country id): from the 10-minute cache, or from the network. */
export async function getCurrentWeather(
  key: string,
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<CurrentWeather> {
  const hit = cachedWeather(key);
  if (hit) return hit;
  const w = await fetchCurrentWeather(lat, lng, signal);
  cache.set(key, w);
  zones.set(key, w.timeZone);
  return w;
}
