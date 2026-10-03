import { createInitialState } from '../core/state';
import type { GameConfig } from '../core/types';
self.onmessage = (event: MessageEvent<{ seed: number; config: GameConfig }>) => {
  try {
    const state = createInitialState(event.data.seed,event.data.config,progress=>self.postMessage({kind:'progress',progress}));
    self.postMessage({kind:'complete',state});
  } catch(error) { self.postMessage({kind:'error',message:error instanceof Error?error.message:String(error)}); }
};
