"use client";
import { useEffect,useState } from "react";
import type { PreparedLesson } from "../../domain/lesson";
import { sceneAt } from "../../domain/lesson";
import { formatEquation,stepLabel } from "../../domain/format";
import { useLessonPlayer } from "./useLessonPlayer";
import PlaybackBar from "./PlaybackBar";
import BoardFrame from "./BoardFrame";
import Conversation, { type QuestionContext } from "./Conversation";
import Practice from "./Practice";
export default function LessonWorkspace({
  lesson,
  onNewTopic,
  interrupted=false,
}: {
  lesson: PreparedLesson;
  onNewTopic: (topic: string) => void;
  interrupted?:boolean;
}) {
  const player = useLessonPlayer(lesson),
    [cc, setCC] = useState(true),
    [context, setContext] = useState<QuestionContext | null>(null),
    [highlights, setHighlights] = useState<string[]>([]),
    [conversationOpen, setConversationOpen] = useState(false),
    [seekVersion, setSeekVersion] = useState(0);
  useEffect(()=>{if(interrupted){player.pause();setContext(null);setHighlights([]);}},[interrupted]);
  const current = sceneAt(lesson, player.time),
    completed = player.time >= lesson.audio.duration - 0.02;
  function seek(t: number) {
    setContext(null);
    setHighlights([]);
    player.seek(t);
    setSeekVersion((v) => v + 1);
  }
  function ask() {
    const position = player.pause();
    const i = sceneAt(lesson, position);
    setContext({
      lessonId: lesson.plan.id,
      stepId: lesson.plan.scenes[i].id,
      position,
      contextId: crypto.randomUUID(),
      stepTitle: stepLabel(lesson.plan.scenes[i].title),
    });
    setHighlights([]);
    setConversationOpen(true);
    setTimeout(() => document.getElementById("followup-question")?.focus(), 0);
  }
  function resume() {
    const position = context?.position ?? player.time;
    setHighlights([]);
    setContext(null);
    player.seek(position);
    if (position < lesson.audio.duration - 0.02) void player.play();
    setConversationOpen(false);
  }
  return (
    <>
      <div className="lesson-heading">
        <div>
          <p className="eyebrow">
            {lesson.plan.source === "saved-example"
              ? "SAVED EXAMPLE · LOCAL NARRATION"
              : "LIVE-GENERATED · GROQ NARRATION"}
          </p>
          <h1>{formatEquation(lesson.plan.equation)}</h1>
          <p>{lesson.plan.objective}</p>
        </div>
        <button
          onClick={() => {
            player.pause();
            onNewTopic("");
          }}
        >
          New topic ↗
        </button>
      </div>
      <div className="learning-grid">
        <section className="lesson-column">
          <div className="teaching-surface">
            <BoardFrame
              lesson={lesson}
              time={player.time}
              playing={player.playing}
              reduced={player.reduced}
              highlights={highlights}
              seekVersion={seekVersion}
            />
            <p className="caption" aria-label="Narration caption">
              {cc
                ? lesson.scenes[current].captions[0].text
                : "Captions are off."}
            </p>
            <audio ref={player.audio} preload="auto" />
            <PlaybackBar
              player={player}
              duration={lesson.audio.duration}
              onSeek={seek}
            />
            <div className="lesson-actions">
              <button
                className="ask-button"
                aria-label="Ask about this step"
                onClick={ask}
              >
                ? <span>Ask about this step</span>
              </button>
              <details className="lesson-menu">
                <summary>Lesson options</summary>
                <div>
                  <button aria-pressed={cc} onClick={() => setCC(!cc)}>
                    Captions {cc ? "on" : "off"}
                  </button>
                  <details>
                    <summary>Steps & transcript</summary>
                    {lesson.scenes.map((s, i) => (
                      <button
                        key={s.sceneId}
                        onClick={() => {
                          player.pause();
                          seek(s.start);
                        }}
                      >
                        {i + 1}. {s.captions[0].text}
                      </button>
                    ))}
                  </details>
                </div>
              </details>
            </div>
          </div>
          {player.error && (
            <p className="error" role="alert">
              {player.error}
            </p>
          )}
          {completed && (
            <Practice key={lesson.plan.id} practice={lesson.plan.practice} />
          )}
        </section>
        <Conversation
          key={lesson.plan.id}
          lesson={lesson}
          context={context}
          open={conversationOpen}
          onOpen={setConversationOpen}
          onAsk={ask}
          onVisual={setHighlights}
          onResume={resume}
          onNewTopic={(topic) => {
            player.pause();
            onNewTopic(topic);
          }}
        />
      </div>
    </>
  );
}
