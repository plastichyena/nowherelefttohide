# Play Nowhere Left to Hide with an AI

This repository is designed so an external AI/LLM can play the same game rules as a human without reading private `GameState` internals. The current release is v1.5.7.

The portable Player packages produced by GitHub Actions contain a bundled Session CLI, a standalone Linux x64 or Windows x64 Node.js runtime, the Session launcher, this guide, build identity, and the required license notices. They deliberately do not contain the repository checkout, `node_modules`, TypeScript, Vite, Vitest, development scripts, or board images. No separate Node.js installation or `npm install` is required after extracting a package.

## v1.5.7 decision aids and query discovery

Read `observation.importantChanges` after an action and on resume. Status retains important changes from the latest accepted EndTurn through the current decision, so an intervening move does not erase a production loss. Summaries are capped at ten entries and inner arrays at ten values; use their count/omission metadata and revision-pinned history hint for the full record. Branches exclude the parent's later decisions. `observation.combatHazards` lists up to five legal lethal Gas attacks that would kill public friendly units or topple owned sites; query units for complete attack previews before choosing an attack.

Resource `runway` under strategic forecast distinguishes current conditions from a hypothetical loss of the largest producer. Shortage turn 1 means the next EndTurn; zero remaining stock is not itself a shortage if that turn's demand was met. These are static estimates, not predictions of enemy actions. A null estimate carries `not_depleting`, `non_storable`, or a calculation-unavailable reason. Keep the existing `forecastSummary.endTurn.maintenanceBreakdown` in your assessment. Query road branches for `preparedPostCount` and `fallbackAvailable`; the latter describes structural fallback, not safety from hidden enemies.

Discover the JSON Schema 2020-12 query contract from your own Session:

```bash
./run-session.sh query --session=my-game --target=api --revision=0
./run-session.sh query --session=my-game --target=strategic-map --revision=0 --input=graph-filters.json
./run-session.sh query --session=my-game --target=route --revision=0 --input=route-filters.json
```

Replace revision 0 with the current returned revision. `graph-filters.json` contains `{"collection":"nodes"}` (use `edges` for the edge pages). `route-filters.json` can contain `{"moverUnitId":"police-1","destination":{"kind":"facility","id":"capital"}}`, using actual IDs from your Session. Without a mover, provide both `source` and `destination`; that is a general reference route, not a promise that a unit can move there this action. Raw Hex paths are opt-in with `includeHexPath`; `ranges` pages strategicNodes, supplyTransitions and hexPath independently (default 100, maximum 500).

The CLI input file is the filter object itself. In a play-turn query it goes inside the `filters` envelope:

```json
{"type":"query","target":"strategic-map","expectedRevision":0,"filters":{"collection":"nodes"},"pageSize":100}
```

Unknown filters, invalid types and unsupported enum values are errors, not empty successful queries. CLI failures emit `{ "ok": false, "code": "...", "error": "..." }` to stderr and exit nonzero. `RelocateCheckpoint` requires both `checkpointId` and `position`. v1.5.6 and older Saves, Artifacts, Sessions and Checkpoints are incompatible; start a new v1.5.7 game. Wall HP is 20 and Horde Zombie maximum Attack Charge is 4; other zombie types retain their own configuration.

## Playing a Session

Give the extracted package (or its ZIP) to an AI environment that can inspect files and execute local commands, then ask it to play the game. A useful prompt is:

```text
Play Nowhere Left to Hide as the governor. Use the Session CLI and only its public observations, legal actions, action results, events, and your own Public Decision Log. Create a Session, then use play-turn so one Node process stays open for the current turn. Read each JSONL result before choosing the next action, include a unique requestId and the returned expectedRevision, and explicitly submit EndTurn. If an action reports a stopReason, reassess from the returned Compact state and query details before continuing. If this response must end, close the process and report the Session ID so the next response can resume it. At the end, report the result and retain the artifact.
```

## Portable package commands

From the extracted package root, create a persistent Session:

```bash
./run-session.sh new --session-id=my-game --seed=1 --agent-id=my-agent
./run-session.sh play-turn --session=my-game
```

On Windows PowerShell, use the matching bundled launcher:

```powershell
.\run-session.cmd new --session-id=my-game --seed=1 --agent-id=my-agent
.\run-session.cmd play-turn --session=my-game
```

`play-turn` starts by returning one JSON object containing the current Compact state and protocol capabilities. Keep its stdin/stdout handles open across tool calls. Send one JSON object per line and read one JSON response line before sending the next request:

```json
{"type":"query","target":"legal-actions","expectedRevision":0,"pageSize":100}
{"type":"action","action":{"type":"Wait","unitId":"unit-1"},"decisionSummary":"Hold this supplied position.","expectedRevision":0,"requestId":"turn-1-wait-unit-1"}
{"type":"action","action":{"type":"EndTurn"},"decisionSummary":"No higher-priority legal action remains.","expectedRevision":1,"requestId":"turn-1-end"}
```

Every accepted or rejected Action is saved before its response is written. If the connection ends after commit, resend the exact request with the same `requestId`; the response has `replayed: true` and the Action is not applied twice. Reusing an ID with different content is rejected. A successful EndTurn or Game Over closes the process. EOF, explicit `{"type":"close"}`, idle timeout, and the request limit close it without inventing EndTurn or Wait; the closing line reports the saved Revision.

Protocol `1.0.0` accepts at most 1 MiB per JSONL line, 256 requests per process, and 64 Actions or 8 MiB per finite-plan file. The default idle timeout is five minutes; `--idle-timeout-ms` accepts 100–3,600,000 ms. Requests are processed serially with one pending write, stdout honors pipe backpressure, and process-local payload/Runtime caches are bounded and released on close. One live `play-turn` writer is allowed per Session. A legacy `step` or another external commit may still advance the Session; the next interactive request then returns `stale_revision` with the current Compact state so the caller can recover. Run `./run-session.sh --help` or `.\run-session.cmd --help` for the machine-readable schemas and limits. `query api` retains the Agent API fields at top level and adds the same Session capability object at `sessionPlayTurn`.

If the AI host cannot retain a process handle, put a finite plan in `turn-plan.json` and run one process:

```json
{
  "expectedRevision": 0,
  "actions": [
    {"action":{"type":"AssignWorkers","facilityId":"farm-1","workers":5},"decisionSummary":"Restore food output.","requestId":"turn-1-workers"},
    {"action":{"type":"EndTurn"},"decisionSummary":"Complete the reviewed domestic plan.","requestId":"turn-1-end"}
  ]
}
```

```bash
./run-session.sh play-turn --session=my-game --input=turn-plan.json
```

Use finite plans for actions whose intervening public results do not require tactical reassessment. The runner stops on rejection, interrupted movement, unexpected Player Unit damage or loss, a newly visible enemy, a new or worsened Crisis, Game Over, or the first successful EndTurn. It returns executed, rejected, and unexecuted indexes. To allow expected immediate Player Unit damage for one action, provide exact public bounds such as `"expectations":{"playerUnitHp":[{"unitId":"unit-1","minHp":20,"maxHp":25}]}`. This never disables enemy discovery, Unit loss, movement interruption, Crisis, or Game Over stops.

`status` is the process-independent resume command: run it with the same Session ID in a later AI response. There is intentionally no separate `resume` command. `new`, `status`, `play-turn`, `step`, and `load-checkpoint` return a Compact public snapshot by default: the Version, Session ID, Revision, turn/phase/Game Over state, public resources and population, every owned Unit's basic status, owned Facility/Checkpoint state, visible enemies, Crisis Summary, End Turn Forecast and production-capacity summaries, Horde warning, available action kinds, and routes to detail queries. It omits repeated fixed-map data, complete candidate lists, cost tables, facility-level capacity details, and historical Observations from ordinary responses.

The original single-action `step` command remains available for compatibility and recovery. It accepts JSON from standard input or `--input` and starts a new process for that one request:

```bash
printf '%s\n' '{"action":{"type":"EndTurn"},"decisionSummary":"No higher-priority legal action remains.","expectedRevision":0}' | \
  ./run-session.sh step --session=my-game

./run-session.sh step --session=my-game --input=next-step.json
```

The `decisionSummary` is required, must contain 1–500 Unicode code points after trimming, and should be a concise public explanation or reason code—not private chain-of-thought. `expectedRevision` is optional but recommended: use the Revision returned by the last command. A mismatch is rejected as `stale_revision` before an Action or Decision number is applied. A malformed request is rejected without consuming a Decision number. A well-formed but illegal action is recorded as a rejected Decision without changing game state or RNG; inspect the returned error and current Compact snapshot before retrying.

The complete nine-command interface is:

- `new`: create a new, non-overwriting Session
- `status`: inspect or resume the current Active Session
- `step`: apply one action plus `decisionSummary`
- `play-turn`: keep one process and verified Runtime for an interactive turn, or execute a bounded finite plan
- `save-checkpoint`: create a manual Checkpoint
- `list-checkpoints`: list public Checkpoint metadata
- `load-checkpoint`: branch from a Checkpoint into a required new Session ID
- `query`: read one Revision-pinned public detail target
- `artifact`: stream the current or final public Run Artifact Package and return a small manifest

`query` does not change State, RNG, Decision numbers, or the accepted Action sequence. Its targets are `api`, `map`, `units`, `facilities`, `checkpoints`, `branches`, `construction`, `legal-actions`, `forecast`, `history`, `population-transfers`, and `full-snapshot`. It returns `sessionId`, `revision`, `target`, `count`, `hasMore`, `nextCursor`, and either `items` or `value`. List targets use a stable order without duplicates. A cursor is tied to its Session and Revision: never reuse it after State changes. Pages default to 100 items and accept at most 500. Use `--target`, optional `--revision`, `--cursor`, and `--page-size`; pass target filters as JSON with `--input=PATH`.

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

The Session directory includes a private Save Format 16 checkpoint state solely so the runtime can resume deterministically. Session/Checkpoint Schema 10 stores immutable generation data, persistent request IDs, compressed/chunked public payloads, compact Decision records, lossless patches, and hash-chain references so a long history is not repeatedly materialized in ordinary commands. v1.5.6 and earlier AI Session, Checkpoint, Artifact, and Replay data are not migrated; start a new v1.5.7 AI Session and retain old data for use with its old release. Do not inspect or use private state, RNG state, hidden enemies/targets, Rejected Refugee counters, or non-public configuration for decisions. The public Decision Log, CLI JSON, and Artifact Schema 13.0.0 output are the fair-play record; their Decision hash chain detects accidental damage or inconsistency but is not a cryptographic authenticity guarantee against someone rewriting every file coherently.

For a quick built-in-agent smoke test from the repository checkout:

```bash
npm run sim -- --agent=balanced --games=1 --seed=1 --summary-only --out=output/ai-smoke --overwrite
```

The Player package has one runtime entry point, `run-session.sh` or `run-session.cmd`. The package workflow exercises all nine Session commands, file Artifact export, Session resume, Checkpoint branching, and external public drivers for Seeds 1 and 7 with the bundled Node.js runtime. The built-in Balanced Agent and simulation CLI are development tools and remain available from a repository checkout.

## Repository development

Custom TypeScript drivers, built-in Agents, UI development, and tests run from a repository checkout. Install the locked dependencies and use the normal development commands:

```bash
npm ci
npm run session -- status --session=my-game
npm run test
```

For a checkout-side TypeScript driver, use the repository's `vite-node` command:

```powershell
npx vite-node --script path/to/your-driver.ts
```

A custom LLM player should import `createAgentGame` from `src/agent/game.ts` and interact only through the public AgentGame methods:

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

## v1.5.7 tactical context

Use the current `AgentObservation` as the source of truth for conditional forecasts. It does not reveal future random draws or private state.

- Map tiles expose base terrain, road/urban overlays, effective movement cost, terrain defense, and `visibleToPlayer`. Human movement, zombies, replay, and agents share the same weighted pathfinding rules.
- Enemy arrays contain only currently visible `zombie`, `hordeZombie`, `policeZombie`, `soldierZombie`, `riotZombie`, `hunterZombie`, and `gasZombie` units. Never infer hidden enemies from missing movement or checkpoint actions: public planning treats hidden occupied hexes as empty, and execution can stop movement safely when one is encountered.
- Human Units expose `proficiency` (`recruit`, `regular`, or `veteran`), survival/kill counters, `attackChargesRemaining`, and `maxAttackCharges`. Initial Units are Regular; newly produced Police, National Guard, and Riot Police are Recruit by default. Recruit Units become Regular after five surviving Player Turns. A Regular Unit's fifth direct Zombie kill enters promotion-pending state and becomes Veteran at the next Player Turn Start; Veteran Units have two Attack Charges.
- Police has HP 25, Recruit Attack 6, Regular/Veteran Attack 8, Vision 5, and Movement 15. National Guard has HP 50, Recruit Attack 12, Regular/Veteran Attack 15, Vision 5, and Movement 10. Riot Police has HP 75, Recruit Attack 9, Regular/Veteran Attack 12, Movement 10, Range 1, Vision 5, and Population 10. Riot Police uses Police-family fuel and suppression rules, but its public combat Noise class is `medium` (its internal radius is not public). Use `currentFuel`, `maxFuel`, `currentMilitaryGoods`, `maxMilitaryGoods`, and the exact legal-move/attack previews rather than reconstructing costs.
- With Fuel above 0, moves use the normal Unit-type Fuel formula. With Fuel exactly 0, Police retain 3 effective MP and National Guard 2 effective MP as Emergency Movement. Legal moves identify `movementMode`, exact `effectiveMovementCost`, Fuel cost, and projected Fuel. Forest/Mountain still cost 2/3 MP, Fuel stays 0, and a surviving Unit may still Attack or Wait after moving. Supplied Units can refill Fuel at End Turn; an unsupplied Unit can use Emergency Movement again next turn.
- Police carry up to 5 Military Goods and have no fixed End Turn consumption. National Guard carry up to 20 and consume 1 at the start of End Turn economy. After Military Factory production, supplied Units refill from national stock in Unit-ID ascending round-robin order; unsupplied Units do not refill. Remaining carried Fuel and Military Goods are lost when a Unit is destroyed.
- A distance-1 attack costs 1 Military Good when available. At 0, Police, National Guard, and Riot Police may still attack at distance 1 for 0 ammunition, with attack reduced to 20%, rounded up with a minimum of 1 (Regular values: 2/3/3). National Guard distance 2 requires and consumes 2; it is not legal with only 0 or 1. Read `attackPreviews` for distance, cost, projected balance, effective attack, and terrain-adjusted damage. The same ammunition rules govern counterattack and interception.
- Player Units, the Capital (radius 5), owned facilities, and Active checkpoints provide Ground Vision. Forest and Mountain are visible blockers that hide Hexes beyond them. A powered Civilian Drone Base provides terrain-ignoring Aerial Vision `workers × 3`, up to 15; its observation uses `visionMode: aerial`. Use Core-projected visibility and never reconstruct hidden lines.
- Standard fixed Waves spawn at Turn 5 (1 direction, 3 Horde + 3 non-Horde slots), Turn 10 (2, 2 + 5), Turn 20 (1, 5 + 7), Turn 35 (3, 3 + 7), and Turn 50 (4, 5 + 8 Final). Each non-Horde slot is deterministically drawn from `zombie` (70 before the last two Waves, 65 in the last two Waves), `policeZombie` (10), `soldierZombie` (10), `riotZombie` (5), `hunterZombie` (5), and `gasZombie` (5 in only the last two Waves). Riot, Hunter, and Gas are independently capped at one per direction per Wave; after a cap is reached, the remaining weights are renormalized. Warning Lead is 2 turns and exposes only slot count and possible types; the concrete draw is first public after Spawn. Do not infer pre-warning directions, Spawn Group IDs, exact positions, or hidden counts.
- A new game retains its 25 Normal Zombies, adds a seed-determined 1–4 Hunter Zombies, and adds 1–2 Gas Zombies. Hunters start at least 20 hexes from the Capital; Gas starts at least 9 hexes from the Capital. Neither type occupies a Reserve, permanent Facility, Human Unit, or another initial Zombie. A Hunter has HP 20, Attack 15, weighted Movement 15, Range 1, Vision 5, and one Attack Charge. It uses the same Normal Zombie target priority and Noise behavior as Police/Soldier/Riot Zombies; it has no privileged Capital target or terrain-ignoring movement.
- Normal Zombies have HP 15; Horde Zombies have HP 40 and four shared Attack Charges; Police/Soldier/Riot/Hunter Zombies each have one; Gas Zombies have HP 35, Attack 5, Movement 3, Range 1, Vision 3, and one Attack Charge. A Horde Zombie can use its remaining Charge for further legal active attacks after resolution of the first, but may move only once and never moves again after attacking. Counterattack and interception consume the same Charge pool.
- Every Zombie type stops when its route first reaches a living Player Unit, including when it starts adjacent, then can attack an adjacent Player Unit when its normal attack conditions hold. Gas Zombie death causes one explosion over the six adjacent Hexes: each affected Unit takes up to 30 damage after terrain defense and each affected Facility/Checkpoint converts up to 30 healthy people to infected population. Chain explosions resolve from stable Unit IDs after the current explosion's direct effects.
- Army Base is one seeded neutral permanent Facility. It starts with zero workers, zero infection, and 40 dedicated Military Goods; it provides Ground Vision radius 1 unstaffed or 5 with workers. Capturing it on or before Turn 20 grants one free Regular National Guard with Fuel 22 and carried Military Goods 20, once per game, without power or resource cost. Its normal National Guard recruitment uses eligible city population and national resources, never Army Base workers. A staffed owned base can intercept at range 2 (including its own Hex) with Attack 10, two dedicated Military Goods, and up to one interception per healthy worker each Zombie Phase; each actual interception emits Radius 8 Noise.
- A fallen facility or checkpoint converts each 5 actually infected people into one Normal Zombie, up to 6 per resolution, using only empty passable adjacent Hexes. Unconverted infection remains at permanent sites, constructible remnants die when removed, and Wind Power Plants never create infected population. Generated Zombies occupy their Hex immediately, can trigger FIFO site chains, and wait until the next Zombie phase to act normally.
- `importantSiteEvents` contains the latest 50 public infection/fall/spawn/chain facts even for off-screen sites. Site IDs, types, site coordinates, infected-at-fall, requested/actual counts, remaining infection, and chain origin are public; generated Zombie IDs, exact Spawn Hexes, targets, and hidden reaction details are not.
- There is no game-rule turn limit. Victory requires Final Pending = 0 and no living member of the Final roster on the map. Non-Final Zombies and infection do not block victory; immediate defeat still takes priority.

- A surviving supplied unit recovers at the next player-turn start. Combat, counterattack, interception, or automatic infection suppression uses the configured 10% combat rate; only moving, waiting, or taking no action uses the configured 20% rest rate; out of supply is 0%. The observation reports the class, rate, base amount, timing, and survival/supply conditions.
- A Police, Riot Police, or National Guard unit stationed at an infected location contains internal spread regardless of its carried Military Goods. Automatic suppression can use every remaining Attack Charge that can pay its Military Goods cost. Police/Riot suppression has no civilian damage; National Guard suppression is stronger but can cause civilian damage. `endTurnRisk` summarizes ready Units, remaining charges, legal attacks, and uncontained sites without changing legality or state.
- Use `baseRange`, `effectiveRange`, attack previews, and shortage reasons rather than assuming a unit's range. National Guard distance 2 is available only while it can pay the cost of 2; the removed global `militarySupplyAvailable` state is not part of v1.5.5.
- Operational Wind produces 15 Electricity without Fuel and emits one Radius 8 Noise pulse before the Zombie target snapshot, even outside Supply. Wind is never a Visible Population target. Building/disabled/recovering Wind produces neither power nor Noise. Wave Capital Anchors take priority over Wind Noise.
- `BuildConstructibleFacility` creates Simple Farm (Civilian Goods 25), Civilian Drone Base (50), Temporary Housing (25), or Wind Power Plant (100) on a Core-listed, currently visible, supplied, empty Plain Hex without road, entrance, reserve, facility, checkpoint, barbed wire, Player Unit, or visible Zombie. Unseen destinations return `constructible_not_visible` regardless of hidden walls or enemies. Construction completes next Player Turn. Read Core candidates for legality.
- Simple Farm has Power Mode `none` and produces Food 5 per worker without Electricity, with one per road branch. Civilian Drone Base has Power Mode `required`, needs 5 Electricity, and provides Vision 3 per worker when powered. Both preserve existing workers/functions outside Supply, but cannot gain workers there.
- Power demand is Capital/City 10, Civilian Factory 15, Military Factory 20, Refinery 10, and Housing 5. Allocation order is Capital/City, occupied Housing, existing production tiers through Army Base reservation, then empty Housing. Power Plants have 15 capacity per worker and consume turn-start Fuel 2 per actual Electricity 5 not supplied by Wind.
- Same-turn Food, Civilian Goods, and Military Goods production can pay same-turn maintenance. Same-turn output cannot become another production process's input. Increasing Civilian Goods production may release existing turn-start stock from the civilian-maintenance reservation to Military Factory input, but turn-start stock 0 still means no Military Factory input.
- Read `startingStock`, `projectedProduction`, `maintenanceRequired`, `endingStock`, and maintenance `shortage`. Fuel projection separately exposes Wind supply, Power Fuel, Unit refill demand/allocation, Refinery production, and ending stock. `strategicForecast` is the shared Core projection for resource dependency, single-point-of-failure, and Guaranteed Defeat warnings; prioritize a legal domestic remedy over combat when defeat is avoidable.
- Checkpoint observations show the role (`active`, `standby`, `dormant`, `remnant`, `ruined`, or `abandoned`), branch-owned policy and `currentPolicyTurns`, queue total/throughput/arrival ranges/Queue Pressure, and queue state. Core-generated `observation.checkpointPositionCandidates` is a top-level Full Snapshot field, not a field inside each checkpoint or branch. In the Session CLI, retrieve these candidates with `query --target=construction`; `query --target=checkpoints` lists existing posts. Build and relocation require the target and every branch road Hex from the capital side through it to be in current Player Vision; Facility Hexes are never valid, and each branch allows five prepared Active + Standby posts. Candidates include projected radius, supply deltas, and newly buildable Hexes. Read `legal` and `reasonCode` instead of reconstructing rules; `fallbackAvailable` is structural only and hidden enemies never make a candidate illegal or appear through candidate differences. Healthy Queue population consumes maintenance but does not contribute to city overcrowding.
- A listed `TurnAwayCheckpointRefugees` action may remove a legal number of waiting refugees. The direction/policy rejection counters, exact future bonus count, and reset state are private: treat the future Horde effect as a qualitative risk only. A first Checkpoint built on a branch costs 5 Civilian Goods; later Build and Relocate actions cost 25.
- `DecommissionConstructibleFacility` removes an eligible empty Drone Base (refund 25) or Temporary Housing (refund 0), including outside Supply. It never removes Simple Farm or Wind.
- Human-involved normal combat and Horde Zombie movement emit common public Noise events after their respective resolution. Police publishes `medium`, Riot Police `medium`, National Guard `large`, and Horde movement uses a fixed Radius 8 that is described as a rule rather than exposed as hidden target data. Nearby fallen permanent sites with at least 5 infected may respawn Zombies and start immediate FIFO chains. Do not infer or seek an exact Human Noise Radius, affected Zombie IDs/counts, Spawn Hexes, or Zombie Noise Target memory; those remain verification-only.

There is no public `SuppressInfection` action. Infection response is resolved by the engine at End Turn, so select a listed movement, attack, wait, domestic, checkpoint, or End Turn action instead.

`crisisSummary` is a deterministic index of public facts, ordered by `critical`, `warning`, and `advisory`. It includes reason codes for capital/site infection, checkpoint infection, supply risk, Horde warnings, guaranteed resource defeat, and recent public losses. Treat it as a reminder: it never reveals hidden enemies or future draws and never changes legal actions. `endTurnRisk` is likewise a decision aid for the current observation only.

When using the Session CLI, each `step` response also contains `stateDelta`, a public-only summary of newly infected/ruined sites, newly spotted or publicly lost enemies, Unit HP/supply changes, and Checkpoint role changes since the previous Decision. Ordinary `AgentObservation` and Human UI responses do not contain this Session-only field.

## v1.5.7 Wave and housing decisions

- Each scheduled Wave freezes its roster on schedule, consumes the participating directions' rejection counters, and starts even with zero free Spawn slots. Each direction has a dedicated 22-Hex zone. Pending Waves spawn oldest first as slots become available; newly spawned Units act from the next Zombie Phase.
- Read `baseWaveUnitCount`, `committedWaveUnitCount`, `spawnedSoFar`, and `pendingCount`, plus public direction/group/kind. `horde_wave_started` and `horde_spawn_batch` are separate events. Exact type composition, private counters, anchors, and hidden positions remain private.
- Rejected Bonus uses the same weighted table and shared per-direction caps as base slots. After the Final roster freezes, natural refugee arrivals stop, existing queues continue, and further rejection cannot increase the Horde Bonus.
- All Zombie types avoid passing through other Zombies. Targeted blocked Zombies may take deterministic closer or equal-distance fallback routes; immediate sideways backtracking is prohibited. Scheduled non-Horde Zombies retain a Capital Anchor below Visible Population and above Noise. An empty owned Capital still falls immediately on Zombie occupation. Soldier Zombie Attack is 10 for every origin.
- Temporary Housing has soft capacity 10, Vision 1, no recruitment hub or output, and no build limit. Its healthy residents contribute to the supplied population pool. Cities receive refugees before Housing; overflow chooses the lowest total-resident/capacity ratio. Manual healthy transfers may exceed capacity. Disconnected Housing retains residents, capacity, Vision, and defeat population but cannot receive refugees, transfer population, or contribute recruits.
- Each occupied unpowered Housing adds 1% of normal Food and Civilian Goods maintenance. Sum the count before rounding each resource once. This is independent of overcrowding. Read `strategicForecast.nextTurnPenalties` and separate crisis reasons for the deterministic next-turn projection, including certain Housing/Wind completion; future RNG is excluded.
- Built Wind is limited to the number of road branches, excluding initial Wind. Empty Housing disappears on Zombie occupation; Wind instead follows its disabled/recovery rules.

## Fair-play boundary

The AI player should not use `GameEngine.getState()`, `AgentGameAdapter.getDebugState()`, save internals, hidden future random values, or other non-public implementation details to make decisions. Those exist for development and diagnostics, not as player-visible information.

The intended information boundary is the same one used by the built-in Agent platform and Human UI: public Observation plus currently legal actions. App `1.5.7` uses Game Rules `9.0.0`, Agent/Observation/Browser Bridge API `14.0.0`, Fixed Map `fixed-51x51-v4`, Save Format `16`, Artifact Schema `13.0.0`, Checkpoint/Session Schema `10.0.0`, Balanced Agent `8.0.0`, and Random Agent `6.0.0`. Artifact Schema 13.0.0 packages public Wave/Warning/Site Event, Gas/Army Base state, production-capacity state, Metrics, a lossless public Decision Log, request identity, and lineage without private Checkpoint state. v1.5.6 and earlier AI Replay, Artifact, Session, Checkpoint, and normal Save data are rejected without conversion or overwrite.

## Package layout

A generated package has this general structure:

```text
nowhere-left-to-hide-ai-<version>-<commit>-<platform>/
├─ PLAY_WITH_AI.md
├─ LICENSE
├─ THIRD_PARTY_NOTICES
├─ ASSETS_LICENSE.md
├─ BUILD_INFO.txt
├─ PORTABLE_PACKAGE.json
├─ session-cli.mjs       # pre-bundled Session CLI
├─ run-session.sh        # Linux package (or run-session.cmd on Windows)
└─ runtime/
   ├─ identity.env       # Linux package (or identity.cmd on Windows)
   └─ node/node           # standalone bundled Node executable
```

The Player package intentionally has no `package.json`, `node_modules`, source tree, development launcher, or board runtime assets. Use a repository checkout for custom TypeScript drivers, built-in Agent development, UI work, and tests.

The package is tied to a specific Git commit. `BUILD_INFO.txt` records the app version, commit SHA, and bundled Node.js version so a playthrough can be reproduced against the correct source revision.

## v1.5.7 parameter queries and ZIP spectator

Read `status.observation.forecastSummary.endTurn.maintenancePopulation` and `maintenanceBreakdown` for healthy city/housing residents, production/base workers, unit personnel, and waiting/screening/approved upkeep. Facility queries expose production, inputs, stopping reasons, and `recovery` conditions separately. Attack previews expose visible Gas chains; they do not estimate hidden entities, reanimation/site-spawn consequences, or the later enemy phase. Turn Away affects waiting people only; its future Wave risk is qualitative.

```bash
./run-session.sh query --session=example --target=population-transfers --revision=12
./run-session.sh step --session=example --input=transfer.json
```

`transfer.json` (use IDs, bounds, and Revision returned by your own query):

```json
{"action":{"type":"TransferPopulation","fromFacilityId":"capital","toFacilityId":"city-1","people":7},"decisionSummary":"Move seven residents to the secured city.","expectedRevision":12}
```

The list of legal actions is finite and does not enumerate every legal integer. `population-transfers` returns `min`, `max`, `legal`, `reason`, and per-item `revision`. A null range means the pair is currently ineligible. Core validates the submitted count again. An old Revision is rejected before recording a Decision. Use `construction` filters (`facilityType`, `legalOnly`, `inSupply`, `reasonCode`, `q`, `r`) and pagination instead of assuming that a truncated list is complete.

`artifact` exports the public directory and sibling ZIP; `replayZipPath` identifies the file. The ZIP includes public ancestry, fixed map and explicit roads, comments, results, and verified payload references; it excludes private checkpoint state. Open **AIリプレイ観戦 / Watch AI replay** from the game title and select this ZIP locally. The viewer starts paused before the first Decision, supports 0.5/1/2/4× playback, previous/next Decision, exact-turn seeking, and stops at the end. Comments use Unicode code points: `min(8, max(3, ceil(length/20)))` seconds; absent comments skip directly to the one-second result phase. Logs retain 100 visited Decisions; older Decisions remain seekable.

The spectator does not resume a Session or touch normal autosave. It supports v1.5.7 public packages with different viewer Build IDs, while executable replay/resume retains strict build checks. Old versions, unsafe paths, bad hashes, missing payloads, corrupt ZIP entries and incompatible maps are rejected. Use the exported ZIP: its NDJSON stream must be stored, not recompressed. ZIP64/multivolume/encrypted archives are unsupported. Limits are 64 MiB per logical payload, 4 MiB per Decision line, 32 MiB ZIP directory, and one million Decisions; snapshot cache is bounded to 16 MiB. A total ZIP size over 50 MB is not by itself an error. Payload parsing and rendering still require browser working memory; cancel and choose another file if loading cannot complete. Physical phone memory and 512 MiB endurance are separate measurements, not universal guarantees.

## v1.5.7 decision checklist (Linux and Windows)

Keep the complete Compact response from `status` and every `play-turn` result. Do not print only resources and unit HP: that drops the reasons needed to operate the economy. Review all of these on every decision:

- `observation.forecastSummary.endTurn`: maintenance population, basic/overcrowding/housing-outage maintenance and resource ending stocks.
- `observation.availableCityPopulation`: presently eligible turn-start city residents, distinct from total population.
- `observation.roadBranches`: all four branches, `managed`, active checkpoint (or null), policy, next arrival, arrivals ended, and dated `latestPublicFlow`, and `currentQueue`. Compare `stateDelta.branchFlowChanges` for queue changes between committed revisions. These events are recent results, not cumulative totals or forecasts. An unmanaged branch uses pass-through. Strict screening and a waiting queue do not mean zero inflow or zero maintenance. Turn Away applies only to waiting people.
- `observation.productionStops`: up to eight owned facility IDs, stop reasons, power allocation reasons and output. `omitted` explicitly counts omitted entries; query facilities for all details at the same revision.
- `stateDelta.facilityChanges` and public `events`: compare only the preceding committed revision. Reason labels derived from state are distinguished from associated observed events. `status`/`new` do not invent changes.
- `stopReason`, rejected action, `unexecuted` indexes and returned revision: a finite plan's unexecuted actions have not happened.

Use the same requests on both platforms (`./run-session.sh` on Linux, `.\run-session.cmd` on Windows). In an open play-turn process:

```json
{"type":"query","target":"worker-assignments","expectedRevision":0,"pageSize":100}
{"type":"query","target":"population-transfers","expectedRevision":0,"pageSize":100}
{"type":"query","target":"facilities","expectedRevision":0,"pageSize":100}
{"type":"query","target":"units","expectedRevision":0,"pageSize":100}
{"type":"query","target":"construction","expectedRevision":0,"filters":{"facilityType":"barbedWire","legalOnly":true},"pageSize":100}
```

Substitute the actual returned revision. Worker queries separate the target facility reason from each city source's healthy and currently available population. Transfer queries return separate `fromReason` and `toReason`; `ineligible_city` does not ban city transfers in general. Legal integer amounts between min and max are accepted even when absent from the finite legal-action examples.

Read the unit's `attackPreviews[].gasExplosion`, including friendly damage and projected deaths, before shooting Gas. For a Human standing on wire, `conditionalIncomingCombat` shows independent attacks from currently visible enemies. `conditionalCounterattack` reports wall damage, remaining wall HP, penetration and Human HP separately; it is conditional on survival and counterattack eligibility, not a prediction of the next enemy phase.

`BuildBarbedWire` takes `position: {q,r}` and costs Civilian Goods 5, Military Goods 5 and one action. HP is 20, Human entry costs 5 MP (ordinary per-hex Fuel), and Zombies spend attack charges to breach. Excess normal-combat damage penetrates and then receives Human terrain defense. Gas bypasses walls. Walls give no vision, supply or maintenance and cannot be repaired or removed. Equal-radius lateral lines are allowed; radial pairs one or two hexes apart are forbidden. Construction also requires the neighboring/radial inspection area to be visible. A generic visibility refusal does not imply a hidden enemy or hidden wall.

Only current visible walls are public. Version 1.5.5 and older saves, checkpoints, sessions and artifacts are rejected without migration or rewriting old autosaves.

A Human killed by Gas or other non-combat damage still reanimates on its original Hex. If wire survives there, only that spawn is allowed inside it (`spawnedInsideBarbedWire`); after leaving, the Zombie cannot re-enter intact wire. Gas does not reduce the wall HP.

### Checkpoint supply: radius measured from the capital

Supply starts within Hex distance 5 of the capital in every direction. Each Active checkpoint sets its branch sector radius to `max(initialSupplyRadius, distance(capital, activeCheckpoint))`. A tile belongs to its nearest main-road branch sector(s); a shared boundary is supplied if any of its sectors reaches it. The radius is measured from the capital, not from the checkpoint. Standby/Dormant/Remnant/Ruined/Abandoned posts do not extend supply. `providesSupply: true` means an Active supply role, not that this post added any new coverage.

Example: capital (25,25), east Active (30,25) means radius 5 → 5. Army Base (31,24) and road (31,25) are at capital distance 6 and remain outside supply despite being adjacent to the checkpoint. Advancing the east Active to a legal distance-6 position extends that sector to radius 6. Reconnoitre the target and the entire capital-side branch road first, then check candidate legality. With an existing Active, forward expansion uses `RelocateCheckpoint`; a second `BuildCheckpoint` is a rear Standby and does not extend supply.

For Session CLI candidate discovery, write `{"branchId":"east","actionType":"RelocateCheckpoint"}` to a filters file and run:

```sh
node tools/session-cli.mjs query --session=YOUR_SESSION --root=YOUR_ROOT --target=construction --revision=CURRENT_REVISION --input=checkpoint-filters.json
```

Use the launcher supplied by your Portable package in place of `node tools/session-cli.mjs` when applicable. `--input` contains the filter object itself. Read `legal`, `reasonCode`, `currentBranchRadius`, `projectedBranchRadius`, `newlySuppliedHexCount`, `newlySuppliedFacilityIds`, and the corresponding losses. Only legal candidates carry an actionable projection. Illegal candidates report the unchanged current radius and zero deltas; this does not mean forward expansion is impossible after the stated blocker is resolved. Follow pagination; do not filter by current `inSupply: true` when looking for forward expansion.

Compact checkpoints and the `checkpoints` query expose `supplyExplanation`, including current branch radius and a revision-pinned `candidateQuery`. Accepted construction, relocation and role changes report actual before/after radius and newly supplied/unsupplied Hex and facility counts in `importantChanges.items[].consequences`, including `supply_coverage_unchanged` when nothing was gained or lost. These coverage counts describe the whole decision; they are not additional independent gains to sum across posts.
