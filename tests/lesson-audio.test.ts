import {it,expect,vi} from 'vitest';
vi.mock('../src/server/lessons/runtime',()=>({guard:()=>{},liveService:()=>({get:async()=>({audio:Buffer.from('0123456789').toString('base64')})})}));
import {GET} from '../src/app/api/lessons/[id]/audio/route';
it('serves byte ranges for deterministic seeking',async()=>{const r=await GET(new Request('http://localhost/audio',{headers:{range:'bytes=2-5'}}),{params:Promise.resolve({id:'test'})});expect(r.status).toBe(206);expect(r.headers.get('Content-Range')).toBe('bytes 2-5/10');expect(await r.text()).toBe('2345');});
it('rejects unsatisfiable ranges',async()=>{const r=await GET(new Request('http://localhost/audio',{headers:{range:'bytes=99-100'}}),{params:Promise.resolve({id:'test'})});expect(r.status).toBe(416);});
it('supports suffix ranges',async()=>{const r=await GET(new Request('http://localhost/audio',{headers:{range:'bytes=-3'}}),{params:Promise.resolve({id:'test'})});expect(await r.text()).toBe('789');});
