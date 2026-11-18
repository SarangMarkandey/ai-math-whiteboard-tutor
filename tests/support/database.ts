import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { DB } from '../../src/server/db/client';
/** Real embedded PostgreSQL SQL engine; one backend, with explicit client checkout
 * serialization. This tests SQL/persistence, not Neon networking or multi-backend locks. */
export async function testDatabase(directory?:string,migrate=true){
 const pg=new PGlite(directory);await pg.waitReady;
 if(migrate)await pg.exec(readFileSync('migrations/001_demo_storage.sql','utf8'));
 let tail=Promise.resolve();
 const connect=async()=>{
  const previous=tail;let release!:()=>void;
  tail=new Promise<void>(resolve=>{release=resolve;});await previous;
  return {release,query:async(sql:string,params?:unknown[])=>{
   const result=await pg.query(sql,params);
   const rows=result.rows.map(row=>Object.fromEntries(Object.entries(row as Record<string,unknown>).map(([k,v])=>[k,v instanceof Uint8Array?Buffer.from(v):v])));
   return {rows,rowCount:rows.length || result.affectedRows || 0};
  }};
 };
 const db={connect,query:async(sql:string,params?:unknown[])=>{const c=await connect();try{return await c.query(sql,params);}finally{c.release();}}} as unknown as DB;
 return {pg,db};
}
