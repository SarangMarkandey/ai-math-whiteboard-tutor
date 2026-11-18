import { Pool } from 'pg';
import { databaseOptions,databaseDiagnostic } from '../src/server/db/options.mjs';
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required.');process.exit(1);}
let pool;
try{
 pool=new Pool({...databaseOptions(process.env.DATABASE_URL),max:1,statement_timeout:15000});
 const c=await pool.connect();
 try{
  await c.query('BEGIN');await c.query("SET LOCAL TIME ZONE 'UTC'");await c.query('SELECT id FROM tutor_control WHERE id=1 FOR UPDATE');
  await c.query('DELETE FROM tutor_lessons WHERE expires_at<now()');
  await c.query('DELETE FROM tutor_speech WHERE expires_at<now()');
  await c.query('DELETE FROM tutor_blobs b WHERE NOT EXISTS (SELECT 1 FROM tutor_lesson_blobs r WHERE r.blob_key=b.key) AND NOT EXISTS (SELECT 1 FROM tutor_speech s WHERE s.blob_key=b.key)');
  await c.query("DELETE FROM tutor_operations WHERE created_at<now()-interval '7 days' AND expires_at<now()");
  await c.query("DELETE FROM tutor_usage WHERE day<CURRENT_DATE-7");
  await c.query("DELETE FROM tutor_access WHERE created_at<now()-interval '7 days'");
  await c.query('COMMIT');console.log('Expired demo data and unreferenced audio pruned.');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}catch(error){console.error(databaseDiagnostic(error,'Database pruning'));process.exitCode=1;}finally{await pool?.end();}
