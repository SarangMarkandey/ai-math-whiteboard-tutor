import { validateMathematics } from '../domain/prepare';
import { rational as r } from "../domain/math";
import { planSchema, timelineSchema, type LessonPlan } from "../domain/lesson";
import timing from "./timings.json";
const elements: LessonPlan["elements"] = [];
const beats: LessonPlan["scenes"][number]["actions"][] = Array.from(
  { length: 20 },
  () => [],
);
function element(
  id: string,
  kind: LessonPlan["elements"][number]["kind"],
  text: string,
  x: number,
  y: number,
  width = 65,
  height = 35,
) {
  elements.push({ id, kind, text, x, y, width, height });
}
function act(
  beat: number,
  target: string,
  kind: LessonPlan["scenes"][number]["actions"][number]["kind"] = "reveal",
  duration = 0.7,
  extra = {},
) {
  beats[beat].push({ target, kind, duration, ...extra });
}
function term(id: string, text: string, x: number, y: number, beat: number) {
  element(id, "term", text, x, y);
  act(beat, id);
}
term("problem", "Solve for x", 65, 50, 0);
term("original-x", "2x", 80, 94, 1);
term("original-plus", "+3", 180, 94, 1);
term("original-equal", "=", 290, 94, 1);
term("original-right", "11", 385, 94, 1);
act(2, "original-x", "highlight");
act(3, "original-plus", "highlight");
act(3, "original-right", "highlight");
element("scale", "balance", "", 690, 270, 400);
act(4, "scale");
for (let i = 0; i < 2; i++) {
  element(`bag-${i}`, "block", "x", 535 + i * 65, 205, 50, 60);
  act(5, `bag-${i}`);
}
for (let i = 0; i < 3; i++) {
  element(`left-${i}`, "block", "", 535 + i * 28, 280, 22, 22);
  act(5, `left-${i}`);
}
for (let i = 0; i < 11; i++) {
  element(
    `right-${i}`,
    "block",
    "",
    760 + (i % 4) * 28,
    205 + Math.floor(i / 4) * 28,
    22,
    22,
  );
  act(5, `right-${i}`);
}
term("subtract-left", "-3", 180, 145, 6);
term("subtract-right", "-3", 385, 145, 6);
act(7, "subtract-left", "highlight");
act(7, "subtract-right", "highlight");
for (const [id, x, y] of [
  ["cancel-plus", 180, 94],
  ["cancel-minus", 180, 145],
] as const) {
  element(id, "stroke", "", x, y - 8, 58, -30);
  act(8, id, "draw", 1.2);
}
for (let i = 0; i < 3; i++) {
  act(9, `left-${i}`, "highlight");
  act(9, `right-${i + 8}`, "highlight");
  for (const side of ["left", "right"]) {
    const id = side === "left" ? `left-${i}` : `right-${i + 8}`;
    const e = elements.find((e) => e.id === id)!;
    act(10, id, "move", 1.8, {
      from: { x: e.x, y: e.y },
      to: { x: e.x, y: e.y + 65 },
    });
    act(10, id, "fade", 1.8);
  }
}
term("result-x", "2x", 80, 218, 11);
term("result-equal", "=", 290, 218, 11);
term("result-right", "8", 400, 218, 11);
for (const [id, x] of [
  ["bar-left", 78],
  ["bar-right", 382],
] as const) {
  element(id, "stroke", "", x, 234, 65, 0);
  act(12, id, "draw", 1);
}
term("denominator-left", "2", 95, 273, 13);
term("denominator-right", "2", 400, 273, 13);
for (let i = 0; i < 2; i++) {
  element(
    `group-${i}`,
    "group",
    `group ${i + 1}`,
    530 + i * 175,
    370,
    145,
    100,
  );
  act(14, `group-${i}`);
}
for (let i = 0; i < 8; i++) {
  const id = `right-${i}`,
    e = elements.find((e) => e.id === id)!;
  act(14, id, "move", 2, {
    from: { x: e.x, y: e.y },
    to: {
      x: 565 + Math.floor(i / 4) * 175 + (i % 2) * 30,
      y: 390 + Math.floor((i % 4) / 2) * 30,
    },
  });
}
term("answer", "x = 4", 100, 345, 15);
act(15, "answer", "highlight");
term("substitute", "2(4) + 3 = 11", 75, 412, 16);
term("multiply", "8 + 3 = 11", 75, 468, 17);
term("verified", "11 = 11", 75, 524, 18);
term("invitation", "Try: 3x + 2 = 14", 530, 530, 19);
export const examplePlan = planSchema.parse({
  version: 2,
  id: "linear-2x-3-11",
  title: "Solving a linear equation",
  objective: "Preserve equality with matching operations",
  source: "saved-example",
  level: "beginner",
  equation: { a: r(2), b: r(3), c: r(11) },
  elements,
  scenes: timing.segments.map((s, i) => ({
    id: `beat-${i}`,
    title: s.text,
    narration: [{ id: `phrase-${i}`, text: s.text }],
    actions: beats[i],
  })),
  practice: {
    equation: { a: r(3), b: r(2), c: r(14) },
    prompt: "3x + 2 = 14",
    expected: r(4),
    hint: "Subtract 2 on both sides, then divide both sides by 3.",
  },
});
validateMathematics(examplePlan);
export const example = timelineSchema.parse({
  plan: examplePlan,
  audio: {
    src: "/audio/linear-equation.mp3",
    duration: timing.duration,
    provenance:
      "Offline Flite SLT development fixture. Phrase file durations measured; action offsets are authored, not verified word alignment.",
  },
  scenes: timing.segments.map((s, i) => ({
    sceneId: `beat-${i}`,
    start: s.start,
    end: s.end,
    cues: beats[i].map((action, j) => ({
      at:
        s.start +
        (action.kind === "reveal"
          ? Math.min(j * 0.22, (s.end - s.start) * 0.3)
          : 0),
      action,
    })),
    captions: [{ start: s.start, end: s.end, text: s.text }],
  })),
});
