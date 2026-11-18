"use client";
import {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useRef,
  useState,
} from "react";
import { type PreparedLesson, timelineSchema } from "../domain/lesson";
type Progress = {
  id: string;
  stage: string;
  message?: string;
  retryAt?: number;
  completed: number;
  total: number;
  manifest?: PreparedLesson;
  outline?: string[];
};
export type LiveLessonHandle = { start: () => void; cancel: () => void };
const LiveLesson = forwardRef<
  LiveLessonHandle,
  {
    topic: string;
    onReady: (lesson: PreparedLesson) => void;
    onBusy?: (b: boolean) => void;
  }
>(function LiveLesson({ topic, onReady, onBusy }, ref) {
  const [progress, setProgress] = useState<Progress | null>(null),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [scrollRequest, setScrollRequest] = useState(0),
    [resumeId, setResumeId] = useState(""),
    [stopped, setStopped] = useState(false);
  const run = useRef(0),
    preparation = useRef<HTMLElement>(null),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!scrollRequest) return;
    preparation.current?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  }, [scrollRequest]);
  useEffect(() => {
    setResumeId(localStorage.getItem("math-tutor-job") ?? "");
    return () => {
      run.current++;
      controller.current?.abort();
    };
  }, []);
  async function generate(id?: string) {
    const token = ++run.current;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setStopped(false);
    setProgress(null);
    setBusy(true);
    setScrollRequest((value) => value + 1);
    onBusy?.(true);
    setStatus(
      id ? "Resuming saved preparation…" : "Understanding your question…",
    );
    try {
      let p: Progress;
      if (id) {
        const r = await fetch(`/api/lessons/${id}`, {
          signal: c.signal,
          cache: "no-store",
        });
        if (!r.ok)
          throw new Error("Cannot resume this lesson. Start a new request.");
        p = await r.json();
        if (!["ready", "clarify", "unsupported"].includes(p.stage))
          p.message = undefined;
      } else {
        const r = await fetch("/api/lessons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic }),
          signal: c.signal,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        p = data;
      }
      if (token !== run.current) return;
      setResumeId(p.id);
      localStorage.setItem("math-tutor-job", p.id);
      for (let n = 0; n < 40; n++) {
        if (token !== run.current) return;
        setProgress(p);
        if (p.stage === "ready") {
          if (!p.manifest) throw new Error("Prepared manifest is missing");
          const lesson = timelineSchema.parse(p.manifest);
          if (token === run.current) {
            onReady(lesson);
            setStatus("Ready to start — press Play.");
          }
          return;
        }
        if (p.stage === "clarify" || p.stage === "unsupported") {
          setStatus(
            p.message ?? "Please clarify the supported linear equation.",
          );
          return;
        }
        if (p.message) {
          setStopped(true);
          setStatus(
            (p.retryAt ? "Free quota / waiting: " : "Generation failed: ") +
              p.message,
          );
          return;
        }
        setStatus(
          p.stage === "interpret"
            ? "Understanding your question…"
            : p.stage === "plan"
              ? "Preparing the explanation…"
              : p.stage === "assemble"
                ? "Assembling measured narration…"
                : `Preparing narration ${p.completed} / ${p.total}. Remaining content is being prepared; no playback will start automatically.`,
        );
        const delay = Math.max(
          0,
          (p.retryAt ?? (p.stage === "plan" ? Date.now() + 2700 : 0)) -
            Date.now(),
        );
        if (delay > 0)
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, delay);
            c.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          });
        if (token !== run.current) return;
        const r = await fetch(`/api/lessons/${p.id}`, {
          method: "POST",
          headers: id && n === 0 ? {"x-explicit-retry":"1"} : {},
          signal: c.signal,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        p = data;
      }
      throw new Error("Preparation stage limit reached. Resume explicitly.");
    } catch (e) {
      if (token === run.current && !c.signal.aborted) {
        setStopped(true);
        setStatus(
          e instanceof Error
            ? e.message
            : "Generation failed. Resume explicitly.",
        );
      }
    } finally {
      if (token === run.current) {
        setBusy(false);
        onBusy?.(false);
      }
    }
  }
  function cancel() {
    run.current++;
    controller.current?.abort();
    setBusy(false);
    setStopped(true);
    onBusy?.(false);
    setStatus("Preparation paused. Your completed stages are saved.");
  }
  useImperativeHandle(ref, () => ({
    start: () => void generate(),
    cancel: () => {
      run.current++;
      controller.current?.abort();
      setBusy(false);
      onBusy?.(false);
      setStopped(false);
      setStatus("");
      setProgress(null);
      setResumeId("");
    },
  }));
  if (
    (!status && !resumeId) ||
    (progress?.stage === "ready" && !busy && !stopped)
  )
    return null;
  return (
    <section ref={preparation} className="generation-card" aria-label="Lesson preparation">
      <div className="generation-title">
        <span className={busy ? "status-dot working" : "status-dot"} />
        <h2>
          {busy
            ? "Preparing your lesson"
            : stopped
              ? "Preparation needs attention"
              : status
                ? "Lesson preparation"
                : "Continue learning"}
        </h2>
        {busy && <button onClick={cancel}>Cancel preparation</button>}
      </div>
      {status && <p className="generation-request">{topic}</p>}
      <p role="status">
        {status || "A previous lesson is available to resume."}
      </p>
      {progress && (
        <div className="clip-progress">
          <progress
            max={progress.total}
            value={progress.completed}
            aria-label="Narration clips prepared"
          />
          <small>
            {progress.completed} of {progress.total} narration clips prepared
          </small>
        </div>
      )}
      {resumeId && !busy && (stopped || !status) && (
        <button className="secondary" onClick={() => void generate(resumeId)}>
          Resume preparation
        </button>
      )}
      <details>
        <summary>Preparation details</summary>
        <p>
          Progress is saved locally. Free Plan limits can require a pause.
          Nothing generates after cancellation or failure until you explicitly
          resume.
        </p>
      </details>
    </section>
  );
});
export default LiveLesson;
