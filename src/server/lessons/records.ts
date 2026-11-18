import 'server-only';
import { LESSON_PIPELINE_VERSION, NARRATION_LIMIT } from '../../domain/teaching-contract';
import { z } from 'zod';
import { equationSchema, solve, equal } from '../../domain/math';
import { planSchema, timelineSchema } from '../../domain/lesson';
import { speechSchema, normalizeWav } from '../../domain/speech';
export const jobSchema = z.object({
 id:z.string().regex(/^[a-f0-9]{64}$/),version:z.literal(1),topic:z.string().min(3).max(400),
 config:z.object({lessonModel:z.string().max(100),ttsModel:z.string().max(100),voice:z.string().max(100),promptVersion:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(LESSON_PIPELINE_VERSION)]),level:z.literal('beginner')}),
 stage:z.enum(['interpret','plan','narration','assemble','ready','clarify','unsupported']),
 equation:equationSchema.optional(),plan:planSchema.optional(),outline:z.array(z.string().max(90)).max(6).optional(),
 clips:z.array(z.object({segmentId:z.string().max(80),text:z.string().max(NARRATION_LIMIT),speech:speechSchema})).max(16),
 manifest:timelineSchema.optional(),audio:z.string().optional(),message:z.string().max(1000).optional(),retryAt:z.number().optional(),attempts:z.number().int().min(0).max(10),
}).strict().superRefine((j,c)=>{
 const bad=(message:string)=>c.addIssue({code:'custom',message});
 if(j.plan && j.plan.id!==j.id)bad('Plan reference mismatch');
 if(j.stage==='ready'&&!j.manifest)bad('Ready manifest missing');
 if(['narration','assemble','ready'].includes(j.stage)&&!j.plan)bad('Plan missing');
 if(j.manifest&&j.manifest.plan.id!==j.id)bad('Manifest reference mismatch');
 j.manifest?.audio.clips?.forEach((clip,i)=>{if(clip.src!==`/api/lessons/${j.id}/clips/${i}`)bad('Playback clip reference mismatch');});
 if(j.plan){
  const practice=solve(j.plan.practice.equation);
  if(practice.kind!=='unique'||!equal(practice.solution,j.plan.practice.expected))bad('Invalid practice mathematics');
  if(j.equation&&JSON.stringify(j.equation)!==JSON.stringify(j.plan.equation))bad('Equation reference mismatch');
 }

 j.clips.forEach((clip,i)=>{
  const n=j.plan?.scenes[i]?.narration[0];
  if(!n||n.id!==clip.segmentId||n.text!==clip.text)bad('Clip does not match plan');
  try{if(normalizeWav(Buffer.from(clip.speech.audio_base64,'base64')).durationSeconds!==clip.speech.durationSeconds)bad('Invalid measured duration');}catch{bad('Invalid stored audio');}
 });
});
