import "server-only";
import { createHash } from "node:crypto";
import {
  followupRequest,
  trustedContext,
  validateAnswer,
  type FollowupInput,
} from "../../domain/followup";
import { specificEquation, sameEquation } from "../../domain/live";
import { type PreparedLesson } from "../../domain/lesson";
export type AnswerProvider = (
  context: ReturnType<typeof trustedContext>,
  input: FollowupInput,
) => Promise<unknown>;
export class FollowupService {
  private flights = new Map<string, Promise<unknown>>();
  private completed = new Map<string, unknown>();
  constructor(
    private load: (id: string) => Promise<PreparedLesson | null>,
    private provider: AnswerProvider,
  ) {}
  async answer(raw: unknown) {
    const input = followupRequest.parse(raw),
      key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const hit = this.completed.get(key);
    if (hit) return hit;
    const active = this.flights.get(key);
    if (active) return active;
    const work = this.prepare(input);
    this.flights.set(key, work);
    try {
      const result = await work;
      this.completed.set(key, result);
      if (this.completed.size > 100)
        this.completed.delete(this.completed.keys().next().value!);
      return result;
    } finally {
      this.flights.delete(key);
    }
  }
  private async prepare(input: FollowupInput) {
    const lesson = await this.load(input.lessonId);
    if (!lesson)
      throw new Error(
        "This lesson is not available on the server. Reload or resume its preparation.",
      );
    const context = trustedContext(lesson, input),
      equation = specificEquation(input.question);
    if (equation && !sameEquation(equation, lesson.plan.equation))
      return {
        lessonId: input.lessonId,
        stepId: input.stepId,
        position: input.position,
        contextId: input.contextId,
        kind: "new-lesson",
        text: "That is a different equation. Start a new lesson to explore it; your current lesson will stay paused.",
        newTopic: input.question,
        visual: { kind: "none", targets: [] },
      };
    const raw = await this.provider(context, input);
    const hintOnly =
      context.index === lesson.scenes.length - 1 ||
      /\b(practice|exercise)\b/i.test(input.question);
    if (
      hintOnly &&
      raw &&
      typeof raw === "object" &&
      "text" in raw &&
      typeof raw.text === "string" &&
      /\{\{(?:solution|verification)\}\}/.test(raw.text)
    )
      throw new Error(
        "The tutor attempted to reveal a solution in practice context. Please ask for a method hint instead.",
      );
    const answer = validateAnswer(raw, context);
    return {
      lessonId: input.lessonId,
      stepId: input.stepId,
      position: input.position,
      contextId: input.contextId,
      kind: "ai",
      ...answer,
    };
  }
}
