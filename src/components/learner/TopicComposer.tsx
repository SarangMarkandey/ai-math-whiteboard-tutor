"use client";
const examples = [
  "Explain linear equations.",
  "Help me solve 5x + 7 = 32.",
  "Show an equation with a fractional answer.",
];
export default function TopicComposer({
  ready,
  topic,
  onTopic,
  onGenerate,
  onSaved,
  busy,
  hasLesson,
  onClose,
}: {
  ready: boolean;
  topic: string;
  onTopic: (v: string) => void;
  onGenerate: () => void;
  onSaved: () => void;
  busy: boolean;
  hasLesson: boolean;
  onClose: () => void;
}) {
  return (
    <section className={`topic-entry ${hasLesson ? "compact" : ""}`}>
      <p className="eyebrow">LINEAR EQUATIONS · BEGINNER</p>
      <h1>
        {hasLesson
          ? "Explore a new equation"
          : "What would you like to understand?"}
      </h1>
      <p>
        See why each step works, hear it explained, and ask when something isn’t
        clear.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onGenerate();
        }}
      >
        <label htmlFor="topic">Your mathematics question</label>
        <div className="topic-composer">
          <textarea
            disabled={!ready}
            id="topic"
            maxLength={400}
            value={topic}
            onChange={(e) => onTopic(e.target.value)}
            placeholder="For example, help me solve 5x + 7 = 32"
            rows={2}
          />
          <button className="primary" disabled={!ready || !topic.trim()}>
            Generate lesson <span aria-hidden="true">↗</span>
          </button>
        </div>
      </form>
      <p className="scope-note">
        Supported: linear equations in the form ax + b = c, including negative
        and fractional values. Free Plan only.
      </p>
      <div className="example-prompts">
        {examples.map((t, i) => (
          <button disabled={!ready} key={t} onClick={() => onTopic(t)}>
            <span>0{i + 1}</span>
            {t}
            <b aria-hidden="true">↗</b>
          </button>
        ))}
      </div>
      <div className="saved-option">
        <button disabled={!ready} onClick={onSaved}>
          Try saved example <span>2x + 3 = 11 →</span>
        </button>
        <small>
          Saved teaching content with local narration. No generation required.
        </small>
        {hasLesson && (
          <button onClick={onClose}>Return to current lesson</button>
        )}
      </div>
    </section>
  );
}
