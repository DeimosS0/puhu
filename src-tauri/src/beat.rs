// The music's pulse, for Puhu's dance: what the computer plays (the loopback, through
// speech::audio at 16 kHz mono) turned into a tempo, where the beat falls, how loud it is
// and six bands. It listens only while the island says music plays (`music_listen`):
// otherwise no device is open and nothing runs. Nothing leaves the computer: the page
// gets numbers, never sound.
//
// The beat: every 16 ms, how much the spectrum rose (spectral flux: the onsets). Every
// quarter of a second the autocorrelation of the last 8 s of onsets picks the period
// (60–190 BPM, leaning towards 120 as a listener does), and the offset that lines the
// most onsets up with that period says where the last beat fell. Between two estimates
// the phase runs on by itself and is only nudged, so a dance never jumps.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::flow::logic::bands;
use crate::speech::{audio, SAMPLE_RATE};

const HOP: usize = 256;
const WINDOW: usize = 1024;
/// Onset frames a second (62.5).
const FRAME_HZ: f64 = SAMPLE_RATE as f64 / HOP as f64;
/// 8 s of onsets.
const HISTORY: usize = 500;
/// A new estimate every quarter of a second, a pulse to the page about 20 times a second.
const ESTIMATE_EVERY: usize = 16;
const EMIT_EVERY: usize = 3;
pub const BANDS: usize = 6;
const EVENT: &str = "music-pulse";
const MIN_BPM: f64 = 60.0;
const MAX_BPM: f64 = 190.0;
/// The onsets are measured in this many bands, 40 Hz to 6 kHz.
const ONSET_BANDS: usize = 24;

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq)]
pub struct Pulse {
    /// Beats a minute; 0 until a tempo is found.
    pub bpm: f64,
    /// Where we are in the beat: 0 on it, rising to 1 just before the next.
    pub phase: f64,
    /// How clear the beat is, 0…1. The dance keeps its own steady bounce below ~0.3.
    pub confidence: f64,
    /// Loudness 0…1, against the music's own recent peak.
    pub energy: f64,
    /// Bass to treble, 0…1 each.
    pub bands: [f64; BANDS],
}

pub struct Tracker {
    window: VecDeque<f32>,
    pending: usize,
    hann: Vec<f64>,
    onset_ranges: Vec<(usize, usize)>,
    prev_db: [f64; ONSET_BANDS],
    onsets: VecDeque<f64>,
    frames: usize,
    /// Frames a beat; 0 while there is no tempo.
    period: f64,
    phase: f64,
    confidence: f64,
    /// A different period the estimates keep proposing, and how many times in a row.
    candidate: (f64, u32),
    ranges: Vec<(usize, usize)>,
    band_peak: [f64; BANDS],
    bands: [f64; BANDS],
    energy_peak: f64,
    energy: f64,
}

impl Default for Tracker {
    fn default() -> Self {
        Self {
            window: VecDeque::with_capacity(WINDOW),
            pending: 0,
            hann: (0..WINDOW).map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (WINDOW - 1) as f64).cos()).collect(),
            onset_ranges: log_ranges(ONSET_BANDS, 40.0, 6000.0),
            prev_db: [-90.0; ONSET_BANDS],
            onsets: VecDeque::with_capacity(HISTORY),
            frames: 0,
            period: 0.0,
            phase: 0.0,
            confidence: 0.0,
            candidate: (0.0, 0),
            ranges: bands::bin_ranges(WINDOW, SAMPLE_RATE as f64, BANDS),
            band_peak: [-120.0; BANDS],
            bands: [0.0; BANDS],
            energy_peak: -120.0,
            energy: 0.0,
        }
    }
}

impl Tracker {
    /// Feeds 16 kHz mono samples; a pulse every few frames.
    pub fn feed(&mut self, samples: &[f32]) -> Option<Pulse> {
        let mut out = None;
        for &s in samples {
            if self.window.len() == WINDOW {
                self.window.pop_front();
            }
            self.window.push_back(s);
            self.pending += 1;
            if self.pending < HOP {
                continue;
            }
            self.pending = 0;
            if self.window.len() == WINDOW {
                self.frame();
                if self.frames % EMIT_EVERY == 0 {
                    out = Some(self.pulse());
                }
            }
        }
        out
    }

    pub fn pulse(&self) -> Pulse {
        Pulse {
            bpm: if self.period > 0.0 { FRAME_HZ * 60.0 / self.period } else { 0.0 },
            phase: self.phase,
            confidence: self.confidence,
            energy: self.energy,
            bands: self.bands,
        }
    }

    fn frame(&mut self) {
        let mut re: Vec<f64> = self.window.iter().zip(&self.hann).map(|(&s, &w)| s as f64 * w).collect();
        let mut im = vec![0.0; WINDOW];
        audio::fft(&mut re, &mut im);

        // Onsets: how much louder the music got, band by band in dB, so a kick, a snare
        // and a new chord all count, whatever the mix and the volume.
        let power = |k: usize| re[k] * re[k] + im[k] * im[k];
        let total: f64 = (1..WINDOW / 2).map(power).sum();
        let mut flux = 0.0;
        for (b, &(from, to)) in self.onset_ranges.iter().enumerate() {
            let p = (from..to).map(power).sum::<f64>() / ((to - from) * WINDOW * WINDOW) as f64;
            let db = (10.0 * (p + 1e-12).log10()).max(-90.0);
            flux += (db - self.prev_db[b]).max(0.0);
            self.prev_db[b] = db;
        }
        if self.onsets.len() == HISTORY {
            self.onsets.pop_front();
        }
        self.onsets.push_back(flux);

        // Loudness and bands against their own recent peak (falling 1.25 dB a second), so
        // the bars move as much at low volume as at high.
        let db = 10.0 * (total / (WINDOW * WINDOW) as f64 + 1e-12).log10();
        self.energy_peak = db.max(self.energy_peak - 0.02);
        let silent = db < -75.0;
        self.energy = if silent { 0.0 } else { ((db - self.energy_peak + 30.0) / 30.0).clamp(0.0, 1.0) };
        for (b, &(from, to)) in self.ranges.iter().enumerate() {
            let p: f64 = (from..to).map(|k| re[k] * re[k] + im[k] * im[k]).sum::<f64>() / ((to - from).max(1) * WINDOW * WINDOW) as f64;
            let d = 10.0 * (p + 1e-12).log10();
            self.band_peak[b] = d.max(self.band_peak[b] - 0.02);
            let target = if silent { 0.0 } else { ((d - self.band_peak[b] + 30.0) / 30.0).clamp(0.0, 1.0) };
            let k = if target > self.bands[b] { 0.6 } else { 0.2 };
            self.bands[b] += (target - self.bands[b]) * k;
        }

        self.frames += 1;
        if self.period > 0.0 {
            self.phase = (self.phase + 1.0 / self.period).rem_euclid(1.0);
        }
        if silent {
            self.confidence *= 0.97;
        }
        // The first tempo after 3 s of music, then on the full 8 s.
        if self.frames % ESTIMATE_EVERY == 0 && self.onsets.len() >= HISTORY * 3 / 8 {
            self.estimate();
        }
    }

    fn estimate(&mut self) {
        let n = self.onsets.len();
        // The envelope's peaks: each onset above the average of the 0.2 s around it.
        let raw: Vec<f64> = self.onsets.iter().copied().collect();
        let peaks: Vec<f64> = (0..n)
            .map(|i| {
                let (a, b) = (i.saturating_sub(6), (i + 7).min(n));
                (raw[i] - raw[a..b].iter().sum::<f64>() / (b - a) as f64).max(0.0)
            })
            .collect();
        let mean = peaks.iter().sum::<f64>() / n as f64;
        let x: Vec<f64> = peaks.iter().map(|v| v - mean).collect();
        let var = x.iter().map(|v| v * v).sum::<f64>() / n as f64;
        if var <= 1e-9 {
            self.confidence *= 0.5;
            return;
        }
        let lag_of = |bpm: f64| FRAME_HZ * 60.0 / bpm;
        let (lo, hi) = (lag_of(MAX_BPM).floor() as usize, lag_of(MIN_BPM).ceil() as usize);
        let max_lag = (4 * hi + 2).min(n - 1);
        let ac: Vec<f64> = (0..=max_lag).map(|l| (l..n).map(|i| x[i] * x[i - l]).sum::<f64>() / ((n - l) as f64 * var)).collect();
        let near_peak = |l: usize| -> f64 {
            if l + 1 > max_lag {
                return 0.0;
            }
            ac[l - 1].max(ac[l]).max(ac[l + 1])
        };
        // A beat comes back after one period and after two, three, four: the period is
        // scored with its multiples (a comb), and leans towards 120 BPM, an octave either
        // side, as listeners tap.
        let scores: Vec<f64> = (lo..=hi)
            .map(|l| {
                let comb = ac[l] + 0.8 * near_peak(2 * l) + 0.6 * near_peak(3 * l) + 0.4 * near_peak(4 * l);
                let bpm = FRAME_HZ * 60.0 / l as f64;
                comb * (-0.5 * ((bpm / 120.0).log2() / 0.75).powi(2)).exp()
            })
            .collect();
        let (bi, &best) = scores.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap();
        // Finer than a frame: around the best lag, the period whose multiples line up best.
        let ac_at = |q: f64| -> f64 {
            let i = q.floor() as usize;
            if i + 1 > max_lag {
                return 0.0;
            }
            ac[i] + (ac[i + 1] - ac[i]) * (q - i as f64)
        };
        let l = (lo + bi) as f64;
        let mut period = l;
        let mut fine = f64::MIN;
        let mut q = l - 1.0;
        while q <= l + 1.0 {
            let s = ac_at(q) + 0.8 * ac_at(2.0 * q) + 0.6 * ac_at(3.0 * q) + 0.4 * ac_at(4.0 * q);
            if s > fine {
                (period, fine) = (q, s);
            }
            q += 0.05;
        }
        // How far the best period stands out from all the others.
        let m = scores.iter().sum::<f64>() / scores.len() as f64;
        let sd = (scores.iter().map(|s| (s - m) * (s - m)).sum::<f64>() / scores.len() as f64).sqrt();
        let clear = if sd > 1e-12 { ((best - m) / sd - 1.5) / 2.5 } else { 0.0 };
        self.confidence = self.confidence * 0.7 + clear.clamp(0.0, 1.0) * 0.3;

        // A new tempo only once the estimates keep proposing it: for 1.5 s, or for 4 s when
        // it is the same music counted differently (half, double, two or three to a beat),
        // which a song with a busy rhythm proposes now and then.
        let near = |p: f64, q: f64| q > 0.0 && (p - q).abs() / q < 0.04;
        let first = self.period == 0.0;
        if first || near(period, self.period) {
            self.period = if first { period } else { self.period * 0.8 + period * 0.2 };
            self.candidate = (0.0, 0);
        } else if near(period, self.candidate.0) {
            self.candidate.1 += 1;
            let related = [2.0, 0.5, 1.5, 2.0 / 3.0].iter().any(|r| near(period * r, self.period));
            if self.candidate.1 >= if related { 16 } else { 6 } {
                self.period = period;
                self.candidate = (0.0, 0);
            }
        } else {
            self.candidate = (period, 1);
        }

        // Where the last beat fell: the offset that lines the most peaks up with the
        // period, the recent beats counting a little more.
        let p = self.period;
        let beats = (((n as f64) - p) / p).floor().clamp(1.0, 16.0) as usize;
        let at = |pos: f64| -> f64 {
            if pos < 0.0 {
                return 0.0;
            }
            let i = pos.floor() as usize;
            let f = pos - i as f64;
            let v0 = peaks.get(i).copied().unwrap_or(0.0);
            let v1 = peaks.get(i + 1).copied().unwrap_or(v0);
            v0 + (v1 - v0) * f
        };
        let last = (n - 1) as f64;
        let mut since = (0.0, f64::MIN);
        let mut phi = 0.0;
        while phi < p {
            let s: f64 = (0..beats).map(|k| at(last - phi - k as f64 * p) * (1.0 - 0.03 * k as f64)).sum();
            if s > since.1 {
                since = (phi, s);
            }
            phi += 0.5;
        }
        let measured = since.0 / p;
        let err = (measured - self.phase + 0.5).rem_euclid(1.0) - 0.5;
        self.phase = (self.phase + err * if first { 1.0 } else { 0.35 }).rem_euclid(1.0);
    }
}

/// `count` bands spaced evenly on a log scale from `low` to `high` Hz, as FFT bins
/// [from, to) of WINDOW samples; each has at least one bin and they follow each other.
fn log_ranges(count: usize, low: f64, high: f64) -> Vec<(usize, usize)> {
    let bin_hz = SAMPLE_RATE as f64 / WINDOW as f64;
    let mut out = Vec::with_capacity(count);
    let mut last = (low / bin_hz).floor().max(1.0) as usize;
    for i in 0..count {
        let edge = low * (high / low).powf((i + 1) as f64 / count as f64);
        let to = (WINDOW / 2).min((last + 1).max((edge / bin_hz).ceil() as usize));
        out.push((last, to));
        last = to;
    }
    out
}

/// The open loopback while music plays.
#[derive(Default)]
pub struct Listener(Mutex<Option<audio::Capture>>);

/// The island says whether music plays: the loopback is open while it does, closed after.
#[tauri::command]
pub fn music_listen(app: AppHandle, listener: State<Listener>, on: bool) {
    let mut open = listener.0.lock().unwrap();
    if !on {
        // Dropping the capture closes the device and joins its thread.
        open.take();
        return;
    }
    if open.is_some() {
        return;
    }
    let mut tracker = Tracker::default();
    let mut told = false;
    let started = audio::Capture::start(audio::Source::System, move |samples| {
        if let Some(pulse) = tracker.feed(samples) {
            if !told && pulse.confidence > 0.5 {
                told = true;
                crate::log::line(format!("music pulse: {:.0} BPM", pulse.bpm));
            }
            let _ = app.emit(EVENT, pulse);
        }
    });
    match started {
        Ok(capture) => *open = Some(capture),
        Err(err) => crate::log::line(format!("music pulse: no loopback ({err})")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A drum machine: a low thump and a short noise burst on every beat, soft noise between.
    fn beats(bpm: f64, seconds: f64, first: f64) -> Vec<f32> {
        let rate = SAMPLE_RATE as f64;
        let n = (seconds * rate) as usize;
        let mut seed = 0x1234_5678u32;
        let mut noise = move || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            (seed as f64 / u32::MAX as f64) * 2.0 - 1.0
        };
        let mut out: Vec<f32> = (0..n).map(|_| (noise() * 0.01) as f32).collect();
        let mut t = first * rate;
        while (t as usize) < n {
            let start = t as usize;
            for j in 0..1600.min(n - start) {
                let k = j as f64;
                let thump = 0.7 * (-k / 400.0).exp() * (2.0 * std::f64::consts::PI * 70.0 * k / rate).sin();
                let click = 0.3 * (-k / 60.0).exp() * noise();
                out[start + j] += (thump + click) as f32;
            }
            t += 60.0 / bpm * rate;
        }
        out
    }

    fn listen(samples: &[f32]) -> Tracker {
        let mut t = Tracker::default();
        for chunk in samples.chunks(480) {
            t.feed(chunk);
        }
        t
    }

    #[test]
    fn finds_the_tempo_of_a_steady_beat() {
        for bpm in [92.0, 120.0, 138.0] {
            let p = listen(&beats(bpm, 12.0, 0.2)).pulse();
            assert!((p.bpm - bpm).abs() < 2.0, "heard {} BPM for {bpm}", p.bpm);
            assert!(p.confidence > 0.3, "confidence {} at {bpm} BPM", p.confidence);
        }
    }

    #[test]
    fn the_phase_lines_up_with_the_beats() {
        let (bpm, first, seconds) = (120.0, 0.13, 12.0);
        let samples = beats(bpm, seconds, first);
        let p = listen(&samples).pulse();
        // The tracker has heard every whole hop; where the beat stands at its last frame.
        let heard = (samples.len() / HOP * HOP) as f64 / SAMPLE_RATE as f64;
        let beat = 60.0 / bpm;
        let expected = ((heard - first) / beat).rem_euclid(1.0);
        let off = ((p.phase - expected + 0.5).rem_euclid(1.0) - 0.5).abs();
        assert!(off < 0.12, "phase {} where the beat is at {expected}", p.phase);
    }

    #[test]
    fn silence_has_no_beat() {
        let p = listen(&vec![0.0; SAMPLE_RATE as usize * 8]).pulse();
        assert!(p.confidence < 0.1 && p.energy == 0.0, "{p:?}");
    }

    #[test]
    fn a_new_tempo_takes_over() {
        let mut samples = beats(100.0, 10.0, 0.0);
        samples.extend(beats(130.0, 12.0, 0.0));
        let p = listen(&samples).pulse();
        assert!((p.bpm - 130.0).abs() < 2.0, "still at {} BPM", p.bpm);
    }
}
