import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../core/engine';
import type { GameState } from '../core/types';
import { decodeSaveCode } from './save';

const v151Fixture = readFileSync(
  new URL('../testing/fixtures/v151-standard.save.txt', import.meta.url),
  'utf8',
).trim();

describe('v1.5.1 standard Save Format 11 compatibility', () => {
  it('decodes, loads, and continues the real v1.5.1 standard save fixture', () => {
    const decoded = decodeSaveCode(v151Fixture);
    expect(decoded.valid, decoded.errors.join('; ')).toBe(true);
    expect(decoded.state).toBeTruthy();
    const snapshot = decoded.state as GameState;
    const engine = new GameEngine(snapshot.seed);
    engine.reset(snapshot.seed, snapshot.config);

    const loaded = engine.step({ type: 'LoadSnapshot', snapshot });
    expect(loaded.error ?? null).toBeNull();
    expect(loaded.state.turn).toBe(snapshot.turn);
    expect(loaded.state.gameVersion).toBe(snapshot.gameVersion);

    const continued = engine.step({ type: 'EndTurn' });
    expect(continued.error ?? null).toBeNull();
    expect(continued.state.turn).toBeGreaterThanOrEqual(snapshot.turn);
    expect(continued.state.gameVersion).toBe(snapshot.gameVersion);
  });
});
