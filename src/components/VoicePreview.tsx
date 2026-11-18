"use client";
import { NARRATION_LIMIT } from "../domain/teaching-contract";
import { useRef, useState } from "react";
const initial =
  "Subtract three from both sides. Doing the same operation on both sides keeps the equation balanced.";
type Config = {
  model: string;
  voice: string;
  problems: string[];
  enabled: boolean;
};
type Result = {
  audio: string;
  status: string;
  captions: { id: string; text: string; start: number; end: number }[];
  metadata: { requestId?: string };
};
export default function VoicePreview() {
  const [text, setText] = useState(initial),
    [config, setConfig] = useState<Config | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [termsRequired, setTermsRequired] = useState(false),
    [modelBlock, setModelBlock] = useState(""),
    [result, setResult] = useState<Result | null>(null),
    [produced, setProduced] = useState(""),
    [time, setTime] = useState(0);
  const locked = useRef(false);
  const audio = useRef<HTMLAudioElement>(null);
  async function load() {
    try {
      const r = await fetch("/api/voice-preview", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setConfig(await r.json());
      setError("");
    } catch {
      setError("Cannot load server configuration. Reopen this panel to retry.");
    }
  }
  async function generate() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setTermsRequired(false);
    setModelBlock("");
    audio.current?.pause();
    try {
      const r = await fetch("/api/voice-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await r.json();
      if (!r.ok) {
        setModelBlock(
          data.code === "model_permission_blocked_org"
            ? "org"
            : data.code === "model_permission_blocked_project"
              ? "project"
              : "",
        );
        setTermsRequired(data.code === "model_terms_required");
        throw new Error(data.error ?? "Preview failed.");
      }
      setResult(data);
      setProduced(text);
      setTime(0);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Preview failed. Check dashboard usage before explicitly retrying.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      className="voice-preview"
      onToggle={(e) => {
        if (e.currentTarget.open && !config) void load();
      }}
    >
      <summary>Development voice preview · Groq · hannah</summary>
      <p>
        Separate short speech preview. The saved lesson still uses its local
        fixture; Groq lesson narration is not connected. There is no automatic
        voice fallback.
      </p>
      <label htmlFor="preview-text">Exact narration to send</label>
      <textarea
        id="preview-text"
        maxLength={NARRATION_LIMIT}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
      />
      <p>{text.length} / {NARRATION_LIMIT} characters · One short teaching beat</p>
      <p>
        Model: {config?.model ?? "Loading configuration…"} · Voice:{" "}
        {config?.voice ?? "Loading…"}
      </p>
      <p>
        Free Plan only. Check Groq account limits before clicking; do not enable
        billing. No automatic retries. Clip duration is measured from WAV
        samples, not estimated from text.
      </p>
      {config?.problems.map((p) => (
        <p key={p} role="alert">
          {p}
        </p>
      ))}
      {config && !config.enabled && (
        <p>Development preview is disabled in production.</p>
      )}
      <button
        disabled={
          busy ||
          !config ||
          !config.enabled ||
          config.problems.length > 0 ||
          !text.trim()
        }
        onClick={generate}
      >
        {busy ? "Generating preview…" : "Generate Preview"}
      </button>
      {error && <p role="alert">{error}</p>}
      {modelBlock && (
        <p>
          <a
            href={
              modelBlock === "org"
                ? "https://console.groq.com/settings/limits"
                : "https://console.groq.com/settings/project/limits"
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Groq {modelBlock === "org" ? "organization" : "project"} model
            permissions
          </a>
        </p>
      )}
      {termsRequired && (
        <p>
          <a
            href="https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english"
            target="_blank"
            rel="noopener noreferrer"
          >
            Review Orpheus terms in Groq Playground
          </a>
        </p>
      )}
      {result && (
        <section aria-label="Generated speech preview">
          <p role="status">
            {result.status === "cache-hit"
              ? "Cache hit — no provider request"
              : result.status === "cache-recovered"
                ? "Recovered generated audio — cache saved without regenerating"
                : "Newly generated preview"}
          </p>
          <p>Generated text: {produced}</p>
          <audio
            key={result.audio}
            ref={audio}
            controls
            src={result.audio}
            preload="metadata"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onError={() =>
              setError(
                "Preview audio cannot be decoded by this browser. Check dashboard usage; do not regenerate automatically.",
              )
            }
          />
          <p aria-label="Preview caption">
            {result.captions.find((c) => time >= c.start && time < c.end)
              ?.text ?? " "}
          </p>
          {result.metadata.requestId && (
            <small>Provider request: {result.metadata.requestId}</small>
          )}
        </section>
      )}
    </details>
  );
}
