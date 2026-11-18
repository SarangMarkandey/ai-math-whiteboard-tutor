import { planSchema, type LessonPlan } from "./lesson";
import { equal, solve, verify } from "./math";
/** Trust boundary shared by saved fixtures and future server providers. */
export function validateMathematics(input: LessonPlan): LessonPlan {
  const plan = planSchema.parse(input);
  const result = solve(plan.equation);
  if (result.kind !== "unique" || !result.verified)
    throw new Error("This lesson layout requires one unique solution.");
  const practice = solve(plan.practice.equation);
  if (
    practice.kind !== "unique" ||
    !equal(practice.solution, plan.practice.expected) ||
    !verify(plan.practice.equation, plan.practice.expected)
  )
    throw new Error("Invalid expected practice answer.");
  return plan;
}
