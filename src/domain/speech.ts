import { z } from "zod";
import { type LessonPlan } from "./lesson";
export const previewRequestSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(179)
      .refine((t) => !!t.trim(), "Enter a short teaching beat"),
  })
  .strict();
/** Streaming WAV writers may leave RIFF/data sizes unknown until EOF.
 * Only explicit unknown-size markers are repaired; known truncated lengths fail.
 * The complete HTTP body must be available before calling this function. */
export function normalizeWav(input:Uint8Array){
 const bytes=Uint8Array.from(input),v=new DataView(bytes.buffer);
 const tag=(o:number)=>String.fromCharCode(...bytes.slice(o,o+4));
 const unknown=(n:number)=>n===0||n===0xffffffff||n===0x7fffffff;
 if(bytes.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw new Error('Expected a RIFF/WAVE audio container');
 const declared=v.getUint32(4,true),streaming=unknown(declared);
 if(!streaming&&declared+8!==bytes.length)throw new Error('RIFF length does not match the received body');
 let sampleRate=0,blockAlign=0,dataBytes=0,formatSeen=false,dataSeen=false;
 for(let o=12;o<bytes.length;){
  if(o+8>bytes.length)throw new Error('Incomplete WAV chunk header');
  let n=v.getUint32(o+4,true);const start=o+8;
  if(tag(o)==='data'&&unknown(n)&&streaming){n=bytes.length-start;v.setUint32(o+4,n,true);}
  if(start+n>bytes.length)throw new Error('WAV chunk extends past the received body');
  if(tag(o)==='fmt '){
   if(formatSeen||n<16)throw new Error('Missing or duplicate WAV format');formatSeen=true;
   let format=v.getUint16(start,true);
   if(format===65534){if(n<40||v.getUint16(start+16,true)<22)throw new Error('Incomplete extensible WAV format');
    const guidTail=[0,0,0,0,16,0,128,0,0,170,0,56,155,113];
    if(!guidTail.every((x,i)=>bytes[start+26+i]===x))throw new Error('Unsupported WAV subformat');
    format=v.getUint16(start+24,true);
   }
   const channels=v.getUint16(start+2,true),bits=v.getUint16(start+14,true);
   sampleRate=v.getUint32(start+4,true);blockAlign=v.getUint16(start+12,true);
   if(![1,3].includes(format)||channels<1||channels>8||sampleRate<8000||sampleRate>192000||!(format===3?[32,64]:[8,16,24,32]).includes(bits)||blockAlign!==channels*bits/8||v.getUint32(start+8,true)!==sampleRate*blockAlign)throw new Error('Unsupported WAV sample format or rate');
  }
  if(tag(o)==='data'){if(!formatSeen||dataSeen)throw new Error('WAV requires one data chunk after its format');dataSeen=true;dataBytes=n;}
  o=start+n+(n%2);
  if(o>bytes.length)throw new Error('Missing WAV chunk padding');
 }
 if(!formatSeen||!dataSeen||!dataBytes||dataBytes%blockAlign)throw new Error('WAV contains no complete audio sample frames');
 v.setUint32(4,bytes.length-8,true);
 return {bytes,durationSeconds:dataBytes/blockAlign/sampleRate};
}
/** Measure actual frames, never text length or declared streaming size. */
export function wavDuration(bytes:Uint8Array){return normalizeWav(bytes).durationSeconds;}
export const speechSchema = z.object({
  audio_base64: z.string().min(1),
  durationSeconds: z.number().positive().finite(),
  format: z.literal("wav"),
});
export type Speech = z.infer<typeof speechSchema>;
export function captionPhrases(s: Speech, text: string) {
  return [{ id: "preview-beat", text, start: 0, end: s.durationSeconds }];
}
export type BeatClip = { segmentId: string; text: string; speech: Speech };
/** Each teaching beat owns a complete clip; no word/character timestamps are inferred. */
export function prepareBeatTimeline(plan: LessonPlan, clips: BeatClip[]) {
  const used = new Set<string>();
  if (clips.length !== plan.scenes.length)
    throw new Error("One clip per teaching beat is required");
  let cursor = 0;
  const scenes = plan.scenes.map((scene) => {
    if (scene.narration.length !== 1)
      throw new Error("Split narration into one phrase per beat");
    const segment = scene.narration[0],
      clip = clips.find((c) => c.segmentId === segment.id);
    if (!clip || used.has(clip.segmentId) || clip.text !== segment.text)
      throw new Error("Missing, duplicate or mismatched beat clip");
    used.add(clip.segmentId);
    speechSchema.parse(clip.speech);
    const measured = wavDuration(
      Uint8Array.from(atob(clip.speech.audio_base64), (c) => c.charCodeAt(0)),
    );
    if (measured !== clip.speech.durationSeconds)
      throw new Error("Clip duration does not match samples");
    const start = cursor,
      end = start + clip.speech.durationSeconds;
    cursor = end;
    return {
      sceneId: scene.id,
      start,
      end,
      cues: scene.actions.map((action) => {const delay=Math.min(action.delay??0,(end-start)*.8);return {at:start+delay,action:{...action,duration:Math.min(action.duration,end-start-delay)}};}),
      captions: [{ start, end, text: segment.text }],
    };
  });
  // Returned clip offsets also support mapping a global seek to an individual clip's audio position.
  const preparedPlan = {
    ...plan,
    scenes: plan.scenes.map((s, i) => ({
      ...s,
      actions: scenes[i].cues.map((c) => c.action),
    })),
  };
  return {
    plan: preparedPlan,
    scenes,
    duration: cursor,
    clips: plan.scenes.map((s, i) => ({
      segmentId: s.narration[0].id,
      start: scenes[i].start,
      end: scenes[i].end,
      speech: clips.find((c) => c.segmentId === s.narration[0].id)!.speech,
    })),
  };
}
export function beatPosition(
  timeline: ReturnType<typeof prepareBeatTimeline>,
  time: number,
) {
  const t = Math.max(0, Math.min(time, timeline.duration));
  const index = timeline.clips.findIndex((c) => t < c.end);
  const i = index < 0 ? timeline.clips.length - 1 : index;
  return { index: i, localTime: t - timeline.clips[i].start };
}
