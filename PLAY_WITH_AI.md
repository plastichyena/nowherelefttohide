# Play Nowhere Left to Hide with an AI

This repository is designed so an external AI/LLM can play the same game rules as a human without reading private `GameState` internals. The current release is v1.4.2.

The portable AI package produced by GitHub Actions contains this repository, installed dependencies, and a Linux x64 Node.js runtime. No separate Node.js installation or `npm install` is required after extracting the package.

## Intended use

Give the extracted package (or its ZIP) to an AI environment that can inspect files and execute local commands, then ask it to play the game. A useful prompt is:

```text
Play Nowhere Left to Hide as the governor. Use the Session CLI and only its public observations, legal actions, step results, events, and your own Public Decision Log. Create a Session, inspect status, submit exactly one listed action with a short public decisionSummary per step, and continue until Game Over. If this response must end, report the Session ID so the next response can resume it with status. At the end, report the result and retain the artifact.
```

## Portable package commands

From the extracted package root, create a persistent Session:

```bash
./run-session.sh new --session-id=my-game --seed=1 --agent-id=my-agent
./run-session.sh status --session=my-game
```

`status` is also the resume command: run it with the same Session ID in a later process or AI response. It returns the current public observation, legal actions, Session metadata, and Game Over status in one JSON value. There is intentionally no separate `resume` command.

Choose exactly one action from `legalActions`, then submit it with a short public rationale. `step` accepts JSON from standard input or `--input`:

```bash
printf '%s\n' '{"action":{"type":"EndTurn"},"decisionSummary":"No higher-priority legal action remains."}' | \
  ./run-session.sh step --session=my-game

./run-session.sh step --session=my-game --input=next-step.json
```

The `decisionSummary` is required, must contain 1–500 Unicode code points after trimming, and should be a concise public explanation or reason code—not private chain-of-thought. A malformed request is rejected without consuming a Decision number. A well-formed but illegal action is recorded as a rejected Decision without changing game state or RNG; inspect the returned error and current legal actions before retrying.

The complete seven-command interface is:

- `new`: create a new, non-overwriting Session
- `status`: inspect or resume the current Active Session
- `step`: apply one action plus `decisionSummary`
- `save-checkpoint`: create a manual Checkpoint
- `list-checkpoints`: list public Checkpoint metadata
- `load-checkpoint`: branch from a Checkpoint into a required new Session ID
- `artifact`: obtain the current or final public Run Artifact

Checkpoint and branch example:

```bash
./run-session.sh save-checkpoint --session=my-game
./run-session.sh list-checkpoints --session=my-game
./run-session.sh load-checkpoint --session=my-game \
  --checkpoint=PASTE_RETURNED_CHECKPOINT_ID --new-session-id=my-branch
./run-session.sh status --session=my-branch
./run-session.sh artifact --session=my-branch
```

Use the exact Checkpoint ID returned by `save-checkpoint` or `list-checkpoints`; the example ID is illustrative. Loading never rewinds or overwrites the parent Session. It creates a child Session whose lineage and public history continue from that Checkpoint. Automatic Checkpoints are created after every five completed turns by default (configurable with positive `--checkpoint-interval` on `new`), and a final Checkpoint is created at Game Over.

Session data defaults to `output/sessions`; pass the same `--root=PATH` to every command to use another root. Active state is committed after each well-formed Decision, so a later `status` continues the same Decision Log and Run Artifact. If Active data is reported corrupt or incompatible, do not edit private files and do not expect an automatic rollback: list the valid Checkpoints and explicitly create a new branch with `load-checkpoint`.

The Session directory includes a private Save Format 7 checkpoint state solely so the runtime can resume deterministically. Do not inspect or use private state, RNG state, hidden enemies/targets, or non-public configuration for decisions. The public `trace.ndjson`, CLI JSON, and Artifact Schema 3.0.0 output are the fair-play record; their Decision hash chain detects accidental damage or inconsistency but is not a cryptographic authenticity guarantee against someone rewriting every file coherently.

For a quick built-in-agent smoke test instead of an interactive Session:

```bash
./run-npm.sh run sim -- --agent=balanced --games=1 --seed=1 --out=output/ai-smoke --overwrite
```

This runs the built-in Balanced Agent and is a quick way to verify that the bundled runtime works. The package workflow separately exercises all seven Session commands with the bundled Node.js runtime.

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
9. report `getResult()` and keep `getRunArtifact()` as a public play trace for debugging

## v1.4.2 tactical context

Use the current `AgentObservation` as the source of truth for conditional forecasts. It does not reveal future random draws or private state.

- Map tiles expose base terrain, road/urban overlays, effective movement cost, terrain defense, and `visibleToPlayer`. Human movement, zombies, replay, and agents share the same weighted pathfinding rules.
- Enemy arrays contain only currently visible `zombie` and `hordeZombie` units. Never infer hidden enemies from missing movement or checkpoint actions: public planning treats hidden occupied hexes as empty, and execution can stop movement safely when one is encountered.
- Police and National Guard have vision 5, Movement 10, individual Fuel pools, and individual carried Military Goods. Use `currentFuel`, `maxFuel`, `currentMilitaryGoods`, `maxMilitaryGoods`, and the exact legal-move/attack previews rather than reconstructing costs.
- With Fuel above 0, moves use the normal Unit-type Fuel formula. With Fuel exactly 0, Police retain 3 effective MP and National Guard 2 effective MP as Emergency Movement. Legal moves identify `movementMode`, exact `effectiveMovementCost`, Fuel cost, and projected Fuel. Forest/Mountain still cost 2/3 MP, Fuel stays 0, and a surviving Unit may still Attack or Wait after moving. Supplied Units can refill Fuel at End Turn; an unsupplied Unit can use Emergency Movement again next turn.
- Police carry up to 5 Military Goods and have no fixed End Turn consumption. National Guard carry up to 20 and consume 1 at the start of End Turn economy. After Military Factory production, supplied Units refill from national stock in Unit-ID ascending round-robin order; unsupplied Units do not refill. Remaining carried Fuel and Military Goods are lost when a Unit is destroyed.
- A distance-1 attack costs 1 Military Good when available. At 0, Police/National Guard may still attack at distance 1 with effective attack 1/2 and consume 0. National Guard distance 2 requires and consumes 2; it is not legal with only 0 or 1. Read `attackPreviews` for distance, cost, projected balance, effective attack, and terrain-adjusted damage. The same ammunition rules govern counterattack and interception.
- The Capital, owned facilities, and active checkpoints add shared visibility. Wind Power Plant also gives Vision 1. A powered Civilian Drone Base gives Vision `workers × 2`. Standby and Dormant checkpoints do not. The outer 120-hex Horde Spawn Reserve has `playerOccupancyAllowed=false`: Player Units, Player facilities, and Checkpoints cannot enter, stop, or be placed there, while Zombie movement, attacks, damage, interception, and attacks against visible Zombies remain legal.
- Standard fixed Waves spawn at Turn 5 (1 direction, 2/1 Horde/Normal), Turn 10 (2, 1/2), Turn 20 (1, 4/4), Turn 35 (3, 2/4), and Turn 50 (4, 4/5 Final). Warning Lead is 2 turns; after warning begins, all selected directions are public. The Final Wave has four direction groups and 36 units. Do not infer pre-warning directions, Spawn Group IDs, exact positions, or hidden counts.
- There is no game-rule turn limit. After the Final Horde spawns on the configured turn, play continues until defeat or all three public victory flags are true: `finalHordeDefeated`, `suppliedAreaZombieClear`, and `suppliedAreaInfectionClear`.

- A surviving supplied unit recovers at the next player-turn start. Combat, counterattack, interception, or automatic infection suppression uses the configured 10% combat rate; only moving, waiting, or taking no action uses the configured 20% rest rate; out of supply is 0%. The observation reports the class, rate, base amount, timing, and survival/supply conditions.
- A police or National Guard unit stationed at an infected location contains internal spread regardless of its carried Military Goods. If it still has an attack available and has at least 1 Military Good after refill, automatic suppression consumes 1 during the infection phase. At 0 it only contains spread: it does not suppress and does not consume its attack. Police suppression has no civilian damage; National Guard suppression is stronger but can cause civilian damage.
  - Use `baseRange`, `effectiveRange`, attack previews, and shortage reasons rather than assuming a unit's range. National Guard distance 2 is available only while it can pay the cost of 2; the removed global `militarySupplyAvailable` state is not part of v1.4.2.
- Wind Power Plant supplies 15 Electricity at Fuel 0 and has Zombie Target Value 5, but no civilian population or Supply source. Its disabled/recovering state supplies neither power nor vision. `zombieTargetValue` is distinct from real population and must not be treated as consumption or Defeat population.
- `BuildConstructibleFacility` creates a Simple Farm (Civilian Goods 15) or Civilian Drone Base (Civilian Goods 25) only on a Core-listed supplied, empty Plain Hex with no road, urban overlay, entrance, Player Unit, or visible Zombie. Build Turn is inactive; operations begin next Player Turn. Read `constructibleFacilityPositionCandidates` rather than reconstructing legality.
- Simple Farm has Power Mode `none` and produces Food 5 per worker without Electricity. Civilian Drone Base has Power Mode `required`, needs 5 Electricity, and provides Vision 2 per worker when powered. Both have independent per-type cap `ceil(roadBranchCount / 2)`, preserve existing workers/functions outside Supply, but cannot gain workers there.
- Cities require 5 power for population-derived Civilian Goods; without it, only that production stops and administration remains usable. Power allocation is Cities, permanent Farm/Civilian Factory, input-ready Military Factory, Refinery, then Drone Base; Simple Farm has no power demand. Generation uses turn-start Fuel at `Fuel 1 → Electricity 5`; same-turn Refinery output is unavailable to Power and Unit refills.
- Same-turn Food, Civilian Goods, and Military Goods production can pay same-turn maintenance. Same-turn output cannot become another production process's input. Increasing Civilian Goods production may release existing turn-start stock from the civilian-maintenance reservation to Military Factory input, but turn-start stock 0 still means no Military Factory input.
- Read `startingStock`, `projectedProduction`, `maintenanceRequired`, `endingStock`, and maintenance `shortage`. Fuel projection separately exposes Wind supply, Power Fuel, Unit refill demand/allocation, Refinery production, and ending stock. `strategicForecast` is the shared Core projection for resource dependency, single-point-of-failure, and Guaranteed Defeat warnings; prioritize a legal domestic remedy over combat when defeat is avoidable.
- Checkpoint observations show the role (`active`, `standby`, `dormant`, `remnant`, `ruined`, or `abandoned`), branch-owned policy and `currentPolicyTurns`, queue total/throughput/arrival ranges/Queue Pressure, and Core-generated `checkpointPositionCandidates` for every branch road tile. Candidates include projected radius, supply deltas, and newly buildable Hexes. Read `legal` and `reasonCode` instead of reconstructing rules; `fallbackAvailable` is structural only and hidden enemies never make a candidate illegal or appear through candidate differences.
- Human-involved normal combat emits a public Noise event with its known center, source unit type, and Noise Class. Both Police and National Guard publish `medium`. Do not infer or seek an exact Noise Radius, affected zombie IDs/counts, or zombie Noise Target memory; those are not player-visible and are absent from production results and Browser Bridge artifacts. A Browser Bridge artifact is a public trace, not a complete verification replay artifact; local/CI verification artifacts retain the exact configuration required for deterministic replay.

There is no public `SuppressInfection` action. Infection response is resolved by the engine at End Turn, so select a listed movement, attack, wait, domestic, checkpoint, or End Turn action instead.

## Fair-play boundary

The AI player should not use `GameEngine.getState()`, `AgentGameAdapter.getDebugState()`, save internals, hidden future random values, or other non-public implementation details to make decisions. Those exist for development and diagnostics, not as player-visible information.

The intended information boundary is the same one used by the built-in Agent platform and Human UI: public Observation plus currently legal actions. App `1.4.2` uses Game Rules `2.2.0`, Agent/Observation/Browser Bridge API `4.0.0`, Fixed Map `fixed-31x31-v1`, Save Format `7`, Artifact Schema `3.0.0`, Checkpoint Schema `1.0.0`, Balanced Agent `4.2.0`, and Random Agent `2.2.0`. Artifact Schema 3.0.0 stores fixed topology once, includes public Wave/Warning state, Metrics, the public Decision Log and optional Session lineage, and keeps private Checkpoint state outside player-facing artifacts.

## Package layout

A generated package has this general structure:

```text
nowhere-left-to-hide-ai-<version>-<commit>-linux-x64/
├─ PLAY_WITH_AI.md
├─ BUILD_INFO.txt
├─ run-npm.sh
├─ run-vite-node.sh
├─ run-session.sh
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
