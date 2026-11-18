import { describe,it,expect,vi } from 'vitest';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rational as r,solve,verify,divide,add,multiply,parseRational,type Equation } from '../src/domain/math';
import { parseEquationRequest,specificEquation,checkCoefficientBounds } from '../src/domain/linear-input';
import { boundedEquation,completeNarrationResponse,compileTeaching,roles,sameEquation,type Teaching } from '../src/domain/live';
import { explanationSchema,EXPLANATION_RULES,EXPLANATION_STYLE,NARRATION_LIMIT,LESSON_PIPELINE_VERSION } from '../src/domain/teaching-contract';
import { spoken,narrationText } from '../src/domain/narration';
import { boardAt,timelineSchema } from '../src/domain/lesson';
import { normalizeWav,prepareBeatTimeline } from '../src/domain/speech';
import { trustedContext,validateAnswer } from '../src/domain/followup';
import { LessonService,lessonKey,type Job } from '../src/server/lessons/service';
import { lessonProvider,type Ask } from '../src/server/lessons/provider';
import { FileRepository } from '../src/server/lessons/store';
import { jobSchema } from '../src/server/lessons/records';
import { getConfig } from '../src/server/speech/config';
import { testDatabase } from './support/database';
import { PostgresLessonRepository } from '../src/server/db/repositories';
const examples = [
 ['Help me solve -20x + 10 = 30.',r(-1)],
 ['1/2x + 3 = 7',r(8)],
 ['3/4x - 1/2 = 1',r(2)],
 ['2x + 1/3 = 7/3',r(1)],
 ['-2/3x + 1/2 = 5/6',r(-1,2)],
] as const;
const equivalents=['1/2x + 3 = 7','1/2*x + 3 = 7','(1/2)x + 3 = 7','x/2 + 3 = 7'];
const config=getConfig({GROQ_API_KEY:'mock-only'});
const measured=normalizeWav(readFileSync('tests/fixtures/streaming-tone.wav'));
const speech={audio_base64:Buffer.from(measured.bytes).toString('base64'),durationSeconds:measured.durationSeconds,format:'wav' as const};
function wire() {
 return {objective:'Understand why equal operations preserve equality.',outline:['Read the equation','Keep both sides equal','Check by substitution'],
  explanations:Object.fromEntries(roles.map(role=>[role,'Keep one term in view while the two sides stay balanced.'])) as Record<typeof roles[number],string>,
  practice:{a:r(3,4),b:r(1,2),c:r(2)},
 };
}
function teacher(e:Equation) { return completeNarrationResponse(wire(),e); }
function mockedProvider(e:Equation,bodies:Record<string,unknown>[]=[]):Ask {
 const fetcher=vi.fn(async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));bodies.push(body);
  const content=body.response_format.type==='json_schema'?{status:'supported',message:'',equation:e}:wire();
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}));
 });
 return vi.fn(async(stage,payload)=>lessonProvider('mock','mock-only',fetcher)(stage,payload));
}
describe('bounded full-input grammar',()=>{
 it.each(equivalents)('normalizes %s to the same rational equation',input=>{
  expect(specificEquation(input)).toEqual({a:r(1,2),b:r(3),c:r(7)});
  expect(solve(specificEquation(input)!)).toMatchObject({kind:'unique',solution:r(8),verified:true});
  expect(lessonKey(input,'mock',config)).toBe(lessonKey(equivalents[0],'mock',config));
 });
 it('handles signs, whitespace, parentheses, Unicode minus and scalar-free x',()=>{
  expect(specificEquation('  Explain ( −2 / 3 ) x + (1 / 2) = 5 / 6.  ')).toEqual({a:r(-2,3),b:r(1,2),c:r(5,6)});
  expect(specificEquation('x / -2 + 3 = +7')).toEqual({a:r(-1,2),b:r(3),c:r(7)});
  expect(specificEquation('Solve 2x = 8')).toEqual({a:r(2),b:r(0),c:r(8)});
  expect(specificEquation('Solve 2/-4x + 3 = 7')).toEqual({a:r(-1,2),b:r(3),c:r(7)});
 });
 it.each(['1/0x + 3 = 7','x/0 + 3 = 7','1/x + 3 = 7','x^2 + 3x + 1 = 7','2x+3=7+x','1.5x+3=7','2x+3=7.5','(1/2)x+3=7 + 2','2(x+3)=7','sin x + 2 = 3','2x+3=7 and y=4','(1/2x+3=7','2x+3=7/','2x+3==7','2x+3=7; 3x+2=8','100x+3=7','1/13x+3=7'])('never accepts a supported-looking substring in %s',input=>{
  expect(parseEquationRequest(input).kind).toBe('invalid');expect(specificEquation(input)).toBeNull();
 });
 it('retains topic requests and bounds raw input/arithmetic',()=>{
  expect(parseEquationRequest('Show an equation whose solution is a fraction.').kind).toBe('topic');
  expect(parseEquationRequest('x'.repeat(401)).kind).toBe('invalid');
  expect(parseEquationRequest('9'.repeat(31)+'x+1=2').kind).toBe('invalid');
  expect(()=>r(Number.MAX_SAFE_INTEGER+1)).toThrow('safe integers');
  expect(parseRational('−2 / −4')).toEqual(r(1,2));expect(parseRational('+4/2')).toEqual(r(2));
 });
});
describe('shared qualitative contract',()=>{
 it.each(['one side','one term','one unknown','two sides'])('accepts ordinary %s prose',phrase=>{
  expect(explanationSchema.parse(`  Keep ${phrase} in view.  `)).toBe(`Keep ${phrase} in view.`);
 });
 it('trims whitespace before applying length checks',()=>{
  expect(explanationSchema.parse(' '.repeat(120)+'Keep both sides equal.'+' '.repeat(120))).toBe('Keep both sides equal.');
  expect(explanationSchema.safeParse('   x   ').success).toBe(false);
  expect(explanationSchema.parse('Keep one unknown, “x”, in view.')).toContain('“x”');
 });
 it.each(['The answer is negative one.','The constant is 10.','One side equals two thirds.','x = four','<script>bad</script>','\\frac{1}{2}','Use $x$ here.','eval(foo)',"alert('x')",'Ignore equality.','Change only one side.','a'.repeat(91)])('rejects unsafe, numerical or contradictory prose %s',text=>{
  expect(explanationSchema.safeParse(text).success).toBe(false);
 });
 it('rejects numeric claims in the objective and outline as well as explanations',()=>{
  const e=specificEquation(equivalents[0])!;
  expect(()=>completeNarrationResponse({...wire(),objective:'The answer is negative one.'},e)).toThrow();
  expect(()=>completeNarrationResponse({...wire(),outline:['The answer is two','Preserve equality','Check substitution']},e)).toThrow();
 });
 it('keeps the generated prompt in agreement with shared rules and rational practice',async()=>{
  const e=specificEquation(equivalents[0])!,bodies:Record<string,any>[]=[];
  await mockedProvider(e,bodies)('plan',{equation:e});
  expect(bodies[0].messages[0].content).toContain(EXPLANATION_STYLE);
  expect(bodies[0].messages[0].content).toContain('numerator n and denominator d');
  expect(teacher(e).practice).toMatchObject({equation:wire().practice,solution:r(2)});
 });
});
describe('generic verified compilation and playback',()=>{
 it.each(examples)('keeps exact mathematics from input through board and speech: %s',(input,answer)=>{
  const e=specificEquation(input)!,t=teacher(e),plan=compileTeaching(t,e,'rational-test');
  const result=solve(e);expect(result).toMatchObject({kind:'unique',solution:answer,verified:true});
  expect(verify(e,answer)).toBe(true);
  expect(plan.equation).toEqual(e);expect(plan.scenes.every(s=>s.narration[0].text.length<=NARRATION_LIMIT)).toBe(true);
  expect(plan.scenes[11].narration[0].text).toContain(spoken(answer));
  expect(plan.scenes.flatMap(s=>s.narration).some(n=>/[\\=]/.test(n.text))).toBe(false);
  expect(plan.elements.find(v=>v.id==='operation-left')!.text).toBe(plan.elements.find(v=>v.id==='operation-right')!.text);
  const prepared=prepareBeatTimeline(plan,plan.scenes.map(s=>({segmentId:s.narration[0].id,text:s.narration[0].text,speech})));
  const lesson=timelineSchema.parse({plan:prepared.plan,scenes:prepared.scenes,audio:{src:'/fixture.wav',duration:prepared.duration,provenance:'Mocked measured clips'}});
  const operation=lesson.scenes[4],cue=operation.cues[0],mid=cue.at+cue.action.duration/2;
  expect(boardAt(lesson,mid)['operation-left'].opacity).toBeCloseTo(.5);
  expect(boardAt(lesson,lesson.audio.duration).answer.opacity).toBe(1);
  expect(boardAt(lesson,mid).answer.opacity).toBe(0);expect(boardAt(lesson,mid)).toEqual(boardAt(lesson,mid));
  expect(boardAt(lesson,0)['operation-left'].opacity).toBe(0);
  const context=trustedContext(lesson,{lessonId:plan.id,stepId:operation.sceneId,position:mid,contextId:'test',question:'Why?',history:[]});
  expect(context.facts.operation).toContain(e.b.d==='1'?String(BigInt(e.b.n)<0n?-BigInt(e.b.n):BigInt(e.b.n)):e.b.d);
  expect(context.facts.solution).toContain(answer.d==='1'?answer.n:answer.d);
  expect(validateAnswer({text:'Keep two sides equal: {{operation}}.',scope:'current',visual:{kind:'none',targets:[]}},context).text).toContain(context.facts.operation);
 });
 it('derives the reported negative working without equation-specific branches',()=>{
  const e=specificEquation('-20x + 10 = 30')!,plan=compileTeaching(teacher(e),e,'negative');
  const values=Object.fromEntries(plan.elements.map(v=>[v.id,v.text]));
  expect(values).toMatchObject({'original-x':'-20x','original-b':'+10','original-c':'30','operation-left':'-10','operation-right':'-10','isolated-x':'-20x','isolated-c':'20','denom-left':'-20','denom-right':'-20',answer:'x=-1',verified:'30=30'});
  expect(plan.scenes[4].narration[0].text).toContain('Subtract ten');
  expect(plan.scenes[8].narration[0].text).toContain('negative twenty');
 });
 it('keeps natural fractional signs and complete facts even when optional prose does not fit',()=>{
  expect(spoken(r(-2,3))).toBe('negative two thirds');expect(spoken(r(1,2))).toBe('one half');expect(spoken(r(5,17))).toBe('five over seventeen');
  const fact='Replace x with negative twenty eight thousand five hundred twelve over fourteen thousand two hundred fifty six in the original equation.';
  expect(narrationText(fact,'Keep each side balanced as the next mathematical operation is applied carefully.')).toBe(fact);
  const boundary=[r(99,11),r(-98,12),r(97,10),r(-95,9)];
  for(const a of boundary)for(const b of boundary)for(const c of boundary){
   const e={a,b,c},plan=compileTeaching(teacher(e),e,'boundary');
   for(const scene of plan.scenes)expect(scene.narration[0].text.length).toBeLessThanOrEqual(NARRATION_LIMIT);
  }
 });
 it('rejects altered structured equations/answers and prevents division by zero',()=>{
  const e=specificEquation('-2/3x + 1/2 = 5/6')!;
  const wrong=teacher(e);wrong.solution=r(7);expect(()=>compileTeaching(wrong,e,'bad')).toThrow('contradict');
  wrong.solution=r(-1,2);wrong.equation.a=r(2,3);expect(()=>compileTeaching(wrong,e,'bad')).toThrow('contradict');
  expect(()=>divide(r(1),r(0))).toThrow('zero');
  expect(solve({a:r(0),b:r(2),c:r(3)}).kind).toBe('none');expect(solve({a:r(0),b:r(2),c:r(2)}).kind).toBe('infinite');
 });
 it('checks deterministic rational equations built from independent known solutions',()=>{
  let checked=0;
  for(let i=0;i<120&&checked<32;i++){
   const an=BigInt(i%9-4||1),ad=BigInt(i%4+1),bn=BigInt(i%7-3),bd=BigInt(i%3+1),xn=BigInt(i%11-5),xd=BigInt(i%3+1);
   // Construct a*x+b directly with independent integer products; never solve for x here.
   const c=r(an*xn*bd+bn*ad*xd,ad*xd*bd),e={a:r(an,ad),b:r(bn,bd),c};
   try{checkCoefficientBounds(e);}catch{continue;}
   const result=solve(e);expect(result.kind).toBe('unique');if(result.kind!=='unique')throw new Error();
   expect(BigInt(result.solution.n)*xd).toBe(xn*BigInt(result.solution.d));
   const sn=BigInt(result.solution.n),sd=BigInt(result.solution.d);
   expect((an*sn*bd+bn*ad*sd)*BigInt(c.d)).toBe(BigInt(c.n)*ad*sd*bd);
   expect(verify(e,result.solution)).toBe(true);expect(result.verified).toBe(true);
   expect(compileTeaching(teacher(e),e,'generated').scenes).toHaveLength(16);checked++;
  }
  expect(checked).toBe(32);
 });
});
describe('request stages, retry feedback and stored rational lessons',()=>{
 it.each(examples)('prepares and restores a new verified lesson through mocked providers: %s',async(input,answer)=>{
  const dir=mkdtempSync(path.join(tmpdir(),'rational-pipeline-'));
  try{
   const e=specificEquation(input)!,repo=new FileRepository<Job>(dir,data=>jobSchema.parse(data));
   const bodies:Record<string,any>[]=[],provider=mockedProvider(e,bodies),speaker={preview:vi.fn(async()=>({entry:{speech}}))};
   let service=new LessonService(repo,provider,speaker,config,'mock',true),job=await service.create(input);
   job=await service.advance(job.id);expect(job.equation).toEqual(e);
   job=await service.advance(job.id);expect(job.stage).toBe('narration');expect(speaker.preview).not.toHaveBeenCalled();
   const planRequest=JSON.parse(bodies[1].messages[1].content);
   expect(planRequest.equation).toEqual(e);expect(planRequest.verifiedSteps.solution).toEqual(answer);
   job=await service.advance(job.id);expect(job.clips).toHaveLength(1);
   // Restart the service and load validated records, retaining the successful clip.
   service=new LessonService(new FileRepository<Job>(dir,data=>jobSchema.parse(data)),provider,speaker,config,'mock',true);
   while(job.stage!=='ready'){job.retryAt=undefined;await repo.put(job.id,job);job=await service.advance(job.id);if(job.message)throw new Error(job.message);}
   expect(speaker.preview).toHaveBeenCalledTimes(16);expect(provider).toHaveBeenCalledTimes(2);
   expect(job.plan!.equation).toEqual(e);expect(job.plan!.practice.expected).toEqual(r(2));
   expect(jobSchema.safeParse(job).success).toBe(true);
   expect(job.manifest!.audio.clips).toHaveLength(16);
   expect(boardAt(job.manifest!,job.manifest!.audio.duration).answer.opacity).toBe(1);
   const finalText=job.manifest!.plan.elements.find(v=>v.id==='answer')!.text;
   expect(finalText).toBe(answer.d==='1'?`x=${answer.n}`:`x=\\frac{${answer.n}}{${answer.d}}`);
   // Completed version-three content remains readable, byte/text-for-byte, without AI or speech.
   job.config.promptVersion=3;await repo.put(job.id,job);const old=structuredClone(job);
   expect(await service.advance(job.id)).toEqual(old);expect(speaker.preview).toHaveBeenCalledTimes(16);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('persists a fractional plan/clip through PostgreSQL JSON and separate audio restoration',async()=>{
  const {db,pg}=await testDatabase();try{
   const e=specificEquation('-2/3x + 1/2 = 5/6')!,repo=new PostgresLessonRepository(db),provider=mockedProvider(e),speaker={preview:vi.fn(async()=>({entry:{speech}}))};
   let service=new LessonService(repo,provider,speaker,config,'mock',true),job=await service.create('-2/3x + 1/2 = 5/6');
   job=await service.advance(job.id);job=await service.advance(job.id);job=await service.advance(job.id);
   service=new LessonService(new PostgresLessonRepository(db),provider,speaker,config,'mock',true);
   const restored=await service.get(job.id);
   expect(restored!.equation).toEqual(e);expect(restored!.plan!.practice.expected).toEqual(r(2));
   expect(restored!.clips[0]).toEqual(job.clips[0]);
   expect(JSON.stringify((await db.query('SELECT data FROM tutor_lessons')).rows[0].data)).not.toContain('audio_base64');
  }finally{await pg.close();}
 },15000);
 it('retains verification after a planning failure and sends safe field/rule feedback on explicit retry',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'rational-retry-'));
  try{
   const e=specificEquation('-20x+10=30')!,repo=new FileRepository<Job>(dir,data=>jobSchema.parse(data));
   const speaker={preview:vi.fn(async()=>({entry:{speech}}))},requests:any[]=[];
   const fetcher=vi.fn(async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));requests.push(body);
    const plan=wire();if(requests.length===2)plan.explanations.constant='The constant is 10. Private rejected sentence.';
    const content=body.response_format.type==='json_schema'?{status:'supported',message:'',equation:e}:plan;
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}));
   });
   const provider:Ask=(stage,payload)=>lessonProvider('mock','mock-only',fetcher)(stage,payload);
   const service=new LessonService(repo,provider,speaker,config,'mock',true),initial=await service.create('-20x+10=30');
   await service.advance(initial.id);const failed=await service.advance(initial.id);
   expect(failed.stage).toBe('plan');expect(failed.attempts).toBe(1);expect(failed.equation).toEqual(e);
   expect(failed.message).toContain('explanations.constant');expect(failed.message).toContain(EXPLANATION_RULES.text);
   expect(failed.message).not.toContain('Private rejected');expect(speaker.preview).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(2);
   const recovered=await service.advance(initial.id);expect(recovered.stage).toBe('narration');
   const context=JSON.parse(requests[2].messages[1].content);
   expect(context.previousValidationIssue).toContain('explanations.constant');expect(context.previousValidationIssue).toContain('no digits');
   expect(context.requirements).toBe(EXPLANATION_STYLE);expect(speaker.preview).not.toHaveBeenCalled();
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('allows one contract upgrade for an exhausted older plan without touching its verified equation',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'rational-upgrade-'));
  try{
   const e=specificEquation('x/2 + 3 = 7')!,repo=new FileRepository<Job>(dir,data=>jobSchema.parse(data)),provider=mockedProvider(e),speaker={preview:vi.fn(async()=>({entry:{speech}}))};
   const service=new LessonService(repo,provider,speaker,config,'mock'),job=await service.create('x/2 + 3 = 7');
   job.stage='plan';job.equation=e;job.attempts=2;job.config.promptVersion=3;job.message='explanations.constant: numerical claim rejected';await repo.put(job.id,job);
   const recovered=await service.advance(job.id);
   expect(recovered.config.promptVersion).toBe(LESSON_PIPELINE_VERSION);expect(recovered.attempts).toBe(1);expect(recovered.equation).toEqual(e);expect(recovered.stage).toBe('narration');
   expect(provider).toHaveBeenCalledTimes(1);expect(speaker.preview).not.toHaveBeenCalled();
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it.each(['1/0x+3=7','x^2+3x=7','100x+3=7','0x+2=3','0x+2=2'])('clarifies unsupported %s before invoking providers',async input=>{
  const dir=mkdtempSync(path.join(tmpdir(),'rational-scope-'));
  try{
   const provider=mockedProvider({a:r(1),b:r(2),c:r(3)}),speaker={preview:vi.fn(async()=>({entry:{speech}}))},service=new LessonService(new FileRepository<Job>(dir),provider,speaker,config,'mock');
   const job=await service.create(input),result=await service.advance(job.id);
   expect(['clarify','unsupported']).toContain(result.stage);expect(result.message).toBeTruthy();expect(result.plan).toBeUndefined();
   expect(provider).not.toHaveBeenCalled();expect(speaker.preview).not.toHaveBeenCalled();
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('rejects a fractional interpretation mismatch and does not silently start planning',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'rational-mismatch-'));
  try{
   const provider=mockedProvider({a:r(1,3),b:r(3),c:r(7)}),speaker={preview:vi.fn(async()=>({entry:{speech}}))},service=new LessonService(new FileRepository<Job>(dir),provider,speaker,config,'mock');
   const job=await service.create('x/2 + 3 = 7'),result=await service.advance(job.id);
   expect(result.message).toContain('changed your equation');expect(provider).toHaveBeenCalledTimes(1);expect(speaker.preview).not.toHaveBeenCalled();
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('keys equivalent notation together while retaining request context and speech settings',()=>{
  const key=lessonKey('Help me solve (1/2)x + 3 = 7.','mock',config);
  expect(key).toBe(lessonKey('Help me solve x/2 + 3 = 7','mock',config));
  expect(key).not.toBe(lessonKey('Explain x/2 + 3 = 7','mock',config));
  expect(key).not.toBe(lessonKey('Help me solve x/2 + 3 = 7','other-model',config));
  expect(key).not.toBe(lessonKey('Help me solve x/2 + 3 = 7','mock',{...config,voiceId:'different-configured-voice'}));
 });
});
