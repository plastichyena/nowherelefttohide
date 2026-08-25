import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import type { GameConfig, HeadlessGame } from './types';

/** Factory kept separate from rendering so CI can run the complete rule set. */
export function createHeadlessGame(seed = 1, config: GameConfig = createDefaultConfig()): HeadlessGame {
  return new GameEngine(seed, config);
}

export { GameEngine } from './engine';
