"use client";
import { useEffect, useRef, useState } from "react";
import { example as savedLesson } from "../content/example";
import { presentLesson } from "../domain/presentation";
import type { PreparedLesson } from "../domain/lesson";
import LiveLesson, { type LiveLessonHandle } from "./LiveLesson";
import TopicComposer from "./learner/TopicComposer";
import LessonWorkspace from "./learner/LessonWorkspace";
export default function Workspace() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [lesson, setLesson] = useState<PreparedLesson | null>(null),
    [homeVersion, setHomeVersion] = useState(0),
    [version, setVersion] = useState(0),
    [topic, setTopic] = useState(""),
    [composing, setComposing] = useState(true),
    [busy, setBusy] = useState(false);
  const generation = useRef<LiveLessonHandle>(null);
  function choose(next: PreparedLesson) {
    setLesson(presentLesson(next));
    setVersion((v) => v + 1);
    setComposing(false);
  }
  function newTopic(text: string) {
    generation.current?.cancel();
    setTopic(text);
    setComposing(true);
    setTimeout(() => document.getElementById("topic")?.focus(), 0);
  }
  function goHome() {
    newTopic("");
    // Restore preparation's startup state, including the saved-job resume card.
    setHomeVersion((v) => v + 1);
    // Unmount the teaching workspace so its player releases the audio,
    // conversation and board state rather than leaving them below the composer.
    setLesson(null);
  }
  return (
    <main className="app-shell">
      <header className="app-header">
        <button
          className="product-title"
          onClick={goHome}
          aria-label="Math Tutor — home"
        >
          <span className="product-mark" aria-hidden="true">
            =
          </span>
          Math Tutor
        </button>
        <span className="header-note">Understand the working.</span>
        <span className="level-badge">Algebra · Beginner</span>
      </header>
      {(!lesson || composing) && (
        <TopicComposer
          ready={hydrated}
          topic={topic}
          onTopic={setTopic}
          onGenerate={() => generation.current?.start()}
          busy={busy}
          hasLesson={!!lesson}
          onClose={() => setComposing(false)}
          onSaved={() => {
            generation.current?.cancel();
            choose(savedLesson);
          }}
        />
      )}
      <LiveLesson
        key={homeVersion}
        ref={generation}
        topic={topic}
        onBusy={setBusy}
        onReady={choose}
      />
      {lesson && (
        <LessonWorkspace
          key={`${lesson.plan.id}:${version}`}
          lesson={lesson}
          interrupted={composing}
          onNewTopic={newTopic}
        />
      )}
      <footer className="app-footer">
        A visual maths workspace{" "}
        <span>Saved and live content are always labelled.</span>
      </footer>
    </main>
  );
}
