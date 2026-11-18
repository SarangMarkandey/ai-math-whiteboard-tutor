import "server-only";
import { EXPLANATION_STYLE, LESSON_PIPELINE_VERSION, validationFeedback } from '../../domain/teaching-contract';
import { parseEquationRequest } from '../../domain/linear-input';
import { solve } from '../../domain/math';
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  interpretationSchema,
  specificEquation,
  boundedEquation,
  sameEquation,
  compileTeaching,
  roles,
} from "../../domain/live";
import {
  type LessonPlan,
  timelineSchema,
  type PreparedLesson,
} from "../../domain/lesson";
import { type Equation } from "../../domain/math";
import {
  prepareBeatTimeline,
  normalizeWav,
  type BeatClip,
} from "../../domain/speech";
import { type Repository } from "./store";
import { type Ask } from "./provider";
import { type SpeechConfig, SpeechError } from "../speech/config";
import { type PreviewService } from "../speech/service";
export type Job = {
  id: string;
  version: 1;
  topic: string;
  config: {
    lessonModel: string;
    ttsModel: string;
    voice: string;
    promptVersion: 1 | 2 | 3 | typeof LESSON_PIPELINE_VERSION;
    level: "beginner";
  };
  stage:
    | "interpret"
    | "plan"
    | "narration"
    | "assemble"
    | "ready"
    | "clarify"
    | "unsupported";
  equation?: Equation;
  plan?: LessonPlan;
  outline?: string[];
  clips: BeatClip[];
  manifest?: PreparedLesson;
  audio?: string;
  message?: string;
  retryAt?: number;
  attempts: number;
};
export const topicSchema = z
  .object({ topic: z.string().trim().min(3).max(400) })
  .strict();
export function lessonKey(topic: string, model: string, c: SpeechConfig) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        request: (() => {
          const parsed = parseEquationRequest(topic);
          return parsed.kind === 'equation' ? {equation:parsed.equation,context:parsed.context} : {topic};
        })(),
        model,
        tts: c.modelId,
        voice: c.voiceId,
        format: c.outputFormat,
        speechVersion: c.version,
        prompt: LESSON_PIPELINE_VERSION,
        schema: 3,
        level: "beginner",
      }),
    )
    .digest("hex");
}
export function joinWavs(clips: BeatClip[]) {
  let format: Buffer | undefined;
  const data: Buffer[] = [];
  for (const clip of clips) {
    const b = Buffer.from(
      normalizeWav(Buffer.from(clip.speech.audio_base64, "base64")).bytes,
    );
    for (let i = 12; i + 8 <= b.length;) {
      const n = b.readUInt32LE(i + 4),
        tag = b.toString("ascii", i, i + 4);
      if (tag === "fmt ") {
        const f = b.subarray(i + 8, i + 8 + n);
        if (format && !format.equals(f))
          throw new Error("Speech clips have incompatible sample formats");
        format = f;
      }
      if (tag === "data") data.push(b.subarray(i + 8, i + 8 + n));
      i += 8 + n + (n % 2);
    }
  }
  if (!format || !data.length) throw new Error("No prepared speech");
  const payload = Buffer.concat(data),
    fmt = Buffer.alloc(8 + format.length + (format.length % 2));
  fmt.write("fmt ");
  fmt.writeUInt32LE(format.length, 4);
  format.copy(fmt, 8);
  const header = Buffer.alloc(12);
  header.write("RIFF");
  header.writeUInt32LE(
    4 + fmt.length + 8 + payload.length + (payload.length % 2),
    4,
  );
  header.write("WAVE", 8);
  const dh = Buffer.alloc(8);
  dh.write("data");
  dh.writeUInt32LE(payload.length, 4);
  return Buffer.concat([
    header,
    fmt,
    dh,
    payload,
    ...(payload.length % 2 ? [Buffer.alloc(1)] : []),
  ]);
}
export class LessonService {
  private flights = new Map<string, Promise<Job>>();
  private creations = new Map<string,Promise<Job>>();
  constructor(
    private repo: Repository<Job>,
    private ask: Ask,
    private speech: {
      preview: (
        body: unknown,
        config: SpeechConfig,
      ) => Promise<{ entry: { speech: BeatClip["speech"] } }>;
    },
    private config: SpeechConfig,
    private lessonModel: string,
    private clipPlayback = false,
  ) {}
  async create(topic: string) {
    topic = topicSchema.parse({ topic }).topic;
    const id = lessonKey(topic, this.lessonModel, this.config);
    const existing=this.creations.get(id);if(existing)return existing;
    const work=this.createStored(topic,id);this.creations.set(id,work);
    try{return await work;}finally{this.creations.delete(id);}
  }
  private async createStored(topic:string,id:string){
    const hit = await this.repo.get(id);
    if (hit) return hit;
    const job: Job = {
      id,
      version: 1,
      topic,
      config: {
        lessonModel: this.lessonModel,
        ttsModel: this.config.modelId,
        voice: this.config.voiceId,
        promptVersion: LESSON_PIPELINE_VERSION,
        level: "beginner",
      },
      stage: "interpret",
      clips: [],
      attempts: 0,
    };
    if(this.repo.create)return this.repo.create(id,job);
    await this.repo.put(id, job);
    return job;
  }
  get(id: string) {
    return this.repo.get(id);
  }
  advance(id: string) {
    const existing = this.flights.get(id);
    if (existing) return existing;
    const work = this.run(id);
    this.flights.set(id, work);
    return work.finally(() => this.flights.delete(id));
  }
  private async run(id: string) {
    const job = await this.repo.get(id);
    if (!job) throw new Error("Lesson not found");
    if (job.retryAt && Date.now() < job.retryAt) return job;
    if (["ready", "clarify", "unsupported"].includes(job.stage)) return job;
    if (
      job.config.lessonModel !== this.lessonModel ||
      job.config.ttsModel !== this.config.modelId ||
      job.config.voice !== this.config.voiceId
    )
      throw new Error(
        "Configuration changed. Start a new lesson to avoid mixing narration settings.",
      );
    const previousIssue = job.message;
    job.message = undefined;
    job.retryAt = undefined;
    try {
      if (job.stage === "interpret") {
        const parsed = parseEquationRequest(job.topic);
        const specific = parsed.kind === 'equation' ? parsed.equation : null;
        if (parsed.kind === 'invalid') {
          job.stage = 'clarify';
          job.message = parsed.message;
        } else if (specific && solve(specific).kind !== 'unique') {
          job.stage = 'unsupported';
          job.equation = specific;
          job.message = solve(specific).kind === 'none'
            ? 'This equation has no solution. Live lessons currently require one unique solution; no division by zero was attempted.'
            : 'Every value of x satisfies this equation. Live lessons currently require one unique solution; no division by zero was attempted.';
        } else {
          const interpreted = interpretationSchema.parse(
            await this.ask("interpret", {
              request: job.topic,
              specificEquation: specific,
            }),
          );
          if (interpreted.status !== "supported") {
            job.stage = interpreted.status;
            job.message = interpreted.message;
          } else {
            if (specific && !sameEquation(specific, interpreted.equation))
              throw new Error(
                "The model changed your equation. No lesson was substituted.",
              );
            job.equation = boundedEquation(specific ?? interpreted.equation).e;
            if (
              !specific &&
              /fraction/i.test(job.topic) &&
              boundedEquation(job.equation).result.solution.d === "1"
            )
              throw new Error(
                "The chosen example did not have a fractional solution. Retry interpretation explicitly.",
              );
            job.config.promptVersion = LESSON_PIPELINE_VERSION;
            job.stage = "plan";
            job.attempts = 0;
          }
        }
      } else if (job.stage === "plan") {
        // Upgrade only unfinished old planning stages; retain verified interpretation.
        if (job.config.promptVersion !== LESSON_PIPELINE_VERSION) {
          job.config.promptVersion = LESSON_PIPELINE_VERSION;
          job.attempts = 0;
        }
        if (job.attempts >= 2)
          throw new Error(
            "Plan validation failed twice. Start a revised request; automatic repair is disabled.",
          );
        const verified = boundedEquation(job.equation!);
        const raw = await this.ask("plan", {
          request: job.topic,
          previousValidationIssue: previousIssue,
          equation: verified.e,
          verifiedSteps: verified.result,
          roles,
          requirements: EXPLANATION_STYLE,
        });
        job.attempts++;
        job.plan = compileTeaching(raw, verified.e, job.id);
        job.outline = (raw as { outline: string[] }).outline;
        job.stage = "narration";
      } else if (job.stage === "narration") {
        const scene = job.plan!.scenes[job.clips.length];
        const n = scene.narration[0];
        const prepared = await this.speech.preview(
          { text: n.text },
          this.config,
        );
        job.clips.push({
          segmentId: n.id,
          text: n.text,
          speech: prepared.entry.speech,
        });
        if (job.clips.length === job.plan!.scenes.length)
          job.stage = "assemble";
        else job.retryAt = Date.now() + 6100;
      } else if (job.stage === "assemble") {
        const timed = prepareBeatTimeline(job.plan!, job.clips);
        if (!this.clipPlayback) {
          const audio = joinWavs(job.clips);
          if (Math.abs(normalizeWav(audio).durationSeconds - timed.duration) > 0.001)
            throw new Error("Prepared speech duration mismatch");
          job.audio = audio.toString("base64");
        }
        job.manifest = timelineSchema.parse({
          plan: timed.plan,
          scenes: timed.scenes,
          audio: {
            src: `/api/lessons/${id}/audio`,
            duration: timed.duration,
            ...(this.clipPlayback ? {clips:timed.scenes.map((scene,index)=>({
              src:`/api/lessons/${id}/clips/${index}`,start:scene.start,end:scene.end,
            }))} : {}),
            provenance:
              "Live Groq teaching plan and Orpheus audio. Measured beat boundaries; within-beat visual durations are authored estimates, not word alignment.",
          },
        });
        job.stage = "ready";
      }
    } catch (e) {
      if(job.stage==="plan"&&e instanceof SpeechError&&["lesson_schema","lesson_validation"].includes(e.code))job.attempts++;
      job.message =
        e instanceof SpeechError
          ? e.message
          : e instanceof z.ZodError
            ? `AI output failed validation. Check: ${validationFeedback(e)} Earlier verified stages are retained; retry this stage explicitly.`
            : e instanceof Error
              ? e.message
              : "Generation failed";
      if (e instanceof SpeechError && e.status === 429)
        job.retryAt = Date.now() + Math.max(1, e.retryAfterSeconds) * 1000;
    }
    await this.repo.put(id, job);
    return job;
  }
}
