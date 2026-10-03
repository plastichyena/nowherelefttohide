import type { WebMcpRegistration } from './webmcp';
import {mapStartFields,bindMapStart,readMapStart,generateGame} from '../ui/map-start';
import {resolveScenario} from '../core/scenarios';
import { PublicBoardRenderer, publicBoardFrame, presentationBoardFrame } from '../ui/publicBoard';
import { TurnPlayback, turnPresentation, createPlaybackControls } from '../ui/turnPlayback';
import type { AgentObservation } from '../agent/types';
import { createAiSession } from '../session/ai-session';
import type { AiSessionActInput, AiSessionActResult, AiSessionPort, AiSessionResponse } from '../session/ai-session-contract';
import { BrowserDownloadArtifactSink, buildAiSessionArtifactPackage } from '../session/artifact-builder';

const LOG_DECISION_LIMIT = 100;
const LOG_BYTE_LIMIT = 2 * 1024 * 1024;
const MAX_CANVAS_PIXELS = 2048 * 2048;

export interface LiveAiViewerOptions {
  buildId?: string;
}

export function liveAiSessionOptions(
  options: LiveAiViewerOptions,
  preferredCommentLocale: 'ja' | 'en',
): { buildId?: string; preferredCommentLocale: 'ja' | 'en' } {
  return {
    ...(options.buildId === undefined ? {} : { buildId: options.buildId }),
    preferredCommentLocale,
  };
}

export function boundedCanvasBackingSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): { width: number; height: number; scale: number } {
  const safeWidth = Math.max(1, Math.floor(cssWidth));
  const safeHeight = Math.max(1, Math.floor(cssHeight));
  const requested = Math.max(1, Math.min(2, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
  const pixelScale = Math.min(requested, Math.sqrt(MAX_CANVAS_PIXELS / (safeWidth * safeHeight)));
  return {
    width: Math.max(1, Math.floor(safeWidth * pixelScale)),
    height: Math.max(1, Math.floor(safeHeight * pixelScale)),
    scale: pixelScale,
  };
}

function locale(): 'ja' | 'en' {
  return document.documentElement.lang.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function text(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

/** The viewer shows a bounded receipt; canonical observations stay in Session/Artifact. */
export function liveAiResultText(response: unknown): string {
  let value = response;
  if (response && typeof response === 'object' && 'before' in response && 'after' in response) {
    const { before: _before, after, ...receipt } = response as Record<string, unknown>;
    const observation = after as Partial<AgentObservation>;
    value = { ...receipt, after: { turn: observation.turn, gameOver: observation.gameOver, resources: observation.resources }, observationDetails: 'Use nlth_observe / nlth_query or Export ZIP for full public state.' };
  }
  const serialized = text(value);
  return serialized.length <= 16_384 ? serialized : `${serialized.slice(0, 16_384)}\n… Viewer receipt truncated; canonical Artifact is complete.`;
}

export class LiveAiViewer {
  private builtInGeneration=0;
  private builtInRunning=false;
  private readonly playback = new TurnPlayback();
  private playbackControls: HTMLElement;
  private displayQueue: Array<{ input: AiSessionActInput; response: AiSessionActResult }> = [];
  private displayBusy = false;
  private registration: WebMcpRegistration | null = null;
  private session: AiSessionPort | null = null;
  private latestObservation: AgentObservation | null = null;
  private omittedDecisions = 0;
  private logBytes = 0;
  private readonly host: HTMLElement;
  private readonly launcher: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly board: PublicBoardRenderer;
  private readonly current: HTMLElement;
  private readonly result: HTMLElement;
  private readonly log: HTMLElement;
  private readonly omitted: HTMLElement;
  private readonly state: HTMLElement;
  private readonly options: LiveAiViewerOptions;

  public constructor(options: LiveAiViewerOptions = {}) {
    this.options = options;
    const ja=locale()==='ja';
    this.host = document.createElement('aside');
    this.host.className = 'live-ai-host';
    this.host.innerHTML = `
      <button type="button" class="live-ai-launcher">${ja?'AIプレイ・観戦':'AI Play / Watch'}</button>
      <section class="live-ai-panel" hidden aria-label="${ja?'AIプレイ・観戦':'AI Play / Watch'}">
        <header><strong>${ja?'AIプレイ・観戦':'AI Play / Watch'}</strong><span class="live-ai-state">${ja?'開始前':'not started'}</span></header>
        <form class="live-map-start settings-form"><label>Seed<input name="seed" type="number" step="1" value="1"></label>${mapStartFields(ja)}</form>
        <div class="live-ai-controls">
          <button type="button" data-live-ai="start">${ja?'開始':'Start'}</button>
          <button type="button" data-live-ai="balanced">${ja?'内蔵AIを観戦':'Balanced AI'}</button>
          <button type="button" data-live-ai="pause">${ja?'一時停止':'Pause'}</button>
          <button type="button" data-live-ai="resume">${ja?'再開':'Resume'}</button>
          <button type="button" data-live-ai="export">${ja?'ZIPを書き出す':'Export ZIP'}</button>
          <button type="button" data-live-ai="end">${ja?'終了':'End'}</button>
          <button type="button" data-live-ai="close">${ja?'閉じる':'Close'}</button>
        </div>
        <details><summary>${ja?'WebMCP接続診断':'WebMCP diagnostics'}</summary><pre class="live-ai-diagnostics"></pre><button type="button" data-live-ai="smoke">${ja?'読み取り専用の接続テスト':'Read-only Self Test'}</button></details>
        <div class="live-ai-board"><canvas aria-label="${ja?'AIに公開された盤面':'Live AI public board'}"></canvas></div><button type="button" data-live-ai="fit">${ja?'全体':'Fit'}</button><section class="public-board-details"></section>
        <section class="live-ai-current" aria-live="polite">${ja?'「開始」後にWebMCPから操作できます。':'WebMCP client can start after Start.'}</section>
        <pre class="live-ai-result" aria-live="polite"></pre>
        <p class="live-ai-omitted" hidden></p>
        <details><summary>${ja?'判断ログ':'Decision log'}</summary><ol class="live-ai-log"></ol></details>
      </section>`;
    document.body.append(this.host);
    this.launcher = this.host.querySelector('.live-ai-launcher')!;
    this.panel = this.host.querySelector('.live-ai-panel')!;
    this.canvas = this.host.querySelector('canvas')!;
    this.board = new PublicBoardRenderer(this.canvas, this.host.querySelector('.public-board-details')!, locale());
    this.playbackControls=createPlaybackControls(this.panel,locale()==='ja',()=>this.playback.skip());
    this.current = this.host.querySelector('.live-ai-current')!;
    this.result = this.host.querySelector('.live-ai-result')!;
    this.log = this.host.querySelector('.live-ai-log')!;
    this.omitted = this.host.querySelector('.live-ai-omitted')!;
    this.state = this.host.querySelector('.live-ai-state')!;
    bindMapStart(this.host.querySelector<HTMLFormElement>('.live-map-start')!,'una');
    this.host.querySelector('form')!.addEventListener('submit',e=>e.preventDefault());
    new MutationObserver(()=>this.refreshLocale()).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    const appRoot = document.querySelector<HTMLElement>('#app');
    const syncTitleVisibility = (): void => {
      const titleVisible = appRoot?.classList.contains('title-screen') ?? false;
      this.host.hidden = !titleVisible;
      if (!titleVisible) {
        this.panel.hidden = true;
        this.launcher.hidden = false;
      }
    };
    syncTitleVisibility();
    if (appRoot) new MutationObserver(syncTitleVisibility).observe(appRoot, { attributes: true, attributeFilter: ['class'] });
    this.launcher.addEventListener('click', () => { this.panel.hidden = false; this.launcher.hidden = true; });
    this.host.addEventListener('click', (event) => this.onClick(event));
    window.addEventListener('resize', () => { if (this.latestObservation && !this.playback.active) void this.render(this.latestObservation); });
  }

  public setRegistration(registration: WebMcpRegistration): void { this.registration = registration; this.refreshDiagnostics(); }
  private refreshLocale():void {
    const ja=locale()==='ja', title=ja?'AIプレイ・観戦':'AI Play / Watch';
    const form=this.host.querySelector<HTMLFormElement>('.live-map-start')!;
    if(!form.querySelector('progress')){
      const values=new FormData(form);
      form.innerHTML=`<label>Seed<input name="seed" type="number" step="1" value="1"></label>${mapStartFields(ja)}`;
      for(const [name,value] of values){const control=form.elements.namedItem(name);if(control instanceof HTMLInputElement||control instanceof HTMLSelectElement)control.value=String(value);}
      bindMapStart(form,'una');
    }
    this.launcher.textContent=title;this.panel.setAttribute('aria-label',title);
    this.panel.querySelector('header strong')!.textContent=title;
    const labels:Record<string,[string,string]>={start:['開始','Start'],balanced:['内蔵AIを観戦','Balanced AI'],pause:['一時停止','Pause'],resume:['再開','Resume'],export:['ZIPを書き出す','Export ZIP'],end:['終了','End'],close:['閉じる','Close'],smoke:['読み取り専用の接続テスト','Read-only Self Test'],fit:['全体','Fit']};
    for(const [key,pair] of Object.entries(labels))this.panel.querySelector(`[data-live-ai="${key}"]`)!.textContent=pair[ja?0:1];
    const summaries=this.panel.querySelectorAll(':scope > details > summary');
    summaries[0]!.textContent=ja?'WebMCP接続診断':'WebMCP diagnostics';summaries[1]!.textContent=ja?'判断ログ':'Decision log';
    this.playbackControls.querySelector('strong')!.textContent=ja?'ゾンビターン':'Zombie turn';
    this.playbackControls.querySelector('button')!.textContent=ja?'演出をスキップ':'Skip animation';
    this.board.setLocale(locale());
    if(!this.session){this.state.textContent=ja?'開始前':'not started';this.current.textContent=ja?'「開始」後にWebMCPから操作できます。':'WebMCP client can start after Start.';}
    this.updateOmitted();
  }
  public refreshDiagnostics = (): void => {
    const node = this.host.querySelector('.live-ai-diagnostics');
    if (node && this.registration) node.textContent = text(this.registration.diagnostics());
  };

  public getSession = (): AiSessionPort | null => this.session;

  public act = async (input: AiSessionActInput): Promise<AiSessionResponse<AiSessionActResult> | { ok: false; generation: 0; revision: 0; error: { code: 'unsupported'; message: string } }> => {
    if (!this.session) return { ok: false, generation: 0, revision: 0, error: { code: 'unsupported', message: 'AI play/watch session is not active' } };
    const response = this.session.act(input);
    if (!response.ok) {
      this.showResult(response);
      return response;
    }
    this.latestObservation = response.after;
    if(!response.replayed) { this.displayQueue.push({input,response});this.consumeDisplayQueue(); }
    if (response.after.gameOver) await this.exportArtifact();
    return response;
  };

  private consumeDisplayQueue():void {
    if(this.displayBusy)return;
    const next=this.displayQueue.shift();if(!next)return;
    this.displayBusy=true;this.showIncomingDecision(next.input);
    const finish=()=>{
      this.playbackControls.hidden=true;
      this.board.setFrame(publicBoardFrame(next.response.after));this.showResult(next.response);
      this.displayBusy=false;this.consumeDisplayQueue();
    };
    const presentation=turnPresentation(next.response.record.events);
    if(presentation&&!this.panel.hidden){
      this.playbackControls.hidden=false;const base=publicBoardFrame(next.response.before);
      this.playback.play(presentation,(visual,effects)=>this.board.setFrame(presentationBoardFrame(base,visual,effects)),finish);
    }else finish();
  }

  private cancelPlayback():void {
    this.playback.cancel();this.playbackControls.hidden=true;this.displayQueue=[];this.displayBusy=false;
    if(this.latestObservation)this.board.setFrame(publicBoardFrame(this.latestObservation));
  }

  private async start(): Promise<boolean> {
    const form=this.host.querySelector<HTMLFormElement>('.live-map-start')!;
    const ja=locale()==='ja';
    const input=readMapStart(form), resolved=resolveScenario({...input,scenarioId:'una'});
    const progress=document.createElement('section');progress.innerHTML=`<progress></progress><p role="status"></p><button type="button">${ja?'キャンセル':'Cancel'}</button>`;
    form.append(progress);
    const task=generateGame(resolved.seed,resolved.config,p=>{progress.querySelector('p')!.textContent=`${p.stage} ${p.attempt}/${p.maxAttempts}`;});
    progress.querySelector('button')!.addEventListener('click',()=>task.cancel(),{once:true});
    const buttons=[...this.host.querySelectorAll<HTMLButtonElement>('[data-live-ai="start"],[data-live-ai="balanced"]')];buttons.forEach(b=>b.disabled=true);
    let preparedInitialState;
    try{preparedInitialState=await task.promise;}catch(error){this.result.textContent=String(error);return false;}
    finally{progress.remove();buttons.forEach(b=>b.disabled=false);}
    this.builtInGeneration++;this.builtInRunning=false;
    this.cancelPlayback();
    this.session = createAiSession({...liveAiSessionOptions(this.options, locale()),preparedInitialState});
    const artifact = this.session.buildPublicArtifact();
    if (artifact.ok) {
      this.latestObservation = artifact.artifact.finalObservation;
      await this.render(this.latestObservation);
    }
    this.state.textContent = locale()==='ja'?'プレイ中':'active';
    this.current.textContent = locale() === 'ja' ? 'セッション開始。接続状態は診断欄で確認できます。' : 'Session started. Connection status is shown in diagnostics.';
    await this.registration?.smokeTest();
    this.refreshDiagnostics();
    this.result.textContent = '';
    this.log.replaceChildren();
    this.omittedDecisions = 0;
    this.logBytes = 0;
    this.updateOmitted();
    return true;
  }

  /** Built-in policy consumes the same public session and display queue as WebMCP. */
  private async startBalanced():Promise<void> {
    if(!await this.start())return;
    const token=++this.builtInGeneration;this.builtInRunning=true;
    const {BalancedAgent}=await import('../agent/balancedAgent');const agent=new BalancedAgent();
    let decision=0;
    while(token===this.builtInGeneration&&this.session) {
      if(this.session.getContext().lifecycle!=='active'||this.displayBusy) {await new Promise(resolve=>setTimeout(resolve,50));continue;}
      const observed=this.session.observe();if(!observed.ok||observed.observation.gameOver)break;
      const actions:import('../core/types').GameAction[]=[];let cursor:string|undefined;
      do {const page=this.session.getLegalActions({generation:observed.generation,baseRevision:observed.revision,pageSize:500,...(cursor?{cursor}:{})});if(!page.ok)return;actions.push(...page.actions);cursor=page.nextCursor??undefined;}while(cursor);
      if(!actions.length)break;
      const selected=agent.decide(this.latestObservation!,actions);
      await this.act({generation:observed.generation,baseRevision:observed.revision,requestId:`balanced-${token}-${decision++}`,action:selected.action,decisionSummary:locale()==='ja'?'公開情報に基づき内蔵Balanced AIが行動します。':'Built-in Balanced AI acts on public information.'});
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(token===this.builtInGeneration)this.builtInRunning=false;
  }

  private onClick(event: Event): void {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-live-ai]');
    if (!button) return;
    switch (button.dataset.liveAi) {
      case 'smoke': void this.registration?.smokeTest().then(this.refreshDiagnostics); break;
      case 'fit': this.board.fit(); break;
      case 'start': void this.start(); break;
      case 'balanced': void this.startBalanced(); break;
      case 'pause': this.cancelPlayback(); if (this.session) { this.session.setPaused(true); this.state.textContent = locale()==='ja'?'一時停止中':'paused'; } break;
      case 'resume': if (this.session) { this.session.setPaused(false); this.state.textContent = locale()==='ja'?'プレイ中':'active'; } break;
      case 'end': this.builtInGeneration++;this.builtInRunning=false;this.cancelPlayback(); if (this.session) { this.session.end(); this.state.textContent = locale()==='ja'?'終了':'ended'; void this.exportArtifact(); } break;
      case 'export': void this.exportArtifact(); break;
      case 'close': if(this.builtInRunning)this.session?.setPaused(true);this.cancelPlayback(); this.panel.hidden = true; this.launcher.hidden = false; break;
    }
    this.refreshDiagnostics();
  }

  private async exportArtifact(): Promise<void> {
    if (!this.session) return;
    const response = this.session.buildPublicArtifact();
    if (!response.ok) { this.showResult(response); return; }
    new BrowserDownloadArtifactSink().deliver(buildAiSessionArtifactPackage(response.artifact));
  }

  private showIncomingDecision(input: AiSessionActInput): void {
    const item = document.createElement('li');
    item.className = 'live-ai-decision';
    const heading = document.createElement('strong');
    heading.textContent = `${locale()==='ja'?'判断':'Decision'} · ${input.requestId} · ${String((input.action as { type?: unknown }).type ?? 'Action')}`;
    const comment = document.createElement('p');
    comment.textContent = typeof input.decisionSummary === 'string' && input.decisionSummary.length > 0 ? input.decisionSummary : (locale()==='ja'?'（コメントなし）':'(no comment)');
    item.append(heading, comment);
    const bytes = new TextEncoder().encode(item.textContent ?? '').byteLength;
    item.dataset.bytes = String(bytes);
    this.log.prepend(item);
    this.logBytes += bytes;
    this.current.replaceChildren(heading.cloneNode(true), comment.cloneNode(true));
    this.trimLog();
  }

  private showResult(response: unknown, renderError?: unknown): void {
    this.refreshDiagnostics();
    this.result.textContent = renderError ? `${liveAiResultText(response)}\nrenderError: ${String(renderError)}` : liveAiResultText(response);
  }

  private trimLog(): void {
    while (this.log.children.length > LOG_DECISION_LIMIT || this.logBytes > LOG_BYTE_LIMIT) {
      const oldest = this.log.lastElementChild as HTMLElement | null;
      if (!oldest || this.log.children.length <= 1) break;
      this.logBytes -= Number(oldest.dataset.bytes ?? 0);
      oldest.remove();
      this.omittedDecisions += 1;
    }
    this.updateOmitted();
  }

  private updateOmitted(): void {
    this.omitted.hidden = this.omittedDecisions === 0;
    this.omitted.textContent = this.omittedDecisions === 0 ? '' : locale()==='ja'?`表示上限（100判断・2 MiB）のため、過去${this.omittedDecisions}件を省略しています。書き出す記録には全判断が含まれます。`:`${this.omittedDecisions} older Decision details omitted by the 100 Decisions / 2 MiB viewer limit. Canonical Artifact remains complete.`;
  }

  private renderWithWatchdog(observation: AgentObservation): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('render_sync_timeout')), 5000);
      this.render(observation).then(() => { window.clearTimeout(timer); resolve(); }, (error) => { window.clearTimeout(timer); reject(error); });
    });
  }

  private render(observation: AgentObservation): Promise<void> {
    return new Promise((resolve, reject) => window.requestAnimationFrame(() => {
      try {
      this.board.setLocale(locale());
      this.board.setFrame(publicBoardFrame(observation));
      resolve();
      } catch (error) {
        reject(error);
      }
    }));
  }
}
