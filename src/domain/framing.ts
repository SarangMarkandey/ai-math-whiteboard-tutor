import { sceneAt, type PreparedLesson } from "./lesson";
export function frameAt(lesson: PreparedLesson, time: number) {
  const scene = lesson.plan.scenes[sceneAt(lesson, time)];
  const ids = scene.actions.map((a) => a.target);
  const y = Math.max(
    0,
    ...lesson.plan.elements.filter((e) => ids.includes(e.id)).map((e) => e.y),
  );
  // Leave room below the baseline for fractional denominators and descenders.
  return { y: y > 230 ? Math.min(310, y - 180) : 0, height: 280 };
}
