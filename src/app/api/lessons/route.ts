import { createLesson, publicJob, guard } from '@/server/lessons/runtime';
import { topicSchema } from '@/server/lessons/service';
import { apiError } from '@/server/demo';
import { SpeechError } from '@/server/speech/config';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(r:Request){
 try{await guard(r);const text=await r.text();
  if(text.length>2000)throw new SpeechError('input','Topic request is too large.',400);
  const {topic}=topicSchema.parse(JSON.parse(text));
  return Response.json(publicJob(await createLesson(topic)),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error);}
}
