import { guard,persistent } from '@/server/lessons/runtime';
import { getConfig,configurationProblems,SpeechError } from '@/server/speech/config';
import { apiError } from '@/server/demo';
export const runtime='nodejs';
export const maxDuration=30;
export async function GET(request:Request){
 try{
  await guard(request);
  if(configurationProblems(getConfig()).length)throw new SpeechError('configuration','GROQ_API_KEY is not configured. Saved examples still work.',503);
  return Response.json({ready:true,storage:persistent()?'postgresql':'local-development',providerAccess:'not probed; only user-triggered generation checks account access'},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error);}
}
