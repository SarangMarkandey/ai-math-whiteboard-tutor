import "server-only";
import { Pool, type PoolClient } from 'pg';
import { databaseOptions } from './options.mjs';
import { SpeechError } from '../speech/config';
export const storageError = () => new SpeechError('storage', 'Persistent storage is unavailable or its migration is missing. The owner should check DATABASE_URL and run db:migrate. Your current lesson is preserved.', 503);
const shared = globalThis as typeof globalThis & { tutorPool?: Pool };
export function database() {
  if (!process.env.DATABASE_URL) throw new SpeechError('configuration', 'Missing server configuration: DATABASE_URL. Saved examples remain available.', 503);
  return shared.tutorPool ??= new Pool({
    ...databaseOptions(process.env.DATABASE_URL),
    max: 2, idleTimeoutMillis: 1000,
    statement_timeout: 5000, application_name: 'math-tutor-demo',
    allowExitOnIdle: true,
  }).on('error', () => { /* No raw connection diagnostics: URLs may contain credentials. */ });
}
export type DB = Pick<Pool, 'query' | 'connect'>;
export async function transaction<T>(db: DB, work: (c: PoolClient) => Promise<T>) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    // This single row serializes quota admission, capacity checks and claims.
    await c.query('SELECT id FROM tutor_control WHERE id=1 FOR UPDATE');
    const result = await work(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { c.release(); }
}
export async function checkDatabase(db: DB = database()) {
  try {
    const r = await db.query('SELECT version FROM tutor_schema_version');
    if (r.rows.length !== 1 || r.rows[0].version !== 1) throw storageError();
  } catch { throw storageError(); }
}
