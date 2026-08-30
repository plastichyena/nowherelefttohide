# Play Nowhere Left to Hide with an AI

This repository is designed so an external AI/LLM can play the same game rules as a human without reading private `GameState` internals. The current release is v1.3.1.

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

- `getApiInfo()`
- `reset(options?)`
- `getObservation()`
- `getLegalActions()`
- `step(action)`
- `isGameOver()`
- `getResult()`
- `getRunArtifact()`

Recommended loop:

1. `getApiInfo()` to read the versioned contract and static rules
2. `reset`
3. inspect `getObservation`
4. inspect `getLegalActions`
5. choose exactly one listed legal action
6. explain the reason for the choice
7. call `step`
8. repeat until `isGameOver()` is true
9. report `getResult()` and keep `getRunArtifact()` for replay/debugging

## v1.3 tactical context

Use the current `AgentObservation` as the source of truth for conditional forecasts. It does not reveal future random draws or private state.

- Map tiles expose base terrain, road/urban overlays, effective movement cost, terrain defense, and `visibleToPlayer`. Human movement, zombies, replay, and agents share the same weighted pathfinding rules.
- Enemy arrays contain only currently visible `zombie` and `hordeZombie` units. Never infer hidden enemies from missing movement or checkpoint actions: public planning treats hidden occupied hexes as empty, and execution can stop movement safely when one is encountered.
- Police and National Guard have vision 5. The Capital, owned facilities, and operational checkpoints add shared visibility. Hidden enemy positions, IDs, target memory, spawn coordinates, and counts are not public.
- Periodic Hordes spawn as `hordeZombie` units before the Final Horde. The observation always exposes warning type, direction, remaining turns, spawn turn, and Final Horde status—but not size or exact spawn positions.
- There is no game-rule turn limit. After the Final Horde spawns on the configured turn, play continues until defeat or all three public victory flags are true: `finalHordeDefeated`, `suppliedAreaZombieClear`, and `suppliedAreaInfectionClear`.

- A surviving supplied unit recovers at the next player-turn start. Combat, counterattack, interception, or automatic infection suppression uses the configured 10% combat rate; only moving, waiting, or taking no action uses the configured 20% rest rate; out of supply is 0%. The observation reports the class, rate, base amount, timing, and survival/supply conditions.
- A police or National Guard unit stationed at an infected location contains internal spread. If it still has an attack available and did not spend it on normal combat, the engine can automatically suppress during the infection phase after End Turn. Police suppression has no civilian damage; National Guard suppression is stronger but can cause civilian damage.
- Use `baseRange` and `effectiveRange` rather than assuming a unit's range. National Guard is base range 2, falling to effective range 1 while military supply is short.
- Production-facility worker capacity is 30. Cities require 5 power for population-derived Civilian Goods; without it, only that production stops and administration remains usable. Farm, Civilian Factory, and Military Factory produce at ×1 without power and ×2 when supplied with 5 power. Refinery and Power Plant are not boost targets.
- Generation uses only turn-start Fuel at `Fuel 1 → Electricity 5`, consumes Fuel only for complete five-power facility allocations, and never uses same-turn Refinery output. Allocation order is required cities, Farm/Civilian Factory boosts, then input-ready Military Factory boosts. `SetPowerSupply` toggles an industrial boost request.
- Same-turn Food, Civilian Goods, and Military Goods production can pay same-turn maintenance. Same-turn output cannot become another production process's input. Increasing Civilian Goods production may release existing turn-start stock from the civilian-maintenance reservation to Military Factory input, but turn-start stock 0 still means no Military Factory input.
- Read `startingStock`, `projectedProduction`, `maintenanceRequired`, `endingStock`, and maintenance `shortage`. Treat Civilian Goods `productionInputShortage` as Military Factory curtailment rather than civilian deaths, and distinguish Fuel demand/usage from physical generation limits.
- Checkpoint observations show screening pools and current policy. `getApiInfo().rules.checkpointPolicies` gives the static screening time, acceptance, infection chance, and infected-population rate for Pass through, Normal, and Strict. These are trade-offs; no policy is always correct.

There is no public `SuppressInfection` action. Infection response is resolved by the engine at End Turn, so select a listed movement, attack, wait, domestic, checkpoint, or End Turn action instead.

## Fair-play boundary

The AI player should not use `GameEngine.getState()`, `AgentGameAdapter.getDebugState()`, save internals, hidden future random values, or other non-public implementation details to make decisions. Those exist for development and diagnostics, not as player-visible information.

The intended information boundary is the same one used by the built-in Agent platform and Human UI: public Observation plus currently legal actions. App `1.3.1` uses Game Rules, Agent, Observation, Bridge, and Artifact contracts `1.4.0`, Save Format `3`, Balanced Agent `3.0.0`, and Random Agent `1.2.0`.

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
