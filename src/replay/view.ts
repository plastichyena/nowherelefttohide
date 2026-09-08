import { BOARD_ASSET_REGISTRY, resolveBoardAssetUrl } from '../ui/boardAssets';
import { ReplayPackage, ReplayZip } from './package';
import { roadEdges } from '../core/roads';
import { hexKey } from '../core/hex';
import type { SessionPublicDocument } from '../session/types';
import type { Locale } from '../ui/i18n';

export const commentDuration = (comment: string): number => comment ? Math.min(8, Math.max(3, Math.ceil(Array.from(comment).length / 20))) * 1000 : 0;

/** A read-only public-document viewer. It has no GameEngine or persistence access. */
export function showReplay(root: HTMLElement, locale: Locale, exit: () => void): void {
  const ja = locale === 'ja';
  root.className = 'app-shell replay-screen';
  root.innerHTML = `<main class="replay-view"><header><h1>${ja ? 'AIリプレイ観戦' : 'Watch AI replay'}</h1><button data-replay="exit">${ja ? 'タイトルへ' : 'Title'}</button></header><div class="replay-file"><label>${ja ? '公開Artifact ZIPを選択' : 'Choose public Artifact ZIP'} <input type="file" accept=".zip,application/zip" data-replay="file"></label><button data-replay="cancel">${ja ? '読込中止' : 'Cancel loading'}</button><p role="status" data-replay="status"></p></div><canvas data-replay="board" aria-label="${ja ? 'AIに公開された盤面' : 'Board visible to AI'}"></canvas><nav aria-label="Replay"><button data-replay="prev">◀</button><button data-replay="play">${ja ? '再生' : 'Play'}</button><button data-replay="next">▶</button><label>${ja ? '速度' : 'Speed'} <select data-replay="speed"><option value="0.5">0.5×</option><option selected value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label><label>Turn <input data-replay="turn" type="number" min="1" value="1"></label><button data-replay="seek">${ja ? '移動' : 'Go'}</button><button data-replay="fit">${ja ? '全体' : 'Fit'}</button></nav><p data-replay="position"></p><section class="replay-comment"><h2>${ja ? 'AIの判断コメント' : 'AI decision comment'}</h2><p data-replay="comment"></p><small>${ja ? 'AIのコメントには誤認が含まれる場合があります。' : 'AI comments may contain mistaken assumptions.'}</small></section><section class="replay-log"><h2>${ja ? 'ゲームの結果ログ' : 'Game result log'}</h2><p data-replay="action"></p><small>${ja ? '直近100判断のログを保持します。過去の判断はターン移動で再表示できます。' : 'Keeps logs for 100 Decisions. Seek a turn to revisit older Decisions.'}</small><ol data-replay="events"></ol></section></main>`;
  const get = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-replay="${name}"]`)!;
  const status = get('status'), canvas = get<HTMLCanvasElement>('board');
  get<HTMLButtonElement>('play').disabled=true;get<HTMLButtonElement>('cancel').disabled=true;
  let abort = new AbortController(), pkg: ReplayPackage | null = null, frame: Awaited<ReturnType<ReplayPackage['decision']>> | null = null;
  let decision = 0, resultPhase = false, playing = false, remaining = 0, last = performance.now(), speed = 1, busy = false, generation = 0, disposed = false;
  let zoom = 2.5, panX = 0, panY = 0, current: SessionPublicDocument | null = null;
  const setStatus = (s: string) => { status.textContent = s; };
  const pause = () => { playing = false; get('play').textContent = ja ? '再生' : 'Play'; };
  const point = (q: number, r: number) => ({ x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r });
  const images = new Map<string, HTMLImageElement>();
  const sprite = (ctx: CanvasRenderingContext2D, path: string, x: number, y: number, size: number) => {
    let img = images.get(path);
    if (!img) { img = new Image(); img.onload = () => { if (!disposed) draw(); }; img.src = resolveBoardAssetUrl(path); images.set(path, img); }
    if (img.complete && img.naturalWidth) { ctx.drawImage(img, x-size/2,y-size/2,size,size); return true; }
    return false;
  };
  const draw = () => {
    if (!pkg || !current) return;
    const rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1,Math.round(rect.width*dpr)); canvas.height=Math.max(1,Math.round(rect.height*dpr));
    const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr);ctx.fillStyle='#121b19';ctx.fillRect(0,0,rect.width,rect.height);
    const fit=Math.min(rect.width/135,rect.height/82),scale=fit*zoom;
    const transform=(q:number,r:number)=>{const p=point(q,r);return{x:rect.width/2+(p.x-65)*scale+panX,y:rect.height/2+(p.y-38)*scale+panY};};
    const visible=new Set(current.observation.visibleTileKeys);
    for(const tile of pkg.map.tiles){const p=transform(tile.q,tile.r);if(p.x < -scale || p.x>rect.width+scale || p.y < -scale || p.y>rect.height+scale)continue;ctx.beginPath();for(let k=0;k<6;k++){const angle=(60*k-30)*Math.PI/180;const x=p.x+Math.cos(angle)*scale,y=p.y+Math.sin(angle)*scale;if(k===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.closePath();ctx.fillStyle=tile.terrain==='forest'?'#355447':tile.terrain==='mountain'?'#5d615d':tile.terrain==='water'?'#345569':'#6b7053';ctx.globalAlpha=visible.has(hexKey(tile))?1:.35;ctx.fill();ctx.globalAlpha=1;}
    for(const e of roadEdges(pkg.map.roads!)){const a=transform(e.a.q,e.a.r),b=transform(e.b.q,e.b.r);ctx.strokeStyle=e.role==='trunk'?'#b5a98d':e.role==='collector'?'#968e7b':'#777467';ctx.lineWidth=Math.max(.5,scale*(e.role==='trunk'?.28:e.role==='collector'?.16:.09));ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    const text=(label:string,q:number,r:number,color:string,path?:string)=>{const p=transform(q,r);ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,scale*.5),0,Math.PI*2);ctx.fill();if(path&&zoom>=1.5)sprite(ctx,path,p.x,p.y,Math.max(14,scale*2));if(zoom>=3){ctx.font=`${Math.max(10,Math.min(16,scale))}px sans-serif`;ctx.fillStyle='#fff';ctx.fillText(label,p.x+scale*.7,p.y);}};
    for(const f of current.observation.facilities)text(`${f.type} ${f.healthyPopulation}`,f.position.q,f.position.r,f.owner==='player'?'#dfce85':'#8d8b80',BOARD_ASSET_REGISTRY.facilities[f.type]);
    for(const c of current.observation.checkpoints)text(`CP ${c.waiting+c.screening+c.approved}`,c.position.q,c.position.r,'#d7a14d',BOARD_ASSET_REGISTRY.facilities.checkpoint);
    for(const u of current.observation.units)text(`${u.type} ${u.hp}`,u.position.q,u.position.r,'#67d5c7',BOARD_ASSET_REGISTRY.units[u.type]);
    for(const u of current.observation.zombies)if(visible.has(hexKey(u.position)))text(`${u.type} ${u.hp}`,u.position.q,u.position.r,'#e8796b',BOARD_ASSET_REGISTRY.units[u.type]);
    if(resultPhase && frame)for(const e of frame.record.events){const p=e.payload;if(typeof p.q==='number'&&typeof p.r==='number'){const at=transform(p.q,p.r);ctx.strokeStyle='#ffda73';ctx.lineWidth=2;ctx.beginPath();ctx.arc(at.x,at.y,Math.max(5,scale),0,Math.PI*2);ctx.stroke();}}
  };
  const logs = new Map<number, string[]>();
  const render = () => {
    if(!frame||!pkg)return;
    current=resultPhase?frame.after:frame.before;
    get('position').textContent=`Turn ${current.observation.turn} · Decision ${decision+1}/${pkg.index.length} · ${resultPhase?(ja?'行動結果':'Result'):(ja?'判断直前':'Before decision')}`;
    get('comment').textContent=frame.record.decisionSummary || (ja?'コメントなし':'No comment');
    get('action').textContent=`${JSON.stringify(frame.record.inputAction)}${resultPhase?` — ${frame.record.accepted?(ja?'実行済み':'Executed'):`${ja?'拒否':'Rejected'}: ${frame.record.error?.message ?? ''}`}`:''}`;
    if(resultPhase)logs.set(decision,[`${ja?'判断':'Decision'} ${decision+1}: ${JSON.stringify(frame.record.inputAction)}`, ...frame.record.events.map(e=>`Turn ${e.turn} · ${e.type} ${JSON.stringify(e.payload)}`), ...(frame.record.error?[frame.record.error.message]:[])]);
    // Retain a bounded log window; older Decisions remain reachable through the seek controls.
    while(logs.size>100)logs.delete(logs.keys().next().value!);
    const ol=get('events');ol.replaceChildren();for(const [,lines] of [...logs].sort(([a],[b])=>a-b))for(const line of lines){const li=document.createElement('li');li.textContent=line;ol.append(li);}draw();
  };
  const seek = async (index:number) => {
    if(!pkg||index<0||index>=pkg.index.length)return;pause();busy=true;get<HTMLButtonElement>('play').disabled=true;const token=++generation;
    try{const loaded=await pkg.decision(index);if(token!==generation||disposed)return;decision=index;frame=loaded;resultPhase=false;remaining=commentDuration(loaded.record.decisionSummary ?? '');setStatus('');render();}catch(e){setStatus(String(e));}finally{if(token===generation){busy=false;get<HTMLButtonElement>('play').disabled=!frame;get<HTMLButtonElement>('cancel').disabled=true;}}
  };
  get<HTMLInputElement>('file').onchange=async()=>{
    const file=get<HTMLInputElement>('file').files?.[0];if(!file)return;
    abort.abort();abort=new AbortController();pause();frame=null;pkg=null;current=null;canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);logs.clear();busy=true;get<HTMLButtonElement>('play').disabled=true;get<HTMLButtonElement>('cancel').disabled=false;const token=++generation;setStatus(ja?'ZIPと公開記録を検証中…':'Validating ZIP and public records…');
    try{const loaded=await new ReplayPackage(new ReplayZip(file,abort.signal)).open();if(token!==generation||disposed)return;pkg=loaded;busy=false;if(pkg.index.length)await seek(0);else setStatus(ja?'判断記録がありません。':'No Decisions recorded.');}catch(e){if(token===generation)setStatus(`${ja?'読込できません':'Unable to load'}: ${e instanceof Error?e.message:String(e)}`);}finally{if(token===generation){busy=false;get<HTMLButtonElement>('play').disabled=!frame;get<HTMLButtonElement>('cancel').disabled=true;}}
  };
  get('cancel').onclick=()=>{if(!busy)return;get<HTMLButtonElement>('cancel').disabled=true;abort.abort();generation++;busy=false;pause();setStatus(ja?'読込を中止しました。ZIPを再選択できます。':'Loading cancelled. Select another ZIP.');};
  get('prev').onclick=()=>{void seek(decision-1);};get('next').onclick=()=>{void seek(decision+1);};
  get('seek').onclick=()=>{if(!pkg)return;const turn=Number(get<HTMLInputElement>('turn').value),i=pkg.index.findIndex(e=>e.turn===turn);if(i<0){pause();setStatus(ja?'指定ターンの判断記録がありません。':'No Decision recorded for this turn.');}else void seek(i);};
  get('play').onclick=()=>{if(!frame||busy)return;if(playing){pause();return;}if(resultPhase&&pkg&&decision===pkg.index.length-1&&remaining<=0)return;playing=true;last=performance.now();get('play').textContent=ja?'一時停止':'Pause';};
  get<HTMLSelectElement>('speed').onchange=()=>{speed=Number(get<HTMLSelectElement>('speed').value);};
  get('fit').onclick=()=>{zoom=1;panX=panY=0;draw();};
  const pointers=new Map<number,{x:number;y:number}>();canvas.style.touchAction='none';
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});};
  canvas.onpointermove=e=>{const old=pointers.get(e.pointerId);if(!old)return;const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)?.[1];if(other){const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(before>0)zoom=Math.max(.5,Math.min(12,zoom*after/before));}else{panX+=e.clientX-old.x;panY+=e.clientY-old.y;}pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});draw();};
  canvas.onpointerup=canvas.onpointercancel=e=>{pointers.delete(e.pointerId);};canvas.onwheel=e=>{e.preventDefault();zoom=Math.max(.5,Math.min(12,zoom*Math.exp(-e.deltaY*.001)));draw();};
  const resize=new ResizeObserver(draw);resize.observe(canvas);
  let raf=0;
  const animate=async(now:number)=>{if(disposed)return;const elapsed=now-last;last=now;
    if(playing&&!busy&&frame&&pkg){remaining-=elapsed*speed;if(remaining<=0){if(!resultPhase){resultPhase=true;remaining=1000;render();}else if(decision+1<pkg.index.length){const wasPlaying=playing;await seek(decision+1);if(wasPlaying&&!disposed){playing=true;get('play').textContent=ja?'一時停止':'Pause';last=performance.now();}}else pause();}}
    raf=requestAnimationFrame(t=>{void animate(t);});};raf=requestAnimationFrame(t=>{void animate(t);});
  get('exit').onclick=()=>{disposed=true;generation++;abort.abort();cancelAnimationFrame(raf);resize.disconnect();pause();exit();};
}
