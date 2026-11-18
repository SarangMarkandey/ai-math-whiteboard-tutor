import { checkCoefficientBounds, COEFFICIENT_SCOPE } from './linear-input';
import { explanationSchema, objectiveSchema, outlineItemSchema } from './teaching-contract';
import { spoken, spokenCoefficient, narrationText } from './narration';
import { signedTerm, coefficient } from "./format";
import { z } from "zod";
import {
  equationSchema,
  rationalSchema,
  normalizeEquation,
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
export { spoken } from './narration';
export { specificEquation } from './linear-input';
export function boundedEquation(input: unknown) {
  const e = checkCoefficientBounds(normalizeEquation(equationSchema.parse(input)));
  const result = solve(e);
  if (result.kind !== 'unique')
    throw new Error(result.kind === 'none'
      ? 'This equation has no solution. Unique-solution lessons are supported first.'
      : 'Every x satisfies this equation. Unique-solution lessons are supported first.');
  return { e, result };
}
export const interpretationSchema = z
  .object({
    status: z.enum(["supported", "clarify", "unsupported"]),
    message: z.string().max(240),
    equation: equationSchema,
  })
  .strict();
export const teachingSchema = z
  .object({
    objective: objectiveSchema,
    outline: z.array(outlineItemSchema).min(3).max(6),
    equation: equationSchema,
    solution: rationalSchema,
    beats: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,35}$/),
            role: z.enum(roles),
            explanation: explanationSchema,
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
  objective: objectiveSchema,
  outline: z.array(outlineItemSchema).min(3).max(6),
  explanations: z.object(
    Object.fromEntries(roles.map(role => [role, explanationSchema])) as
      Record<typeof roles[number], typeof explanationSchema>,
  ).strict(),
  practice: equationSchema.superRefine((equation,ctx) => {
    const e = normalizeEquation(equation);
    if (BigInt(e.a.n) === 0n) ctx.addIssue({code:'custom',path:['a'],message:'Use a nonzero practice coefficient.'});
    try { checkCoefficientBounds(e); } catch { ctx.addIssue({code:'custom',message:COEFFICIENT_SCOPE}); }
  }),

}).strict();

export function completeNarrationResponse(input: unknown, equation: Equation): Teaching {
  const wire = narrationResponseSchema.parse(input);
  const main = boundedEquation(equation);
  const practice = boundedEquation(wire.practice);
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
    c = tex(e.c),
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
  element(5, "operation-right", signedTerm(negate(e.b), true), 510, 145);
  element(6, "cancel-b", "", 225, 65, "stroke", 95, 35);
  element(6, "cancel-op", "", 225, 120, "stroke", 95, 35);
  element(7, "isolated-x", coefficient(e.a, true), 65, 220);
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
  const absoluteConstant = BigInt(e.b.n) < 0n ? negate(e.b) : e.b;
  const operation = BigInt(e.b.n) > 0n ? 'Subtract' : 'Add';
  const from = operation === 'Subtract' ? 'from' : 'to';
  const fact = [
    'Let us solve the equation on the board.',
    `The x term is ${spokenCoefficient(e.a)}.`,
    `The constant term is ${spoken(e.b)}.`,
    `The right side is ${spoken(e.c)}. Both sides must stay equal.`,
    `${operation} ${spoken(absoluteConstant)} ${from} the left side.`,
    `${operation} ${spoken(absoluteConstant)} ${from} the right side too.`,
    'The constant and its opposite cancel to zero.',
    `Now ${spokenCoefficient(e.a)} equals ${spoken(remaining)}.`,
    `Divide the left side by ${spoken(e.a)}.`,
    `Divide the right side by ${spoken(e.a)} too.`,
    'The coefficient divided by itself is one.',
    `So x equals ${spoken(result.solution)}.`,
    `Replace x with ${spoken(result.solution)} in the original equation.`,
    `The multiplication gives ${spoken(product)}.`,
    `Both sides equal ${spoken(e.c)}. The solution is verified.`,
    'Try the related practice equation below.',
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
    const text = narrationText(fact[i], beat.explanation);
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
