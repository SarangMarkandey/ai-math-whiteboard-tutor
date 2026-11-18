import type { PreparedLesson } from './lesson';
export type PlaybackClip={src:string;start:number;end:number};
export function playbackClips(lesson:PreparedLesson):PlaybackClip[]{
 return lesson.audio.clips??[{src:lesson.audio.src,start:0,end:lesson.audio.duration}];
}
export function locateClip(clips:PlaybackClip[],time:number){
 const t=Math.max(0,Math.min(time,clips.at(-1)!.end));
 const index=Math.max(0,clips.findIndex((clip,i)=>t<clip.end||i===clips.length-1));
 return {index,offset:Math.max(0,t-clips[index].start),time:t};
}
export type TransportState={time:number;ready:boolean;playing:boolean;buffering:boolean;error:string};
/** One active audio element. Global board time is clip.start + actual currentTime.
 * Only a deliberate seek is held while metadata buffers; no clock simulates speech. */
export class AudioTransport {
 private clips:PlaybackClip[];
 private index=0;
 private pending:number|null=0;
 private intent=false;
 private frame=0;
 private disposed=false;
 private revision=0;
 private state:TransportState={time:0,ready:false,playing:false,buffering:true,error:''};
 private listeners:Record<string,()=>void>;
 constructor(private audio:HTMLAudioElement,private lesson:PreparedLesson,private changed:(s:TransportState)=>void){
  this.clips=playbackClips(lesson);
  this.listeners={
   loadedmetadata:()=>this.loaded(),
   play:()=>this.tick(),playing:()=>{this.emit({buffering:false});this.tick();},
   pause:()=>cancelAnimationFrame(this.frame),
   timeupdate:()=>this.sync(),seeked:()=>this.sync(),
   waiting:()=>this.emit({buffering:true}),canplay:()=>this.emit({buffering:false}),
   ended:()=>this.ended(),
   error:()=>{this.intent=false;this.emit({ready:true,playing:false,buffering:false,error:'Narration could not load. Your position is preserved. Retry Play or use the transcript.'});},
  };
  for(const [name,fn] of Object.entries(this.listeners))audio.addEventListener(name,fn);
  this.load(0,0);
 }
 private emit(update:Partial<TransportState>){if(!this.disposed){this.state={...this.state,...update};this.changed({...this.state});}}
 private sync(){
  if(this.pending!==null)return;
  const clip=this.clips[this.index];
  this.emit({time:Math.max(clip.start,Math.min(clip.end,clip.start+this.audio.currentTime))});
 }
 private tick(){
  cancelAnimationFrame(this.frame);this.sync();
  if(this.intent&&!this.disposed&&!this.audio.paused&&!this.audio.ended&&this.pending===null)
   this.frame=requestAnimationFrame(()=>this.tick());
 }
 private load(index:number,offset:number){
  ++this.revision;cancelAnimationFrame(this.frame);this.pending=offset;this.index=index;
  this.emit({time:this.clips[index].start+offset,buffering:true,error:'',playing:this.intent});
  this.audio.pause();this.audio.src=this.clips[index].src;this.audio.load();
 }
 private loaded(){
  const offset=this.pending;if(offset===null)return;
  const expected=this.clips[this.index].end-this.clips[this.index].start;
  if(this.lesson.audio.clips&&(!Number.isFinite(this.audio.duration)||Math.abs(this.audio.duration-expected)>.1)){
   this.intent=false;this.emit({ready:true,playing:false,buffering:false,error:'Stored audio duration does not match this lesson. Please reload the lesson.'});return;
  }
  this.audio.currentTime=Math.min(offset,expected);this.pending=null;
  this.emit({ready:true,buffering:false});this.sync();
  if(this.intent)void this.startAudio();
 }
 private async startAudio(){
  const revision=this.revision;
  try{await this.audio.play();if(this.intent)this.tick();}
  catch{if(revision===this.revision&&!this.disposed){this.intent=false;this.emit({playing:false,error:'Playback could not start. Press Play to continue from this position.'});}}
 }
 private ended(){
  if(!this.audio.ended)return;
  if(this.index+1<this.clips.length){this.load(this.index+1,0);return;}
  this.intent=false;cancelAnimationFrame(this.frame);
  this.emit({time:this.lesson.audio.duration,playing:false,buffering:false});
 }
 seek(time:number){
  const p=locateClip(this.clips,time);
  if(p.index!==this.index||this.pending!==null){this.load(p.index,p.offset);return;}
  this.audio.currentTime=p.offset;this.emit({time:p.time,error:''});
 }
 pause(){this.intent=false;cancelAnimationFrame(this.frame);this.audio.pause();this.sync();this.emit({playing:false});return this.state.time;}
 play(){
  const retry=!!this.state.error;
  this.intent=true;this.emit({playing:true,error:''});
  if(this.state.time>=this.lesson.audio.duration){this.seek(0);if(this.pending===null)void this.startAudio();return;}
  if(retry||this.audio.error){const p=locateClip(this.clips,this.state.time);this.load(p.index,p.offset);}
  else if(this.pending===null)void this.startAudio();
 }
 dispose(){
  this.disposed=true;this.intent=false;++this.revision;cancelAnimationFrame(this.frame);
  for(const [name,fn] of Object.entries(this.listeners))this.audio.removeEventListener(name,fn);
  this.audio.pause();this.audio.removeAttribute('src');this.audio.load();
 }
}
