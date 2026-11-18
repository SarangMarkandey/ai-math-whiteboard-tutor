import 'server-only';
import { createHmac, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { SpeechError } from './speech/config';
import { storageError } from './db/client';
import { z } from 'zod';
export function sessionSecret(){
 const secret=process.env.DEMO_SESSION_SECRET;
 if(!secret||secret.length<32)throw new SpeechError('configuration','Missing server configuration: DEMO_SESSION_SECRET must contain at least 32 random characters.',503);
 return secret;
}
export function signSession(id:string,secret:string){return createHmac('sha256',secret).update(id).digest('hex');}
export function verifySession(value:string|undefined,secret:string,now=Date.now()){
 if(!value)return null;const [id,time,signature]=value.split('.');
 if(!/^[a-f0-9-]{36}$/.test(id??'')||!/^\d{13}$/.test(time??'')||! /^[a-f0-9]{64}$/.test(signature??''))return null;
 const age=now-Number(time);if(age<0||age>86400000)return null;
 const wanted=signSession(`${id}.${time}`,secret);
 return timingSafeEqual(Buffer.from(wanted),Buffer.from(signature))?id:null;
}
export async function demoSession(){
 const secret=sessionSecret(),jar=await cookies(),value=jar.get('tutor-demo')?.value;
 let id=verifySession(value,secret);
 if(!id){id=randomUUID();const unsigned=`${id}.${Date.now()}`;
  jar.set('tutor-demo',`${unsigned}.${signSession(unsigned,secret)}`,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:86400,path:'/'});
 }
 return createHash('sha256').update(id).digest('hex');
}
export function apiError(error:unknown){
 const e=error instanceof SpeechError?error:error instanceof z.ZodError || error instanceof SyntaxError?
  new SpeechError('input','Invalid request. Check your input and select the lesson again.',400):new SpeechError('unavailable','The request could not complete. Check server configuration or retry explicitly. Your current lesson is preserved.',503);
 return Response.json({error:e.message,code:e.code,retryAfterSeconds:e.retryAfterSeconds},{status:e.status,headers:{'Cache-Control':'no-store',...(e.retryAfterSeconds?{'Retry-After':String(e.retryAfterSeconds)}:{})}});
}
