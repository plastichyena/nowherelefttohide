import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { gunzipSync, strFromU8 } from 'fflate';
import { GameEngine } from '../core/engine';
import { createDefaultConfig } from '../core/config';
import type { GameState } from '../core/types';
import { DEFAULT_AUTOSAVE_KEY, V171_AUTOSAVE_KEY, decodeSaveCode, encodeSaveCode, exportSaveJson, importSaveJson } from '../persistence/save';
import { createTerminalSessionFixture, terminalFixtureAction } from '../testing/v171-session-fixture';
import legacy from '../testing/fixtures/v171-score-compat.json';
import { createTranslator, type Locale } from './i18n';

vi.mock('phaser', () => ({ default: { Scene: class {}, Game: class {} } }));
import { GameUiController } from './controller';

// A small DOM sink for the existing status markup. Run the real controller
// render/load/save methods and Core/codec; omit canvas/layout and unrelated
// optional mounts. This is a Node unit test, not a browser/layout test.
class StatusElement {
  textContent = '';
  dataset: Record<string, string> = {};
  hidden = false;
  private attributes = new Map<string, string>();
  private html = '';
  constructor(private readonly acceptMarkup: (html: string) => void = () => {}) {}
  get innerHTML(): string { return this.html; }
  set innerHTML(html: string) { this.html = html; this.acceptMarkup(html); }
  insertAdjacentHTML(_position: string, html: string): void { this.acceptMarkup(html); }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
}

class StatusDom extends StatusElement {
  private nodes = new Map<string, StatusElement>();
  readonly ownerDocument = { createTreeWalker: () => ({ nextNode: () => null }) };
  readonly renderedMenus: Array<{ label: string | null; pending: string | undefined }> = [];
  constructor() { super(); }
  override set innerHTML(html: string) { this.nodes.clear(); this.accept(html); }
  override insertAdjacentHTML(_position: string, html: string): void { this.accept(html); }
  querySelector(selector: string): StatusElement | null { return this.nodes.get(selector) ?? null; }
  querySelectorAll(selector: string): StatusElement[] {
    if (selector === '[data-overlay]' || selector === '[aria-label], [title]') return this.menu ? [this.menu] : [];
    return selector.split(',').flatMap(part => this.nodes.get(part.trim()) ?? []);
  }
  get menu(): StatusElement { return this.nodes.get('.more-menu')!; }
  get terminal(): StatusElement | null { return this.querySelector('[data-terminal-save-status]'); }
  private accept(html: string): void {
    const menu = /<button\b[^>]*class="[^"]*\bmore-menu\b[^"]*"[^>]*>/.exec(html);
    if (menu) {
      const element = new StatusElement();
      for (const attr of menu[0].matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(attr[1]!, attr[2]!);
      this.nodes.set('.more-menu', element);
    }
    if (html.includes('data-upper-overlay')) this.nodes.set('[data-upper-overlay]', new StatusElement(markup => {
      this.nodes.delete('[data-upper-overlay] [role="status"]');
      this.accept(markup);
      const row = /<p\b[^>]*role="status"[^>]*>([^<]*)<\/p>/.exec(markup);
      if (row) { const element = new StatusElement(); element.textContent = row[1]!; this.nodes.set('[data-upper-overlay] [role="status"]', element); }
    }));
    if (html.includes('data-modal="statistics"')) {
      this.nodes.set('[data-modal="statistics"]', new StatusElement());
      this.nodes.set('[data-modal="statistics"] .stats-grid', new StatusElement(markup => this.accept(markup)));
      this.renderedMenus.push({ label: this.menu.getAttribute('aria-label'), pending: this.menu.dataset.pending });
    }
    for (const row of html.matchAll(/<p\b([^>]*)>([^<]*)<\/p>/g)) {
      const binding = /data-bind="(save-status|save-modal-status)"/.exec(row[1]!);
      const key = binding ? `[data-bind="${binding[1]}"]` : row[1]!.includes('data-terminal-save-status') ? '[data-terminal-save-status]' : null;
      if (key) {
        const element = new StatusElement(); element.textContent = row[2]!; this.nodes.set(key, element);
        if (binding?.[1] === 'save-modal-status') this.nodes.set('[data-modal="save"] [data-bind="save-modal-status"]', element);
      }
    }
  }
}

// Only expose private entry points to this test; no production testing API.
type ControllerProbe = {
  readJsonFile(input: HTMLElement): void;
  loadAutosave(): void;
  manualSave(): void;
  showSaveModal(): void;
  updateHud(): void;
  upperOverlay: 'menu' | null;
  state: GameState;
};

let won: GameState;
let wonJson: string;
let previousCode: string;
beforeAll(() => {
  const before = createTerminalSessionFixture('v172-local-validation', 'won')
    .createNew({ seed: 42, agentId: 'save-status-regression' }).exportPrivateState() as unknown as GameState;
  const step = GameEngine.fromSnapshot(before).step(terminalFixtureAction(before, 'won'));
  expect(step.error).toBeNull();
  won = step.state as GameState;
  expect(won.result).toMatchObject({ outcome: 'won', turn: 2, terminalScore: { status: 'scored', points: { total: '17951' } } });
  wonJson = exportSaveJson(won);
  previousCode = encodeSaveCode(new GameEngine(42, createDefaultConfig({ mapMode: 'fixed' })).getState() as GameState);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function harness(locale: Locale, currentCode?: string, oldCode?: string) {
  vi.useFakeTimers();
  const values = new Map<string, string>([['nowhere-left-to-hide:locale', locale]]);
  if (currentCode) values.set(DEFAULT_AUTOSAVE_KEY, currentCode);
  if (oldCode) values.set(V171_AUTOSAVE_KEY, oldCode);
  const writes: Array<{ key: string; code: string }> = [];
  const atWrite: Array<{ label: string | null; pending: string | undefined }> = [];
  const dom = new StatusDom();
  let failWrites = false;
  vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, code: string) => {
      writes.push({ key, code });
      atWrite.push({ label: dom.menu.getAttribute('aria-label'), pending: dom.menu.dataset.pending });
      if (failWrites) throw new Error('QuotaExceededError: regression storage failure');
      values.set(key, code);
    },
  });
  const controller = new GameUiController(dom as unknown as HTMLElement, snapshot => GameEngine.fromSnapshot(snapshot!)) as unknown as ControllerProbe;
  const importJson = async (json: string) => {
    const text = Promise.resolve(json);
    controller.readJsonFile({ files: [{ text: () => text }] } as unknown as HTMLElement);
    await text; // readJsonFile registered its decode/load continuation first.
    await Promise.resolve();
  };
  return { controller, dom, values, writes, atWrite, importJson, fail: (value: boolean) => { failWrites = value; } };
}

function label(locale: Locale, status: string, turn: number | null): string {
  const t = createTranslator(locale);
  return t(status) + (turn === null ? '' : ` · ${t('lastSavedTurn')} ${turn}`);
}
function expectStatus(dom: StatusDom, locale: Locale, status: string, turn: number | null, pending: boolean): void {
  const text = label(locale, status, turn);
  // Check the terminal first: before the fix it is correct while the menu is stale.
  expect(dom.terminal?.textContent).toBe(text);
  expect(dom.menu.getAttribute('aria-label')).toBe(`${locale === 'ja' ? 'メニュー' : 'Menu'} · ${text}`);
  expect(dom.menu.dataset.pending).toBe(String(pending));
}

describe('controller JSON import save-status synchronization', () => {
  it.each(['ja', 'en'] as const)('synchronizes a successful terminal JSON autosave without another view update (%s)', async locale => {
    // The existing slot is also Turn 2, matching the integration report exactly.
    const h = harness(locale, encodeSaveCode(won));
    await h.importJson(wonJson);
    expect(h.writes).toHaveLength(1);
    expect(decodeSaveCode(h.values.get(DEFAULT_AUTOSAVE_KEY)!).state).toEqual(won);
    expect(h.controller.state).toEqual(won);
    expectStatus(h.dom, locale, 'saveStatusSaved', 2, false);
    expect(h.atWrite).toEqual([{ label: `${locale === 'ja' ? 'メニュー' : 'Menu'} · ${label(locale, 'saving', 2)}`, pending: 'true' }]);
  });

  it.each([false, true])('shows failed import and retry with the actual previous local save (existing=%s)', async existing => {
    const h = harness('ja', existing ? previousCode : undefined);
    h.fail(true);
    await h.importJson(wonJson);
    expect(h.writes).toHaveLength(1);
    expect(h.values.get(DEFAULT_AUTOSAVE_KEY)).toBe(existing ? previousCode : undefined);
    expect(h.controller.state).toEqual(won);
    expectStatus(h.dom, 'ja', 'saveFailed', existing ? 1 : null, true);
    h.controller.upperOverlay = 'menu';
    h.controller.updateHud();
    h.controller.showSaveModal();
    h.fail(false);
    h.controller.manualSave();
    expect(h.writes).toHaveLength(2);
    expectStatus(h.dom, 'ja', 'saveStatusSaved', 2, false);
    expect(h.dom.querySelector('[data-upper-overlay] [role="status"]')?.textContent).toBe(label('ja', 'saveStatusSaved', 2));
    expect(h.dom.querySelector('[data-bind="save-modal-status"]')?.textContent).toBe(label('ja', 'saveStatusSaved', 2));
    expect(decodeSaveCode(h.values.get(DEFAULT_AUTOSAVE_KEY)!).state).toEqual(won);
    expect(h.controller.state).toEqual(won);
  });

  it.each(['JSON', 'autosave'] as const)('keeps a migrated terminal %s unsaved until an explicit successful write', async source => {
    const oldCode = legacy.cases.find(entry => entry.name === 'finished-won')!.code;
    const oldJson = strFromU8(gunzipSync(Buffer.from(oldCode, 'base64url')));
    const h = harness('en', source === 'JSON' ? previousCode : undefined, oldCode);
    if (source === 'JSON') await h.importJson(oldJson);
    else h.controller.loadAutosave();
    expect(h.writes).toHaveLength(0);
    expect(h.values.get(DEFAULT_AUTOSAVE_KEY)).toBe(source === 'JSON' ? previousCode : undefined);
    expect(h.values.get(V171_AUTOSAVE_KEY)).toBe(oldCode);
    expect(h.controller.state).toEqual(importSaveJson(oldJson).state);
    expect(h.controller.state.result?.terminalScore).toMatchObject({ status: 'unscored', reason: 'legacy_v1.7.1' });
    expectStatus(h.dom, 'en', 'unsavedChanges', source === 'JSON' ? 1 : null, true);
    const migrated = structuredClone(h.controller.state);
    h.controller.manualSave();
    expect(h.writes).toHaveLength(1);
    expectStatus(h.dom, 'en', 'saveStatusSaved', migrated.turn, false);
    expect(decodeSaveCode(h.values.get(DEFAULT_AUTOSAVE_KEY)!).state).toEqual(migrated);
    expect(h.controller.state).toEqual(migrated);
    expect(h.values.get(V171_AUTOSAVE_KEY)).toBe(oldCode);
  });
});
