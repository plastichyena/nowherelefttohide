import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { GameEngine } from '../core/engine';
import type { GameState } from '../core/types';
import {
  AutoSaveStore,
  decodeSaveCode,
  encodeSaveCode,
  exportSaveJson,
  importSaveJson,
} from './save';

function initialState(seed = 42): GameState {
  return new GameEngine(seed, createDefaultConfig()).getState() as GameState;
}

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('save format', () => {
  it('round-trips a complete GameState through Base64URL and JSON', () => {
    const state = initialState();
    const code = encodeSaveCode(state);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(code.length).toBeLessThan(exportSaveJson(state).length);
    expect(decodeSaveCode(code)).toMatchObject({ valid: true, state });

    const json = exportSaveJson(state);
    expect(importSaveJson(json)).toMatchObject({ valid: true, state });
  });

  it('rejects a tampered code before returning a snapshot', () => {
    const code = encodeSaveCode(initialState());
    const index = Math.floor(code.length / 2);
    const tampered = `${code.slice(0, index)}${code[index] === 'A' ? 'B' : 'A'}${code.slice(index + 1)}`;
    const result = decodeSaveCode(tampered);
    expect(result.valid).toBe(false);
    expect(result.state).toBeNull();
    expect(result.errors.join(' ')).toMatch(/checksum|decode|parse/i);
  });

  it('rejects version and invariant violations in JSON', () => {
    const envelope = JSON.parse(exportSaveJson(initialState())) as Record<string, unknown>;
    envelope.formatVersion = 999;
    expect(importSaveJson(JSON.stringify(envelope)).valid).toBe(false);

    const validEnvelope = JSON.parse(exportSaveJson(initialState())) as { state: GameState };
    validEnvelope.state.facilities[0]!.workers = validEnvelope.state.facilities[0]!.workerCapacity + 1;
    expect(importSaveJson(JSON.stringify(validEnvelope)).valid).toBe(false);
  });

  it('uses local storage for autosave and reports storage failures', () => {
    const storage = new MemoryStorage();
    const store = new AutoSaveStore({ storage });
    const saved = store.save(initialState(9));
    expect(saved.ok).toBe(true);
    expect(store.hasSave()).toBe(true);
    expect(store.load().valid).toBe(true);

    const messages: string[] = [];
    const unavailable = new AutoSaveStore({ storage: null, onError: (message) => messages.push(message) });
    expect(unavailable.save(initialState()).ok).toBe(false);
    expect(messages.length).toBe(1);
  });
});
