import 'server-only';
import { LESSON_PIPELINE_VERSION } from '../../domain/teaching-contract';
import { LessonService, type Job } from './service';
import { FileRepository } from './store';
import { lessonProvider } from './provider';
import { getConfig, configurationProblems, SpeechError } from '../speech/config';
import { PreviewService } from '../speech/service';
import { generateSpeech } from '../speech/provider';
import { FileSpeechRepository } from '../speech/cache';
import { PostgresLessonRepository, PostgresSpeechRepository } from '../db/repositories';
import { checkDatabase } from '../db/client';
import { ProductionGate } from '../db/leases';
import { sessionSecret } from '../demo';
import { jobSchema } from './records';
const globals=globalThis as typeof globalThis & { tutorRuntime?:ReturnType<typeof createRuntime> };
export const persistent=()=>!!process.env.DATABASE_URL;
function createRuntime(){
 const config=getConfig(),model=process.env.GROQ_LESSON_MODEL?.trim()||'openai/gpt-oss-20b';
 const repo=persistent()?new PostgresLessonRepository():new FileRepository<Job>(undefined,data=>jobSchema.parse(data));
 const speech=new PreviewService(persistent()?new PostgresSpeechRepository():new FileSpeechRepository(),
  (text,c)=>generateSpeech(text,c,limitedFetch));
 const service=new LessonService(repo,lessonProvider(model,config.apiKey,limitedFetch),speech,config,model,true);
 return {service,repo,config,model,version:LESSON_PIPELINE_VERSION};
}
export function liveService(){
 if(globals.tutorRuntime?.version!==LESSON_PIPELINE_VERSION)globals.tutorRuntime=createRuntime();
 return globals.tutorRuntime.service;
}
export async function limitedFetch(input:Parameters<typeof fetch>[0],init?:RequestInit){
 const r=await fetch(input,init);
 if(persistent()){
  let wait=r.status===429?Math.max(1,Number(r.headers.get('retry-after'))||60):0;
  for(const name of ['requests','tokens'])if(r.headers.get('x-ratelimit-remaining-'+name)==='0'){
   const reset=r.headers.get('x-ratelimit-reset-'+name)||'';
   const parts=[...reset.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)];
   const seconds=parts.reduce((sum,m)=>sum+Number(m[1])*({h:3600,m:60,s:1,ms:.001}[m[2]]??0),0);
   wait=Math.max(wait,Math.ceil(seconds)||60);
  }
  if(wait)await new ProductionGate().cooldown(wait);
 }
 return r;
}
export async function createLesson(topic:string){
 return liveService().create(topic);
}
export async function advanceLesson(id:string,retry:boolean){
 const service=liveService();if(!persistent())return service.advance(id);
 const gate=new ProductionGate();
 const job=await service.get(id);if(!job)throw new SpeechError('missing','Lesson expired. Submit the topic again or try the saved example.',404);
 if(['ready','clarify','unsupported'].includes(job.stage)||job.retryAt&&job.retryAt>Date.now())return job;
 const fingerprint=(j:Job)=>`${LESSON_PIPELINE_VERSION}:${j.config.promptVersion}:${j.stage}:${j.clips.length}:${j.attempts}`;
 const initial=fingerprint(job);
 const result=await gate.execute(`lesson:${id}:${initial}`,retry,async()=>{
  const latest=await service.get(id);if(!latest||fingerprint(latest)!==initial)return latest!;
  const next=await service.advance(id);
  if(next.message&&!['clarify','unsupported'].includes(next.stage))throw new SpeechError('preparation',next.message,next.retryAt?429:502,next.retryAt?Math.max(1,Math.ceil((next.retryAt-Date.now())/1000)):0);
  if(!['ready','clarify','unsupported'].includes(next.stage)){
   next.retryAt=Math.max(next.retryAt??0,await gate.nextAllowed());
   await globals.tutorRuntime!.repo.put(id,next);
  }
  return next;
 });
 return result??(await service.get(id))!;
}
export async function lessonClip(id:string,index:number){
 liveService();const repo=globals.tutorRuntime!.repo;
 if(repo instanceof PostgresLessonRepository)return repo.clip(id,index);
 const job=await repo.get(id);const clip=job?.clips[index];
 return clip?Buffer.from(clip.speech.audio_base64,'base64'):null;
}
export function publicJob(j:Job){return {id:j.id,stage:j.stage,message:j.message,retryAt:j.retryAt,completed:j.clips.length,total:j.plan?.scenes.length??16,manifest:j.manifest,outline:j.outline};}
export async function guard(request:Request){
 if(request.method==='POST'){
  let valid=false;
  try{
   const origin=new URL(request.headers.get('origin')??'');
   // Next.js may expose an internal hostname in request.url behind a proxy.
   // Host is the browser's target host; never trust arbitrary forwarded-host values.
   valid=['http:','https:'].includes(origin.protocol)&&origin.host===(request.headers.get('host')??new URL(request.url).host);
  }catch{}
  if(!valid)throw new SpeechError('origin','Use this application to submit requests.',403);
 }
 if(process.env.NODE_ENV==='production'&&!persistent())throw new SpeechError('configuration','Production live features require DATABASE_URL and the explicit database migration. Saved examples remain available.',503);
 if(persistent()){
  sessionSecret();await checkDatabase();
  if(request.method==='POST'&&configurationProblems(getConfig()).length)
   throw new SpeechError('configuration','Missing server configuration: GROQ_API_KEY. Saved examples remain available.',503);
 }
}
