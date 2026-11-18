import { signedTerm, coefficient } from "./format";
import { z } from "zod";
import {
  equationSchema,
  rationalSchema,
  parseRational,
  rational as r,
  solve,
  equal,
  negate,
  multiply,
  add,
  type Equation,
  type Rational,
} from "./math";
import { planSchema, type LessonPlan } from "./lesson";
export const roles = [
  "introduce",
  "unknown",
  "constant",
  "equality",
  "operationLeft",
  "operationRight",
  "cancel",
  "simplify",
  "divideLeft",
  "divideRight",
  "quotient",
  "solution",
  "substitute",
  "multiply",
  "verify",
  "practice",
] as const;
export const rationalText = (v: Rational) =>
  v.d === "1" ? v.n : `${v.n}/${v.d}`;
export const tex = (v: Rational) =>
  v.d === "1" ? v.n : `\\frac{${v.n}}{${v.d}}`;
export const equationText = (e: Equation) =>
  `${rationalText(e.a)}x ${BigInt(e.b.n) < 0n ? "-" : "+"} ${rationalText(BigInt(e.b.n) < 0n ? negate(e.b) : e.b)} = ${rationalText(e.c)}`;
const words = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
function intSpeech(s: string): string {
  const n = Number(s);
  if (n < 0) return `negative ${intSpeech(String(-n))}`;
  if (n < 20) return words[n];
  if (n < 100)
    return (
      [
        "",
        "",
        "twenty",
        "thirty",
        "forty",
        "fifty",
        "sixty",
        "seventy",
        "eighty",
        "ninety",
      ][Math.floor(n / 10)] + (n % 10 ? ` ${words[n % 10]}` : "")
    );
  return s;
}
export const spoken = (v: Rational) =>
  v.d === "1" ? intSpeech(v.n) : `${intSpeech(v.n)} over ${intSpeech(v.d)}`;
export function boundedEquation(input: unknown) {
  const raw = equationSchema.parse(input);
  const e: Equation = {
    a: r(BigInt(raw.a.n), BigInt(raw.a.d)),
    b: r(BigInt(raw.b.n), BigInt(raw.b.d)),
    c: r(BigInt(raw.c.n), BigInt(raw.c.d)),
  };
  for (const v of Object.values(e))
    if (Math.abs(Number(v.n)) > 99 || Math.abs(Number(v.d)) > 12)
      throw new Error(
        "Use coefficients up to ninety-nine and denominators up to twelve.",
      );
  const result = solve(e);
  if (result.kind !== "unique")
    throw new Error(
      result.kind === "none"
        ? "This equation has no solution. Unique-solution lessons are supported first."
        : "Every x satisfies this equation. Unique-solution lessons are supported first.",
    );
  return { e, result };
}
export function specificEquation(topic: string): Equation | null {
  const s = topic.replaceAll("−", "-").replaceAll("×", "*");
  const m =
    /(-?\d+(?:\/\d+)?|-)??\s*\*?\s*x\s*([+-])\s*(\d+(?:\/\d+)?)\s*=\s*(-?\d+(?:\/\d+)?)(?![\d/a-z]|\.\d)/i.exec(
      s,
    );
  if (!m) return null;
  if (
    /[\d=^*/.+-]|\bx\b/i.test(s.slice(0, m.index)) ||
    /[\d=^*/+-]|\bx\b/i.test(s.slice(m.index + m[0].length))
  )
    return null;
  try {
    const a = parseRational(m[1] === "-" ? "-1" : m[1] || "1"),
      b = parseRational(m[3]);
    return { a, b: m[2] === "-" ? negate(b) : b, c: parseRational(m[4]) };
  } catch {
    return null;
  }
}
export const interpretationSchema = z
  .object({
    status: z.enum(["supported", "clarify", "unsupported"]),
    message: z.string().max(240),
    equation: equationSchema,
  })
  .strict();
const explanation = z
  .string()
  .min(4)
  .max(90)
  .refine(
    (t) =>
      !/[\d<>\\=\[\]]/.test(t) &&
      !new RegExp(
        `\\b(${words.join("|")}|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|half|quarter)\\b`,
        "i",
      ).test(t) &&
      !/(only (the )?(left|right)|different operations|break equality|ignore equality)/i.test(
        t,
      ),
    "Numerical claims belong to verified facts, not prose",
  );
export const teachingSchema = z
  .object({
    objective: z.string().min(10).max(140),
    outline: z.array(z.string().min(3).max(90)).min(3).max(6),
    equation: equationSchema,
    solution: rationalSchema,
    beats: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,35}$/),
            role: z.enum(roles),
            explanation,
            visual: z.enum(["reveal", "highlight", "draw"]),
          })
          .strict(),
      )
      .length(16),
    practice: z
      .object({
        equation: equationSchema,
        solution: rationalSchema,
        hint: z.string().min(5).max(160),
      })
      .strict(),
  })
  .strict();
export type Teaching = z.infer<typeof teachingSchema>;
/** Transport contract: prose only plus a small practice problem. Layout and main maths are code-owned. */
export const narrationResponseSchema = z.object({
  objective: z.string().min(10).max(140),
  outline: z.array(z.string().min(3).max(90)).min(3).max(6),
  explanations: z.object(
    Object.fromEntries(roles.map(role => [role, explanation])) as
      Record<typeof roles[number], typeof explanation>,
  ).strict(),
  practice: z.object({
    a: z.number().int().min(-20).max(20).refine(value => value !== 0),
    b: z.number().int().min(-99).max(99),
    c: z.number().int().min(-99).max(99),
  }).strict(),
}).strict();

export function completeNarrationResponse(input: unknown, equation: Equation): Teaching {
  const wire = narrationResponseSchema.parse(input);
  const main = boundedEquation(equation);
  const practice = boundedEquation({
    a: r(wire.practice.a), b: r(wire.practice.b), c: r(wire.practice.c),
  });
  return teachingSchema.parse({
    objective: wire.objective,
    outline: wire.outline,
    equation: main.e,
    solution: main.result.solution,
    beats: roles.map((role, i) => ({
      id: `step-${i}`,
      role,
      explanation: wire.explanations[role],
      visual: [1, 2, 3, 10].includes(i) ? 'highlight'
        : [6, 8, 9].includes(i) ? 'draw' : 'reveal',
    })),
    practice: {
      equation: practice.e,
      solution: practice.result.solution,
      hint: 'Remove the constant with the same operation on both sides, then divide by the coefficient.',
    },
  });
}

export function sameEquation(a: Equation, b: Equation) {
  return equal(a.a, b.a) && equal(a.b, b.b) && equal(a.c, b.c);
}
export function compileTeaching(
  input: unknown,
  equation: Equation,
  id: string,
): LessonPlan {
  const t = teachingSchema.parse(input),
    { e, result } = boundedEquation(equation);
  if (!sameEquation(t.equation, e) || !equal(t.solution, result.solution))
    throw new Error("AI mathematical claims contradict verified steps");
  const p = boundedEquation(t.practice.equation);
  if (!equal(p.result.solution, t.practice.solution) || sameEquation(p.e, e))
    throw new Error("Invalid or unrelated practice answer");
  if (
    new Set(t.beats.map((b) => b.id)).size !== 16 ||
    t.beats.some((b, i) => b.role !== roles[i])
  )
    throw new Error(
      "Teaching beats must follow the verified operation sequence",
    );
  const a = tex(e.a),
    b = tex(e.b),
    c = tex(e.c),
    op = tex(negate(e.b)),
    remaining = result.steps[1].c,
    x = tex(result.solution),
    product = multiply(e.a, result.solution);
  const elements: LessonPlan["elements"] = [];
  const actions: LessonPlan["scenes"][number]["actions"][] = roles.map(
    () => [],
  );
  function element(
    i: number,
    id: string,
    text: string,
    x: number,
    y: number,
    kind: "term" | "stroke" = "term",
    width = 65,
    height = 35,
  ) {
    elements.push({ id, kind, text, x, y, width, height });
    actions[i].push({
      target: id,
      kind: kind === "stroke" ? "draw" : "reveal",
      duration: kind === "stroke" ? 1.2 : 0.7,
    });
  }
  element(0, "original-x", coefficient(e.a, true), 65, 90);
  element(0, "original-b", signedTerm(e.b, true), 225, 90);
  element(0, "original-eq", "=", 395, 90);
  element(0, "original-c", c, 510, 90);
  actions[0].forEach((a, i) => {
    a.delay = i * 0.45;
  });
  actions[1].push({ target: "original-x", kind: "highlight", duration: 2 });
  actions[2].push({ target: "original-b", kind: "highlight", duration: 2 });
  actions[3].push({ target: "original-eq", kind: "highlight", duration: 2 });
  element(4, "operation-left", signedTerm(negate(e.b), true), 225, 145);
  element(5, "operation-right", `+(${op})`, 510, 145);
  element(6, "cancel-b", "", 225, 65, "stroke", 95, 35);
  element(6, "cancel-op", "", 225, 120, "stroke", 95, 35);
  element(7, "isolated-x", `${a}x`, 65, 220);
  element(7, "isolated-eq", "=", 395, 220);
  element(7, "isolated-c", tex(remaining), 510, 220);
  element(8, "bar-left", "", 60, 238, "stroke", 125, 0);
  element(8, "denom-left", a, 95, 280);
  element(9, "bar-right", "", 505, 238, "stroke", 125, 0);
  element(9, "denom-right", a, 540, 280);
  actions[8].find((a) => a.target === "denom-left")!.delay = 0.9;
  actions[9].find((a) => a.target === "denom-right")!.delay = 0.9;
  actions[10].push(
    { target: "denom-left", kind: "highlight", duration: 2 },
    { target: "denom-right", kind: "highlight", duration: 2 },
  );
  element(11, "answer", `x=${x}`, 65, 345);
  element(
    12,
    "substitution",
    `${a}\\cdot(${x})${signedTerm(e.b, true)}=${c}`,
    65,
    410,
  );
  element(
    13,
    "product",
    `${tex(product)}${signedTerm(e.b, true)}=${c}`,
    65,
    465,
  );
  element(14, "verified", `${tex(add(product, e.b))}=${c}`, 65, 525);
  element(15, "practice-label", "\\text{Your turn}", 690, 90);
  const centered: Record<string, number> = {
    "original-x": 50,
    "original-b": 215,
    "original-eq": 395,
    "original-c": 500,
    "operation-left": 215,
    "operation-right": 500,
    "isolated-x": 50,
    "isolated-eq": 395,
    "isolated-c": 500,
    "denom-left": 50,
    "denom-right": 500,
  };
  for (const e of elements) {
    if (e.id in centered) {
      e.x = centered[e.id];
      e.width = e.id.endsWith("eq") ? 65 : 125;
      e.align = "center";
    }
    if (e.id === "bar-left") {
      e.x = 50;
      e.width = 125;
    }
    if (e.id === "bar-right") {
      e.x = 500;
      e.width = 125;
    }
  }
  const fact = [
    `Solve ${spoken(e.a)} times x plus ${spoken(e.b)} equals ${spoken(e.c)}.`,
    `The unknown is x. Its coefficient is ${spoken(e.a)}.`,
    `The constant term is ${spoken(e.b)}.`,
    `Both sides of the equation have the same value.`,
    `Add ${spoken(negate(e.b))} on the left.`,
    `Add ${spoken(negate(e.b))} on the right too.`,
    `The constant and its opposite cancel to zero.`,
    `We have ${spoken(e.a)} times x equals ${spoken(remaining)}.`,
    `Divide the left side by ${spoken(e.a)}.`,
    `Divide the right side by ${spoken(e.a)} too.`,
    `The coefficient divided by itself is one.`,
    `So x equals ${spoken(result.solution)}.`,
    `Substitute ${spoken(result.solution)} for x in the original equation.`,
    `The multiplication gives ${spoken(product)}.`,
    `Both sides equal ${spoken(e.c)}. The solution is verified.`,
    `Try the related practice equation below.`,
  ];
  const scenes = t.beats.map((beat, i) => {
    const permitted =
      i === 1 || i === 2 || i === 3 || i === 10
        ? "highlight"
        : i === 6 || i === 8 || i === 9
          ? "draw"
          : "reveal";
    if (beat.visual !== permitted)
      throw new Error("Unsupported visual for this teaching beat");
    const text = `${fact[i]} ${beat.explanation}`;
    if (text.length > 179)
      throw new Error(
        "Teaching phrase exceeds the speech limit; shorten this beat",
      );
    return {
      id: beat.id,
      title: roles[i],
      narration: [{ id: `speech-${beat.id}`, text }],
      actions: actions[i],
    };
  });
  return planSchema.parse({
    version: 2,
    id,
    title: `Solve ${equationText(e)}`,
    objective: t.objective,
    level: "beginner",
    source: "live-generated",
    equation: e,
    elements,
    scenes,
    practice: {
      equation: p.e,
      prompt: equationText(p.e),
      expected: p.result.solution,
      hint: "Use the same operation on both sides to remove the constant, then divide by the coefficient.",
    },
  });
}
