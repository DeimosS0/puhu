// The weather where the user is, for Puhu to dress for: Open-Meteo (no key, no
// account). Nothing runs until the user types their town in Puhu's window; then the
// town's coordinates are the only thing that leaves the computer, once an hour.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// The island and the desktop window hear of each new reading.
pub const EVENT: &str = "weather";
/// A reading this often, while a town is set.
const EVERY: Duration = Duration::from_secs(3600);
/// After a failed reading (no network), sooner.
const RETRY: Duration = Duration::from_secs(10 * 60);
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY: usize = 256 * 1024;
const SEARCH: &str = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST: &str = "https://api.open-meteo.com/v1/forecast";

/// A town, as found by its name: how it is shown, and where it is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Place {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
}

/// One reading.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    pub place: String,
    /// °C now.
    pub temp: f64,
    /// WMO weather code now (Open-Meteo's `weather_code`).
    pub code: u32,
    pub is_day: bool,
    /// Today's highest and lowest, °C.
    pub high: f64,
    pub low: f64,
    /// Rain (mm) every 15 minutes from now on, for the next hours: [unix ms, mm].
    pub rain: Vec<(f64, f64)>,
    /// And every hour of today: [unix ms, mm].
    pub hours: Vec<(f64, f64)>,
    /// When it was read, unix ms.
    pub at: f64,
}

static LATEST: Mutex<Option<Weather>> = Mutex::new(None);
static PLACE: Mutex<Option<Place>> = Mutex::new(None);
/// Bumped when the town changes: an older loop stops.
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn client() -> Option<reqwest::Client> {
    let url = Url::parse(FORECAST).ok()?;
    crate::net::client(&url, TIMEOUT).ok()
}

async fn get_json(url: Url) -> Option<Value> {
    let response = client()?.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = crate::net::read_capped(response, MAX_BODY).await.ok()?;
    serde_json::from_slice(&body).ok()
}

/// The first town by that name, its name in `lang` where Open-Meteo has it.
#[tauri::command]
pub async fn weather_search(name: String, lang: String) -> Option<Place> {
    let name = name.trim();
    if name.chars().count() < 2 {
        return None;
    }
    let mut url = Url::parse(SEARCH).ok()?;
    url.query_pairs_mut()
        .append_pair("name", name)
        .append_pair("count", "1")
        .append_pair("language", lang.split('-').next().unwrap_or("en"))
        .append_pair("format", "json");
    place_from(&get_json(url).await?)
}

/// The first result of a search, "Town, CC" (the country's code: its name in some
/// languages is long, "Türkiye Cumhuriyeti").
pub fn place_from(json: &Value) -> Option<Place> {
    let first = json.get("results")?.get(0)?;
    let town = first.get("name")?.as_str()?;
    let name = match first.get("country_code").and_then(Value::as_str) {
        Some(code) if !code.is_empty() => format!("{town}, {}", code.to_uppercase()),
        _ => town.to_string(),
    };
    Some(Place { name, lat: first.get("latitude")?.as_f64()?, lon: first.get("longitude")?.as_f64()? })
}

/// The last reading, for a page that (re)loads.
#[tauri::command]
pub fn weather_now() -> Option<Weather> {
    LATEST.lock().unwrap().clone()
}

/// At launch and after every settings save: reads on the hour for the town set, and
/// stops when there is none. The same town keeps its loop.
pub fn sync(app: &AppHandle, place: Option<Place>) {
    {
        let mut current = PLACE.lock().unwrap();
        if *current == place {
            return;
        }
        current.clone_from(&place);
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    *LATEST.lock().unwrap() = None;
    let _ = app.emit(EVENT, None::<Weather>);
    let Some(place) = place else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while GENERATION.load(Ordering::SeqCst) == generation {
            let reading = read(&place).await;
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            let wait = match reading {
                Some(w) => {
                    *LATEST.lock().unwrap() = Some(w.clone());
                    let _ = app.emit(EVENT, Some(w));
                    EVERY
                }
                None => RETRY,
            };
            tokio::time::sleep(wait).await;
        }
    });
}

async fn read(place: &Place) -> Option<Weather> {
    let mut url = Url::parse(FORECAST).ok()?;
    url.query_pairs_mut()
        .append_pair("latitude", &format!("{:.3}", place.lat))
        .append_pair("longitude", &format!("{:.3}", place.lon))
        .append_pair("current", "temperature_2m,weather_code,is_day")
        .append_pair("minutely_15", "precipitation")
        .append_pair("forecast_minutely_15", "16")
        .append_pair("hourly", "precipitation")
        .append_pair("daily", "temperature_2m_max,temperature_2m_min")
        .append_pair("forecast_days", "1")
        .append_pair("timezone", "auto")
        .append_pair("timeformat", "unixtime");
    let json = get_json(url).await;
    if json.is_none() {
        crate::log::line("weather: no reading this time".to_string());
    }
    weather_from(&json?, &place.name)
}

/// A reading from Open-Meteo's answer (`timeformat=unixtime`).
pub fn weather_from(json: &Value, place: &str) -> Option<Weather> {
    let current = json.get("current")?;
    let daily = json.get("daily")?;
    let first = |key: &str| daily.get(key)?.get(0)?.as_f64();
    let series = |times: &str, mm: &str| -> Option<Vec<(f64, f64)>> {
        let times = json.pointer(times)?.as_array()?;
        let mm = json.pointer(mm)?.as_array()?;
        Some(times.iter().zip(mm).filter_map(|(t, v)| Some((t.as_f64()? * 1000.0, v.as_f64().unwrap_or(0.0)))).collect())
    };
    let rain = series("/minutely_15/time", "/minutely_15/precipitation")?;
    let hours = series("/hourly/time", "/hourly/precipitation").unwrap_or_default();
    Some(Weather {
        place: place.to_string(),
        temp: current.get("temperature_2m")?.as_f64()?,
        code: current.get("weather_code")?.as_u64()? as u32,
        is_day: current.get("is_day").and_then(Value::as_u64).unwrap_or(1) == 1,
        high: first("temperature_2m_max")?,
        low: first("temperature_2m_min")?,
        rain,
        hours,
        at: current.get("time").and_then(Value::as_f64).map_or(0.0, |t| t * 1000.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_search_gives_the_town_and_its_country_code() {
        let answer = json!({ "results": [{ "name": "İstanbul", "country": "Türkiye Cumhuriyeti", "country_code": "TR", "latitude": 41.01, "longitude": 28.95 }] });
        assert_eq!(place_from(&answer), Some(Place { name: "İstanbul, TR".into(), lat: 41.01, lon: 28.95 }));
        assert_eq!(place_from(&json!({ "generationtime_ms": 0.5 })), None);
    }

    #[test]
    fn a_forecast_gives_now_today_and_the_rain_to_come() {
        let answer = json!({
            "current": { "time": 1_762_500_000, "temperature_2m": 12.4, "weather_code": 61, "is_day": 0 },
            "minutely_15": { "time": [1_762_500_000, 1_762_500_900], "precipitation": [0.0, 0.4] },
            "hourly": { "time": [1_762_498_800, 1_762_502_400], "precipitation": [0.0, 1.2] },
            "daily": { "temperature_2m_max": [15.1], "temperature_2m_min": [8.2] }
        });
        let w = weather_from(&answer, "İstanbul, Türkiye").unwrap();
        assert_eq!((w.temp, w.code, w.is_day, w.high, w.low), (12.4, 61, false, 15.1, 8.2));
        assert_eq!(w.rain, vec![(1_762_500_000_000.0, 0.0), (1_762_500_900_000.0, 0.4)]);
        assert_eq!(w.hours, vec![(1_762_498_800_000.0, 0.0), (1_762_502_400_000.0, 1.2)]);
        assert_eq!(w.at, 1_762_500_000_000.0);
    }
}
