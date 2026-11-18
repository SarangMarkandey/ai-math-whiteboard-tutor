import type { Player } from "./useLessonPlayer";
export const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export default function PlaybackBar({
  player: p,
  duration,
  onSeek,
}: {
  player: Player;
  duration: number;
  onSeek: (t: number) => void;
}) {
  return (
    <div className="playback">
      <div className="timeline">
        <span>{clock(p.time)}</span>
        <input
          aria-label="Lesson position"
          type="range"
          min="0"
          max={duration}
          step=".01"
          value={p.time}
          disabled={!p.ready}
          onChange={(e) => onSeek(+e.target.value)}
        />
        <span>{clock(duration)}</span>
      </div>
      <div className="playback-buttons">
        <button
          className="primary play-button"
          disabled={!p.ready}
          onClick={p.toggle}
        >
          {p.playing ? "Pause" : "Play"}
        </button>
        <button
          disabled={!p.ready}
          aria-label="Seek backward"
          onClick={() => onSeek(p.time - 5)}
        >
          ↶ <span>5s</span>
        </button>
        <button
          disabled={!p.ready}
          aria-label="Seek forward"
          onClick={() => onSeek(p.time + 5)}
        >
          <span>5s</span> ↷
        </button>
        <button
          className="restart"
          disabled={!p.ready}
          onClick={() => {
            p.pause();
            onSeek(0);
          }}
        >
          Restart
        </button>
        <button className="mute" aria-pressed={p.muted} onClick={p.mute}>
          {p.muted ? "Unmute" : "Mute"}
        </button>
        {p.buffering && <small role="status">Buffering…</small>}
      </div>
    </div>
  );
}
