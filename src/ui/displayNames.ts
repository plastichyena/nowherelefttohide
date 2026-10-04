import type { GameState } from '../core/types';
import { facilityLabel, unitLabel, type Locale } from './i18n';

/** Human display names never replace identifiers in actions, persistence or public APIs. */
export function humanNames(state: Readonly<GameState>, locale: Locale): Map<string,string> {
  const names = new Map<string,string>();
  const serialCounts = new Map<string,number>();
  for (const unit of state.units) {
    const key = `${unit.type}:${/-(\d+)$/.exec(unit.id)?.[1] ?? ''}`;
    serialCounts.set(key, (serialCounts.get(key) ?? 0) + 1);
  }
  for (const unit of state.units) {
    // Production identifiers carry an immutable serial. Display only that number,
    // so removing an earlier unit cannot renumber surviving units.
    const serial = /-(\d+)$/.exec(unit.id)?.[1];
    const coordinates = `(${unit.position.q},${unit.position.r})`;
    const identifier = serial ? `${serial}${serialCounts.get(`${unit.type}:${serial}`)! > 1 ? ` ${coordinates}` : ''}` : coordinates;
    names.set(unit.id, `${unitLabel(unit.type,locale)} ${identifier}`);
  }
  for (const event of state.events ?? []) {
    names.set(event.id, `${locale === 'ja' ? 'イベント' : 'Event'} ${/-(\d+)$/.exec(event.id)?.[1] ?? event.turn}`);
    const { unitId, unitType } = event.payload;
    if (typeof unitId === 'string' && typeof unitType === 'string' && !names.has(unitId)) {
      const location = typeof event.payload.q === 'number' && typeof event.payload.r === 'number' ? `(${event.payload.q},${event.payload.r})` : '';
      names.set(unitId, `${unitLabel(unitType,locale)} ${/-(\d+)$/.exec(unitId)?.[1] ?? location}`.trim());
    }
  }
  for (const facility of state.facilities) names.set(facility.id, `${facilityLabel(facility.type,locale)} (${facility.position.q},${facility.position.r})`);
  for (const checkpoint of state.checkpoints) names.set(checkpoint.id, `${locale==='ja'?'検問所':'Checkpoint'} (${checkpoint.position.q},${checkpoint.position.r})`);
  for (const branch of state.map.roadBranches) names.set(branch.id, locale==='ja' ? ({north:'北支線',south:'南支線',east:'東支線',west:'西支線'}[branch.id] ?? '支線') : `${branch.id[0]!.toUpperCase()}${branch.id.slice(1)} branch`);
  return names;
}

/** Apply only to rendered prose. Input values, data attributes and export code stay byte-identical. */
export function localizeHumanReferences(root: HTMLElement, names: ReadonlyMap<string,string>): void {
  const identifiers = [...names.keys()].filter(id=>!['north','south','east','west'].includes(id)).sort((a,b)=>b.length-a.length);
  if (!identifiers.length) return;
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])(?:${identifiers.map(id=>id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})(?![A-Za-z0-9_-])`, 'g');
  const replace = (value:string) => value.replace(pattern,id=>names.get(id)!);
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while(walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest('textarea, input, script, style, pre, code, [data-noise-debug-mount]')) continue;
    const value=replace(node.data); if(value!==node.data) node.data=value;
  }
  root.querySelectorAll<HTMLElement>('[aria-label], [title]').forEach(element=>{
    for(const attr of ['aria-label','title']) { const value=element.getAttribute(attr); if(value) element.setAttribute(attr,replace(value)); }
  });
}
