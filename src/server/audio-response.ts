import 'server-only';
export function audioResponse(b:Buffer,range:string|null){
 const headers={'Content-Type':'audio/wav','Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'};
 const invalid=()=>new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${b.length}`}});
 if(range){
  const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||!m[1]&&!m[2])return invalid();
  const start=m[1]?Number(m[1]):Math.max(0,b.length-Number(m[2]));
  const end=m[1]&&m[2]?Math.min(Number(m[2]),b.length-1):b.length-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=b.length)return invalid();
  const slice=b.subarray(start,end+1);
  return new Response(Uint8Array.from(slice),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${b.length}`,'Content-Length':String(slice.length)}});
 }
 return new Response(Uint8Array.from(b),{headers:{...headers,'Content-Length':String(b.length)}});
}
