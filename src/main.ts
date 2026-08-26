import 'phaser';
import './styles.css';
import { GameUiController, type UiGameEngine } from './ui/controller';

const root = document.querySelector<HTMLElement>('#app');

interface EngineModule {
  GameEngine?: new () => UiGameEngine;
  default?: new () => UiGameEngine;
  previewMove?: (state: Readonly<import('./core/types').GameState>, unitId: string, destination: import('./core/types').HexCoord) => unknown;
}

async function loadEngineModule(): Promise<EngineModule> {
  // The core owns the rules; this adapter only keeps the UI resilient while
  // the engine module is code-split or replaced in headless builds.
  const module = await import('./core/engine');
  return module as unknown as EngineModule;
}

async function boot(): Promise<void> {
  if (!root) throw new Error('App root element is missing');
  let engineFactory: (() => UiGameEngine) | null = null;
  try {
    // Load once so the title screen can render immediately and all game
    // sessions use the same bundled GameEngine constructor.
    const engineModule = await loadEngineModule();
    const Constructor = engineModule.GameEngine ?? engineModule.default;
    if (!Constructor) throw new Error('GameEngine export is unavailable');
    engineFactory = () => {
      const engine = new Constructor();
      // Core currently exports previewMove as a pure function. Adapt that
      // export to the optional UI-facing method without changing GameState or
      // introducing a second rules path.
      if (engineModule.previewMove) {
        engine.previewMove = (unitId, destination) => engineModule.previewMove!(engine.getState(), unitId, destination);
      }
      return engine;
    };
  } catch (error) {
    root.innerHTML = `<main class="title-card"><h1>Nowhere Left to Hide</h1><p class="title-copy">Game Coreを読み込めません。${String(error instanceof Error ? error.message : error)}</p></main>`;
    return;
  }
  new GameUiController(root, engineFactory).mount();
}

void boot();
