"use client";
import { useState } from "react";
import { parseRational, verify } from "../../domain/math";
import type { LessonPlan } from "../../domain/lesson";
export default function Practice({
  practice,
}: {
  practice: LessonPlan["practice"];
}) {
  const [answer, setAnswer] = useState(""),
    [hint, setHint] = useState(false),
    [feedback, setFeedback] = useState("");
  return (
    <section className="practice">
      <p className="eyebrow">YOUR TURN</p>
      <h2>{practice.prompt}</h2>
      <p>Use the same idea. What value of x keeps both sides equal?</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            setFeedback(
              verify(practice.equation, parseRational(answer))
                ? "Correct — substitution makes both sides equal."
                : "Not quite. Put your value back into the equation and try again.",
            );
          } catch {
            setFeedback("Enter an integer or fraction, such as 8/3.");
          }
        }}
      >
        <label htmlFor="practice-answer">x =</label>
        <input
          id="practice-answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          autoComplete="off"
          placeholder="Your answer"
        />
        <button className="primary">Check answer</button>
      </form>
      <div className="practice-links">
        <button onClick={() => setHint(true)}>Show hint</button>
        <button
          onClick={() => {
            setAnswer("");
            setFeedback("");
          }}
        >
          Try again
        </button>
      </div>
      {hint && <p>{practice.hint}</p>}
      <p role="status">{feedback}</p>
    </section>
  );
}
