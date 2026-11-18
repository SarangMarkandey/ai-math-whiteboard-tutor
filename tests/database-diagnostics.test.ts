import {it,expect} from 'vitest';
import { databaseOptions,databaseDiagnostic } from '../src/server/db/options.mjs';
it('preserves certificate verification explicitly without changing credentials or local connections',()=>{
 const input='postgresql://test:dummy-password@example.invalid/test?sslmode=require&channel_binding=require';
 const options=databaseOptions(input),url=new URL(options.connectionString);
 expect(url.searchParams.get('sslmode')).toBe('verify-full');
 expect(url.searchParams.get('channel_binding')).toBe('require');
 expect(url.password).toBe('dummy-password');expect(options.connectionTimeoutMillis).toBe(15000);
 expect(databaseOptions('postgresql://test@localhost/test').connectionString).toBe('postgresql://test@localhost/test');
 expect(()=>databaseOptions('invalid')).toThrow();
});
it('handles nested network errors and timeouts without logging raw secrets',()=>{
 const secret='postgresql://private:dummy-secret@private-host/private-db';
 const nested=new AggregateError([Object.assign(new Error(secret),{code:'ENOTFOUND'})],secret);
 const diagnostic=databaseDiagnostic(nested,'Database connection');
 expect(diagnostic).toContain('ENOTFOUND');expect(diagnostic).toContain('DNS');expect(diagnostic).not.toContain('private');
 expect(databaseDiagnostic(new Error('Connection terminated due to connection timeout'))).toContain('TIMEOUT');
 expect(databaseDiagnostic(new Error(secret))).not.toContain('private');
});
it('gives safe certificate, authentication and migration instructions',()=>{
 expect(databaseDiagnostic(Object.assign(new Error('certificate failed: private-host'),{code:'CERT_HAS_EXPIRED'}))).toContain('do not disable');
 expect(databaseDiagnostic({code:'28P01',message:'private-password'})).toContain('authentication failed');
 expect(databaseDiagnostic({code:'MIGRATION_CHECKSUM'})).toContain('add a new migration');
 expect(databaseDiagnostic({code:'42P07'})).toContain('do not drop');
});
