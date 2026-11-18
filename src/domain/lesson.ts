import { z } from "zod";
import { equationSchema, rationalSchema } from "./math";
const visual = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["term", "stroke", "block", "balance", "group"]),
  align:z.enum(["left","center"]).optional(),
  text: z.string().max(180).default(""),
  x: z.number().finite().min(0).max(950),
  y: z.number().finite().min(0).max(560),
  width: z.number().default(65),
  height: z.number().default(35),
});
const action = z.object({
  target: z.string(),
  kind: z.enum(["reveal", "draw", "highlight", "move", "fade"]),
  duration: z.number().positive(),
  delay:z.number().nonnegative().max(5).optional(),
  from: z.object({ x: z.number(), y: z.number() }).optional(),
  to: z.object({ x: z.number(), y: z.number() }).optional(),
});
export const planSchema = z
  .object({
    version: z.literal(2),
    id: z.string(),
    title: z.string(),
    objective: z.string(),
    level: z.literal("beginner"),
    source: z.enum(["saved-example", "live-generated"]),
    equation: equationSchema,
    elements: z.array(visual).min(1).max(100),
    scenes: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        narration: z.array(z.object({ id: z.string(), text: z.string() })),
        actions: z.array(action),
      }),
    ),
    practice: z.object({
      equation: equationSchema,
      prompt: z.string(),
      expected: rationalSchema,
      hint: z.string(),
    }),
  })
  .superRefine((p, c) => {
    const sceneIds = p.scenes.map((s) => s.id),
      narrationIds = p.scenes.flatMap((s) => s.narration.map((n) => n.id));
    if (
      new Set(sceneIds).size !== sceneIds.length ||
      new Set(narrationIds).size !== narrationIds.length ||
      p.scenes.length > 40
    )
      c.addIssue({
        code: "custom",
        message: "Invalid or duplicate teaching beat IDs",
      });
    const ids = p.elements.map((e) => e.id);
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", message: "Duplicate IDs" });
    for (const s of p.scenes)
      for (const a of s.actions) {
        if (!ids.includes(a.target))
          c.addIssue({ code: "custom", message: "Unknown target" });
        if (a.kind === "move" && (!a.from || !a.to))
          c.addIssue({
            code: "custom",
            message: "Movement needs initial and final coordinates",
          });
      }
  });
export type LessonPlan = z.infer<typeof planSchema>;
export const timelineSchema = z
  .object({
    plan: planSchema,
    audio: z.object({
      src: z.string(),
      duration: z.number().positive(),
      provenance: z.string(),
      clips: z.array(z.object({
        src: z.string().regex(/^\/api\/lessons\/[a-f0-9]{64}\/clips\/\d+$/),
        start: z.number().nonnegative(), end: z.number().positive(),
      })).min(1).max(16).optional(),
    }),
    scenes: z.array(
      z.object({
        sceneId: z.string(),
        start: z.number(),
        end: z.number(),
        cues: z.array(z.object({ at: z.number(), action })),
        captions: z.array(
          z.object({ start: z.number(), end: z.number(), text: z.string() }),
        ),
      }),
    ),
  })
  .superRefine((t, c) => {
    let end = 0;
    if (t.audio.clips) {
      if (t.audio.clips.length !== t.scenes.length)
        c.addIssue({code:'custom',message:'Missing playback clips'});
      t.audio.clips.forEach((clip,i) => {
        if(clip.start !== t.scenes[i]?.start || clip.end !== t.scenes[i]?.end)
          c.addIssue({code:'custom',message:'Invalid clip boundaries'});
      });
    }
    t.scenes.forEach((s, i) => {
      if (
        s.start !== end ||
        s.end <= s.start ||
        s.sceneId !== t.plan.scenes[i]?.id
      )
        c.addIssue({ code: "custom", message: "Invalid scene partition" });
      end = s.end;
      for (const q of s.cues)
        if (
          q.at < s.start ||
          q.at + q.action.duration > s.end + 0.001 ||
          !t.plan.scenes[i].actions.some(
            (a) => JSON.stringify(a) === JSON.stringify(q.action),
          )
        )
          c.addIssue({ code: "custom", message: "Invalid cue" });
    });
    if (end !== t.audio.duration)
      c.addIssue({ code: "custom", message: "Incomplete audio" });
  });
export type PreparedLesson = z.infer<typeof timelineSchema>;
export function sceneAt(l: PreparedLesson, t: number) {
  return Math.max(
    0,
    l.scenes.findIndex((s) => t < s.end) === -1
      ? l.scenes.length - 1
      : l.scenes.findIndex((s) => t < s.end),
  );
}
export function boardAt(l: PreparedLesson, time: number, reduced = false) {
  const state = Object.fromEntries(
    l.plan.elements.map((e) => [
      e.id,
      { ...e, opacity: 0, progress: 0, highlight: 0 },
    ]),
  );
  for (const s of l.scenes)
    for (const q of s.cues) {
      if (time < q.at) continue;
      const e = state[q.action.target],
        a = q.action,
        p = reduced ? 1 : Math.min(1, Math.max(0, (time - q.at) / a.duration));
      switch (a.kind) {
        case "reveal":
          e.opacity = p;
          e.progress = p;
          break;
        case "draw":
          e.opacity = 1;
          e.progress = p;
          break;
        case "highlight":
          e.highlight = p < 1 ? Math.sin(p * Math.PI) : 0;
          break;
        case "fade":
          e.opacity = 1 - p;
          break;
        case "move":
          e.x = a.from!.x + (a.to!.x - a.from!.x) * p;
          e.y = a.from!.y + (a.to!.y - a.from!.y) * p;
          break;
      }
    }
  return state;
}
