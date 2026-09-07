# Nowhere Left to Hide PoC v1.5.4 アップデート要件 確定版

> 本書は v1.5.3 を基準とした v1.5.4 の確定要件である。検討用ドラフトは別ファイルとして残す。

## 1. 目的

v1.5.4 では、Horde の詰まり・Final Horde の Rejected Bonus 可視性・大量 Spawn 容量を中心に、Zombie 移動、Horde Spawn、Rejected Bonus、Temporary Housing、Wind Power、電力バランス、Overcrowding 予測、Save / Agent API 互換性を更新する。

## 2. 互換性・Versioning

- v1.5.3 以前の Save は移行しない。
- v1.5.4 では Map ID を更新し、旧 Map ID の Save を拒否する。
- Save Format Version も更新し、Map ID とは独立に旧 Save を明示的に拒否する。
- Zombie の `previousFallbackPosition`、Pending Wave Roster、Wave Capital Anchor 等の新規 State を Save / Load 対象に含める。
- Agent API / Observation Schema も非互換 Version Up とし、旧 Version の Agent は mismatch として明示的に拒否する。
- 既存 Agent 実装は v1.5.4 Schema へ追従させる。

## 3. Zombie movement / congestion fallback

### 3.1 基本方針

- Zombie は他 Zombie の Hex を通過しない。
- Zombie 同士の 1-Hex overlap は許可しない。
- 既存の Human Unit interception / pin / base interception は維持する。
- Target selection priority 自体は変更しない。
- `decision.target != null` の Zombie に対してのみ、通常の `targetPath` が使えない場合に congestion fallback を実行する。
- Target を持たない Idle Zombie は fallback で移動しない。
- congestion fallback は Horde Zombie だけでなく、Normal / Police / Soldier / Riot / Hunter / Gas 等、すべての Zombie Type とすべての Target reason に共通適用する。

### 3.2 fallback 候補

1. 現在 Hex より Target への Terrain-only weighted distance が短い、合法かつ到達可能な空 Hex を候補にする。
2. 1 が無い場合だけ、現在と同距離の横移動 Hex を候補にする。
3. Target から遠ざかる Hex は候補にしない。
4. 通常の movement budget / terrain cost / per-hex interaction をそのまま適用する。

Tie-break は RNG を使わず、次の順で決定する。

1. Target への Terrain-only weighted distance
2. その Hex へ入る実 Movement Cost
3. 既存の決定的な座標 stable order

### 3.3 直前 Hex への戻り禁止

- fallback による横移動を行った場合、Zombie Unit State に `previousFallbackPosition` 相当を保存する。
- 次回 fallback では、その Hex への即時帰還を候補から除外する。
- この State は Turn をまたいで保持し、Save / Replay 対象とする。
- 次の場合にクリアする。
  - 通常 path で Target へ前進できた。
  - Target が変わった。
  - Target 距離が短くなる fallback に成功した。
- `previousFallbackPosition` 以外に合法 fallback が無い場合、その Turn は停止する。唯一候補であっても戻りは許可しない。

## 4. Capital safety / Wave Capital Anchor

### 4.1 人口 0 Capital の陥落

- Player-owned Capital が `workers = 0 / infected = 0` でも、Zombie が Capital Hex へ侵入・占有した時点で Capital を即 Ruined とし、敗北判定する。
- Zombie Type / 出自は問わない。Normal / Police / Soldier / Riot / Hunter / Gas / Horde すべてに適用する。

### 4.2 Wave Capital Anchor

- Scheduled Horde Wave から Spawn した Normal / 特殊 Zombie は、Spawn 時に Capital 座標を `wave_capital` Anchor として持つ。
- Rejected Bonus 由来個体も対象。
- `hordeZombie` は既存 Horde AI の `Visible Population > Capital Strategic Anchor` を維持し、Normal Zombie 向けの Anchor State を必須としない。
- Wave Capital Anchor は Capital の人口、Vision、Noise、同Wave Horde Zombieの生死・距離・Visionに依存しない。
- Normal / 特殊 Wave Zombie の Target priority は次のまま。
  - Visible Population
  - `wave_capital` / inherited Horde Target
  - Noise
  - Idle
- Visible Population がある間はそちらを一時優先するが、`wave_capital` は消去しない。Visible Population が消えれば Capital へ戻る。
- Wind Noise を含む Noise は `wave_capital` より下位であり、Anchor が有効な Wave Zombie を逸らさない。
- Initial Zombie、reanimation、facility fall / Noise Respawn 等の Wave 外 Zombie には `wave_capital` を付与しない。
- Capital Hex に実際に到達し、その Hex で必要な戦闘・感染・陥落処理を解決した時点で `wave_capital` を解除する。

## 5. Horde Spawn Reserve / Direction Spawn Zone

### 5.1 Reserve

- 51x51 Map の外周 2 rows / columns を Horde Spawn Reserve とする。
- Reserve は Player Unit の進入・建設を禁止する。
- 2列 Reserve 全体を Scheduled Horde 専用にはしない。Initial Zombie、facility fall、Noise Respawn 等は各既存 Spawn rule を維持し、合法なら Reserve 上へ Spawn し得る。
- Map ID を更新する。

### 5.2 Direction ごとの 22 Hex Spawn Zone

- Scheduled Horde は各 Direction の専用 22 Hex Spawn Zone 内だけに Spawn する。
- 他 Direction や Map interior への spill はしない。
- Zone は固定座標を直接ハードコードせず、その Direction の実 Road Entrance を基準に動的生成する。
- Entrance を中心に横方向 ±5 Hex、Reserve 2列を組み合わせ、11×2 = 22 Hex とする。
- West / East は道路中心 row の前後 5 Hex、North / South は道路中心 column の前後 5 Hexを使う。
- Map validator は各 Direction について必ず 22 Hex が Map 内・Reserve 内に生成できることを検証する。

### 5.3 Spawn Hex priority

- Zone 内は Road Entrance 中心から外側へ広がる順で使う。
- 同距離では左右を交互にし、片側へ偏らせない。
- Reserve 2列も同じ位置ごとに交互に使う。
- Spawn Hex 順序に RNG は使わない。
- 同一 Spawn batch では、その batch に出す Horde Zombie を先に中央寄り Hex へ配置し、その後に Normal / 特殊 Zombie を Frozen Roster 順で配置する。

## 6. Scheduled Wave roster freeze / Pending Spawn

### 6.1 Wave start

- Scheduled Turn に Wave を開始し、その Direction の full roster を確定・freeze する。
- freeze 対象には以下を含む。
  - Horde count
  - Base non-Horde type draws
  - Rejected Bonus count / type draws
  - group ID / kind
- Spawn Zone に空きが 0 で実 Spawn が 0 体でも、Wave は開始済みとする。
- Wave start 時点で Rejected Counter 消費、public count 更新、Final なら自然到着終了を行う。
- Spawn できない roster entry は Pending Spawn として保持する。
- Pending entry は Map Unit ではなく、座標・Vision・Target・Attack・Noise reaction を持たない。

### 6.2 Pending Spawn

- 各 Horde Phase に、その Direction の 22 Hex Zone の空き Hex へ可能な数だけ Pending を Spawn する。
- Spawn できなかった分は次 Horde Phase へ持ち越す。
- capacity shortage は正常な Pending 状態であり、技術的 Spawn failure としない。
- Spawn した個体は、その Spawn Turn には移動・攻撃しない。次回 Zombie Phase から行動する。
- Pending から実 Spawn した Wave Normal / 特殊 Zombie は、その時点で `wave_capital` Anchor を受け取る。

### 6.3 複数 Wave の重なり

- 前 Wave の Pending が残っていても、次の Scheduled Wave は予定 Turn どおり開始し、独立 roster を freeze する。
- 同一 Direction に複数 Pending Wave がある場合は oldest Wave first。
- 古い Wave を同じ Horde Phase 中に完了し、空き Hex が残れば新しい Wave も続けて Spawn できる。
- group ID / kind / Final affiliation は Wave ごとに独立する。

### 6.4 Horde Zombie の batch 分散

- Wave が複数 Spawn Turn にまたがる場合、既存 Horde Zombie 数を可能な限り各 Spawn Turn に分散する。
- Horde Zombie 数を増やしてはならない。
- Spawn Turn 数が Horde 数を超えた場合、Horde を使い切った後の batch は Normal / 特殊のみでよい。
- 実際の Spawn Zone の空き不足で予定外に複数 Turn 化した場合も、後続 Turn に最低 1 Horde を残せる範囲で残す。
- 各 Horde Phase 開始時点の実際の空き枠、remaining roster、remaining Horde だけを使って最小必要 Spawn 回数を再推定し、残 Horde を可能な限り均等配分する。未来の空き枠は予測しない。
- 同一 Direction に複数 Pending Wave がある場合、この均等配分は Wave ごとに独立計算する。Wave 間で Horde を融通しない。

## 7. Wave public observability / events

### 7.1 Public counts

Wave 開始時点で Human / AI 双方へ以下を公開する。

- `baseWaveUnitCount`: Scheduled Wave 本体のみ
- `committedWaveUnitCount`: Rejected Bonus 込みの確定 roster 総数
- `spawnedSoFar`
- `pendingCount`
- direction
- group ID / kind（公開上必要な識別子）

例: Scheduled 52 + Bonus 15 の場合、`baseWaveUnitCount=52`, `committedWaveUnitCount=67`。

非公開:

- Rejected Counter 生値
- Bonus が何人の拒絶から生成されたか
- exact Zombie type breakdown
- hidden unit positions

### 7.2 Events

- Wave roster freeze 時に `horde_wave_started` 相当の Event を 1 回発行する。
- 各 Horde Phase の実 Spawn ごとに `horde_spawn_batch` 相当の Event を発行する。
- batch Event は `spawnedThisBatch / spawnedSoFar / pendingCount` を公開する。
- Type 内訳・Hidden position は公開しない。
- 旧 `horde_spawned` の意味を曖昧に拡張せず、Wave start と実 Spawn を別概念にする。

## 8. Rejected Bonus

### 8.1 Counter

- Turn Away と Normal / Strict Screening rejection は既存どおり Direction 別 Rejected Counter に加算する。
- Wave に参加する Direction だけ、Wave roster freeze 時に Counter を Bonus へ変換し、その瞬間に Counter を 0 にする。
- 参加しない Direction の Counter は保持し、次にその Direction が参加する Scheduled Wave まで持ち越す。
- Final Wave は全 Direction 参加のため、Final roster freeze 時に全 Direction Counter を消費する。
- Final roster freeze 後に既存 Checkpoint Queue の Refugee を Turn Away しても Rejected Counter へ加算しない。
- Human / AI には「Final Horde確定後の拒絶は Horde Bonus を増加させない」ことを明示する。

### 8.2 Bonus count / type draw

- Bonus count 算出は既存の `ceil(rejected / 5)` を維持する。
- Rejected Bonus は Normal Zombie 固定ではなく、現行 Base non-Horde Wave Slot と完全に同じ weighted table を使う。
- Normal Zombie も weighted candidate に残す。
- Base non-Horde Slots を既存順・既存 RNG semantics で先に抽選する。
- その後に Rejected Bonus Slots を抽選する。
- Riot / Hunter / Gas caps は Base Slots と Bonus Slots で Direction 単位に共有し、Base が先に cap を消費する。
- 複数 Direction 同時 Wave では現行の固定 Direction order を維持し、各 Direction について `Base draw -> Bonus draw -> roster freeze` を完了する。

## 9. Final Horde

- Final Wave の Scheduled Turn に Final roster を freeze した時点で新規 Refugee の自然到着を終了する。
- Pending Spawn が残っていても自然到着を再開しない。
- 既存 Checkpoint Queue の Screening / Accept は継続できる。
- Final victory は次の両方を満たした時だけ成立する。
  - Final Pending = 0
  - Map 上の Final roster 所属 Zombie = 0
- Map 上の Final 所属 Zombie が一時的に 0 でも Pending が残っていれば勝利しない。
- Final 以前や facility fall / Noise Respawn 等の非Final ZombieがMap上に残っていても、上記2条件を満たせば勝利する。

## 10. Soldier Zombie

- Soldier Zombie の Attack を 5 -> 10 に変更する。
- Wave、National Guard reanimation 等、出自を問わず `soldierZombie` Unit Type の基礎 stat として一律適用する。

## 11. Temporary Housing

### 11.1 基本

- 新 Constructible Facility `temporaryHousing` を追加する。
- Cost: Civilian Goods 50
- Power Demand: 5
- Soft Capacity: 10
- Build Limit: なし
- Civilian Goods output: なし
- Recruitment Hub 能力: なし
- Unit recruitment / production action は提供しない。
- Player-built Temporary Housing 自身は recruitment hub ではないが、Supply 内の健常住民は既存の共通 population pool に参加し、Capital 等の合法 Recruitment Hub での人口 cost に利用可能。

### 11.2 建設

- Plain + Supply 上のみ建設可。
- 既存 Constructible の禁止条件をすべて維持する。Road / Entrance / Reserve / existing Facility / Checkpoint / Player Unit / visible Zombie 等がある Hex は不可。
- Hidden Zombie は既存 public legality の扱いを維持する。
- 建設 Turn は `building` で効果なし。次 Player Turn Start に Operational 化する。
- Operational 化した Turn から Capacity / population function / Power Demand が有効になる。

### 11.3 City-like population behavior

- Temporary Housing は人口収容・Refugee reception・population transfer・healthy civilian defeat count 等について City-like として扱う。
- ただし Recruitment Hub ではない。
- 健常住民は healthy civilian defeat condition に含める。
- Vision 1 を持つ。Power outage / Supply disconnect 中でも Vision 1 を維持する。
- Zombie Visible Population Target Value は健常住民 `workers` のみを使う。`workers=0` なら感染者がいても Visible Population Target 候補にはならない。

### 11.4 Refugee auto-distribution

- 新規 Refugee はまず通常 City の Soft Capacity 空きを優先する。
- その後 Temporary Housing の Soft Capacity 空きを使用する。
- Temporary Housing の受入余力判定では `workers + infected` を使う。
- 全 eligible City / Housing が Soft Capacity 到達後も受入を継続する。
- Soft Capacity 超過後の自動配分先は、受入混雑率 `(workers + infected) / softCapacity` が最も低い Facility とする。同率時は既存 stable order。
- 実際の Overcrowding Penalty 計算は健常住民 `workers` のみで行う。
- 感染者が多い Housing を自動受入先として優先しない。

### 11.5 Population transfer

- 手動人口移送は健常住民 `workers` のみ。
- 感染者の施設間移送機能は追加しない。
- Temporary Housing への手動移送は Soft Capacity 10 を超えても合法。Capacity は Hard Cap ではない。
- `workers + infected` が 10 以上でも、明示的な Player transfer 自体は阻害しない。ただし UI / Agent は総在所人数と warning を表示できる。

### 11.6 Supply disconnect

- 建設には Supply が必要だが、建設後に Supply Network から切断されても Facility・既存住民・Soft Capacity は維持する。
- Supply 外では次を停止する。
  - 新規 Refugee 自動受入
  - Supply population pool 参加
  - 他 City との population transfer 元 / 先
  - Recruitment 用 population contribution
- Supply 復旧後に再参加する。
- Supply 外でも Vision 1、Overcrowding 判定、healthy civilian defeat count、Zombie Target eligibility は維持する。

### 11.7 Power allocation / outage penalty

Power allocation priority は次のとおり。

1. Capital / normal City
2. occupied Temporary Housing
3. 既存 production / normal-demand tiers（Farm / Civilian Factory -> Military Factory -> Refinery -> Drone -> Army Base reservation の現行順）
4. empty Temporary Housing

- Temporary Housing に Player Power Supply ON/OFF toggle は設けない。
- occupied 判定は健常住民 `workers > 0` のみ。
- `workers=0 / infected>0` は Power allocation 上 empty Housing tier とする。
- empty unpowered Housing は outage penalty 対象外。
- occupied Housing が power を得られない場合、1棟につき通常 Food / Civilian Goods maintenance に +1% の追加 maintenance penalty を与える。
- Supply disconnect により Grid power を受けられない occupied Housing も同じ outage penalty 対象。
- 原因表示は `power_shortage` と `supply_disconnected` を区別できるようにする。
- outage count を先に合計し、各 resource ごとに一度だけ計算する。
  - `ceil(normalFoodMaintenance * outageCount / 100)`
  - `ceil(normalCivilianGoodsMaintenance * outageCount / 100)`
- Overcrowding Penalty と outage penalty は独立原因・独立 breakdown とする。
- 両方該当すれば両方加算する。
- どちらも penalty 適用前の通常 maintenance を基礎に独立計算し、相互に複利計算しない。

### 11.8 Turn snapshot

- EndTurn 中の Power Allocation は EndTurn 開始時 snapshot で固定する。
- EndTurn 途中の Refugee reception により empty -> occupied へ変化しても、その EndTurn 中は Power tier を再配分しない。
- 次 Player Turn から occupied tier として扱う。

### 11.9 Overcrowding

- Soft Capacity は 10。Hard Cap ではない。
- Temporary Housing の Overcrowding 判定・Penaltyには健常住民 `workers` のみを数える。`infected` は Penalty 人口に数えない。
- ただし受入余力・自動配分混雑率には `workers + infected` を使う。

### 11.10 Zombie contact / fall

- `workers=0 / infected=0` の Temporary Housing に Zombie が侵入した場合、即座に fall / disappear する。追加 Zombie spawn は無い。侵入した Zombie は Hex に残る。
- `workers=0 / infected>0` は空 Housing 特例にしない。通常の infection / fall 処理を行う。
- `workers>0` の場合も通常 City と同じ infection progression を行い、fall 条件成立時に Housing を削除する。
- infection / fall で生成する Zombie は現行 site spawn と同じ Normal Zombie 固定。Wave weighted table は使わない。
- Housing 消滅後は Fallen Site を残さず、通常 Plain Hex へ戻す。

### 11.11 Decommission

- Temporary Housing は decommission 可。
- 条件:
  - Player-owned
  - `workers=0`
  - `infected=0`
  - building ではない
  - Zombie 非占有
- Supply 接続は不要。
- 1 Player Action を消費。
- Refund 0。

## 12. Wind Power

### 12.1 Player-built Wind

- Wind Power を Constructible に追加する。
- Cost: Civilian Goods 100
- Generation: 15 固定
- Worker: 0
- 建設条件は Temporary Housing と同じく Plain + Supply + 既存 Constructible 禁止条件。
- 建設 Turn は building で発電・Noiseなし。次 Player Turn Start から Operational。
- Player-built Wind の Build Limit は `roadBranches.length`。現Mapでは4。
- 初期配置 Wind はこの上限 Count に含めない。
- Player-built Wind は `building / operational / disabled / recovering` の間すべて slot を消費する。
- Wind は decommission 不可。

### 12.2 Initial / player-built parity

- 初期 Wind と Player-built Wind は、建設由来を除き同じ性能・Vision・Zombie contact / disabled / recovery semantics を持つ。
- Zombie contact 時は既存 Wind と同じ disabled / recoverable behavior とし、Temporary Housing のように消滅しない。
- Vision も既存 Wind rule を継承する。

### 12.3 Supply

- Build 時だけ Supply が必要。
- 完成後は Supply Network 外になっても、owned + operational である限り発電15とNoiseを継続する。

### 12.4 Noise

- `zombieTargetValue=5` を初期 Wind / Player-built Wind の両方から完全廃止する。
- Wind 自体は Visible Population Target 候補にならない。
- operational Wind は毎 Turn、その Wind Hex を中心に Radius 8 の Noise Pulse を 1 回発生させる。
- 4基あれば4 Pulse。各Pulseは独立し、既存共通Noise ruleにより Fallen Site Respawn をPulseごとに発生させ得る。
- `building / disabled / recovering` 中は generation 0 / Noise 0。
- operational 復帰 Turn から generation / Noise を再開する。
- 複数 Wind の Noise は既存 stable facility order（securedOrder、それで同値なら既存ID/座標 stable order）で1基ずつ完全解決する。
- Wind order に RNG を使わない。

### 12.5 Zombie Phase timing

EndTurn の順序を次のようにする。

`INTERNAL INFECTION -> WIND NOISE EMIT -> ZOMBIE TARGET SNAPSHOT -> ZOMBIE MOVE / COMBAT`

- Wind Noise は同じ EndTurn の Zombie target snapshot に反映する。
- これは mid-phase retarget ではなく、snapshot 取得前の Noise emission とする。
- `wave_capital` を持つ Wave Normal / 特殊 Zombie は Anchor が Noise より優先されるため、Wind Noiseでは逸れない。

## 13. Power / economy balance

### 13.1 Power demand

v1.5.4 の Power Demand:

- Capital: 10
- City: 10
- Civilian Factory: 15
- Military Factory: 20
- Refinery: 10
- Temporary Housing: 5
- その他既存施設は、別途本書で変更していない限り v1.5.3 の値を維持する。

### 13.2 Generation

- Power Plant: `workers × 15`（10 -> 15）
- Operational Wind: 15 固定

Power Plant の変更は初期配置・既存施設など出自を問わず一律適用する。

### 13.3 Constructible costs

- Simple Farm: Civilian Goods 15 -> 25
- Civilian Drone Base: Civilian Goods 25 -> 50
- Temporary Housing: Civilian Goods 50
- Wind Power: Civilian Goods 100

Civilian Drone Base の既存 Decommission Refund 50% rule は維持し、v1.5.4 では Refund 25 とする。

## 14. Next-turn Overcrowding / Housing Outage Forecast

### 14.1 目的

Human / AI の両方へ、次 Turn に確定的に発生する Overcrowding と Temporary Housing outage penalty を事前通知する。

### 14.2 予測対象

- 未来 RNG は予測・推測しない。
- deterministic な人口移動・既に結果が確定した Screening outcome 等だけを予測に含める。
- 建設中 Temporary Housing が次 Player Turn Start に確実に Operational 化する場合、その +10 Soft Capacity を予測へ含める。
- 建設中 Wind が次 Player Turn Start に確実に Operational 化する場合、その +15 Generation を予測へ含める。
- 建設中 Housing の +5 Power Demand 等、確定済み build completion を含めて次 Turn Power Allocation を再計算する。

### 14.3 更新タイミング / performance

- Player Action 成功など、予測結果へ影響する Game State mutation の直後に再計算する。
- UI render frame ごとには再計算しない。
- 結果を cache し、Human UI / Agent Observation は cache を読む。
- 人口移送・建設・decommission 等で予測 penalty が0になったら、該当 warning を即座に UI / Observation から削除する。
- 過去 warning の履歴は Event Log 等にのみ残す。

### 14.4 Public output

Overcrowding と Temporary Housing outage は別 Crisis Reason Code とする。

Human / AIへ、各Reasonについて以下を公開する。

- 発生有無
- 原因 / 対象
- penalty ratio
- Food の具体的追加 maintenance 予測
- Civilian Goods の具体的追加 maintenance 予測

例:

- Overcrowding: Food +4 / Civilian Goods +4
- Temporary Housing outage: 2棟, +2%, Food +2 / Civilian Goods +2

未来 RNG や hidden information は公開しない。

## 15. Agent / Observation requirements

- v1.5.4 Agent API / Observation Schema を非互換で更新する。
- 次の公開 state/event を扱えること。
  - Wave start / Spawn batch の分離
  - `baseWaveUnitCount`
  - `committedWaveUnitCount`
  - `spawnedSoFar`
  - `pendingCount`
  - Final Pending
  - Overcrowding forecast
  - Temporary Housing outage forecast
  - Temporary Housing / Wind facility state
- Rejected Counter 生値、未Spawn特殊Zombie内訳、hidden positions 等は公開しない。
- RuleBasedAgent / simulation / replay は新 Schema と Pending semantics に追従する。

## 16. Asset direction

Temporary Housing 用の facility asset を追加する。

- FEMA 等の災害時仮設住宅・緊急住宅を想起させるデザイン。
- prefab / container housing のまとまりとして見えること。
- 既存施設アートと同じゲーム視認性・縮尺・背景透過方針に合わせる。
- 軍事基地や恒久集合住宅ではなく、「短期間に設置された緊急居住区」と読めること。

## 17. Acceptance criteria / regression tests

最低限、以下を automated test / simulation で検証する。

1. 空 Capital + 周囲 Zombie の既存 Horde deadlock が再現せず、Capital侵入で即敗北する。
2. congestion fallback は Zombie overlap / pass-through を起こさず、Targetから遠ざからない。
3. `previousFallbackPosition` により Turn 跨ぎ A-B-A-B の即時振動を防ぐ。
4. Wave start 時に roster が freeze され、Spawn Zone full でも全数 Pending になる。
5. 22 Hex capacity を超える Wave が複数 Horde Phase に分割 Spawnされる。
6. 先行 Zombie が動いて空いた Spawn Zone へ後続 Pending が入る。
7. Spawn Turn の新規 Zombie は移動せず、次 Zombie Phaseから行動する。
8. 同Directionで複数Pending Waveが重なった場合、oldest first で処理される。
9. Horde Zombie が既存数の範囲で複数 Spawn Turn へ可能な限り均等分散される。
10. Wave由来Normal/特殊ZombieがCapital Anchorを持ち、Noiseより優先する。
11. Visible Populationが一時優先されてもCapital Anchorが消えず、その後Capitalへ復帰する。
12. Rejected BonusはBase Slotsの後に同じweighted tableで抽選され、capsを共有する。
13. Final WaveでもRejected Bonusが roster に入り、`baseWaveUnitCount < committedWaveUnitCount`としてHuman/AIから確認できるケースを作る。
14. Final roster freeze後はRefugee自然到着が終了する。
15. Final Pending > 0ではMap上Final Zombieが0でも勝利しない。
16. Final Pending=0かつFinal所属Map Zombie=0で、非FinalZombieが残っていても勝利する。
17. Temporary Housingのbuild timing、Capacity 10、unlimited build、Vision 1、Supply disconnect semanticsを検証する。
18. Temporary Housingの自動受入が通常City優先、Housing後順位になる。
19. Housing受入余力/配分率は`workers+infected`、Overcrowding Penaltyは`workers`のみである。
20. Empty Housing (`workers=0/infected=0`) はZombie侵入で即消滅し、Fallen Siteを残さない。
21. `workers=0/infected>0` Housingは空特例にならず通常感染/陥落処理を行う。
22. Housing outage penaltyはoccupied(`workers>0`)かつunpoweredのみを数え、count×1%をresourceごとに一度だけceilする。
23. Supply disconnectしたoccupied Housingもoutage penalty対象になり、原因表示が区別される。
24. Overcrowding / outage penaltyが独立加算され、複利にならない。
25. Wind build limitはroadBranches.lengthで初期Windを数えない。
26. operational WindだけがGeneration15/Noise8を持ち、disabled/recovering/buildingは0/0になる。
27. 複数Wind Noise Pulseがstable orderで処理され、snapshot前に完了する。
28. Wave Capital Anchor個体はWind Noiseに逸れない。
29. Soldier Zombie Attack 10がすべてのsoldierZombie出自に適用される。
30. Power demand / generation / constructible costs / Drone refund が本書の値になる。
31. ForecastはState mutation時だけ更新し、確定build completionを含み、future RNGを含めない。
32. Save Format / Map ID / Agent Schema mismatchでv1.5.3以前を明示的に拒否する。

## 18. Out of scope / unchanged unless stated

- ZombieのTarget priority自体は本書で明示したWave Capital Anchor以外は変更しない。
- Human interception / pin / movement interactionは変更しない。
- Rejected Bonus以外のfacility fall Zombie spawnはNormal Zombie固定の既存ルールを維持する。
- Simple Farm / Civilian Drone Base 等の既存建設タイミング・配置禁止条件は、本書で数値変更した箇所以外は維持する。
- Wind以外のNoise発生源・Noise priorityは、本書で明示した範囲以外は維持する。
- 旧Save migrationは実装しない。
