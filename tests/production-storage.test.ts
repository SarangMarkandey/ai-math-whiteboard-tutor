import { describe,it,expect,vi } from 'vitest';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDatabase } from './support/database';
import { PostgresLessonRepository,PostgresSpeechRepository,CLIP_CAP } from '../src/server/db/repositories';
import { ProductionGate } from '../src/server/db/leases';
import { checkDatabase } from '../src/server/db/client';
import { LessonService,type Job } from '../src/server/lessons/service';
import { getConfig } from '../src/server/speech/config';
import { cacheKey,identity } from '../src/server/speech/cache';
import { PreviewService } from '../src/server/speech/service';
import { roles } from '../src/domain/live';
import { normalizeWav } from '../src/domain/speech';
import { rational as r,solve } from '../src/domain/math';
import { verifySession,signSession } from '../src/server/demo';
const config=getConfig({GROQ_API_KEY:'mock-only'}),equation={a:r(-20),b:r(30),c:r(50)};
const normalized=normalizeWav(readFileSync('tests/fixtures/streaming-tone.wav'));
const speech={audio_base64:Buffer.from(normalized.bytes).toString('base64'),durationSeconds:normalized.durationSeconds,format:'wav' as const};
function planner(){
 return vi.fn(async(stage:string)=>stage==='interpret'?{status:'supported',message:'',equation}:{
 objective:'Understand the balanced equation.',outline:['Read the equation','Preserve equality','Verify the solution'],equation,solution:solve(equation).kind==='unique'?r(-1):r(0),
 beats:roles.map((role,i)=>({id:`step-${i}`,role,explanation:'Keep the equal values balanced throughout the working.',visual:[1,2,3,10].includes(i)?'highlight':[6,8,9].includes(i)?'draw':'reveal'})),
 practice:{equation:{a:r(3),b:r(2),c:r(14)},solution:r(4),hint:'Remove the constant equally.'},
 });
}
it('persists completed clips and stage across database close/reopen without duplicating audio',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'tutor-pg-'));
 let server=await testDatabase(directory);const provider=planner();const speechProvider=vi.fn(async()=>({speech,metadata:{}}));
 try{
  let repo=new PostgresLessonRepository(server.db);
  let service=new LessonService(repo,provider,new PreviewService(new PostgresSpeechRepository(server.db),speechProvider),config,'mock',true);
  let job=await service.create('Help me solve -20x + 30 = 50');
  job=await service.advance(job.id);job=await service.advance(job.id);job=await service.advance(job.id);
  expect(job.clips).toHaveLength(1);expect(speechProvider).toHaveBeenCalledTimes(1);
  let raw=(await server.db.query('SELECT data FROM tutor_lessons')).rows[0].data;
  expect(JSON.stringify(raw)).not.toContain('audio_base64');
  expect((await server.db.query('SELECT count(*) AS n FROM tutor_blobs')).rows[0].n).toBe(1);
  await server.pg.close();server=await testDatabase(directory,false);
  repo=new PostgresLessonRepository(server.db);
  const restored=await repo.get(job.id);expect(restored?.clips[0].speech).toEqual(speech);
  const clipCache=new PostgresSpeechRepository(server.db);
  const hit=await new PreviewService(clipCache,speechProvider).preview({text:job.clips[0].text},config);
  expect(hit.status).toBe('cache-hit');expect(speechProvider).toHaveBeenCalledTimes(1);
  // New request/service instance resumes only the next beat, using mocked speech.
  const nextSpeaker={preview:vi.fn(async()=>({entry:{speech}}))};
  service=new LessonService(repo,provider,nextSpeaker,config,'mock',true);
  restored!.retryAt=undefined;await repo.put(job.id,restored!);job=await service.advance(job.id);
  expect(job.clips).toHaveLength(2);expect(provider).toHaveBeenCalledTimes(2);expect(nextSpeaker.preview).toHaveBeenCalledTimes(1);
  // Finish remaining stages with injected fixtures; no network and no delay loop.
  while(job.stage!=='ready'){job.retryAt=undefined;await repo.put(job.id,job);job=await service.advance(job.id);}
  expect(job.audio).toBeUndefined();expect(job.manifest!.audio.clips).toHaveLength(16);
  expect(job.manifest!.audio.duration).toBeCloseTo(speech.durationSeconds*16);
  expect(await repo.clip(job.id,0)).toEqual(Buffer.from(normalized.bytes));
  raw=(await server.db.query('SELECT data FROM tutor_lessons')).rows[0].data;
  expect(JSON.stringify(raw)).not.toContain('audio_base64');expect(raw.audio).toBeUndefined();
  expect((await server.db.query('SELECT count(*) AS n FROM tutor_blobs')).rows[0].n).toBe(1);
  await server.db.query("UPDATE tutor_lessons SET data=jsonb_set(data,'{clips,0,speech,durationSeconds}','999')");
  await expect(repo.get(job.id)).rejects.toThrow();
  // Expired entries can be deliberately prepared again even before owner pruning.
  await server.db.query("UPDATE tutor_lessons SET expires_at=now()-interval '1 second'");
  const fresh=await service.create('Help me solve -20x + 30 = 50');
  expect(fresh.stage).toBe('interpret');expect(fresh.clips).toHaveLength(0);
  expect((await server.db.query('SELECT count(*) AS n FROM tutor_lesson_blobs')).rows[0].n).toBe(0);
  await server.db.query("UPDATE tutor_speech SET expires_at=now()-interval '1 second'");
  expect(await clipCache.get(hit.entry.key)).toBeNull();
  await clipCache.put(hit.entry);expect((await clipCache.get(hit.entry.key))?.speech).toEqual(speech);
 }finally{await server.pg.close();rmSync(directory,{recursive:true,force:true});}
},30000);
it('ignores exhausted legacy daily counters while preserving request pacing',async()=>{
 const {db,pg}=await testDatabase();try{
  for(const subject of ['shared','old-session'])for(const kind of ['lessons','questions','requests'])
   await db.query('INSERT INTO tutor_usage(subject,kind,used) VALUES($1,$2,1000000)',[subject,kind]);
  const gate=new ProductionGate(db),work=vi.fn(async()=>({ok:true}));
  for(let i=0;i<10;i++){
   await db.query("UPDATE tutor_control SET blocked_until=now()-interval '1 second'");
   await gate.execute('new-request:'+i,false,work);
  }
  expect(work).toHaveBeenCalledTimes(10);
  expect((await db.query('SELECT max(used) AS n FROM tutor_usage')).rows[0].n).toBe(1000000);
  await expect(gate.execute('paced-request',false,work)).rejects.toMatchObject({code:'rate_limit'});
 }finally{await pg.close();}
});
it('prevents duplicate stages while allowing distinct operations and caching completion',async()=>{
 const {db,pg}=await testDatabase();try{
  const gate=new ProductionGate(db);let release!:()=>void;let started!:()=>void;
  const entered=new Promise<void>(r=>{started=r;});const wait=new Promise<void>(r=>{release=r;});
  const work=vi.fn(async()=>{started();await wait;return {text:'mocked validated answer'};});
  const active=gate.execute('followup:test',false,work,true);await entered;
  await expect(new ProductionGate(db).execute('followup:test',false,work,true)).rejects.toMatchObject({code:'busy'});
  await db.query("UPDATE tutor_control SET blocked_until=now()-interval '1 second'");
  const distinct=vi.fn(async()=>({ok:true}));
  await gate.execute('another-operation',false,distinct);expect(distinct).toHaveBeenCalledTimes(1);
  release();await active;
  expect(await new ProductionGate(db).execute('followup:test',false,work,true)).toEqual({text:'mocked validated answer'});
  expect(work).toHaveBeenCalledTimes(1);
 }finally{await pg.close();}
});
it('requires explicit retry after an expired lease or ambiguous provider failure',async()=>{
 const {db,pg}=await testDatabase();try{
  const gate=new ProductionGate(db),work=vi.fn(async()=>{throw new Error('mock timeout');});
  await expect(gate.execute('stage:x',false,work)).rejects.toThrow('mock timeout');
  await expect(gate.execute('stage:x',false,work)).rejects.toMatchObject({code:'ambiguous'});
  expect(work).toHaveBeenCalledTimes(1);
  await db.query("UPDATE tutor_control SET blocked_until=now()-interval '1 second'");
  await gate.execute('stage:x',true,async()=>undefined);
  await db.query("INSERT INTO tutor_operations(key,owner,state,expires_at) VALUES('expired','00000000-0000-0000-0000-000000000000','active',now()-interval '1 second')");
  await expect(gate.execute('expired',false,work)).rejects.toMatchObject({code:'ambiguous'});
 }finally{await pg.close();}
});
it('fences an expired owner from persisting provider audio',async()=>{
 const {db,pg}=await testDatabase();try{
  const repo=new PostgresSpeechRepository(db),gate=new ProductionGate(db);
  await expect(gate.execute('lease:test',false,async()=>{
   await db.query("UPDATE tutor_operations SET expires_at=now()-interval '1 second' WHERE key='lease:test'");
   await repo.put({key:cacheKey('Test.',config),identity:identity('Test.',config),speech,metadata:{},createdAt:new Date().toISOString()});
  })).rejects.toMatchObject({code:'lease_expired'});
  expect((await db.query('SELECT count(*) AS n FROM tutor_blobs')).rows[0].n).toBe(0);
 }finally{await pg.close();}
});
it('requires a supported schema before production access',async()=>{
 const {db,pg}=await testDatabase();try{await checkDatabase(db);await db.query('UPDATE tutor_schema_version SET version=2');await expect(checkDatabase(db)).rejects.toMatchObject({code:'storage'});}finally{await pg.close();}
});
it('validates signed anonymous sessions, expiry and tampering',()=>{
 const secret='test-secret-longer-than-thirty-two-characters',id='00000000-0000-0000-0000-000000000001',time=Date.now(),unsigned=`${id}.${time}`;
 const value=`${unsigned}.${signSession(unsigned,secret)}`;
 expect(verifySession(value,secret,time)).toBe(id);expect(verifySession(value+'a',secret,time)).toBeNull();
 expect(verifySession(value,secret,time+86400001)).toBeNull();expect(verifySession(value,'other-secret',time)).toBeNull();
 expect(CLIP_CAP).toBeLessThan(4.5*1000*1000);
});

it('rejects oversized clips transactionally without caching a failed generation',async()=>{
 const {db,pg}=await testDatabase();try{
  const bytes=Buffer.alloc(CLIP_CAP+100);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(8000,28);bytes.writeUInt16LE(1,32);bytes.writeUInt16LE(8,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  const measured=normalizeWav(bytes),repo=new PostgresSpeechRepository(db);
  await expect(repo.put({key:cacheKey('Oversized.',config),identity:identity('Oversized.',config),speech:{audio_base64:bytes.toString('base64'),durationSeconds:measured.durationSeconds,format:'wav'},metadata:{},createdAt:new Date().toISOString()})).rejects.toMatchObject({code:'clip_size'});
  expect((await db.query('SELECT count(*) AS n FROM tutor_blobs')).rows[0].n).toBe(0);
 }finally{await pg.close();}
});
