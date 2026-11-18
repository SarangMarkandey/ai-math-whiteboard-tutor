import type { PreparedLesson } from "./lesson";
import { solve, negate, multiply, add } from "./math";
import { coefficient, signedTerm, valueText } from "./format";
/** Upgrade known symbolic slots from structured facts, including previously cached lessons. */
export function presentLesson(lesson: PreparedLesson): PreparedLesson {
  if (lesson.plan.source !== "live-generated") return lesson;
  const e = lesson.plan.equation,
    r = solve(e);
  if (r.kind !== "unique" || !r.verified)
    throw new Error("Invalid lesson mathematics");
  const a = valueText(e.a, true),
    b = signedTerm(e.b, true),
    x = valueText(r.solution, true),
    c = valueText(e.c, true);
  const replacements: Record<string, string> = {
    "original-x": coefficient(e.a, true),
    "original-b": b,
    "operation-left": signedTerm(negate(e.b), true),
    "operation-right": signedTerm(negate(e.b), true),
    "isolated-x": coefficient(e.a, true),
    answer: `x=${x}`,
    substitution: `${a}\\cdot(${x})${b}=${c}`,
    product: `${valueText(multiply(e.a, r.solution), true)}${b}=${c}`,
    verified: `${valueText(add(multiply(e.a, r.solution), e.b), true)}=${c}`,
  };
  return {
    ...lesson,
    plan: {
      ...lesson.plan,
      elements: lesson.plan.elements.map((v) =>
        replacements[v.id] ? { ...v, text: replacements[v.id] } : v,
      ),
    },
  };
}
