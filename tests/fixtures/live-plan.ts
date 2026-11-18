import { roles, compileTeaching, type Teaching } from "../../src/domain/live";
import { rational as r, solve, type Equation } from "../../src/domain/math";
export function mockPlan(e: Equation, id: string) {
  const result = solve(e);
  if (result.kind !== "unique") throw new Error();
  const t: Teaching = {
    objective: "Understand why matching operations preserve equality.",
    outline: ["Read", "Solve", "Check"],
    equation: e,
    solution: result.solution,
    beats: roles.map((role, i) => ({
      id: `step-${i}`,
      role,
      explanation: "Keep track of the equal values as the working develops.",
      visual: [1, 2, 3, 10].includes(i)
        ? "highlight"
        : [6, 8, 9].includes(i)
          ? "draw"
          : "reveal",
    })),
    practice: {
      equation: { a: r(3), b: r(2), c: r(17) },
      solution: r(5),
      hint: "Keep both sides equal.",
    },
  };
  return compileTeaching(t, e, id);
}
