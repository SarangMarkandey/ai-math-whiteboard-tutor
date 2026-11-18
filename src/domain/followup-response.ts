import { z } from 'zod';
export const followupResponse = z.object({
  lessonId: z.string(),
  stepId: z.string(),
  position: z.number(),
  contextId: z.string(),
  kind: z.enum(["ai", "new-lesson"]),
  text: z.string().min(1).max(1500),
  newTopic: z.string().max(500).optional(),
  visual: z.object({
    kind: z.enum(["none", "highlight"]),
    targets: z.array(z.string()).max(3),
  }),
});
