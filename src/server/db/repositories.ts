import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { database, transaction, type DB } from './client';
import { assertLease } from './leases';
import { SpeechError } from '../speech/config';
import { entrySchema, type CacheEntry, type SpeechRepository } from '../speech/cache';
import { jobSchema } from '../lessons/records';
import type { Job } from '../lessons/service';
import type { Repository } from '../lessons/store';
import { normalizeWav } from '../../domain/speech';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const reference=z.string().regex(/^[a-f0-9]{64}$/);
// Conservative logical caps leave space for indexes, TOAST overhead and the rest of a Free DB.
export const AUDIO_CAP=100*1024*1024, JSON_CAP=20*1024*1024, CLIP_CAP=4_000_000;
async function capacity(c:PoolClient, extra=0) {
 const r=await c.query(`SELECT
 (SELECT coalesce(sum(octet_length(audio)),0) FROM tutor_blobs) AS audio,
 (SELECT coalesce(sum(octet_length(data::text)),0) FROM tutor_lessons) +
 (SELECT coalesce(sum(octet_length(data::text)),0) FROM tutor_speech) AS json`);
 if(Number(r.rows[0].audio)+extra>AUDIO_CAP||Number(r.rows[0].json)>JSON_CAP)
  throw new SpeechError('storage_full','Demo storage cap reached. The owner can run db:prune; no speech should be regenerated blindly.',503);
}
async function saveBlob(c:PoolClient, base64:string) {
 const bytes=Buffer.from(base64,'base64');normalizeWav(bytes);
 if(bytes.length>CLIP_CAP)throw new SpeechError('clip_size','Narration clip exceeds the safe delivery limit. Use shorter teaching beats.',502);
 const key=hash(bytes);const hit=await c.query('SELECT key FROM tutor_blobs WHERE key=$1',[key]);
 if(!hit.rowCount){await capacity(c,bytes.length);await c.query('INSERT INTO tutor_blobs(key,audio) VALUES($1,$2)',[key,bytes]);}
 return key;
}
const storedClip=z.object({segmentId:z.string().max(80),text:z.string().max(179),blobKey:reference,speech:z.object({durationSeconds:z.number().positive(),format:z.literal('wav')})}).strict();
export class PostgresLessonRepository implements Repository<Job> {
 constructor(private db:DB=database()){}
 async get(id:string):Promise<Job|null>{
  reference.parse(id);
  const r=await this.db.query('SELECT data FROM tutor_lessons WHERE id=$1 AND expires_at>now()',[id]);
  if(!r.rowCount)return null;
  const data=z.object({clips:z.array(storedClip).max(16)}).passthrough().parse(r.rows[0].data);
  const clips=await Promise.all(data.clips.map(async clip=>{
   const b=await this.db.query('SELECT audio FROM tutor_blobs WHERE key=$1',[clip.blobKey]);
   if(!b.rowCount||hash(b.rows[0].audio)!==clip.blobKey)throw new Error('Invalid stored clip');
   return {segmentId:clip.segmentId,text:clip.text,speech:{...clip.speech,audio_base64:b.rows[0].audio.toString('base64')}};
  }));
  const job=jobSchema.parse({...data,clips});if(job.id!==id)throw new Error('Stored lesson mismatch');return job;
 }
 async create(id:string,input:Job){
  const job=jobSchema.parse(input);if(job.id!==id||job.clips.length)throw new Error('Invalid initial job');
  await transaction(this.db,async c=>{
   const inserted=await c.query(`INSERT INTO tutor_lessons(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data, expires_at=EXCLUDED.expires_at WHERE tutor_lessons.expires_at<=now() RETURNING id`,[id,JSON.stringify(job)]);
   if(inserted.rowCount)await c.query('DELETE FROM tutor_lesson_blobs WHERE lesson_id=$1',[id]);
   await capacity(c);
   const count=await c.query('SELECT count(*) AS n FROM tutor_lessons');
   if(Number(count.rows[0].n)>100)throw new SpeechError('storage_full','Demo lesson cap reached. The owner must prune expired lessons.',503);
  });
  return (await this.get(id))!;
 }
 async put(id:string,input:Job){
  const job=jobSchema.parse(input);if(id!==job.id)throw new Error('Lesson reference mismatch');
  await transaction(this.db,async c=>{
   await assertLease(c);
   // Never persist the assembled file; the manifest references individual clips.
   const {audio:_,clips,...metadata}=job;
   const refs=[];
   for(const clip of clips){const {audio_base64,...speech}=clip.speech;refs.push({segmentId:clip.segmentId,text:clip.text,speech,blobKey:await saveBlob(c,audio_base64)});}
   const data={...metadata,clips:refs};
   await c.query(`INSERT INTO tutor_lessons(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data, expires_at=now()+interval '7 days'`,[id,JSON.stringify(data)]);
   for(const clip of refs)await c.query('INSERT INTO tutor_lesson_blobs VALUES($1,$2) ON CONFLICT DO NOTHING',[id,clip.blobKey]);
   await capacity(c);
   const count=await c.query('SELECT count(*) AS n FROM tutor_lessons');
   if(Number(count.rows[0].n)>100)throw new SpeechError('storage_full','Demo lesson cap reached. The owner must prune expired lessons.',503);
  });
 }
 async clip(id:string,index:number){
  reference.parse(id);if(!Number.isInteger(index)||index<0||index>=16)return null;
  const r=await this.db.query(`SELECT b.audio,b.key,l.data->'clips'->($2::int) AS clip FROM tutor_lessons l JOIN tutor_blobs b ON b.key=l.data->'clips'->($2::int)->>'blobKey' WHERE l.id=$1 AND l.expires_at>now()`,[id,index]);
  if(!r.rowCount)return null;
  const row=r.rows[0],clip=storedClip.parse(row.clip);
  if(hash(row.audio)!==row.key||normalizeWav(row.audio).durationSeconds!==clip.speech.durationSeconds)throw new Error('Invalid clip storage');
  return row.audio as Buffer;
 }
}
export class PostgresSpeechRepository implements SpeechRepository {
 constructor(private db:DB=database()){}
 async get(key:string){
  reference.parse(key);const r=await this.db.query(`SELECT s.data,b.audio FROM tutor_speech s JOIN tutor_blobs b ON b.key=s.blob_key WHERE s.key=$1 AND s.expires_at>now()`,[key]);
  if(!r.rowCount)return null;
  const data=r.rows[0].data;
  return entrySchema.parse({...data,speech:{...data.speech,audio_base64:r.rows[0].audio.toString('base64')}});
 }
 async put(input:CacheEntry){
  const entry=entrySchema.parse(input);
  await transaction(this.db,async c=>{
   await assertLease(c);
   const {audio_base64,...speech}=entry.speech;const blob=await saveBlob(c,audio_base64);
   await c.query(`INSERT INTO tutor_speech(key,data,blob_key) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET data=EXCLUDED.data,blob_key=EXCLUDED.blob_key,expires_at=EXCLUDED.expires_at WHERE tutor_speech.expires_at<=now()`,[entry.key,JSON.stringify({...entry,speech}),blob]);await capacity(c);
  });
 }
}
