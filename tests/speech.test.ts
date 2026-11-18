import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  wavDuration,
  prepareBeatTimeline,
  beatPosition,
} from "../src/domain/speech";
import { boardAt, timelineSchema } from "../src/domain/lesson";
import { examplePlan } from "../src/content/example";
import { getConfig, SpeechError } from "../src/server/speech/config";
import { generateSpeech, validateAudio } from "../src/server/speech/provider";
import {
  cacheKey,
  FileSpeechRepository,
  type CacheEntry,
} from "../src/server/speech/cache";
import { PreviewService } from "../src/server/speech/service";
function wav(seconds = 1) {
  const b = Buffer.alloc(44 + 16000 * 2 * seconds);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(b.length - 44, 40);
  return b;
}
const config = getConfig({ GROQ_API_KEY: "test-secret" });
const generated = () => ({
  speech: {
    audio_base64: wav().toString("base64"),
    durationSeconds: 1,
    format: "wav" as const,
  },
  metadata: { requestId: "mock" },
});
function memory() {
  const data = new Map<string, CacheEntry>();
  return {
    get: vi.fn(async (k: string) => data.get(k) ?? null),
    put: vi.fn(async (e: CacheEntry) => {
      data.set(e.key, e);
    }),
  };
}
afterEach(() => vi.useRealTimers());
describe("Groq preview", () => {
  it("enforces strictly under 180 characters and rejects overrides", async () => {
    const p = vi.fn();
    const s = new PreviewService(memory(), p);
    for (const body of [
      { text: "x".repeat(180) },
      { text: " " },
      { text: "hello", model: "other" },
    ])
      await expect(s.preview(body, config)).rejects.toMatchObject({
        code: "input",
      });
    expect(p).not.toHaveBeenCalled();
    const ok = new PreviewService(
      memory(),
      vi.fn(async () => generated()),
    );
    await expect(
      ok.preview({ text: "x".repeat(179) }, config),
    ).resolves.toMatchObject({ status: "newly-generated" });
  });
  it("uses exact text and provider configuration in stable versioned keys, excluding the key", () => {
    expect(cacheKey("hello", config)).toBe(
      cacheKey("hello", { ...config, apiKey: "rotated" }),
    );
    expect(cacheKey("hello ", config)).not.toBe(cacheKey("hello", config));
    for (const patch of [
      { modelId: "other" },
      { voiceId: "other" },
      { outputFormat: "other" },
      { version: 3 },
    ])
      expect(
        cacheKey("hello", { ...config, ...patch } as typeof config),
      ).not.toBe(cacheKey("hello", config));
  });
  it("coalesces duplicate requests and reuses cache after restart", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "groq-test-"));
    try {
      const p = vi.fn(async () => generated()),
        s = new PreviewService(new FileSpeechRepository(dir), p);
      await Promise.all([
        s.preview({ text: "Hello" }, config),
        s.preview({ text: "Hello" }, config),
      ]);
      expect(p).toHaveBeenCalledTimes(1);
      const r = await new PreviewService(
        new FileSpeechRepository(dir),
        p,
      ).preview({ text: "Hello" }, config);
      expect(r.status).toBe("cache-hit");
      expect(p).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(r.entry)).not.toContain(config.apiKey);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("blocks rapid distinct requests but permits cached replay", async () => {
    const p = vi.fn(async () => generated()),
      s = new PreviewService(memory(), p);
    await s.preview({ text: "one" }, config);
    await expect(s.preview({ text: "two" }, config)).rejects.toMatchObject({
      status: 429,
    });
    expect((await s.preview({ text: "one" }, config)).status).toBe("cache-hit");
    expect(p).toHaveBeenCalledTimes(1);
  });
  it("honors provider retry-after without retrying automatically", async () => {
    vi.useFakeTimers();
    const p = vi
      .fn()
      .mockRejectedValue(
        new SpeechError("provider_error", "rate limit", 429, 120),
      );
    const s = new PreviewService(memory(), p);
    await expect(s.preview({ text: "one" }, config)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10000);
    await expect(s.preview({ text: "one" }, config)).rejects.toMatchObject({
      status: 429,
    });
    expect(p).toHaveBeenCalledTimes(1);
  });
  it("honors exhausted quota headers", async () => {
    const p = vi.fn(async () => ({
        ...generated(),
        metadata: { remainingRequests: "0", resetRequests: "1h" },
      })),
      s = new PreviewService(memory(), p);
    await s.preview({ text: "one" }, config);
    await expect(s.preview({ text: "two" }, config)).rejects.toMatchObject({
      status: 429,
    });
  });
  it("stops on cache read error and recovers write failure without regenerating", async () => {
    const repo = memory(),
      p = vi.fn(async () => generated()),
      s = new PreviewService(repo, p);
    repo.get.mockRejectedValueOnce(new Error("read"));
    await expect(s.preview({ text: "one" }, config)).rejects.toThrow();
    expect(p).not.toHaveBeenCalled();
    repo.put.mockRejectedValueOnce(new Error("write"));
    await expect(s.preview({ text: "one" }, config)).rejects.toThrow();
    expect((await s.preview({ text: "one" }, config)).status).toBe(
      "cache-recovered",
    );
    expect(p).toHaveBeenCalledTimes(1);
  });
  it("reports missing key without generation", async () => {
    const p = vi.fn();
    await expect(
      new PreviewService(memory(), p).preview({ text: "hello" }, getConfig({})),
    ).rejects.toMatchObject({ code: "configuration" });
    expect(p).not.toHaveBeenCalled();
  });
  it("posts only documented parameters to Groq and measures audio duration", async () => {
    const f = vi.fn(
      async () => new Response(wav(2), { headers: { "x-request-id": "mock" } }),
    );
    const r = await generateSpeech("hello", config, f);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, opts] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/speech");
    expect(JSON.parse(opts.body as string)).toEqual({
      model: "canopylabs/orpheus-v1-english",
      voice: "hannah",
      input: "hello",
      response_format: "wav",
    });
    expect(r.speech.durationSeconds).toBe(2);
    expect(r.speech).not.toHaveProperty("alignment");
  });
  it.each([401, 403, 404, 429, 500])(
    "never retries HTTP %s or exposes raw provider bodies",
    async (status) => {
      const f = vi.fn(
        async () =>
          new Response(config.apiKey, {
            status,
            headers: { "retry-after": "45" },
          }),
      );
      await expect(generateSpeech("hello", config, f)).rejects.not.toThrow(
        config.apiKey,
      );
      expect(f).toHaveBeenCalledTimes(1);
    },
  );
  it("times out without retry", async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      (_url: Parameters<typeof fetch>[0], opts?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          opts?.signal?.addEventListener("abort", () =>
            reject(new Error("timeout")),
          ),
        ),
    );
    const p = generateSpeech("hello", config, f, 100);
    const check = expect(p).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(101);
    await check;
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("rejects empty, truncated, unsupported or inconsistent WAV", () => {
    expect(() => validateAudio("")).toThrow();
    const b = wav();
    expect(wavDuration(b)).toBe(1);
    expect(() => wavDuration(b.subarray(0, 100))).toThrow();
    b.writeUInt16LE(6, 20);
    expect(() => wavDuration(b)).toThrow();
  });
});
describe("measured beat synchronization", () => {
  const clips = () =>
    examplePlan.scenes.map((s, i) => ({
      segmentId: s.narration[0].id,
      text: s.narration[0].text,
      speech: {
        ...generated().speech,
        durationSeconds: i === 10 ? 2 : 1,
        audio_base64: wav(i === 10 ? 2 : 1).toString("base64"),
      },
    }));
  it("uses measured clip boundaries and existing actions; backward seeking restores blocks", () => {
    const t = prepareBeatTimeline(examplePlan, clips());
    const lesson = timelineSchema.parse({
      plan: t.plan,
      scenes: t.scenes,
      audio: {
        src: "/mock.wav",
        duration: t.duration,
        provenance: "mock measured beats",
      },
    });
    const start = t.scenes[10].start;
    expect(beatPosition(t, start + 0.9)).toEqual({
      index: 10,
      localTime: 0.9000000000000004,
    });
    const mid = boardAt(lesson, start + 0.9);
    expect(mid["left-0"].opacity).toBeCloseTo(0.5);
    expect(boardAt(lesson, start + 0.9)).toEqual(mid);
    expect(boardAt(lesson, t.scenes[9].start + 0.8)["left-0"].opacity).toBe(1);
    expect(beatPosition(t, t.duration).localTime).toBe(1);
  });
  it("rejects missing, duplicate and mismatched beat clips", () => {
    const c = clips();
    expect(() => prepareBeatTimeline(examplePlan, c.slice(1))).toThrow();
    c[1] = c[0];
    expect(() => prepareBeatTimeline(examplePlan, c)).toThrow();
    const changed = clips();
    changed[0].text = "incorrect";
    expect(() => prepareBeatTimeline(examplePlan, changed)).toThrow();
  });
});

it('recognizes terms acceptance without retries or leaking the raw message',async()=>{
 const f=vi.fn(async()=>new Response(JSON.stringify({error:{code:'model_terms_required',message:config.apiKey}}),{status:400}));
 await expect(generateSpeech('hello',config,f)).rejects.toMatchObject({code:'model_terms_required',status:403});
 expect(f).toHaveBeenCalledTimes(1);
});

it.each(['model_permission_blocked_org','model_permission_blocked_project'])('preserves actionable permission code %s with no retries',async(code)=>{
 const f=vi.fn(async()=>new Response(JSON.stringify({error:{code,message:config.apiKey}}),{status:403}));
 await expect(generateSpeech('hello',config,f)).rejects.toMatchObject({code,status:403});
 expect(f).toHaveBeenCalledTimes(1);
});

it.each([0xffffffff,0x7fffffff,0])('repairs streaming WAV size markers %s using received samples',async(marker)=>{
 const b=wav(2);b.writeUInt32LE(marker,4);b.writeUInt32LE(marker,40);
 expect(wavDuration(b)).toBe(2);
 const f=vi.fn(async()=>new Response(b));const result=await generateSpeech('hello',config,f);
 const cached=Buffer.from(result.speech.audio_base64,'base64');
 expect(cached.readUInt32LE(4)).toBe(cached.length-8);
 expect(cached.readUInt32LE(40)).toBe(cached.length-44);
 expect(result.speech.durationSeconds).toBe(2);
 expect(f).toHaveBeenCalledTimes(1);
});
it('rejects incomplete sample frames and never repairs known truncated lengths',()=>{
 const b=wav();b.writeUInt32LE(0xffffffff,4);b.writeUInt32LE(0xffffffff,40);
 expect(()=>wavDuration(b.subarray(0,b.length-1))).toThrow();
 const known=wav();expect(()=>wavDuration(known.subarray(0,100))).toThrow();
});

it('accepts a real non-seekable FFmpeg WAV with metadata chunks',async()=>{
 const b=readFileSync('tests/fixtures/streaming-tone.wav');
 expect(b.readUInt32LE(4)).toBe(0xffffffff);
 expect(wavDuration(b)).toBeCloseTo(.1,6);
 const f=vi.fn(async()=>new Response(b));
 const result=await generateSpeech('hello',config,f);
 expect(result.speech.durationSeconds).toBeCloseTo(.1,6);
 expect(Buffer.from(result.speech.audio_base64,'base64').readUInt32LE(4)).toBe(b.length-8);
});
