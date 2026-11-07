// The weather Puhu dresses for (src-tauri/src/weather.rs reads it from Open-Meteo, for
// the town the user typed): what he wears, when the rain comes, how the day looks.
// Pure rules, no DOM.

/** A town, as found by its name (weather.rs Place). */
export interface WeatherPlace {
  name: string;
  lat: number;
  lon: number;
}

/** One reading (weather.rs Weather). */
export interface Weather {
  place: string;
  /** °C now. */
  temp: number;
  /** WMO weather code now. */
  code: number;
  isDay: boolean;
  /** Today's highest and lowest, °C. */
  high: number;
  low: number;
  /** [unix ms, mm] every 15 minutes from now, and every hour of today. */
  rain: [number, number][];
  hours: [number, number][];
  /** When it was read, unix ms. */
  at: number;
}

/** What he wears for it (engine.setWeather). */
export interface Dress {
  umbrella: boolean;
  scarf: boolean;
  sun: boolean;
  moon: boolean;
}

/** A reading older than this says nothing about now any more. */
const STALE_MS = 3 * 3600_000;
/** Colder than this (°C), a scarf; warmer than this in the sun, sunglasses. */
const COLD = 6;
const HOT = 26;
/** Rain in a quarter hour (mm) that counts; in an hour, for the day ahead. */
const WET_MM = 0.1;
const WET_HOUR_MM = 0.3;
/** "Rain soon": coming within this long. */
export const SOON_MIN = 45;

/** Drizzle, rain, showers or a thunderstorm (WMO codes). */
export function wetCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

export function snowCode(code: number): boolean {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

/** Whether the quarter hour holding `t` is wet. */
function rainingAt(w: Weather, t: number): boolean {
  return w.rain.some(([at, mm]) => at <= t && t < at + 15 * 60_000 && mm >= WET_MM);
}

function fresh(w: Weather | null, now: number): w is Weather {
  return w != null && now - w.at < STALE_MS;
}

/** What he wears now; null without a fresh reading. */
export function dress(w: Weather | null, now: number): Dress | null {
  if (!fresh(w, now)) return null;
  const wet = wetCode(w.code) || rainingAt(w, now);
  const clear = w.code <= 1;
  return {
    umbrella: wet,
    scarf: w.temp <= COLD || snowCode(w.code),
    sun: !wet && clear && w.isDay && w.temp >= HOT,
    moon: !wet && clear && !w.isDay,
  };
}

/** When it is dry now: the first wet quarter hour to come (unix ms), else null. */
export function nextRain(w: Weather | null, now: number): number | null {
  if (!fresh(w, now) || wetCode(w.code) || rainingAt(w, now)) return null;
  return w.rain.find(([at, mm]) => at > now && mm >= WET_MM)?.[0] ?? null;
}

/** Minutes until the rain when it comes within SOON_MIN, to the nearest five; else null. */
export function rainSoon(w: Weather | null, now: number): number | null {
  const at = nextRain(w, now);
  if (at == null || at - now > SOON_MIN * 60_000) return null;
  return Math.max(5, Math.round((at - now) / 300_000) * 5);
}

/** The hour the rain starts later today (unix ms), for the morning's word; else null. */
export function rainLaterToday(w: Weather | null, now: number): number | null {
  if (!fresh(w, now)) return null;
  const day = new Date(now).toDateString();
  return w.hours.find(([at, mm]) => at + 3600_000 > now && mm >= WET_HOUR_MM && new Date(at).toDateString() === day)?.[0] ?? null;
}

/** Which picture tells the weather now. */
export function weatherIcon(w: Weather): "umbrella" | "snow" | "sun" | "moon" | "cloud" {
  if (wetCode(w.code)) return "umbrella";
  if (snowCode(w.code)) return "snow";
  if (w.code <= 1) return w.isDay ? "sun" : "moon";
  return "cloud";
}
