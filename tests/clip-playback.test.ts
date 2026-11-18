import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { AudioTransport,locateClip,type TransportState } from '../src/domain/audio-transport';
import { example } from '../src/content/example';
import { audioResponse } from '../src/server/audio-response';
const id='a'.repeat(64);
const clips=[0,1,2].map(i=>({src:`/api/lessons/${id}/clips/${i}`,start:i,end:i+1}));
const lesson={...example,audio:{...example.audio,clips,duration:3}};
class Audio extends EventTarget{
 src='';currentTime=0;duration=1;paused=true;ended=false;error=null;
 loads=0;plays=0;
 load(){this.loads++;this.currentTime=0;this.ended=false;}
 async play(){this.plays++;this.paused=false;this.ended=false;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));}
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
 removeAttribute(name:string){if(name==='src')this.src='';}
 metadata(){this.dispatchEvent(new Event('loadedmetadata'));}
 finish(){this.currentTime=this.duration;this.ended=true;this.paused=true;this.dispatchEvent(new Event('ended'));}
}
beforeEach(()=>{vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());});
afterEach(()=>vi.unstubAllGlobals());
it('uses exact clip boundaries and measured global offsets',()=>{
 expect(locateClip(clips,1)).toEqual({index:1,offset:0,time:1});
 expect(locateClip(clips,3)).toEqual({index:2,offset:1,time:3});
 expect(locateClip(clips,-5)).toEqual({index:0,offset:0,time:0});
});
it('plays clips without overlap, preserves the clock while buffering and respects pause',async()=>{
 const a=new Audio();let state!:TransportState;
 const transport=new AudioTransport(a as unknown as HTMLAudioElement,lesson,s=>{state=s;});
 a.metadata();expect(a.plays).toBe(0);transport.play();await Promise.resolve();
 a.currentTime=.45;a.dispatchEvent(new Event('timeupdate'));expect(state.time).toBe(.45);
 expect(transport.pause()).toBe(.45);expect(a.paused).toBe(true);
 transport.play();a.finish();expect(a.src).toBe(clips[1].src);expect(state.time).toBe(1);expect(state.buffering).toBe(true);
 const calls=a.plays;transport.pause();a.metadata();expect(a.plays).toBe(calls);expect(state.time).toBe(1);
 transport.play();a.currentTime=.4;a.dispatchEvent(new Event('timeupdate'));expect(state.time).toBe(1.4);
 a.finish();a.metadata();a.finish();expect(state.time).toBe(3);expect(state.playing).toBe(false);
 transport.play();expect(a.src).toBe(clips[0].src);a.metadata();expect(state.time).toBe(0);
 transport.dispose();expect(a.src).toBe('');expect(a.paused).toBe(true);
});
it('backward seeking restores a partial position and freezes it while paused',()=>{
 const a=new Audio();let state!:TransportState;
 const t=new AudioTransport(a as unknown as HTMLAudioElement,lesson,s=>{state=s;});a.metadata();
 t.seek(2.6);expect(state.time).toBe(2.6);expect(state.buffering).toBe(true);a.metadata();expect(a.currentTime).toBeCloseTo(.6);
 t.seek(.35);expect(a.src).toBe(clips[0].src);a.metadata();expect(state.time).toBe(.35);expect(t.pause()).toBe(.35);
 expect(state.playing).toBe(false);expect(a.paused).toBe(true);t.dispose();
});
it('rejects mismatched stored durations and requires a user retry',()=>{
 const a=new Audio();let state!:TransportState;
 const t=new AudioTransport(a as unknown as HTMLAudioElement,lesson,s=>{state=s;});a.duration=9;a.metadata();
 expect(state.error).toContain('duration');expect(a.plays).toBe(0);t.play();expect(a.loads).toBe(2);t.dispose();
});
it('delivers bounded clips and correct partial byte responses',async()=>{
 const b=Buffer.from('0123456789');
 const response=audioResponse(b,'bytes=2-5');expect(response.status).toBe(206);expect(await response.text()).toBe('2345');
 expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
 expect(await audioResponse(b,'bytes=-3').text()).toBe('789');
 expect(audioResponse(b,'bytes=50-60').status).toBe(416);
 expect(audioResponse(b,'bytes=-').status).toBe(416);
});
it('replays a completed single-file saved lesson on an explicit Play',()=>{
 const a=new Audio();const one={...example,audio:{src:'/saved.wav',duration:1,provenance:'fixture'}};
 const t=new AudioTransport(a as unknown as HTMLAudioElement,one,()=>{});a.metadata();t.play();a.finish();
 const calls=a.plays;t.play();expect(a.currentTime).toBe(0);expect(a.plays).toBe(calls+1);t.dispose();
});
