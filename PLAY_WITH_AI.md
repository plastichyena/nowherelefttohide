# Play Nowhere Left to Hide with an AI

This repository is designed so an external AI/LLM can play the same game rules as a human without reading private `GameState` internals.

The portable AI package produced by GitHub Actions contains this repository, installed dependencies, and a Linux x64 Node.js runtime. No separate Node.js installation or `npm install` is required after extracting the package.

## Intended use

Give the extracted package (or its ZIP) to an AI environment that can inspect files and execute local commands, then ask it to play the game. A useful prompt is:

```text
Play Nowhere Left to Hide as the governor. Use only the public AgentGame interface and player-visible observations. On each turn, inspect the observation and legal actions, explain briefly why you choose an action, apply exactly one legal action, and continue until Game Over. At the end, summarize the result and the decisions that mattered most.
```

## Portable package commands

From the extracted package root:

```bash
./run-npm.sh run sim -- --agent=balanced --games=1 --seed=1 --out=output/ai-smoke --overwrite
```

This runs the built-in Balanced Agent and is a quick way to verify that the bundled runtime works.

For custom TypeScript driver scripts, use the bundled `vite-node` launcher instead of installing tools globally:

```bash
./run-vite-node.sh game/path/to/your-driver.ts
```

A custom LLM player should import `createAgentGame` from `game/src/agent/game.ts` and interact only through the public AgentGame methods:

- `reset(options?)`
- `getObservation()`
- `getLegalActions()`
- `step(action)`
- `isGameOver()`
- `getResult()`
- `getRunArtifact()`

Recommended loop:

1. `reset`
2. inspect `getObservation`
3. inspect `getLegalActions`
4. choose exactly one listed legal action
5. explain the reason for the choice
6. call `step`
7. repeat until `isGameOver()` is true
8. report `getResult()` and keep `getRunArtifact()` for replay/debugging

## Fair-play boundary

The AI player should not use `GameEngine.getState()`, `AgentGameAdapter.getDebugState()`, save internals, hidden future random values, or other non-public implementation details to make decisions. Those exist for development and diagnostics, not as player-visible information.

The intended information boundary is the same one used by the built-in Agent platform: public Observation plus currently legal actions.

## Package layout

A generated package has this general structure:

```text
nowhere-left-to-hide-ai-<version>-<commit>-linux-x64/
├─ PLAY_WITH_AI.md
├─ BUILD_INFO.txt
├─ run-npm.sh
├─ run-vite-node.sh
├─ runtime/
│  └─ node/              # bundled Linux x64 Node.js runtime
└─ game/
   ├─ src/
   ├─ Doc/
   ├─ package.json
   ├─ package-lock.json
   └─ node_modules/      # already installed by GitHub Actions
```

The package is tied to a specific Git commit. `BUILD_INFO.txt` records the app version, commit SHA, and bundled Node.js version so a playthrough can be reproduced against the correct source revision.
