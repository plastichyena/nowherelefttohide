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

export class LiveAiViewer {
  private session: AiSessionPort | null = null;
  private latestObservation: AgentObservation | null = null;
  private omittedDecisions = 0;
  private logBytes = 0;
  private readonly host: HTMLElement;
  private readonly launcher: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly current: HTMLElement;
  private readonly result: HTMLElement;
  private readonly log: HTMLElement;
  private readonly omitted: HTMLElement;
  private readonly state: HTMLElement;
  private readonly options: LiveAiViewerOptions;

  public constructor(options: LiveAiViewerOptions = {}) {
    this.options = options;
    this.host = document.createElement('aside');
    this.host.className = 'live-ai-host';
    this.host.innerHTML = `
      <button type="button" class="live-ai-launcher">AI Play / Watch</button>
      <section class="live-ai-panel" hidden aria-label="AI Play / Watch">
        <header><strong>AI Play / Watch</strong><span class="live-ai-state">not started</span></header>
        <div class="live-ai-controls">
          <button type="button" data-live-ai="start">Start</button>
          <button type="button" data-live-ai="pause">Pause</button>
          <button type="button" data-live-ai="resume">Resume</button>
          <button type="button" data-live-ai="export">Export ZIP</button>
          <button type="button" data-live-ai="end">End</button>
          <button type="button" data-live-ai="close">Close</button>
        </div>
        <div class="live-ai-board"><canvas aria-label="Live AI public board"></canvas></div>
        <section class="live-ai-current" aria-live="polite">WebMCP client can start after Start.</section>
        <pre class="live-ai-result" aria-live="polite"></pre>
        <p class="live-ai-omitted" hidden></p>
        <details><summary>Decision log</summary><ol class="live-ai-log"></ol></details>
      </section>`;
    document.body.append(this.host);
    this.launcher = this.host.querySelector('.live-ai-launcher')!;
    this.panel = this.host.querySelector('.live-ai-panel')!;
    this.canvas = this.host.querySelector('canvas')!;
    this.current = this.host.querySelector('.live-ai-current')!;
    this.result = this.host.querySelector('.live-ai-result')!;
    this.log = this.host.querySelector('.live-ai-log')!;
    this.omitted = this.host.querySelector('.live-ai-omitted')!;
    this.state = this.host.querySelector('.live-ai-state')!;
    this.launcher.addEventListener('click', () => { this.panel.hidden = false; this.launcher.hidden = true; });
    this.host.addEventListener('click', (event) => this.onClick(event));
    window.addEventListener('resize', () => { if (this.latestObservation) void this.render(this.latestObservation); });
  }

  public getSession = (): AiSessionPort | null => this.session;

  public act = async (input: AiSessionActInput): Promise<AiSessionResponse<AiSessionActResult> | { ok: false; generation: 0; revision: 0; error: { code: 'unsupported'; message: string } }> => {
    if (!this.session) return { ok: false, generation: 0, revision: 0, error: { code: 'unsupported', message: 'AI play/watch session is not active' } };
    this.showIncomingDecision(input);
    const response = this.session.act(input);
    if (!response.ok) {
      this.showResult(response);
      return response;
    }
    this.latestObservation = response.after;
    try {
      await this.renderWithWatchdog(response.after);
    } catch (error) {
      this.session.setPaused(true);
      this.state.textContent = 'paused: render sync failure';
      this.current.textContent = 'render sync failure — Core action remains committed; resume after redraw.';
      await this.render(response.after);
      this.showResult(response, error);
      return response;
    }
    this.showResult(response);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    if (response.after.gameOver) await this.exportArtifact();
    return response;
  };

  private async start(): Promise<void> {
    this.session = createAiSession(liveAiSessionOptions(this.options, locale()));
    const artifact = this.session.buildPublicArtifact();
    if (artifact.ok) {
      this.latestObservation = artifact.artifact.finalObservation;
      await this.render(this.latestObservation);
    }
    this.state.textContent = `active · ${locale()}`;
    this.current.textContent = 'Session started. Discover the eight nlth_* WebMCP tools.';
    this.result.textContent = '';
    this.log.replaceChildren();
    this.omittedDecisions = 0;
    this.logBytes = 0;
    this.updateOmitted();
  }

  private onClick(event: Event): void {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-live-ai]');
    if (!button) return;
    switch (button.dataset.liveAi) {
      case 'start': void this.start(); break;
      case 'pause': if (this.session) { this.session.setPaused(true); this.state.textContent = 'paused'; } break;
      case 'resume': if (this.session) { this.session.setPaused(false); this.state.textContent = 'active'; } break;
      case 'end': if (this.session) { this.session.end(); this.state.textContent = 'ended'; void this.exportArtifact(); } break;
      case 'export': void this.exportArtifact(); break;
      case 'close': this.panel.hidden = true; this.launcher.hidden = false; break;
    }
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
    heading.textContent = `Decision · ${input.requestId} · ${String((input.action as { type?: unknown }).type ?? 'Action')}`;
    const comment = document.createElement('p');
    comment.textContent = typeof input.decisionSummary === 'string' && input.decisionSummary.length > 0 ? input.decisionSummary : '(no comment)';
    item.append(heading, comment);
    const bytes = new TextEncoder().encode(item.textContent ?? '').byteLength;
    item.dataset.bytes = String(bytes);
    this.log.prepend(item);
    this.logBytes += bytes;
    this.current.replaceChildren(heading.cloneNode(true), comment.cloneNode(true));
    this.trimLog();
  }

  private showResult(response: unknown, renderError?: unknown): void {
    this.result.textContent = renderError ? `${text(response)}\nrenderError: ${String(renderError)}` : text(response);
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
    this.omitted.textContent = this.omittedDecisions === 0 ? '' : `${this.omittedDecisions} older Decision details omitted by the 100 Decisions / 2 MiB viewer limit. Canonical Artifact remains complete.`;
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
      const rect = this.canvas.getBoundingClientRect();
      const backing = boundedCanvasBackingSize(rect.width || 640, rect.height || 360, window.devicePixelRatio);
      this.canvas.width = backing.width;
      this.canvas.height = backing.height;
      const context = this.canvas.getContext('2d');
      if (!context) throw new Error('canvas_context_unavailable');
      context.setTransform(backing.scale, 0, 0, backing.scale, 0, 0);
      const width = Math.max(1, rect.width || 640);
      const height = Math.max(1, rect.height || 360);
      context.fillStyle = '#111827'; context.fillRect(0, 0, width, height);
      const cellW = width / Math.max(1, observation.map.width);
      const cellH = height / Math.max(1, observation.map.height);
      for (const tile of observation.map.tiles) {
        context.fillStyle = tile.terrain === 'mountain' ? '#59606a' : tile.terrain === 'forest' ? '#274936' : '#3c4a3e';
        context.fillRect(tile.q * cellW, tile.r * cellH, Math.max(1, cellW), Math.max(1, cellH));
        if (tile.road || tile.movementRoad) { context.fillStyle = '#a99672'; context.fillRect(tile.q * cellW, tile.r * cellH, Math.max(1, cellW), Math.max(1, cellH)); }
      }
      const mark = (q: number, r: number, color: string, radius: number) => { context.fillStyle = color; context.beginPath(); context.arc((q + .5) * cellW, (r + .5) * cellH, radius, 0, Math.PI * 2); context.fill(); };
      for (const facility of observation.facilities) mark(facility.position.q, facility.position.r, facility.type === 'oilField' ? '#d59b37' : '#68b0ab', Math.max(2, Math.min(5, cellW * 1.2)));
      for (const unit of observation.units) mark(unit.position.q, unit.position.r, '#60a5fa', Math.max(2, Math.min(5, cellW * 1.2)));
      for (const zombie of observation.zombies) mark(zombie.position.q, zombie.position.r, '#ef4444', Math.max(2, Math.min(5, cellW * 1.2)));
      this.canvas.dataset.backingPixels = String(this.canvas.width * this.canvas.height);
      resolve();
      } catch (error) {
        reject(error);
      }
    }));
  }
}
