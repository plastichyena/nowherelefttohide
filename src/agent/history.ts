import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { createLosslessJsonDiff, applyLosslessJsonDiff } from '../session/public-diff';
import type { JsonPatchOperation } from '../session/types';
import type { JsonValue } from '../core/types';
import { cloneJson } from './action';
import { compactArtifactObservation, restoreArtifactObservation } from './observation';
import type { AgentArtifactObservation, AgentMapObservation, AgentObservation } from './types';

/** An array view that restores only the element being read. JSON writers can stream it. */
export function lazyArray<T>(length: number, read: (index: number) => T): T[] {
  return new Proxy(new Array<T>(length), {
    has(target, key) { return typeof key === 'string' && /^\d+$/u.test(key) ? Number(key) < length : key in target; },
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/u.test(key)) return Number(key) < length ? read(Number(key)) : undefined;
      return Reflect.get(target, key, receiver);
    },
  });
}

/** Public-only compressed snapshots and exact deltas, with a snapshot every 50 entries. */
export class ObservationHistory {
  private entries: Array<{ snapshot: boolean; bytes: Uint8Array }> = [];
  private previous: AgentArtifactObservation | null = null;
  private map: AgentMapObservation | null = null;
  private cachedIndex = -1;
  private cached: AgentArtifactObservation | null = null;
  private metricsHistory: ObservationHistory | null = null;
  public get length() { return this.entries.length; }
  public push(observation: AgentObservation): void {
    if (!this.map) this.map = cloneJson(observation.map);
    const compact = compactArtifactObservation(observation);
    const snapshot = this.length % 50 === 0;
    const payload = snapshot ? compact : createLosslessJsonDiff(this.previous as unknown as JsonValue, compact as unknown as JsonValue);
    this.entries.push({ snapshot, bytes: gzipSync(strToU8(JSON.stringify(payload))) });
    this.previous = compact;
    this.metricsHistory?.push(metricObservation(observation));
  }
  public compactAt(index: number): AgentArtifactObservation {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new Error('History index out of range');
    const start = Math.floor(index / 50) * 50;
    let next = start;
    let current: JsonValue | null = null;
    if (this.cached && this.cachedIndex >= start && this.cachedIndex <= index) {
      current = this.cached as unknown as JsonValue; next = this.cachedIndex + 1;
    }
    for (; next <= index; next += 1) {
      const entry = this.entries[next]!;
      const payload = JSON.parse(strFromU8(gunzipSync(entry.bytes)));
      current = entry.snapshot ? payload : applyLosslessJsonDiff(current!, payload as JsonPatchOperation[]);
    }
    this.cachedIndex = index; this.cached = current as unknown as AgentArtifactObservation;
    return cloneJson(this.cached!);
  }
  public at(index: number): AgentObservation {
    return restoreArtifactObservation(this.compactAt(index < 0 ? this.length + index : index), this.map!);
  }
  public view(): AgentObservation[] { return lazyArray(this.length, (index) => this.at(index)); }
  public metricView(): AgentObservation[] {
    if (!this.metricsHistory) {
      const projected = new ObservationHistory();
      for (let index = 0; index < this.length; index += 1) {
        projected.push(metricObservation(restoreArtifactObservation(this.compactAt(index), { ...this.map!, tiles: [] })));
      }
      this.metricsHistory = projected;
    }
    return this.metricsHistory.view();
  }
  public compactView(): AgentArtifactObservation[] { return lazyArray(this.length, (index) => this.compactAt(index)); }
}

/** Retain every metric input; move previews need only preserve empty/nonempty. */
export function metricObservation(observation: AgentObservation): AgentObservation {
  const recorded = cloneJson(observation);
  recorded.map.tiles = [];
  recorded.constructibleFacilityPositionCandidates = [];
  for (const unit of recorded.units) unit.fuelCostByLegalMove = unit.fuelCostByLegalMove.slice(0, 1);
  return recorded;
}
