import { test,expect } from '@playwright/test';
import { mockPlan } from '../fixtures/live-plan';
import { rational as r } from '../../src/domain/math';
import { normalizeWav,prepareBeatTimeline } from '../../src/domain/speech';
// One-second silent PCM per beat: explicit fixture, never synthetic provider output.
const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
const tone=normalizeWav(wav);
const id='b'.repeat(64),plan=mockPlan({a:r(5),b:r(7),c:r(32)},id);
const prepared=prepareBeatTimeline(plan,plan.scenes.map(scene=>({segmentId:scene.narration[0].id,text:scene.narration[0].text,speech:{audio_base64:Buffer.from(tone.bytes).toString('base64'),durationSeconds:tone.durationSeconds,format:'wav'}})));
const manifest={plan:prepared.plan,scenes:prepared.scenes,audio:{src:`/api/lessons/${id}/audio`,duration:prepared.duration,clips:prepared.scenes.map((s,i)=>({src:`/api/lessons/${id}/clips/${i}`,start:s.start,end:s.end})),provenance:'Mocked measured PCM clips; no real provider calls.'}};
test('measured clip transitions, buffered pause and backward seeking',async({page})=>{
 let delayed=true,release!:()=>void;
 const gate=new Promise<void>(r=>{release=r;});
 await page.route('**/api/lessons',route=>route.fulfill({json:{id,stage:'ready',completed:16,total:16,manifest}}));
 await page.route(`**/api/lessons/${id}/clips/*`,async route=>{
  if(delayed&&route.request().url().endsWith('/1'))await gate;
  const bytes=Buffer.from(tone.bytes),range=route.request().headers()['range'];
  const match=range&&/^bytes=(\d+)-(\d*)$/.exec(range);
  const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;
  await route.fulfill({status:match?206:200,contentType:'audio/wav',body:bytes.subarray(start,end+1),headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(match?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})}});
 });
 await page.goto('/');await page.getByRole('textbox',{name:'Your mathematics question'}).fill('5x + 7 = 32');
 await page.getByRole('button',{name:'Generate lesson',exact:true}).click();
 const slider=page.getByRole('slider',{name:'Lesson position'});
 await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await expect.poll(async()=>Number(await slider.inputValue())).toBeGreaterThan(0);
 await expect(page.getByText('Buffering…',{exact:true})).toBeVisible({timeout:10000});
 // The second clip is deliberately held: global time freezes at its measured start.
 await expect.poll(async()=>Number(await slider.inputValue())).toBeCloseTo(tone.durationSeconds,2);
 await page.getByRole('button',{name:'Pause',exact:true}).click();delayed=false;release();
 await expect(page.getByText('Buffering…',{exact:true})).toHaveCount(0);
 expect(await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await expect.poll(async()=>Number(await slider.inputValue())).toBeGreaterThan(tone.durationSeconds+.05);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 await slider.fill(String(manifest.scenes[11].start+.1));
 await expect(page.locator('[data-element="answer"]')).toBeAttached();
 await slider.fill('.03');
 await expect(page.locator('[data-element="answer"]')).toHaveCount(0);
 await expect.poll(()=>page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeCloseTo(.03,2);
 const saved=Number(await slider.inputValue());await page.waitForTimeout(200);expect(Number(await slider.inputValue())).toBeCloseTo(saved,2);
});
