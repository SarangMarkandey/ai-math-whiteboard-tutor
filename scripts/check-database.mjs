import { Client } from 'pg';
import nextEnv from '@next/env';
import { databaseOptions,databaseDiagnostic } from '../src/server/db/options.mjs';
nextEnv.loadEnvConfig(process.cwd());
let client;
try{
 if(!process.env.DATABASE_URL){const error=new Error();error.code='DATABASE_URL_INVALID';throw error;}
 client=new Client({...databaseOptions(process.env.DATABASE_URL),statement_timeout:5000});
 await client.connect();await client.query('SELECT 1');
 console.log('Database connection verified (read-only).');
 const exists=await client.query("SELECT to_regclass('public.tutor_schema_version') AS schema");
 if(!exists.rows[0].schema)console.log('Application migration is not applied. Review the SQL, then run npm run db:migrate.');
 else{const version=await client.query('SELECT version FROM tutor_schema_version');console.log(version.rows.length===1&&version.rows[0].version===1?'Application schema version verified.':'Application schema version needs review.');}
}catch(error){console.error(databaseDiagnostic(error,'Read-only database check'));process.exitCode=1;}
finally{await client?.end().catch(()=>{});}
