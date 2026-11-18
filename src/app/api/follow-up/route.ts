import { createHash } from 'node:crypto';
import { example } from '@/content/example';
import { liveService, guard, persistent, limitedFetch } from '@/server/lessons/runtime';
import { FollowupService } from '@/server/followup/service';
import { followupProvider } from '@/server/followup/provider';
import { SpeechError } from '@/server/speech/config';
import { followupRequest } from '@/domain/followup';
import { followupResponse } from '@/domain/followup-response';
import { ProductionGate } from '@/server/db/leases';
import { demoSession, apiError } from '@/server/demo';
export const runtime='nodejs';
export const maxDuration=60;
function service(){
 const model=process.env.GROQ_LESSON_MODEL?.trim()||'openai/gpt-oss-20b';
 return new FollowupService(async id=>{
  if(id===example.plan.id)return example;
  const job=await liveService().get(id);return job?.stage==='ready'?job.manifest??null:null;
 },followupProvider(model,process.env.GROQ_API_KEY??'',limitedFetch));
}
export async function POST(request:Request){
 try{
  await guard(request);const text=await request.text();
  if(text.length>8000)throw new SpeechError('input','Question context is too large.',400);
  const input=followupRequest.parse(JSON.parse(text));
  const answer=()=>service().answer(input);
  let result:unknown;
  if(persistent()){
   const session=await demoSession();
   const key='followup:'+createHash('sha256').update(JSON.stringify([1,process.env.GROQ_LESSON_MODEL||'openai/gpt-oss-20b',session,input])).digest('hex');
   result=await new ProductionGate().execute(key,request.headers.get('x-explicit-retry')==='1',answer,true);
  }else result=await answer();
  const reply=followupResponse.parse(result);
  if(reply.lessonId!==input.lessonId||reply.contextId!==input.contextId||reply.stepId!==input.stepId||reply.position!==input.position)
   throw new Error('Mismatched cached response');
  return Response.json(reply,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error);}
}
