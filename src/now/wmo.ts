// WMO weather interpretation codes (the `weather_code` field of Open-Meteo) to short condition text.
// Codes from the Open-Meteo docs: https://open-meteo.com/en/docs (section "WMO Weather interpretation codes").

const TEXT: Record<number, string> = {
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm, hail',
  99: 'Thunderstorm, heavy hail',
};

/**
 * 0 -> "Sunny" by day, "Clear" by night; 3 -> "Overcast"; 95 -> "Thunderstorm".
 * Returns null for a code that is not in the WMO table.
 */
export function weatherText(code: number, isDay = true): string | null {
  if (code === 0) return isDay ? 'Sunny' : 'Clear';
  if (code === 1) return isDay ? 'Mainly sunny' : 'Mainly clear';
  return TEXT[code] ?? null;
}
