import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { speechSchema } from "../../domain/speech";
import { type SpeechConfig, SpeechError } from "./config";
export function identity(text: string, c: SpeechConfig) {
  return {
    version: c.version,
    text,
    voiceId: c.voiceId,
    modelId: c.modelId,
    outputFormat: c.outputFormat,
    provider: c.provider,
  };
}
export function cacheKey(text: string, c: SpeechConfig) {
  return createHash("sha256")
    .update(JSON.stringify(identity(text, c)))
    .digest("hex");
}
export const entrySchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  identity: z.object({
    version: z.number(),
    text: z.string(),
    voiceId: z.string(),
    modelId: z.string(),
    outputFormat: z.string(),
    provider: z.literal("groq"),
  }),
  speech: speechSchema,
  metadata: z.object({
    requestId: z.string().optional(),
    remainingRequests: z.string().optional(),
    remainingTokens: z.string().optional(),
    resetRequests: z.string().optional(),
    resetTokens: z.string().optional(),
  }),
  createdAt: z.string(),
});
export type CacheEntry = z.infer<typeof entrySchema>;
export interface SpeechRepository {
  get(key: string): Promise<CacheEntry | null>;
  put(entry: CacheEntry): Promise<void>;
}
export class FileSpeechRepository implements SpeechRepository {
  constructor(
    private directory = path.join(
      process.cwd(),
      ".cache",
      "groq-voice-preview",
    ),
  ) {}
  private file(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new SpeechError("cache", "Invalid cache reference");
    return path.join(this.directory, `${key}.json`);
  }
  async get(key: string) {
    try {
      return entrySchema.parse(
        JSON.parse(await readFile(this.file(key), "utf8")),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new SpeechError(
        "cache_read",
        "Cannot read preview cache. Fix permissions or clear the cache before generating.",
      );
    }
  }
  async put(entry: CacheEntry) {
    const tmp = this.file(entry.key) + "." + randomUUID() + ".tmp";
    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(tmp, JSON.stringify(entrySchema.parse(entry)), {
        mode: 0o600,
      });
      await rename(tmp, this.file(entry.key));
    } catch {
      await unlink(tmp).catch(() => {});
      throw new SpeechError(
        "cache_write",
        "Speech succeeded but could not be saved. Fix cache permissions. Do not regenerate blindly.",
      );
    }
  }
}
