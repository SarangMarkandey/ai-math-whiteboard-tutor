import { z } from "zod";
import { unsupportedNumberWords } from "./teaching-contract";
import {
  boardAt,
  sceneAt,
  timelineSchema,
  type PreparedLesson,
} from "./lesson";
import { solve, negate, multiply, add } from "./math";
import { formatEquation, valueText, signedTerm } from "./format";
export const followupRequest = z
  .object({
    lessonId: z.string().min(1).max(80),
    stepId: z.string().min(1).max(80),
    position: z.number().finite().nonnegative(),
    contextId: z.string().min(1).max(80),
    question: z.string().trim().min(2).max(500),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            text: z.string().min(1).max(700),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();
export type FollowupInput = z.infer<typeof followupRequest>;
export const answerSchema = z
  .object({
    text: z
      .string()
      .min(5)
      .max(1000)
      .regex(/^[^<>\\\d]*$/),
    scope: z.enum(["current", "unsupported"]),
    visual: z
      .object({
        kind: z.enum(["none", "highlight"]),
        targets: z.array(z.string().min(1).max(80)).max(3),
      })
      .strict(),
  })
  .strict();
export function trustedContext(lesson: PreparedLesson, input: FollowupInput) {
  timelineSchema.parse(lesson);
  if (
    lesson.plan.id !== input.lessonId ||
    input.position > lesson.audio.duration + 0.001
  )
    throw new Error("Invalid lesson reference or playback position");
  const index = sceneAt(lesson, input.position),
    step = lesson.plan.scenes[index];
  if (step.id !== input.stepId)
    throw new Error(
      "Selected step does not match the captured playback position",
    );
  const result = solve(lesson.plan.equation);
  if (result.kind !== "unique" || !result.verified)
    throw new Error("Lesson equation cannot be verified");
  const e = lesson.plan.equation,
    op = negate(e.b);
  const operation =
    BigInt(op.n) < 0n
      ? `Subtract ${valueText(negate(op))} from both sides`
      : `Add ${valueText(op)} to both sides`;
  const constant = signedTerm(e.b);
  const facts = {
    equation: formatEquation(e),
    operation,
    isolated: formatEquation(result.steps[1]),
    division: `Divide both sides by ${valueText(e.a)}`,
    solution: `x = ${valueText(result.solution)}`,
    verification: `${valueText(multiply(e.a, result.solution))} ${constant[0]} ${constant.slice(1)} = ${valueText(add(multiply(e.a, result.solution), e.b))}`,
  };
  const state = boardAt(lesson, input.position);
  const role = step.title;
  const targets = step.actions.map((a) => a.target).join(" ");
  const selectedOperation = /divide|quotient|bar-|denom/.test(
    role + " " + targets,
  )
    ? facts.division
    : /substitut|multiply|verify|verified|product/.test(role + " " + targets)
      ? "Check the solution by substitution"
      : /cancel|simplify|operation|subtract|isolated/.test(role + " " + targets)
        ? facts.operation
        : "Interpret the equality and its terms";
  return {
    index,
    selectedOperation,
    step: {
      id: step.id,
      title: step.title,
      narration: step.narration
        .map((n) => n.text)
        .join(" ")
        .slice(0, 400),
    },
    facts,
    transformations: result.steps,
    visibleTargets: Object.values(state)
      .filter((e) => e.kind === "term" && e.opacity > 0.5)
      .map((e) => e.id),
  };
}
export function validateAnswer(
  raw: unknown,
  context: ReturnType<typeof trustedContext>,
) {
  const a = answerSchema.parse(raw);
  if (/[<>\\\d]/.test(a.text) || unsupportedNumberWords(a.text))
    throw new Error("Use verified fact references for numerical claims");
  const text = a.text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!Object.hasOwn(context.facts, key)) throw new Error("Unknown mathematical fact");
    return context.facts[key as keyof typeof context.facts];
  });
  if (text.length > 1500) throw new Error("Tutor answer is too long");
  if (/[{}]/.test(text)) throw new Error("Invalid mathematical reference");
  if (a.visual.kind === "none" && a.visual.targets.length)
    throw new Error("A text answer cannot contain visual targets");
  for (const id of a.visual.targets)
    if (!context.visibleTargets.includes(id))
      throw new Error("Answer refers to an unavailable visual element");
  return { ...a, text };
}
