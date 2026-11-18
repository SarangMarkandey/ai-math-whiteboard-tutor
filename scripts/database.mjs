import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { databaseOptions, databaseDiagnostic } from '../src/server/db/options.mjs';
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required (server-only).'); process.exit(1); }
let pool;
let phase='Database connection';
try {
 pool = new Pool({...databaseOptions(process.env.DATABASE_URL),max:1,statement_timeout:15000});
 const c=await pool.connect();
 try {
  phase='Database migration';
  await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(728193)");
  await c.query('CREATE TABLE IF NOT EXISTS tutor_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const name='001_demo_storage.sql', sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');
  const hash=createHash('sha256').update(sql).digest('hex');
  const hit=await c.query('SELECT checksum FROM tutor_migrations WHERE name=$1',[name]);
  if(hit.rowCount){if(hit.rows[0].checksum!==hash){const error=new Error('Migration changed');error.code='MIGRATION_CHECKSUM';throw error;}console.log('Database migration already applied.');}
  else {await c.query(sql);await c.query('INSERT INTO tutor_migrations(name,checksum) VALUES($1,$2)',[name,hash]);console.log('Applied migration 001.');}
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}catch(error){console.error(databaseDiagnostic(error,phase));process.exitCode=1;}
finally{await pool?.end();}
