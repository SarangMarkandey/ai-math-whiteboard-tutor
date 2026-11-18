import "server-only";
import { previewRequestSchema, captionPhrases } from "../../domain/speech";
import {
  type SpeechConfig,
  configurationProblems,
  SpeechError,
} from "./config";
import {
  cacheKey,
  identity,
  type SpeechRepository,
  type CacheEntry,
} from "./cache";
import { generateSpeech, validateAudio, type Generated } from "./provider";
export class PreviewService {
  private inFlight = new Map<
    string,
    Promise<{ entry: CacheEntry; status: string }>
  >();
  private blockedUntil = 0;
  private active = false;
  private unsaved = new Map<string, CacheEntry>();
  constructor(
    private repo: SpeechRepository,
    private provider: (
      t: string,
      c: SpeechConfig,
    ) => Promise<Generated> = generateSpeech,
  ) {}
  async preview(body: unknown, c: SpeechConfig) {
    const parsed = previewRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new SpeechError(
        "input",
        "Narration must contain 1–179 characters. Only text is accepted.",
        400,
      );
    const errors = configurationProblems(c);
    if (errors.length)
      throw new SpeechError("configuration", errors.join(". "), 503);
    const text = parsed.data.text,
      key = cacheKey(text, c);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const work = this.prepare(text, c, key);
    this.inFlight.set(key, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(key);
    }
  }
  private async prepare(text: string, c: SpeechConfig, key: string) {
    const recovery = this.unsaved.get(key);
    if (recovery) {
      await this.repo.put(recovery);
      this.unsaved.delete(key);
      return { entry: recovery, status: "cache-recovered" };
    }
    const hit = await this.repo.get(key);
    if (hit) {
      if (
        hit.key !== key ||
        JSON.stringify(hit.identity) !== JSON.stringify(identity(text, c))
      )
        throw new SpeechError(
          "cache_read",
          "Cached configuration does not match. Clear the cache.",
        );
      if (validateAudio(hit.speech.audio_base64) !== hit.speech.durationSeconds)
        throw new SpeechError(
          "cache_read",
          "Cached WAV duration is inconsistent. Clear the cache.",
        );
      captionPhrases(hit.speech, text);
      return { entry: hit, status: "cache-hit" };
    }
    if (this.active || Date.now() < this.blockedUntil)
      throw new SpeechError(
        "rate_limit",
        "Wait before another uncached preview. Cached clips remain replayable.",
        429,
        Math.max(1, Math.ceil((this.blockedUntil - Date.now()) / 1000)),
      );
    this.active = true;
    this.blockedUntil = Date.now() + 6000;
    let generated: Generated;
    try {
      generated = await this.provider(text, c);
      for (const [remaining, reset] of [
        [
          generated.metadata.remainingRequests,
          generated.metadata.resetRequests,
        ],
        [generated.metadata.remainingTokens, generated.metadata.resetTokens],
      ])
        if (remaining === "0") {
          const seconds = resetSeconds(reset);
          this.blockedUntil = Math.max(
            this.blockedUntil,
            Date.now() + seconds * 1000,
          );
        }
    } catch (e) {
      if (e instanceof SpeechError && e.retryAfterSeconds)
        this.blockedUntil = Math.max(
          this.blockedUntil,
          Date.now() + e.retryAfterSeconds * 1000,
        );
      throw e;
    } finally {
      this.active = false;
    }
    if (
      validateAudio(generated.speech.audio_base64) !==
      generated.speech.durationSeconds
    )
      throw new SpeechError(
        "invalid_audio",
        "Clip duration does not match WAV samples.",
      );
    captionPhrases(generated.speech, text);
    const entry: CacheEntry = {
      key,
      identity: identity(text, c),
      ...generated,
      createdAt: new Date().toISOString(),
    };
    this.unsaved.set(key, entry);
    await this.repo.put(entry);
    this.unsaved.delete(key);
    return { entry, status: "newly-generated" };
  }
}

function resetSeconds(value?: string) {
  if (!value) return 60;
  const m =
    /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(
      value,
    );
  return m && m[0]
    ? Math.max(
        1,
        Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0),
      )
    : 60;
}
