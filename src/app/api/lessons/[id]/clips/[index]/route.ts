import { guard, lessonClip } from '@/server/lessons/runtime';
import { apiError } from '@/server/demo';
import { audioResponse } from '@/server/audio-response';
import { z } from 'zod';
export const runtime='nodejs';
export const maxDuration=30;
export async function GET(r:Request,{params}:{params:Promise<{id:string;index:string}>}){
 try{await guard(r);const p=await params;const id=z.string().regex(/^[a-f0-9]{64}$/).parse(p.id);
  const index=z.coerce.number().int().min(0).max(15).parse(p.index);
  const bytes=await lessonClip(id,index);
  return bytes?audioResponse(bytes,r.headers.get('range')):new Response('Clip expired or is not prepared yet. Resume preparation.',{status:404});
 }catch(error){return apiError(error);}
}
