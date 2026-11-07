// Spotify's reports → the page (src-tauri/src/spotify.rs). What touches
// the app: the pill wears the track's
// title, music starting and each new song show the island for a moment on
// the song's cover (with Settings → closedMusic off: music starting shows the
// compact island without a sound), and the card reads the
// player again whenever it comes on screen (seeks made in Spotify's own window
// are never signalled). Now Playing (any app's media session, Windows) gets
// the same, on its own events and pill.

import { Bridge, onEvent } from "../core/bridge";
import { CoverColor } from "../core/cover-color";
import { pillDefinition } from "../core/pills";
import { NowPlaying, PLAYERS, SONG_GAP_MS, SongWatch, Spotify, isAd, type Player, type SpotifyState } from "../core/spotify";
import { State } from "../core/state";
import { t } from "../i18n/i18n";

export interface SpotifyHost {
  /** Compact island from hidden, no peek sound. */
  revealSilently(): void;
  /** A new song: a moment on its cover and title. */
  showSong(player: Player): void;
  /** Its cover came, or a better one: the song on show takes it. */
  songCover(player: Player): void;
}

export const songs = new SongWatch();

let letGo: number | null = null;


/** Each player's events: its state, and a track's cover. */
const EVENTS: ReadonlyArray<[Player, string, string]> = [
  [Spotify, "spotify", "spotify-artwork"],
  [NowPlaying, "nowplaying", "nowplaying-artwork"],
];

export function registerSpotifyHandlers(island: SpotifyHost) {
  for (const [player, state, artwork] of EVENTS) {
    void onEvent<SpotifyState>(state, (s) => applySpotify(island, s, player));
    void onEvent<{ artUrl: string; dataUrl: string }>(artwork, (art) => {
      player.artwork = art;
      // A browser shows its own icon until the page's cover has loaded: each one that comes takes its place.
      if (art.artUrl === player.state.track?.artUrl) island.songCover(player);
      // The glow and the closed island's note take the newest cover's colour.
      CoverColor.read(art.dataUrl, () => State.notify());
      State.notify();
    });
  }
  State.subscribe(() => {
    for (const player of PLAYERS) {
      syncPillName(player);
      refreshWhenShown(player);
    }
  });
}

/** A report from Rust (or the answer to a refresh). */
export function applySpotify(island: SpotifyHost, next: SpotifyState, player: Player = Spotify) {
  const wasPlaying = State.spotifyPlaying;
  player.state = next;
  syncPillName(player);
  const news = songs.see(wasPlaying, State.spotifyPlaying, State.spotifyPlaying ? next.track : null, Date.now());
  // Stopped: once the gap is over without a next song, the island lets the music go.
  if (wasPlaying && !State.spotifyPlaying) {
    if (letGo != null) window.clearTimeout(letGo);
    letGo = window.setTimeout(() => {
      letGo = null;
      State.notify();
    }, SONG_GAP_MS + 50);
  }
  if (news && !State.paused) {
    // At once, with the music: a burst of reports (the title, then the artist) fills the same moment in.
    if (State.settings.closedMusic !== false) island.showSong(player);
    // Only on not playing → playing (SpotifyController.setPlaying).
    else if (news === "start" && State.mode === "hidden") island.revealSilently();
  }
  State.notify();
}

/** SpotifyController.syncTaskName: the track's title, else the pill's name. */
export function syncPillName(player: Player = Spotify) {
  const task = State.tasks.find((x) => x.id === player.pillId);
  if (!task) return;
  const track = player.state.track;
  const title = isAd(track) ? t("Advertisement") : (track?.title ?? "");
  const name = title || (pillDefinition(player.pillId)?.name ?? "Spotify");
  if (task.name !== name) task.name = name;
}

const shown = new Map<Player, boolean>();

function refreshWhenShown(player: Player) {
  const now = State.mode === "expanded" && State.view === "overview" && State.focusTask?.id === player.pillId;
  if (now && !shown.get(player)) void (player.kind === "spotify" ? Bridge.spotifyRefresh() : Bridge.nowPlayingRefresh());
  shown.set(player, now);
}
