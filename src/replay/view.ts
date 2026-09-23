import { ARTILLERY_ASSETS, HELICOPTER_ASSETS } from '../ui/boardAssets';
import { PublicBoardRenderer, publicBoardFrame } from '../ui/publicBoard';
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
  root.innerHTML = `<main class="replay-view"><header><h1>${ja ? 'AIリプレイ観戦' : 'Watch AI replay'}</h1><button data-replay="exit">${ja ? 'タイトルへ' : 'Title'}</button></header><div class="replay-file"><label>${ja ? '公開Artifact ZIPを選択' : 'Choose public Artifact ZIP'} <input type="file" accept=".zip,application/zip" data-replay="file"></label><button data-replay="cancel">${ja ? '読込中止' : 'Cancel loading'}</button><p role="status" data-replay="status"></p></div><canvas data-replay="board" aria-label="${ja ? 'AIに公開された盤面' : 'Board visible to AI'}"></canvas><section class="public-board-details"></section><nav aria-label="Replay"><button data-replay="prev">◀</button><button data-replay="play">${ja ? '再生' : 'Play'}</button><button data-replay="next">▶</button><label>${ja ? '速度' : 'Speed'} <select data-replay="speed"><option value="0.5">0.5×</option><option selected value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label><label>Turn <input data-replay="turn" type="number" min="1" value="1"></label><button data-replay="seek">${ja ? '移動' : 'Go'}</button><button data-replay="fit">${ja ? '全体' : 'Fit'}</button></nav><p data-replay="position"></p><p data-replay="health"></p><section class="replay-comment"><h2>${ja ? 'AIの判断コメント' : 'AI decision comment'}</h2><p data-replay="comment"></p><small>${ja ? 'AIのコメントには誤認が含まれる場合があります。' : 'AI comments may contain mistaken assumptions.'}</small></section><section class="replay-log"><h2>${ja ? 'ゲームの結果ログ' : 'Game result log'}</h2><p data-replay="action"></p><small>${ja ? '直近100判断のログを保持します。過去の判断はターン移動で再表示できます。' : 'Keeps logs for 100 Decisions. Seek a turn to revisit older Decisions.'}</small><ol data-replay="events"></ol></section></main>`;
  const legend=document.createElement('details');
  const title=document.createElement('summary');title.textContent=ja?'盤面の凡例':'Board legend';legend.append(title);
  for(const [label,path,description] of [
    [ja?'水面':'Water',BOARD_ASSET_REGISTRY.terrain.water,ja?'青い水面のHex。':'Blue water Hex.'],
    [ja?'橋':'Bridge',BOARD_ASSET_REGISTRY.overlays.bridge,ja?'水面を横切る道路。':'Road crossing water.'],
    [ja?'原子力発電所':'Nuclear power plant',BOARD_ASSET_REGISTRY.facilities.nuclearPowerPlant,ja?'大型の冷却塔。':'Large cooling towers.'],
    [ja?'空軍基地':'Air Base',BOARD_ASSET_REGISTRY.facilities.airBase,ja?'滑走路と格納庫。':'Runway and hangars.'],
    [ja?'特殊部隊':'Special Forces',BOARD_ASSET_REGISTRY.units.specialForces,ja?'特殊装備の歩兵。':'Infantry with specialist equipment.'],
    [ja?'野戦砲・梱包':'Field Artillery · Packed',ARTILLERY_ASSETS.packed,ja?'牽引する姿勢。':'Towed stance.'],
    [ja?'野戦砲・展開':'Field Artillery · Deployed',ARTILLERY_ASSETS.deployed,ja?'砲脚を広げた射撃姿勢。':'Firing stance with spread trails.'],
    [ja?'ヘリ・着陸':'Helicopter · Landed',HELICOPTER_ASSETS.landed,ja?'静止ローターと接地姿勢。':'Stopped rotor and grounded stance.'],
    [ja?'ヘリ・飛行':'Helicopter · Airborne',HELICOPTER_ASSETS.airborne,ja?'回転ローターと▲。▣は搭乗者。':'Spinning rotor and ▲. ▣ indicates cargo.'],
    ['Pack Zombie',BOARD_ASSET_REGISTRY.units.packZombie,ja?'密集した群れ。':'A tightly packed group.'],
  ]) { const row=document.createElement('p'),icon=document.createElement('img');icon.src=resolveBoardAssetUrl(path!);icon.alt=label!;icon.width=40;icon.height=40;row.append(icon,document.createTextNode(` ${label}: ${description}`));legend.append(row); }
  const droneLegend=document.createElement('p');droneLegend.textContent=ja?'Dと水色の範囲は軍用ドローンの視界です。':'D and the cyan area mark Military Drone vision.';legend.append(droneLegend);
  root.querySelector('.replay-view')!.append(legend);
  const get = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-replay="${name}"]`)!;
  const status = get('status'), canvas = get<HTMLCanvasElement>('board');
  get<HTMLButtonElement>('play').disabled=true;get<HTMLButtonElement>('cancel').disabled=true;
  let abort = new AbortController(), pkg: ReplayPackage | null = null, frame: Awaited<ReturnType<ReplayPackage['decision']>> | null = null;
  let decision = 0, resultPhase = false, playing = false, remaining = 0, last = performance.now(), speed = 1, busy = false, generation = 0, disposed = false;
  let current: SessionPublicDocument | null = null;
  const board = new PublicBoardRenderer(canvas,root.querySelector('.public-board-details')!,locale);
  const setStatus = (s: string) => { status.textContent = s; };
  const pause = () => { playing = false; get('play').textContent = ja ? '再生' : 'Play'; };
  const draw = () => { if(pkg&&current)board.setFrame(publicBoardFrame(current.observation,pkg.map)); };
  const logs = new Map<number, string[]>();
  const render = () => {
    if(!frame||!pkg)return;
    current=resultPhase?frame.after:frame.before;
    get('position').textContent=`Turn ${current.observation.turn} · Decision ${decision+1}/${pkg.index.length} · ${resultPhase?(ja?'行動結果':'Result'):(ja?'判断直前':'Before decision')}`;
    const h=current.observation.endTurnForecast.publicHealth;
    get('health').textContent=`${ja?'衛生ストレス 食料 / 民需品':'Health stress food / goods'} ${h.stressBefore.food.toFixed(2)} → ${h.stressAfter.food.toFixed(2)} / ${h.stressBefore.civilianGoods.toFixed(2)} → ${h.stressAfter.civilianGoods.toFixed(2)} · ${ja?'食料不足蓄積':'Food accumulation'} ${h.accumulationBefore.toFixed(2)} → ${h.accumulationAfter.toFixed(2)} · ${ja?'飢餓予測人数':'Projected starvation deaths'} ${h.starvation.loss} · ${ja?'繰越端数':'Carry'} ${h.starvation.carryAfter.toFixed(3)}`;
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
    abort.abort();abort=new AbortController();pause();frame=null;pkg=null;current=null;board.clear();logs.clear();busy=true;get<HTMLButtonElement>('play').disabled=true;get<HTMLButtonElement>('cancel').disabled=false;const token=++generation;setStatus(ja?'ZIPと公開記録を検証中…':'Validating ZIP and public records…');
    try{const loaded=await new ReplayPackage(new ReplayZip(file,abort.signal)).open();if(token!==generation||disposed)return;pkg=loaded;busy=false;if(pkg.index.length)await seek(0);else setStatus(ja?'判断記録がありません。':'No Decisions recorded.');}catch(e){if(token===generation)setStatus(`${ja?'読込できません':'Unable to load'}: ${e instanceof Error?e.message:String(e)}`);}finally{if(token===generation){busy=false;get<HTMLButtonElement>('play').disabled=!frame;get<HTMLButtonElement>('cancel').disabled=true;}}
  };
  get('cancel').onclick=()=>{if(!busy)return;get<HTMLButtonElement>('cancel').disabled=true;abort.abort();generation++;busy=false;pause();setStatus(ja?'読込を中止しました。ZIPを再選択できます。':'Loading cancelled. Select another ZIP.');};
  get('prev').onclick=()=>{void seek(decision-1);};get('next').onclick=()=>{void seek(decision+1);};
  get('seek').onclick=()=>{if(!pkg)return;const turn=Number(get<HTMLInputElement>('turn').value),i=pkg.index.findIndex(e=>e.turn===turn);if(i<0){pause();setStatus(ja?'指定ターンの判断記録がありません。':'No Decision recorded for this turn.');}else void seek(i);};
  get('play').onclick=()=>{if(!frame||busy)return;if(playing){pause();return;}if(resultPhase&&pkg&&decision===pkg.index.length-1&&remaining<=0)return;playing=true;last=performance.now();get('play').textContent=ja?'一時停止':'Pause';};
  get<HTMLSelectElement>('speed').onchange=()=>{speed=Number(get<HTMLSelectElement>('speed').value);};
  get('fit').onclick=()=>board.fit();
  let raf=0;
  const animate=async(now:number)=>{if(disposed)return;const elapsed=now-last;last=now;
    if(playing&&!busy&&frame&&pkg){remaining-=elapsed*speed;if(remaining<=0){if(!resultPhase){resultPhase=true;remaining=1000;render();}else if(decision+1<pkg.index.length){const wasPlaying=playing;await seek(decision+1);if(wasPlaying&&!disposed){playing=true;get('play').textContent=ja?'一時停止':'Pause';last=performance.now();}}else pause();}}
    raf=requestAnimationFrame(t=>{void animate(t);});};raf=requestAnimationFrame(t=>{void animate(t);});
  get('exit').onclick=()=>{disposed=true;generation++;abort.abort();cancelAnimationFrame(raf);board.dispose();pause();exit();};
}
