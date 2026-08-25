import { expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { runRandomTestGames } from './randomAgent';

it('completes 100 deterministic headless random games without invariant failures', () => {
  // A lower action cap is a test-agent Config, not a separate rules path. It
  // forces turn progression while still exercising every atomic action type.
  const config = createDefaultConfig({ maxActionsPerTurn: 8 });
  const failures = runRandomTestGames(Array.from({ length: 100 }, (_, index) => index + 1), config);
  expect(failures).toEqual([]);
}, 120_000);
