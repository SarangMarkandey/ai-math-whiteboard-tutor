import { describe, it, expect, vi } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  roles,
  completeNarrationResponse,
  specificEquation,
  compileTeaching,
  sameEquation,
  type Teaching,
} from "../src/domain/live";
import { rational as r, solve, type Equation } from "../src/domain/math";
import { normalizeWav } from "../src/domain/speech";
import { boardAt } from "../src/domain/lesson";
import {
  LessonService,
  joinWavs,
  type Job,
} from "../src/server/lessons/service";
import { FileRepository, type Repository } from "../src/server/lessons/store";
import { getConfig, SpeechError } from "../src/server/speech/config";
import { lessonProvider } from "../src/server/lessons/provider";
const config = getConfig({ GROQ_API_KEY: "test-secret" });
export function teaching(e: Equation): Teaching {
  const result = solve(e);
  if (result.kind !== "unique") throw new Error();
  return {
    objective: "Understand how equality is preserved.",
    outline: ["Read the equation", "Preserve equality", "Check the result"],
    equation: e,
    solution: result.solution,
    beats: roles.map((role, i) => ({
      id: `step-${i}`,
      role,
      explanation: "Keep track of the equal values as the working develops.",
      visual:
        i === 1 || i === 2 || i === 3 || i === 10
          ? "highlight"
          : i === 6 || i === 8 || i === 9
            ? "draw"
            : "reveal",
    })),
    practice: {
      equation: { a: r(3), b: r(2), c: r(17) },
      solution: r(5),
      hint: "Keep both sides equal.",
    },
  };
}
const equation = { a: r(5), b: r(7), c: r(32) };
function memory() {
  const m = new Map<string, Job>();
  return {
    get: vi.fn(async (id: string) => structuredClone(m.get(id) ?? null)),
    put: vi.fn(async (id: string, v: Job) => {
      m.set(id, structuredClone(v));
    }),
  };
}
const audio = normalizeWav(readFileSync("tests/fixtures/streaming-tone.wav"));
const speech = {
  audio_base64: Buffer.from(audio.bytes).toString("base64"),
  durationSeconds: audio.durationSeconds,
  format: "wav" as const,
};
const speak = () => ({
  preview: vi.fn(async () => ({
    entry: { speech },
    status: "newly-generated",
  })),
});
const ask = (e = equation) =>
  vi.fn(async (stage: string) =>
    stage === "interpret"
      ? { status: "supported", message: "", equation: e }
      : teaching(e),
  );
describe("live mathematics and semantic layout", () => {
  it.each([
    "Teach me 5x + 7 = 32.",
    "Explain 3x - 4 = 11",
    "Help me solve -20x + 30 = 50",
    "Solve -2/3x + 1/2 = 5/6",
  ])("preserves exact specific input %s", (topic) => {
    const e = specificEquation(topic)!;
    expect(e).not.toBeNull();
    expect(solve(e).kind).toBe("unique");
    const p = compileTeaching(teaching(e), e, "live");
    expect(sameEquation(p.equation, e)).toBe(true);
    expect(p.source).toBe("live-generated");
    expect(p.elements.some((v) => v.id === "operation-left")).toBe(true);
  });
  it("does not partially parse unsupported equations", () => {
    for (const t of ["1.5x + 2 = 7", "x^2 + 5x + 7 = 32", "5x + 7 = 32 + x"])
      expect(specificEquation(t)).toBeNull();
  });
  it("produces new mathematical working and handles fractional answers", () => {
    const p = compileTeaching(teaching(equation), equation, "new");
    expect(p.elements.find((e) => e.id === "answer")!.text).toBe("x=5");
    const e = { a: r(3), b: r(-4), c: r(12) };
    const f = compileTeaching(teaching(e), e, "fraction");
    expect(f.elements.find((e) => e.id === "answer")!.text).toContain(
      "\\frac{16}{3}",
    );
    expect(
      f.elements.every((e) => !["block", "balance"].includes(e.kind)),
    ).toBe(true);
  });
  it("rejects wrong mathematical claims and unsupported visuals", () => {
    const t = teaching(equation);
    t.solution = r(4);
    expect(() => compileTeaching(t, equation, "bad")).toThrow();
    const wrong = teaching(equation);
    wrong.practice.solution = r(99);
    expect(() => compileTeaching(wrong, equation, "bad")).toThrow();
    const raw = teaching(equation);
    raw.beats[0].explanation = "The answer is four.";
    expect(() => compileTeaching(raw, equation, "bad")).toThrow();
  });
});
describe("resumable request stages", () => {
  it("resumes persisted partial narration after service restart and reconstructs backward seeks", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lesson-test-"));
    try {
      const repo = new FileRepository<Job>(dir),
        provider = ask(),
        speaker = speak();
      let s = new LessonService(repo, provider, speaker, config, "mock");
      let j = await s.create("Teach 5x + 7 = 32");
      j = await s.advance(j.id);
      expect(j.stage).toBe("plan");
      j = await s.advance(j.id);
      expect(j.stage).toBe("narration");
      j = await s.advance(j.id);
      expect(j.clips.length).toBe(1);
      s = new LessonService(repo, provider, speaker, config, "mock");
      for (let i = 0; i < 16; i++) {
        j.retryAt = undefined;
        await repo.put(j.id, j);
        j = await s.advance(j.id);
      }
      expect(j.stage).toBe("ready");
      expect(provider).toHaveBeenCalledTimes(2);
      expect(speaker.preview).toHaveBeenCalledTimes(16);
      expect(
        normalizeWav(Buffer.from(j.audio!, "base64")).durationSeconds,
      ).toBeCloseTo(j.manifest!.audio.duration);
      const later = boardAt(j.manifest!, j.manifest!.audio.duration);
      expect(later.answer.opacity).toBe(1);
      const before = boardAt(j.manifest!, 0);
      expect(before.answer.opacity).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("keeps earlier stages when speech fails and retries only explicitly", async () => {
    const repo = memory(),
      provider = ask(),
      speaker = speak();
    speaker.preview.mockRejectedValueOnce(
      new SpeechError("quota", "Free quota reached", 429, 60),
    );
    const s = new LessonService(repo, provider, speaker, config, "mock");
    let j = await s.create("5x + 7 = 32");
    await s.advance(j.id);
    await s.advance(j.id);
    j = await s.advance(j.id);
    expect(j.stage).toBe("narration");
    expect(j.plan).toBeDefined();
    expect(j.message).toContain("quota");
    expect((await s.advance(j.id)).clips.length).toBe(0);
    expect(speaker.preview).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it("rejects changed equations without fallback", async () => {
    const s = new LessonService(
      memory(),
      ask({ a: r(2), b: r(3), c: r(11) }),
      speak(),
      config,
      "mock",
    );
    const j = await s.create("5x + 7 = 32");
    const failed = await s.advance(j.id);
    expect(failed.stage).toBe("interpret");
    expect(failed.message).toContain("changed your equation");
    expect(failed.plan).toBeUndefined();
  });
  it("bounds plan validation attempts", async () => {
    const provider = ask();
    provider.mockImplementation(async (stage) =>
      stage === "interpret"
        ? { status: "supported", message: "", equation }
        : { ...teaching(equation), solution: r(99) },
    );
    const s = new LessonService(memory(), provider, speak(), config, "mock");
    const j = await s.create("5x + 7 = 32");
    await s.advance(j.id);
    await s.advance(j.id);
    await s.advance(j.id);
    const end = await s.advance(j.id);
    expect(end.message).toContain("twice");
    expect(provider).toHaveBeenCalledTimes(3);
  });
  it("caches an existing job and coalesces duplicate advances", async () => {
    const provider = ask(),
      s = new LessonService(memory(), provider, speak(), config, "mock");
    const a = await s.create("5x + 7 = 32");
    const b = await s.create("5x + 7 = 32");
    expect(a.id).toBe(b.id);
    await Promise.all([s.advance(a.id), s.advance(a.id)]);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("requests strict structured output once and never retries 429", async () => {
    const f = vi.fn(
      async () =>
        new Response("{}", { status: 429, headers: { "retry-after": "30" } }),
    );
    const p = lessonProvider("openai/gpt-oss-20b", "secret", f);
    await expect(p("interpret", {})).rejects.toMatchObject({ status: 429 });
    await expect(p("interpret", {})).rejects.toMatchObject({ status: 429 });
    expect(f).toHaveBeenCalledTimes(1);
    const [, options] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(
      JSON.parse(options.body as string).response_format.json_schema.strict,
    ).toBe(true);
  });
});

it.each(['clarify','unsupported'] as const)('returns honest %s guidance without generating a plan or narration',async(status)=>{
 const repo=memory(),speaker=speak(),provider=vi.fn(async()=>({status,message:'Please specify a supported linear equation.',equation}));
 const s=new LessonService(repo,provider,speaker,config,'mock');const j=await s.create('help with maths');const result=await s.advance(j.id);expect(result.stage).toBe(status);expect(result.message).toContain('specify');expect(speaker.preview).not.toHaveBeenCalled();
});
it('rejects an integer example when a fractional solution was requested',async()=>{const s=new LessonService(memory(),ask(),speak(),config,'mock');const j=await s.create('Show an equation whose solution is a fraction');expect((await s.advance(j.id)).message).toContain('fractional solution');});

function narrationWire(e = equation) {
 const t = teaching(e);
 return {objective:t.objective,outline:t.outline,
 explanations:Object.fromEntries(t.beats.map(b=>[b.role,b.explanation])),
 practice:{a:3,b:2,c:17}};
}
it('requests a compact JSON narration payload and computes all mathematical answers locally',async()=>{
 const f=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(narrationWire())}}]})));
 const result=await lessonProvider('openai/gpt-oss-20b','secret',f)('plan',{equation});
 expect(result).toMatchObject({equation,solution:r(5),practice:{solution:r(5),hint:expect.any(String)}});
 const [,options]=f.mock.calls[0] as unknown as [string,RequestInit];
 expect(JSON.parse(options.body as string).response_format).toEqual({type:'json_object'});
 expect(f).toHaveBeenCalledTimes(1);
});
it('compiles the reported negative-coefficient equation from narration-only provider output',()=>{
 const e=specificEquation('Help me solve -20x + 30 = 50')!;
 expect(e).toEqual({a:r(-20),b:r(30),c:r(50)});
 const t=completeNarrationResponse(narrationWire(e),e);
 expect(t.solution).toEqual(r(-1));
 const plan=compileTeaching(t,e,'negative-regression');
 expect(plan.elements.find(v=>v.id==='answer')?.text).toBe('x=-1');
 expect(plan.scenes.every(s=>s.narration.every(n=>n.text.length<180))).toBe(true);
 expect(plan.scenes.map(s=>s.narration[0].text).join(' ')).toContain('negative twenty');
});
it('rejects incomplete narration, zero practice coefficients and unexpected numerical claims',()=>{
 const missing=narrationWire();delete (missing.explanations as Record<string,string>).cancel;
 expect(()=>completeNarrationResponse(missing,equation)).toThrow();
 expect(()=>completeNarrationResponse({...narrationWire(),practice:{a:0,b:2,c:17}},equation)).toThrow();
 expect(()=>completeNarrationResponse({...narrationWire(),solution:r(99)},equation)).toThrow();
});
it('upgrades an exhausted old planning job on explicit resume while retaining its equation',async()=>{
 const e=specificEquation('Help me solve -20x + 30 = 50')!;
 const repo=memory(),provider=ask(e),speaker=speak();
 const service=new LessonService(repo,provider,speaker,config,'mock');
 const j=await service.create('Help me solve -20x + 30 = 50');
 j.stage='plan';j.equation=e;j.attempts=2;j.config.promptVersion=2;j.message='Schema rejected';
 await repo.put(j.id,j);
 const resumed=await service.advance(j.id);
 expect(resumed.stage).toBe('narration');expect(resumed.config.promptVersion).toBe(3);
 expect(resumed.attempts).toBe(1);expect(resumed.equation).toEqual(e);
 expect(provider.mock.calls.map(c=>c[0])).toEqual(['plan']);
 expect(speaker.preview).not.toHaveBeenCalled();
});
it('handles provider schema rejection without using failed_generation or automatically retrying',async()=>{
 const f=vi.fn(async()=>new Response(JSON.stringify({error:{code:'json_validate_failed',failed_generation:'secret-invalid-data'}}),{status:400}));
 await expect(lessonProvider('openai/gpt-oss-20b','secret',f)('plan',{})).rejects.toMatchObject({code:'lesson_schema'});
 expect(f).toHaveBeenCalledTimes(1);
});
it('explicitly resumes planning after provider schema failure without repeating interpretation',async()=>{
 const repo=memory(),provider=ask(),speaker=speak();
 provider.mockImplementationOnce(async()=>({status:'supported',message:'',equation})).mockImplementationOnce(async()=>{throw new SpeechError('lesson_schema','Schema rejected');}).mockImplementationOnce(async()=>teaching(equation));
 const s=new LessonService(repo,provider,speaker,config,'mock');const j=await s.create('5x + 7 = 32');await s.advance(j.id);
 const failed=await s.advance(j.id);expect(failed.stage).toBe('plan');expect(failed.equation).toEqual(equation);expect(speaker.preview).not.toHaveBeenCalled();
 expect((await s.advance(j.id)).stage).toBe('narration');expect(provider.mock.calls.map(c=>c[0])).toEqual(['interpret','plan','plan']);
});

it('reports invalid narration fields safely without a provider retry',async()=>{
 const wire=narrationWire();wire.explanations.cancel='Subtract 999, secret-invalid-output';
 const f=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})));
 const request=lessonProvider('openai/gpt-oss-20b','secret',f)('plan',{equation});
 await expect(request).rejects.toMatchObject({code:'lesson_validation',message:expect.stringContaining('explanations.cancel')});
 await expect(request).rejects.toMatchObject({message:expect.not.stringContaining('secret-invalid-output')});
 expect(f).toHaveBeenCalledTimes(1);
});
