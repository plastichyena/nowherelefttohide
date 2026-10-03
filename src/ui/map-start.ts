import { resolveScenario } from '../core/scenarios';
import { cloneConfig } from '../core/config';
import type { GameConfig, GameState } from '../core/types';
import type { GenerationProgress } from '../core/map-generation';

export function mapStartFields(ja: boolean): string {
  return `<label>${ja?'マップ':'Map'}<select name="mapMode"><option value="random">${ja?'ランダム':'Random'}</option><option value="fixed">${ja?'固定':'Fixed'}</option></select></label>
    <button type="button" data-random-seed>${ja?'ランダムseed':'Random seed'}</button>
    <details><summary>${ja?'詳細seed設定':'Advanced seeds'}</summary>
    <p>${ja?'空欄は通常のSeedを使用します。':'Blank fields use the main Seed.'}</p>
    <label>${ja?'地図seed':'Map seed'}<input name="mapSeed" type="number" step="1"></label>
    <label>${ja?'ゲーム進行seed':'Gameplay seed'}<input name="gameplaySeed" type="number" step="1"></label></details>
    <button type="button" data-copy-reproduction>${ja?'再現キーをコピー':'Copy reproduction key'}</button><output data-reproduction></output>`;
}
export function readMapStart(form: HTMLFormElement) {
  const data=new FormData(form), seed=Number(data.get('seed'));
  if(!String(data.get('seed')??'').trim())throw new Error('Seed is required / Seedを入力してください');
  const optional=(key:string)=>{const value=String(data.get(key)??'').trim();return value===''?undefined:Number(value);};
  const input={seed,mapMode:String(data.get('mapMode')??'random') as GameConfig['mapMode'],mapSeed:optional('mapSeed'),gameplaySeed:optional('gameplaySeed')};
  resolveScenario(input); return input;
}
export function bindMapStart(form: HTMLFormElement, scenarioId: string) {
  form.querySelector('[data-random-seed]')?.addEventListener('click',()=>{
    const value=crypto.getRandomValues(new Uint32Array(1))[0]!;
    (form.elements.namedItem('seed') as HTMLInputElement).value=String(value);
  });
  form.querySelector('[data-copy-reproduction]')?.addEventListener('click',async()=>{
    const output=form.querySelector('[data-reproduction]')!;
    try { const text=JSON.stringify({scenarioId,...readMapStart(form),...(scenarioId==='custom'?{customStartFields:Object.fromEntries(new FormData(form))}:{})});output.textContent=text;await navigator.clipboard?.writeText(text); }
    catch(error){output.textContent=String(error);}
  });
}
/** Termination rejects this request; late messages never commit a game. */
export function generateGame(seed:number,config:GameConfig,progress:(p:GenerationProgress)=>void) {
  const worker=new Worker(new URL('./map-generation.worker.ts',import.meta.url),{type:'module'});
  let rejectPending:(error:Error)=>void=()=>{};
  const promise=new Promise<GameState>((resolve,reject)=>{
    rejectPending=reject;
    worker.onmessage=e=>{
      if(e.data.kind==='progress')progress(e.data.progress);
      else if(e.data.kind==='complete'){worker.terminate();resolve(e.data.state);}
      else {worker.terminate();reject(new Error(e.data.message));}
    };
    worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};
    worker.postMessage({seed,config});
  });
  return {promise,cancel(){worker.terminate();rejectPending(new Error('generation_cancelled'));}};
}
export const UI_CORRECTION_FIELDS = ['checkpoint.initialSupplyRadius','initialFacilityPopulation.*.survivors','initialFacilityPopulation.*.infected','initialFacilityPopulation.*.survivorRange','initialFacilityPopulation.*.infectedRange','economy.initialWorkersByFacility.*'] as const;
export function proposeMapCorrections(config:GameConfig,message:string) {
  const corrected=cloneConfig(config),changes:Array<{field:string;before:unknown;after:unknown;reason:string}>=[];
  if(config.scenarioId!=='custom')return {corrected,changes};
  if(message.includes('initialSupplyRadius')||message.includes('initial_buildable_plain')) {
    changes.push({field:'checkpoint.initialSupplyRadius',before:config.checkpoint.initialSupplyRadius,after:5,reason:'固定検問所と8施設の初期供給・建設余地を確保 / Restore initial supply and construction space'});
    corrected.checkpoint.initialSupplyRadius=5;
  }
  // Population correction is limited to the named capacity failure. No combat/economy values change.
  const id=/Initial workers exceed capacity for ([\w-]+)/.exec(message)?.[1];
  if(id){
    const type=id==='capital'?'capital':id.startsWith('city-')?'city':id.startsWith('civilian-factory')?'civilianFactory':id.startsWith('military-factory')?'militaryFactory':id.startsWith('farm-')?'farm':null;
    if(type){const p=corrected.initialFacilityPopulation[id],capacity=config.facilities[type].workerCapacity;
      if(p){const before=structuredClone(p);p.infected=Math.min(capacity,p.infected??0);p.infectedRange=null;p.survivors=Math.min(capacity-p.infected,p.survivors??config.economy.initialWorkersByFacility[id]??capacity);p.survivorRange=null;
        changes.push({field:`initialFacilityPopulation.${id}`,before,after:structuredClone(p),reason:'定員内の初期人口 / Initial population within capacity'});}}
  }
  return {corrected,changes};
}
