import {test,expect} from '@playwright/test';
import { completeNarrationResponse,compileTeaching,roles } from '../../src/domain/live';
import { specificEquation } from '../../src/domain/linear-input';
import { rational as r } from '../../src/domain/math';
import { normalizeWav,prepareBeatTimeline } from '../../src/domain/speech';
const fixtures=[
 ['Help me solve -20x + 10 = 30.','x=-1'],
 ['(1/2)x + 3 = 7','x=8'],
 ['3/4x - 1/2 = 1','x=2'],
 ['2x + 1/3 = 7/3','x=1'],
 ['-2/3x + 1/2 = 5/6','x=\\frac{-1}{2}'],
] as const;
const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
const measured=normalizeWav(wav);
for(const [index,[request,answer]] of fixtures.entries()){
 test(`exact rational working and backward seeking: ${request}`,async({page},info)=>{
  const id=(index+1).toString().repeat(64),equation=specificEquation(request)!;
  const plan=compileTeaching(completeNarrationResponse({objective:'Understand why equal changes preserve equality.',outline:['Read the equation','Preserve equality','Check substitution'],explanations:Object.fromEntries(roles.map(role=>[role,'Keep one term in view while the two sides stay balanced.'])),practice:{a:r(3,4),b:r(1,2),c:r(2)}},equation),equation,id);
  const prepared=prepareBeatTimeline(plan,plan.scenes.map(scene=>({segmentId:scene.narration[0].id,text:scene.narration[0].text,speech:{audio_base64:wav.toString('base64'),format:'wav',durationSeconds:measured.durationSeconds}})));
  const manifest={plan:prepared.plan,scenes:prepared.scenes,audio:{src:`/api/lessons/${id}/audio`,duration:prepared.duration,clips:prepared.scenes.map((s,i)=>({src:`/api/lessons/${id}/clips/${i}`,start:s.start,end:s.end})),provenance:'Mocked AI lesson data and local silent PCM fixture. No provider calls.'}};
  await page.route('**/api/lessons',route=>route.fulfill({json:{id,stage:'ready',completed:16,total:16,manifest}}));
  await page.route(`**/api/lessons/${id}/clips/*`,route=>{
   const range=route.request().headers()['range'],match=range&&/^bytes=(\d+)-(\d*)$/.exec(range);
   const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),wav.length-1):wav.length-1;
   return route.fulfill({status:match?206:200,contentType:'audio/wav',body:wav.subarray(start,end+1),headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(match?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})}});
  });
  await page.goto('/');await page.getByRole('textbox',{name:'Your mathematics question'}).fill(request);await page.getByRole('button',{name:'Generate lesson',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  const slider=page.getByRole('slider',{name:'Lesson position'});
  await slider.fill('6.5');
  const stroke=page.locator('[data-element="cancel-b"] path');
  await expect.poll(async()=>Number(await stroke.getAttribute('stroke-dashoffset'))).toBeCloseTo(.5,2);
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect.poll(async()=>Number(await stroke.getAttribute('stroke-dashoffset'))).toBeLessThan(.45);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const frozen=await stroke.getAttribute('stroke-dashoffset');await page.waitForTimeout(100);expect(await stroke.getAttribute('stroke-dashoffset')).toBe(frozen);
  await slider.fill('11.9');
  await expect(page.locator('[data-element="answer"] annotation')).toHaveText(answer);
  await expect(page.locator('[data-element="original-x"]')).toBeAttached();
  await slider.fill('14.9');await expect(page.locator('[data-element="verified"]')).toBeAttached();
  if(index===4)await page.screenshot({path:`test-results/rational-${info.project.name}.png`,fullPage:true});
  await slider.fill('4.3');await expect(page.locator('[data-element="answer"]')).toHaveCount(0);await expect(page.locator('[data-element="cancel-b"]')).toHaveCount(0);
  await slider.fill(String(prepared.duration));await page.getByRole('textbox',{name:'x =',exact:true}).fill('4/2');await page.getByRole('button',{name:'Check answer'}).click();
  await expect(page.getByRole('status').filter({hasText:'Correct'})).toBeVisible();
 });
}
