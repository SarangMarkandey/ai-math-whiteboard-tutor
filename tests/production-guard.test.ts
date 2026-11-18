import { afterEach,it,expect,vi } from 'vitest';
import { guard } from '../src/server/lessons/runtime';
afterEach(()=>vi.unstubAllEnvs());
it('accepts the target Host behind Next internal URLs and rejects cross-origin posts',async()=>{
 vi.stubEnv('NODE_ENV','development');vi.stubEnv('DATABASE_URL','');
 await expect(guard(new Request('http://localhost:3000/api/lessons',{method:'POST',headers:{host:'demo.example','origin':'https://demo.example'}}))).resolves.toBeUndefined();
 await expect(guard(new Request('http://localhost:3000/api/lessons',{method:'POST',headers:{host:'demo.example','origin':'https://other.example'}}))).rejects.toMatchObject({code:'origin'});
});
it('keeps production guarded when durable configuration is absent',async()=>{
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('DATABASE_URL','');
 await expect(guard(new Request('https://demo.example/api/health'))).rejects.toMatchObject({code:'configuration',status:503});
});
