# Play Nowhere Left to Hide with an AI

This repository is designed so an external AI/LLM can play the same game rules as a human without reading private `GameState` internals. The current release is v1.5.1.

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

`status` is also the resume command: run it with the same Session ID in a later process or AI response. There is intentionally no separate `resume` command. `new`, `status`, `step`, and `load-checkpoint` return a Compact public snapshot by default: the Version, Session ID, Revision, turn/phase/Game Over state, public resources and population, every owned Unit's basic status, owned Facility/Checkpoint state, visible enemies, Crisis Summary, End Turn Forecast summary, Horde warning, available action kinds, and a route to the corresponding detail query. It never silently omits a Unit or candidate; it omits repeated fixed-map data, complete candidate lists, cost tables, and historical Observations from the ordinary response.

Choose exactly one action from `legalActions`, then submit it with a short public rationale. `step` accepts JSON from standard input or `--input`:

```bash
printf '%s\n' '{"action":{"type":"EndTurn"},"decisionSummary":"No higher-priority legal action remains.","expectedRevision":0}' | \
  ./run-session.sh step --session=my-game

./run-session.sh step --session=my-game --input=next-step.json
```

The `decisionSummary` is required, must contain 1–500 Unicode code points after trimming, and should be a concise public explanation or reason code—not private chain-of-thought. `expectedRevision` is optional but recommended: use the Revision returned by the last command. A mismatch is rejected as `stale_revision` before an Action or Decision number is applied. A malformed request is rejected without consuming a Decision number. A well-formed but illegal action is recorded as a rejected Decision without changing game state or RNG; inspect the returned error and current Compact snapshot before retrying.

The complete eight-command interface is:

- `new`: create a new, non-overwriting Session
- `status`: inspect or resume the current Active Session
- `step`: apply one action plus `decisionSummary`
- `save-checkpoint`: create a manual Checkpoint
- `list-checkpoints`: list public Checkpoint metadata
- `load-checkpoint`: branch from a Checkpoint into a required new Session ID
- `query`: read one Revision-pinned public detail target
- `artifact`: stream the current or final public Run Artifact Package and return a small manifest

`query` does not change State, RNG, Decision numbers, or the accepted Action sequence. Its targets are `api`, `map`, `units`, `facilities`, `checkpoints`, `branches`, `construction`, `legal-actions`, `forecast`, `history`, and `full-snapshot`. It returns `sessionId`, `revision`, `target`, `count`, `hasMore`, `nextCursor`, and either `items` or `value`. List targets use a stable order without duplicates. A cursor is tied to its Session and Revision: never reuse it after State changes. Pages default to 100 items and accept at most 500. Use `--target`, optional `--revision`, `--cursor`, and `--page-size`; pass target filters as JSON with `--input=PATH`.

```bash
./run-session.sh query --session=my-game --target=legal-actions --revision=0 --page-size=100
./run-session.sh query --session=my-game --target=full-snapshot --revision=0
./run-session.sh query --session=my-game --target=full-snapshot --revision=0 --out=snapshot.json
```

Use `query --out=PATH` to stream the complete query response into a new JSON file and return only small output metadata on standard output. Existing output files are rejected. Standard output also streams with backpressure when `--out` is omitted.

Checkpoint and branch example:

```bash
./run-session.sh save-checkpoint --session=my-game
./run-session.sh list-checkpoints --session=my-game
./run-session.sh load-checkpoint --session=my-game \
  --checkpoint=PASTE_RETURNED_CHECKPOINT_ID --new-session-id=my-branch
./run-session.sh status --session=my-branch
./run-session.sh query --session=my-branch --target=history --page-size=100
./run-session.sh artifact --session=my-branch --out=my-branch.nlth-artifact
```

Use the exact Checkpoint ID returned by `save-checkpoint` or `list-checkpoints`; the example ID is illustrative. Loading never rewinds or overwrites the parent Session. It creates a child Session whose lineage and public history continue from that Checkpoint. Automatic Checkpoints are created after every five completed turns by default (configurable with positive `--checkpoint-interval` on `new`), and a final Checkpoint is created at Game Over.

Session data defaults to `output/sessions`; pass the same `--root=PATH` to every command to use another root. Active state is committed after each well-formed Decision, so a later `status` continues the same Decision Log and Run Artifact. `artifact --out=PATH` creates a self-contained public Artifact Package directory without placing its full JSON on standard output; the response is a small manifest with the package path, schema, hash, and count. The result is stored in the Artifact stream footer. The directory contains `manifest.json`, streaming `artifact.ndjson`, and deduplicated public payloads. If Active data is reported corrupt or incompatible, do not edit private files and do not expect an automatic rollback: list the valid Checkpoints and explicitly create a new branch with `load-checkpoint`.

The Session directory includes a private Save Format 11 checkpoint state solely so the runtime can resume deterministically. Session/Checkpoint Schema 4 stores immutable generation data, compressed/chunked public payloads, compact Decision records, lossless patches, and hash-chain references so a long history is not repeatedly materialized in ordinary commands. Do not inspect or use private state, RNG state, hidden enemies/targets, Rejected Refugee counters, or non-public configuration for decisions. The public Decision Log, CLI JSON, and Artifact Schema 7.0.0 output are the fair-play record; their Decision hash chain detects accidental damage or inconsistency but is not a cryptographic authenticity guarantee against someone rewriting every file coherently.

For a quick built-in-agent smoke test instead of an interactive Session:

```bash
./run-npm.sh run sim -- --agent=balanced --games=1 --seed=1 --summary-only --out=output/ai-smoke --overwrite
```

This runs the built-in Balanced Agent and is a quick way to verify that the bundled runtime works. The package workflow separately exercises all eight Session commands, file Artifact export, and public API drivers for Seeds 1 and 7 with the bundled Node.js runtime.

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
- `getArtifactPage(options?)`

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

`getRunArtifact()` remains the complete public Artifact API. For a bounded read of a large trace, use `getArtifactPage({ target, offset?, pageSize?, expectedRevision? })`. The allowed targets are `manifest`, `observations`, `actions`, `events`, and `invalid-attempts`; it returns the current Revision, target, `count`, `total`, `hasMore`, `nextOffset`, and public `items`. Pages default to 100 items and cannot exceed 500. It is read-only; an old `expectedRevision` is rejected without changing the game.

## v1.5.1 tactical context

Use the current `AgentObservation` as the source of truth for conditional forecasts. It does not reveal future random draws or private state.

- Map tiles expose base terrain, road/urban overlays, effective movement cost, terrain defense, and `visibleToPlayer`. Human movement, zombies, replay, and agents share the same weighted pathfinding rules.
- Enemy arrays contain only currently visible `zombie`, `hordeZombie`, `policeZombie`, `soldierZombie`, `riotZombie`, and `hunterZombie` units. Never infer hidden enemies from missing movement or checkpoint actions: public planning treats hidden occupied hexes as empty, and execution can stop movement safely when one is encountered.
- Human Units expose `proficiency` (`recruit`, `regular`, or `veteran`), survival/kill counters, `attackChargesRemaining`, and `maxAttackCharges`. Initial Units are Regular; newly produced Police, National Guard, and Riot Police are Recruit by default. Recruit Units become Regular after five surviving Player Turns. A Regular Unit's fifth direct Zombie kill enters promotion-pending state and becomes Veteran at the next Player Turn Start; Veteran Units have two Attack Charges.
- Police has HP 25, Recruit Attack 6, Regular/Veteran Attack 8, Vision 5, and Movement 15. National Guard has HP 50, Recruit Attack 12, Regular/Veteran Attack 15, Vision 5, and Movement 10. Riot Police has HP 75, Recruit Attack 9, Regular/Veteran Attack 12, Movement 10, Range 1, Vision 5, and Population 10. Riot Police uses Police-family fuel and suppression rules, but its public combat Noise class is `medium` (its internal radius is not public). Use `currentFuel`, `maxFuel`, `currentMilitaryGoods`, `maxMilitaryGoods`, and the exact legal-move/attack previews rather than reconstructing costs.
- With Fuel above 0, moves use the normal Unit-type Fuel formula. With Fuel exactly 0, Police retain 3 effective MP and National Guard 2 effective MP as Emergency Movement. Legal moves identify `movementMode`, exact `effectiveMovementCost`, Fuel cost, and projected Fuel. Forest/Mountain still cost 2/3 MP, Fuel stays 0, and a surviving Unit may still Attack or Wait after moving. Supplied Units can refill Fuel at End Turn; an unsupplied Unit can use Emergency Movement again next turn.
- Police carry up to 5 Military Goods and have no fixed End Turn consumption. National Guard carry up to 20 and consume 1 at the start of End Turn economy. After Military Factory production, supplied Units refill from national stock in Unit-ID ascending round-robin order; unsupplied Units do not refill. Remaining carried Fuel and Military Goods are lost when a Unit is destroyed.
- A distance-1 attack costs 1 Military Good when available. At 0, Police, National Guard, and Riot Police may still attack at distance 1 for 0 ammunition, with attack reduced to 20%, rounded up with a minimum of 1 (Regular values: 2/3/3). National Guard distance 2 requires and consumes 2; it is not legal with only 0 or 1. Read `attackPreviews` for distance, cost, projected balance, effective attack, and terrain-adjusted damage. The same ammunition rules govern counterattack and interception.
- Player Units, the Capital (radius 5), owned facilities, and Active checkpoints provide Ground Vision. Forest and Mountain are visible blockers that hide Hexes beyond them. A powered Civilian Drone Base provides terrain-ignoring Aerial Vision `workers × 3`, up to 15; its observation uses `visionMode: aerial`. Use Core-projected visibility and never reconstruct hidden lines.
- Standard fixed Waves spawn at Turn 5 (1 direction, 3 Horde + 3 non-Horde slots), Turn 10 (2, 2 + 5), Turn 20 (1, 5 + 7), Turn 35 (3, 3 + 7), and Turn 50 (4, 5 + 8 Final). Each non-Horde slot is deterministically drawn from `zombie` (70), `policeZombie` (10), `soldierZombie` (10), `riotZombie` (5), or `hunterZombie` (5). Riot and Hunter are independently capped at one per direction per Wave; after either cap is reached, the remaining weights are renormalized. Warning Lead is 2 turns and exposes only slot count and possible types; the concrete draw is first public after Spawn. Do not infer pre-warning directions, Spawn Group IDs, exact positions, or hidden counts.
- A new game retains its 25 Normal Zombies and adds a seed-determined 1–4 Hunter Zombies. Hunters start at least 20 hexes from the Capital and never occupy a Reserve, permanent Facility, Human Unit, Normal Zombie, or another Hunter. A Hunter has HP 20, Attack 15, weighted Movement 15, Range 1, Vision 5, and one Attack Charge. It uses the same Normal Zombie target priority and Noise behavior as Police/Soldier/Riot Zombies; it has no privileged Capital target or terrain-ignoring movement.
- Normal Zombies have HP 15; Horde Zombies have HP 40 and two shared Attack Charges; Police/Soldier/Riot/Hunter Zombies each have one. A Horde Zombie can use its remaining Charge for a second legal active attack after resolution of the first, but may move only once and never moves again after attacking. Counterattack and interception consume the same Charge pool.
- A fallen facility or checkpoint converts each 5 actually infected people into one Normal Zombie, up to 6 per resolution, using only empty passable adjacent Hexes. Unconverted infection remains at permanent sites, constructible remnants die when removed, and Wind Power Plants never create infected population. Generated Zombies occupy their Hex immediately, can trigger FIFO site chains, and wait until the next Zombie phase to act normally.
- `importantSiteEvents` contains the latest 50 public infection/fall/spawn/chain facts even for off-screen sites. Site IDs, types, site coordinates, infected-at-fall, requested/actual counts, remaining infection, and chain origin are public; generated Zombie IDs, exact Spawn Hexes, targets, and hidden reaction details are not.
- There is no game-rule turn limit. After the Final Horde spawns on the configured turn, play continues until defeat or all three public victory flags are true: `finalHordeDefeated`, `suppliedAreaZombieClear`, and `suppliedAreaInfectionClear`.

- A surviving supplied unit recovers at the next player-turn start. Combat, counterattack, interception, or automatic infection suppression uses the configured 10% combat rate; only moving, waiting, or taking no action uses the configured 20% rest rate; out of supply is 0%. The observation reports the class, rate, base amount, timing, and survival/supply conditions.
- A Police, Riot Police, or National Guard unit stationed at an infected location contains internal spread regardless of its carried Military Goods. Automatic suppression can use every remaining Attack Charge that can pay its Military Goods cost. Police/Riot suppression has no civilian damage; National Guard suppression is stronger but can cause civilian damage. `endTurnRisk` summarizes ready Units, remaining charges, legal attacks, and uncontained sites without changing legality or state.
  - Use `baseRange`, `effectiveRange`, attack previews, and shortage reasons rather than assuming a unit's range. National Guard distance 2 is available only while it can pay the cost of 2; the removed global `militarySupplyAvailable` state is not part of v1.5.1.
- Wind Power Plant supplies 15 Electricity at Fuel 0 and has Zombie Target Value 5, but no civilian population or Supply source. Its disabled/recovering state supplies neither power nor vision. `zombieTargetValue` is distinct from real population and must not be treated as consumption or Defeat population.
- `BuildConstructibleFacility` creates a Simple Farm (Civilian Goods 15) or Civilian Drone Base (Civilian Goods 25) only on a Core-listed supplied, empty Plain Hex with no road, urban overlay, entrance, Player Unit, or visible Zombie. Build Turn is inactive; operations begin next Player Turn. Read `constructibleFacilityPositionCandidates` rather than reconstructing legality.
- Simple Farm has Power Mode `none` and produces Food 5 per worker without Electricity, with one per road branch. Civilian Drone Base has Power Mode `required`, needs 5 Electricity, and provides Vision 3 per worker when powered. Both preserve existing workers/functions outside Supply, but cannot gain workers there.
- Cities require 5 power for population-derived Civilian Goods; without it, only that production stops and administration remains usable. Power allocation is Cities, permanent Farm/Civilian Factory, input-ready Military Factory, Refinery, then Drone Base; Simple Farm has no power demand. Generation uses turn-start Fuel at `Fuel 1 → Electricity 5`; same-turn Refinery output is unavailable to Power and Unit refills.
- Same-turn Food, Civilian Goods, and Military Goods production can pay same-turn maintenance. Same-turn output cannot become another production process's input. Increasing Civilian Goods production may release existing turn-start stock from the civilian-maintenance reservation to Military Factory input, but turn-start stock 0 still means no Military Factory input.
- Read `startingStock`, `projectedProduction`, `maintenanceRequired`, `endingStock`, and maintenance `shortage`. Fuel projection separately exposes Wind supply, Power Fuel, Unit refill demand/allocation, Refinery production, and ending stock. `strategicForecast` is the shared Core projection for resource dependency, single-point-of-failure, and Guaranteed Defeat warnings; prioritize a legal domestic remedy over combat when defeat is avoidable.
- Checkpoint observations show the role (`active`, `standby`, `dormant`, `remnant`, `ruined`, or `abandoned`), branch-owned policy and `currentPolicyTurns`, queue total/throughput/arrival ranges/Queue Pressure, and Core-generated `checkpointPositionCandidates` for every branch road tile. Build and relocation require the target and every branch road Hex from the capital side through it to be in current Player Vision; Facility Hexes are never valid, and each branch allows five prepared Active + Standby posts. Candidates include projected radius, supply deltas, and newly buildable Hexes. Read `legal` and `reasonCode` instead of reconstructing rules; `fallbackAvailable` is structural only and hidden enemies never make a candidate illegal or appear through candidate differences. Healthy Queue population consumes maintenance but does not contribute to city overcrowding.
- A listed `TurnAwayCheckpointRefugees` action may remove a legal number of waiting refugees. The direction/policy rejection counters, exact future bonus count, and reset state are private: treat the future Horde effect as a qualitative risk only. A first Checkpoint built on a branch costs 5 Civilian Goods; later Build and Relocate actions cost 25.
- A listed `DecommissionConstructibleFacility` action only removes an eligible Civilian Drone Base and returns its Core-calculated Civilian Goods refund. It never removes a Simple Farm.
- Human-involved normal combat and Horde Zombie movement emit common public Noise events after their respective resolution. Police publishes `medium`, Riot Police `medium`, National Guard `large`, and Horde movement uses a fixed Radius 8 that is described as a rule rather than exposed as hidden target data. Nearby fallen permanent sites with at least 5 infected may respawn Zombies and start immediate FIFO chains. Do not infer or seek an exact Human Noise Radius, affected Zombie IDs/counts, Spawn Hexes, or Zombie Noise Target memory; those remain verification-only.

There is no public `SuppressInfection` action. Infection response is resolved by the engine at End Turn, so select a listed movement, attack, wait, domestic, checkpoint, or End Turn action instead.

`crisisSummary` is a deterministic index of public facts, ordered by `critical`, `warning`, and `advisory`. It includes reason codes for capital/site infection, checkpoint infection, supply risk, Horde warnings, guaranteed resource defeat, and recent public losses. Treat it as a reminder: it never reveals hidden enemies or future draws and never changes legal actions. `endTurnRisk` is likewise a decision aid for the current observation only.

When using the Session CLI, each `step` response also contains `stateDelta`, a public-only summary of newly infected/ruined sites, newly spotted or publicly lost enemies, Unit HP/supply changes, and Checkpoint role changes since the previous Decision. Ordinary `AgentObservation` and Human UI responses do not contain this Session-only field.

## Fair-play boundary

The AI player should not use `GameEngine.getState()`, `AgentGameAdapter.getDebugState()`, save internals, hidden future random values, or other non-public implementation details to make decisions. Those exist for development and diagnostics, not as player-visible information.

The intended information boundary is the same one used by the built-in Agent platform and Human UI: public Observation plus currently legal actions. App `1.5.1` uses Game Rules `4.0.0`, Agent/Observation/Browser Bridge API `8.0.0`, Fixed Map `fixed-51x51-v1`, Save Format `11`, Artifact Schema `7.0.0`, Checkpoint/Session Schema `4.0.0`, Balanced Agent `5.0.0`, and Random Agent `3.0.0`. Artifact Schema 7.0.0 packages public Wave/Warning/Site Event state, Metrics, a lossless public Decision Log, and lineage without private Checkpoint state. v1.5.0 and earlier Save, Replay, Artifact, Session, and Checkpoint data are rejected without conversion.

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
   ├─ dist/portable/session-cli.mjs  # pre-bundled Session CLI
   ├─ Doc/
   ├─ package.json
   ├─ package-lock.json
   └─ node_modules/      # already installed by GitHub Actions
```

The package is tied to a specific Git commit. `BUILD_INFO.txt` records the app version, commit SHA, and bundled Node.js version so a playthrough can be reproduced against the correct source revision.
