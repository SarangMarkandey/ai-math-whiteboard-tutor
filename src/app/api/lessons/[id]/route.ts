import { liveService, advanceLesson, publicJob, guard } from '@/server/lessons/runtime';
import { apiError } from '@/server/demo';
import { z } from 'zod';
export const runtime='nodejs';
export const maxDuration=60;
const idSchema=z.string().regex(/^[a-f0-9]{64}$/);
export async function POST(r:Request,{params}:{params:Promise<{id:string}>}){
 try{await guard(r);const id=idSchema.parse((await params).id);
  return Response.json(publicJob(await advanceLesson(id,r.headers.get('x-explicit-retry')==='1')),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error);}
}
export async function GET(r:Request,{params}:{params:Promise<{id:string}>}){
 try{await guard(r);const job=await liveService().get(idSchema.parse((await params).id));
  return job?Response.json(publicJob(job),{headers:{'Cache-Control':'no-store'}}):Response.json({error:'Lesson expired or not found. Submit its topic again.'},{status:404});
 }catch(error){return apiError(error);}
}
