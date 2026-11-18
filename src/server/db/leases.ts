import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database, transaction, type DB } from './client';
import { SpeechError } from '../speech/config';
const scope=new AsyncLocalStorage<{key:string;owner:string}>();
export async function assertLease(c:PoolClient){
 const lease=scope.getStore();if(!lease)return;
 const r=await c.query("SELECT key FROM tutor_operations WHERE key=$1 AND owner=$2 AND state='active' AND expires_at>now()",[lease.key,lease.owner]);
 if(!r.rowCount)throw new SpeechError('lease_expired','Preparation lease expired. Check usage before explicitly retrying; a provider call may have consumed quota.',409);
}
export class ProductionGate {
 constructor(private db:DB=database()){}
 async execute<T>(key:string,retry:boolean,work:()=>Promise<T>,cacheResult=false):Promise<T|undefined>{
  const owner=randomUUID();
  const admission=await transaction(this.db,async c=>{
   const old=await c.query("SELECT * FROM tutor_operations WHERE key=$1 AND created_at>now()-interval '7 days'",[key]);const row=old.rows[0];
   if(row?.state==='done')return {cached:true,result:row.result};
   if(row?.state==='active'&&new Date(row.expires_at).getTime()>Date.now())
    throw new SpeechError('busy','This preparation is already running. Wait, then resume explicitly.',409,5);
   if(row&&!retry)throw new SpeechError('ambiguous','An earlier request failed or its lease expired. It may have consumed quota. Check usage, then explicitly retry this stage.',409);
   const control=await c.query('SELECT blocked_until FROM tutor_control WHERE id=1');
   const wait=Math.ceil((new Date(control.rows[0].blocked_until).getTime()-Date.now())/1000);
   if(wait>0)throw new SpeechError('rate_limit','The shared demo is cooling down for Groq rate limits. Wait before explicitly resuming.',429,wait);
   await c.query(`INSERT INTO tutor_operations(key,owner,state,expires_at) VALUES($1,$2,'active',now()+interval '90 seconds') ON CONFLICT(key) DO UPDATE SET owner=EXCLUDED.owner,state='active',expires_at=EXCLUDED.expires_at,result=NULL,created_at=now()`,[key,owner]);
   // Global spacing survives cold starts. Provider headers can extend it.
   await c.query("UPDATE tutor_control SET blocked_until=now()+interval '7 seconds' WHERE id=1");
   return {cached:false,result:null};
  });
  if(admission.cached)return admission.result as T|undefined;
  try{
   const result=await scope.run({key,owner},work);
   await transaction(this.db,async c=>{
    await scope.run({key,owner},()=>assertLease(c));
    await c.query("UPDATE tutor_operations SET state='done', result=$3 WHERE key=$1 AND owner=$2",[key,owner,cacheResult?JSON.stringify(result):null]);
   });
   return result;
  }catch(error){
   await this.db.query("UPDATE tutor_operations SET state='failed' WHERE key=$1 AND owner=$2 AND state='active'",[key,owner]).catch(()=>{});
   if(error instanceof SpeechError&&error.retryAfterSeconds)await this.cooldown(error.retryAfterSeconds);
   throw error;
  }
 }
 async nextAllowed(){
  const r=await this.db.query('SELECT blocked_until FROM tutor_control WHERE id=1');
  return new Date(r.rows[0].blocked_until).getTime();
 }
 async cooldown(seconds:number){
  await this.db.query("UPDATE tutor_control SET blocked_until=greatest(blocked_until,now()+$1*interval '1 second') WHERE id=1",[Math.max(1,Math.min(seconds,86400))]);
 }
}
