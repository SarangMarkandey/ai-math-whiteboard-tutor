import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import { createHash,randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(tmpdir(),'tutor-production-'));
const db=await PGlite.create(dir);
const server=new PGLiteSocketServer({db,host:'127.0.0.1',port:55439,maxConnections:4});
let app=null,pool=null,checkpoint='socket startup';
const base='http://127.0.0.1:3211';
const env={...process.env,DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:55439/postgres',DEMO_SESSION_SECRET:randomBytes(32).toString('hex'),GROQ_API_KEY:'mock-only-never-valid',GROQ_LESSON_MODEL:'openai/gpt-oss-20b',GROQ_TTS_MODEL:'canopylabs/orpheus-v1-english',GROQ_TTS_VOICE:'hannah',NODE_OPTIONS:'--import='+pathToFileURL(path.join(process.cwd(),'tests/support/no-external.mjs')).href};
async function command(args){
 const child=spawn('npm',args,{env,stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});
 const [code]=await once(child,'exit');if(code!==0)console.error(output.split('\n').filter(line=>line.startsWith('Database migration failed')||line.startsWith('Prune failed')).join('\n'));assert.equal(code,0,'Local migration/pruning command failed');return output;
}
async function stop(){if(app){const done=once(app,'exit');try{process.kill(-app.pid,'SIGTERM');}catch{}await done;app=null;}}
async function start(extra={}){
 app=spawn('npm',['start','--','--hostname','127.0.0.1','--port','3211'],{env:{...env,...extra},stdio:['ignore','pipe','pipe'],detached:true});
 app.stdout.on('data',()=>{});app.stderr.on('data',()=>{});
 for(let i=0;i<100;i++){
  if(app.exitCode!==null)throw new Error('Production server exited');
  try{const r=await fetch(base);if(r.ok)return;}catch{}
  await new Promise(r=>setTimeout(r,200));
 }
 throw new Error('Production server startup timed out');
}
try{
 await server.start();
 checkpoint='explicit migrations';await command(['run','db:migrate']);await command(['run','db:migrate']);
 pool=new Pool({connectionString:env.DATABASE_URL,max:1});
 checkpoint='production startup';await start();
 checkpoint='health check';const health=await fetch(base+'/api/health');assert.equal(health.status,200);assert.equal((await health.json()).storage,'postgresql');
 assert.equal((await fetch(base+'/dev/voice')).status,404);
 assert.equal((await fetch(base+'/api/voice-preview',{method:'POST',headers:{origin:base}})).status,403);
 checkpoint='anonymous lesson admission';let cookie='';
 async function create(topic){
  const r=await fetch(base+'/api/lessons',{method:'POST',headers:{origin:base,'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({topic})});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return r;
 }
 const created=await create('Help me solve 5x + 7 = 32');assert.equal(created.status,200);const job=await created.json();assert.equal(job.stage,'interpret');
 assert.ok(cookie.startsWith('tutor-demo='));
 assert.equal((await create('Help me solve 5x + 7 = 32')).status,200);
 assert.equal((await create('Help me solve 3x + 2 = 14')).status,200);
 assert.equal((await create('Help me solve 4x + 2 = 18')).status,429);
 checkpoint='application restart';await stop();
 await start();
 assert.equal((await (await fetch(base+'/api/lessons/'+job.id)).json()).stage,'interpret');
 checkpoint='persisted fixture and clip delivery';
 // Seed one verified fixture beat without any speech/AI request.
 const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
 const key=createHash('sha256').update(wav).digest('hex');
 const eq={a:{n:'5',d:'1'},b:{n:'7',d:'1'},c:{n:'32',d:'1'}};
 const narration={id:'phrase',text:'Subtract seven from both sides.'};
 const plan={version:2,id:job.id,title:'Mocked production fixture',objective:'Check storage and delivery.',level:'beginner',source:'live-generated',equation:eq,elements:[{id:'eq',kind:'term',text:'5x+7=32',x:100,y:100,width:200,height:35}],scenes:[{id:'beat',title:'Subtract equally',narration:[narration],actions:[]}],practice:{equation:{a:{n:'3',d:'1'},b:{n:'2',d:'1'},c:{n:'14',d:'1'}},prompt:'3x+2=14',expected:{n:'4',d:'1'},hint:'Subtract equally.'}};
 const manifest={plan,audio:{src:`/api/lessons/${job.id}/audio`,duration:1,clips:[{src:`/api/lessons/${job.id}/clips/0`,start:0,end:1}],provenance:'Mocked test-only PCM fixture'},scenes:[{sceneId:'beat',start:0,end:1,cues:[],captions:[{start:0,end:1,text:narration.text}]}]};
 const stored=(await pool.query('SELECT data FROM tutor_lessons WHERE id=$1',[job.id])).rows[0].data;
 Object.assign(stored,{stage:'ready',equation:eq,plan,manifest,clips:[{segmentId:'phrase',text:narration.text,speech:{format:'wav',durationSeconds:1},blobKey:key}]});
 await pool.query('INSERT INTO tutor_blobs(key,audio) VALUES($1,$2)',[key,wav]);await pool.query('INSERT INTO tutor_lesson_blobs VALUES($1,$2)',[job.id,key]);await pool.query('UPDATE tutor_lessons SET data=$2 WHERE id=$1',[job.id,JSON.stringify(stored)]);
 const resumed=await fetch(base+`/api/lessons/${job.id}`,{method:'POST',headers:{origin:base,cookie}});assert.equal(resumed.status,200);const ready=await resumed.json();assert.equal(ready.stage,'ready');assert.ok(!JSON.stringify(ready).includes('audio_base64'));
 const clip=await fetch(base+manifest.audio.clips[0].src,{headers:{range:'bytes=0-43'}});assert.equal(clip.status,206);assert.equal((await clip.arrayBuffer()).byteLength,44);
 assert.equal((await fetch(base+`/api/lessons/${job.id}/audio`)).status,410);
 checkpoint='pruning';await command(['run','db:prune']);
 checkpoint='missing storage guard';await stop();await start({DATABASE_URL:''});
 assert.equal((await fetch(base+'/api/health')).status,503);assert.equal((await fetch(base)).status,200);
 console.log('PASS: npm start, explicit/idempotent migrations, real pg TCP, persistent requests/restart, session quotas, ready manifest, clip ranges, pruning, preview disabled, missing-config guard. Mocked audio only; no provider calls.');
}catch{console.error('Production smoke check failed at '+checkpoint+'. No credentials or raw server/database errors are printed.');process.exitCode=1;}
finally{await stop();if(pool)await pool.end();await server.stop();await db.close();await rm(dir,{recursive:true,force:true});}
