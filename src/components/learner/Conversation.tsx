"use client";
import { useEffect, useRef, useState } from "react";
import { followupResponse as responseSchema } from "../../domain/followup-response";
import type { PreparedLesson } from "../../domain/lesson";
import { clock } from "./PlaybackBar";
export type QuestionContext = {
  lessonId: string;
  stepId: string;
  position: number;
  contextId: string;
  stepTitle: string;
};
type Message = {
  role: "user" | "assistant" | "notice";
  text: string;
  context: QuestionContext;
  id: string;
};
export default function Conversation({
  lesson,
  context,
  onVisual,
  onResume,
  onAsk,
  onNewTopic,
  open,
  onOpen,
}: {
  lesson: PreparedLesson;
  context: QuestionContext | null;
  onVisual: (targets: string[]) => void;
  onResume: () => void;
  onAsk: () => void;
  onNewTopic: (topic: string) => void;
  open: boolean;
  onOpen: (v: boolean) => void;
}) {
  const [draft, setDraft] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [offer, setOffer] = useState("");
  const currentContext = useRef(context);
  currentContext.current = context;
  const request = useRef(0),
    lock = useRef(false),
    abort = useRef<AbortController | null>(null),
    failed = useRef<{
      question: string;
      messageId: string;
      contextId: string;
    } | null>(null),
    end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    request.current++;
    abort.current?.abort();
    lock.current = false;
    setBusy(false);
    setError("");
    setOffer("");
    failed.current = null;
    return () => {
      request.current++;
      abort.current?.abort();
    };
  }, [context?.contextId]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [messages, busy]);
  async function submit() {
    if (!context || !draft.trim() || lock.current) return;
    const captured = context,
      question = draft.trim(),
      token = ++request.current;
    lock.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    let messageId =
      failed.current?.contextId === captured.contextId &&
      failed.current.question === question
        ? failed.current.messageId
        : crypto.randomUUID();
    const retry = failed.current?.messageId === messageId;
    if (!retry)
      setMessages((m) => [
        ...m,
        { id: messageId, role: "user", text: question, context: captured },
      ]);
    const history = messages
      .filter((m) => m.role !== "notice")
      .slice(-6)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        text: m.text.slice(0, 700),
      }));
    try {
      const r = await fetch("/api/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(retry ? {"x-explicit-retry":"1"} : {}) },
        body: JSON.stringify({
          lessonId: captured.lessonId,
          stepId: captured.stepId,
          position: captured.position,
          contextId: captured.contextId,
          question,
          history,
        }),
        signal: controller.signal,
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(
          data.error ?? "The tutor could not answer. Please retry.",
        );
      const reply = responseSchema.parse(data);
      if (
        token !== request.current ||
        currentContext.current?.contextId !== captured.contextId ||
        reply.contextId !== captured.contextId ||
        reply.lessonId !== lesson.plan.id ||
        reply.stepId !== captured.stepId ||
        reply.position !== captured.position
      )
        return;
      for (const id of reply.visual.targets)
        if (!lesson.plan.elements.some((e) => e.id === id))
          throw new Error("The answer referenced an invalid board element");
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: reply.kind === "ai" ? "assistant" : "notice",
          text: reply.text,
          context: captured,
        },
      ]);
      onVisual(reply.visual.kind === "highlight" ? reply.visual.targets : []);
      setOffer(reply.newTopic ?? "");
      setDraft("");
      failed.current = null;
    } catch (e) {
      if (token === request.current && !controller.signal.aborted) {
        failed.current = { question, messageId, contextId: captured.contextId };
        setError(
          e instanceof Error
            ? e.message
            : "Unable to answer. Your question is preserved.",
        );
      }
    } finally {
      if (token === request.current) {
        setBusy(false);
        lock.current = false;
      }
    }
  }
  return (
    <aside
      className={`conversation-panel ${open ? "is-open" : ""}`}
      aria-label="Tutor conversation"
    >
      <button
        className="conversation-toggle"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        Tutor conversation <span>{open ? "−" : "+"}</span>
      </button>
      <div className="conversation-content">
        <div className="conversation-heading">
          <p className="eyebrow">A LITTLE MORE CLARITY</p>
          <h2>Ask the tutor</h2>
          <p>Questions stay connected to the step you’re exploring.</p>
        </div>
        <div className="messages" role="log" aria-label="Conversation history">
          {!messages.length && (
            <div className="conversation-empty">
              <span>?</span>
              <p>“Why do we do the same thing to both sides?”</p>
              <small>
                Pause on a step and ask what you’d like to understand.
              </small>
            </div>
          )}
          {messages.map((m) => (
            <article className={`message ${m.role}`} key={m.id}>
              <small>
                {m.role === "user"
                  ? "You"
                  : m.role === "assistant"
                    ? "AI tutor"
                    : "Lesson action"}{" "}
                · {clock(m.context.position)} · {m.context.stepTitle}
              </small>
              <p>{m.text}</p>
            </article>
          ))}
          {busy && (
            <p className="answer-loading" role="status">
              The tutor is considering this step…
            </p>
          )}
          <div ref={end} />
        </div>
        <div className="question-area">
          {context ? (
            <>
              <div className="context-chip">
                Step{" "}
                {lesson.plan.scenes.findIndex((s) => s.id === context.stepId) +
                  1}{" "}
                · {clock(context.position)}
                <strong>{context.stepTitle}</strong>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <label htmlFor="followup-question">Ask about this step</label>
                <textarea
                  id="followup-question"
                  maxLength={500}
                  value={draft}
                  disabled={busy}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Why is this operation valid?"
                />
                <button className="primary" disabled={busy || !draft.trim()}>
                  {busy ? "Answering…" : error ? "Retry question" : "Ask tutor"}
                </button>
              </form>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {offer && (
                <button
                  className="new-lesson-offer"
                  onClick={() => onNewTopic(offer)}
                >
                  Start a new lesson
                </button>
              )}
              <button className="resume-lesson" onClick={onResume}>
                Resume lesson →
              </button>
              <small>
                Text explanation first. Highlights, when shown, are temporary
                references.
              </small>
            </>
          ) : (
            <p className="ask-start">
              Select “Ask about this step” beneath the board.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
