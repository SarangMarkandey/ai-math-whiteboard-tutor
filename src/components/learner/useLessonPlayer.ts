"use client";
import { useEffect, useRef, useState } from 'react';
import type { PreparedLesson } from '../../domain/lesson';
import { AudioTransport, type TransportState } from '../../domain/audio-transport';
export function useLessonPlayer(lesson:PreparedLesson){
 const audio=useRef<HTMLAudioElement>(null),transport=useRef<AudioTransport|null>(null);
 const [state,setState]=useState<TransportState>({time:0,ready:false,playing:false,buffering:false,error:''});
 const [muted,setMuted]=useState(false),[reduced,setReduced]=useState(false);
 useEffect(()=>{
  const player=new AudioTransport(audio.current!,lesson,setState);transport.current=player;
  const m=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(m.matches);
  change();m.addEventListener('change',change);
  return()=>{player.dispose();transport.current=null;m.removeEventListener('change',change);};
 },[lesson]);
 const pause=()=>transport.current?.pause()??state.time;
 const play=()=>transport.current?.play();
 return {...state,audio,muted,reduced,pause,play,
  seek:(t:number)=>transport.current?.seek(t),
  toggle:()=>state.playing?pause():play(),
  mute:()=>{if(audio.current)audio.current.muted=!muted;setMuted(!muted);},
 };
}
export type Player=ReturnType<typeof useLessonPlayer>;
