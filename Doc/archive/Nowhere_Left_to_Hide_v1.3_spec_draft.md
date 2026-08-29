# Nowhere Left to Hide PoC v1.3 アップデート要件 ドラフト
## Terrain / Fog of War / Zombie Sensing / Horde Resolution

作成日: 2026-08-29  
ステータス: Draft

---

# 1. 目的

v1.2.xまでのNowhere Left to Hideでは、盤面上の地形差がほぼ存在せず、Zombieの位置も常時プレイヤーから確認可能である。

また、通常ZombieとHordeで基本的に同じUnit Typeおよび行動原理を共有しており、Hordeは主に「一定周期で追加されるZombie集団」として機能している。

v1.3では以下を導入する。

1. 地形による移動・防御差
2. UnitごとのVision
3. Fog of Warによる敵位置情報制限
4. 通常Zombieの視界依存Targeting
5. Horde専用Zombie Type
6. Horde Zombieによる通常ZombieへのTarget伝播
7. Final Hordeと新しい勝利条件

これにより、

> 敵の位置をすべて把握した状態で火力を配置するゲーム

から、

> 地形・視界・敵の行動原理を読みながら、どこを守り、どこを捨て、どこへ部隊を配置するか判断するゲーム

へ発展させる。

---

# 2. 本Versionの中心テーマ

v1.3の中心体験は、

> **見えない敵を、地形と敵の行動原理から読む**

こととする。

Zombieを単純に強化するのではなく、

- 見えていないZombieは正確に把握できない
- Zombie自身も全マップ情報を持たない
- Hordeだけは州都へ向かう明確な戦略目標を持つ
- Hordeが周辺の通常Zombieを巻き込む

ことで、敵側にも限定された情報と行動原理を与える。

---

# 3. スコープ

## 3.1 本アップデートで追加・変更する要素

- Terrain Type
- Terrain Movement Cost
- Terrain Defense Modifier
- RoadとTerrainの分離
- Vision Parameter
- Fog of War
- Agent Observationの敵情報制限
- 通常Zombie Targeting
- Horde Zombie Unit Type
- Horde Zombie Targeting
- Horde Target伝播
- Final Horde
- Turn 30以降のゲーム継続
- 新勝利条件
- Terrain / Vision / Zombie AIに対応したUI
- Balanced AgentのFoW対応
- Replay / Metrics / Observationの更新

## 3.2 今回実装しない要素

- Noise
- 車両
- 航空機
- 水上移動
- Forest / Mountainへの車両進入制限
- Vision Line of Sight
- TerrainによるVision遮蔽
- 高低差
- 建設
- 大型Map
- 詳細な道路移動Bonus
- Zombie Variantの大量追加
- Survivor Unit Variant
- XP
- 地域別Supply
- Final Horde以外のVictory Condition追加

---

# 4. Terrain構造

Terrainは基礎地形として保持する。

最低限以下を定義する。

```text
Plain
Forest
Mountain
Water
```

RoadはTerrain Typeそのものではなく、Terrain上へ重なるOverlayとして扱う。

Facility、City、Checkpoint等も基礎Terrainとは別のHex属性として扱う。

これにより将来的に、

```text
Plain + Road
Forest + Road
Mountain + Road
Facility + Road
```

等を表現可能にする。

---

# 5. Terrain Type

## 5.1 Plain

標準地形。

- Movement Cost: 1
- Defense Bonus: なし
- Ground Unit進入可能
- Zombie進入可能

---

## 5.2 Forest

移動しにくい地形。

- Movement Cost: 2
- Zombie側のみDefense Bonusあり
- Human UnitにはDefense Bonusなし
- Ground Unit進入可能
- Zombie進入可能

将来的にはVehicle Ground Unit進入不可候補とする。

v1.3ではVehicle未実装のため進入制限は追加しない。

---

## 5.3 Mountain

非常に移動しにくい地形。

- Movement Cost: 3
- Defense Bonus: なし
- Ground Unit進入可能
- Zombie進入可能

将来的にはVehicle Ground Unit進入不可候補とする。

---

## 5.4 Water

将来用Terrainとして定義する。

v1.3標準Mapには原則配置しない。

- Ground Human Unit進入不可
- Zombie進入不可
- 将来のFlying Unitは進入可能候補

PathfindingではGround Unitに対してimpassableとして扱う。

---

# 6. Road

RoadはTerrain Overlayとする。

Road上では基礎Terrainより道路移動を優先し、

```text
Movement Cost = 1
```

とする。

例:

```text
Forest + Road → Cost 1
Mountain + Road → Cost 1
Plain + Road → Cost 1
```

RoadそのものにはDefense Bonusを与えない。

Roadの既存用途である、

- Checkpoint建設
- Horde侵入口
- 視覚誘導
- Branch Definition

は維持する。

---

# 7. Facility / Urban Hex

以下をUrban / Facility Hexとして扱う。

- Capital
- City
- Farm
- Civilian Factory
- Military Factory
- Refinery
- Power Plant
- Checkpoint
- Checkpoint Remnant等

Urban / Facility Hexは、

```text
Movement Cost = 1
```

として扱う。

基礎TerrainよりUrban Movement Costを優先する。

---

# 8. Terrain Defense

## 8.1 Urban Defense

Urban / Facility Hex内に存在するUnitは、

**外部Hexから受ける通常Combat DamageにDefense Bonus**

を得る。

対象:

- Police
- National Guard
- Zombie
- Horde Zombie
- 将来追加されるGround Unit

同一Hex内部処理やInfection Suppression等には適用しない。

---

## 8.2 Forest Defense

Forest Hexでは、

**Zombie陣営のみ**

Defense Bonusを得る。

対象:

- Zombie
- Horde Zombie
- 将来追加されるZombie Variant

Human UnitはForest Defense Bonusを得ない。

---

## 8.3 Plain / Road / Mountain

Defense Bonusなし。

---

## 8.4 Damage処理

Terrain Defense値そのものはConfig化する。

最終Damageは最低1を保証する。

概念式:

```text
Final Damage =
max(
  1,
  ceil(Base Damage × Terrain Damage Multiplier)
)
```

具体的なMultiplierはBalance Testで調整可能にする。

---

# 9. Vision

各UnitにVision Parameterを追加する。

v1.3標準値:

| Unit | Vision |
|---|---:|
| Police | 5 |
| National Guard | 5 |
| Zombie | 3 |
| Horde Zombie | 3 |

1.2.x時点のMovement値を暫定Vision値として採用する。

VisionはMovementとは独立したConfig値として保持する。

将来MovementとVisionを個別調整可能にする。

---

# 10. Vision計算

v1.3ではHex DistanceのみでVisionを判定する。

```text
hexDistance(observer, target) <= vision
```

ならVisibleとする。

Terrainによる、

- Vision遮蔽
- Forest Visibility Penalty
- Mountain LOS
- 高低差
- Building Occlusion

は実装しない。

つまりv1.3ではForestやMountain越しでもVision Radius内なら視認可能。

---

# 11. Fog of War

## 11.1 基本原則

Human PlayerおよびAgentは、

**現在の味方Vision外に存在する敵Unitの正確な位置を取得できない。**

FoW対象:

- Zombie
- Horde Zombie

---

## 11.2 常時既知情報

以下はFoW対象外とする。

- Map Terrain
- Road
- Facility Location
- Facility Type
- Horde Warning
- Horde Direction
- Horde Arrival Timing
- 自軍Unit
- 自軍所有Facility
- 自軍Checkpoint
- Supply Network

州政府は州内の地理・主要Infrastructure位置を把握している前提とする。

---

## 11.3 敵Unit

Vision内:

```text
Observationへ表示
```

Vision外:

```text
Observationから除外
```

v1.3では、

- Last Known Position
- Ghost Marker
- 最終確認Turn
- 推定位置

は実装しない。

一度Vision外へ出た敵は、再発見されるまで現在位置不明とする。

---

# 12. Agent ObservationとFair Play

v1.2.xで導入した、

```text
GameState = Internal Truth
AgentObservation = Player-visible Information
```

の境界を維持する。

v1.3では特に、

**AgentObservationからVision外Zombieを完全に除外する。**

Balanced Agent、Random Agent、Browser Bridge、外部LLM Playerは、GameState上の非Visible Zombie位置を意思決定に利用してはならない。

Debug用途のInternal Stateは従来どおりPlayer-facing APIへ公開しない。

---

# 13. Zombie Type

v1.3ではZombie陣営を最低限以下の2Unit Typeへ分離する。

```text
zombie
hordeZombie
```

---

# 14. Horde Zombie

Horde Zombieは通常ZombieとCombat Performanceを共有する。

v1.3標準値:

```text
HP = existing Zombie
Attack = existing Zombie
Move = existing Zombie
Range = existing Zombie
Vision = 3
```

通常Zombieとの差は、

**Targeting Logic**

のみとする。

別Unit Typeとして保持し、

- UI Icon
- Agent Observation
- Replay
- Metrics
- Horde Victory Tracking

で通常Zombieと識別可能にする。

---

# 15. 通常Zombie Targeting

通常Zombieは全Map情報を利用しない。

毎Zombie Turn、現在のVision内情報を基準にTargetを決定する。

優先順位:

```text
1. Visible Population Target
2. Noise Target
3. Inherited Horde Target
4. Idle
```

v1.3ではNoise未実装なので実質:

```text
Visible Population Target
>
Inherited Horde Target
>
Idle
```

となる。

---

# 16. Visible Population Target

通常ZombieおよびHorde Zombieは、自身のVision内に既存Zombie AI上の有効Targetがある場合、それを優先する。

Target選択基準は原則として既存Zombie Targetingの意味を維持する。

基本:

```text
Vision内でHealthy Civilian Populationが最も多い有効Hex
```

を優先する。

同値の場合は既存の決定的なTie-breakまたはSeed付きTie-breakを維持する。

Unit Population単独をPopulation Targetには含めない。

---

# 17. 通常ZombieのIdle

以下をすべて満たす通常ZombieはIdleとする。

- Vision内に有効Population Targetなし
- Noise Targetなし
- Inherited Horde Targetなし

Idle ZombieはそのZombie Turnに移動しない。

ただし通常のCombat / Interception等の合法条件が発生した場合は既存Combat Ruleを適用する。

---

# 18. Horde Zombie Targeting

Horde Zombieは通常Zombieと異なり、Strategic Targetを持つ。

優先順位:

```text
1. Visible Population Target
2. Capital
```

---

## 18.1 Vision内Targetあり

通常Zombieと同じVisible Population Target選択を行う。

---

## 18.2 Vision内Targetなし

Capital Positionを目標として進み続ける。

CapitalはHorde Zombieにとって常時既知のStrategic Anchorとする。

---

## 18.3 Visible Target消失

Horde Zombieが一時的に別Population Targetへ向かった後、そのTargetが、

- Vision外へ出た
- Population 0になった
- Targetとして無効になった

場合、

再びCapitalをTargetとする。

---

# 19. Horde Target伝播

通常ZombieがTargetを持っていない状態で、自身のVision内にHorde Zombieが入った場合、

そのHorde Zombieが現在持っているTargetを継承する。

```text
Normal Zombie Target
=
Visible Horde Zombie Current Target
```

---

# 20. Horde Target継承後

継承したTargetは通常Zombie自身がHorde Zombieを見失っても保持する。

その後の優先順位:

```text
Visible Population Target
>
Noise
>
Inherited Horde Target
>
Idle
```

つまり継承後に自身のVision内へより優先度の高いPopulation Targetが現れた場合、そのTargetへ切り替える。

---

# 21. Inherited Target解除

Inherited Horde Targetが以下の場合は解除する。

- Target Locationが有効なTargetでなくなった
- Healthy Populationが0になった
- Target FacilityがPlayer側Targetとして存在しなくなった
- その他Target Validationに失敗した

解除後に、

- Visible Populationなし
- Noiseなし
- 新たなHorde Targetなし

ならIdleへ戻る。

---

# 22. 複数Horde Zombie

Targetを持たない通常ZombieのVision内に複数Horde Zombieが存在する場合、

1. 最も近いHorde Zombie
2. 同距離なら安定したUnit ID順

で参照するHorde Zombieを決定する。

選択されたHorde ZombieのCurrent Targetを継承する。

---

# 23. Target伝播範囲

v1.3では、

```text
Horde Zombie → Normal Zombie
```

のみTarget共有を許可する。

以下は禁止する。

```text
Normal Zombie → Normal Zombie
Normal Zombie → Horde Zombie
```

これによりTarget情報がMap全域へ無制限に連鎖することを防ぐ。

---

# 24. 将来のNoise

v1.3ではNoise Systemを実装しない。

ただしZombie Target Priorityは将来拡張可能な構造とする。

将来想定:

通常Zombie:

```text
Visible Population
>
Noise
>
Inherited Horde Target
>
Idle
```

NoiseはVision外に存在していてもZombieを誘引可能とする予定。

Noise Targetへ移動中でもVision内へPopulation Targetが現れた場合、Population Targetを優先する。

想定Noise Source:

- Police Gunfire
- National Guard Gunfire
- Vehicle
- Aircraft
- Explosion
- その他将来Unit

---

# 25. Horde Spawn

通常のHorde Spawn周期・予告システムは維持する。

Hordeとして生成されるZombieはすべて、

```text
hordeZombie
```

として生成する。

既存Map上の通常Zombieは自動的にHorde Zombieへ変換しない。

---

# 26. Final Horde

Turn 30を従来の即時Victory Triggerから、

**Final Horde Trigger**

へ変更する。

Turn 30到達だけではVictoryにならない。

Turn 30にFinal Hordeを生成する。

Final Horde規模・方向・生成ルールはConfig化し、既存Horde Ruleを基礎とする。

---

# 27. Turn 30以降

Final Horde発生後もGameは継続する。

```text
Turn 31
Turn 32
Turn 33
...
```

を許可する。

Final Horde後は新しいPeriodic Hordeを生成しない。

ゲームは、

- Victory Condition成立
- Defeat Condition成立

のどちらかまで継続する。

---

# 28. Victory Condition

Final Horde発生後、以下をすべて満たした時点で即時Victoryとする。

## 条件1: Final Horde殲滅

Final Hordeとして生成されたHorde Zombieがすべて死亡している。

この条件はSupply Network内外を問わない。

Final Horde Zombieが1体でも残っていればVictoryしない。

---

## 条件2: Supply Network内Zombie 0

現在のPlayer Supply Network内に、

```text
Zombie
Horde Zombie
```

が1体も存在しない。

Final Horde以外の通常ZombieがSupply Network外に残っていてもVictory可能とする。

---

## 条件3: Supply Network内Infected Population 0

現在のPlayer Supply Network内に存在する、

- Capital
- City
- Production Facility
- Operational Checkpoint
- Checkpoint Remnant
- その他Infected Populationを保持可能なPlayer-controlled Location

のInfected Population合計が0である。

---

# 29. Victory判定とSupply Network縮小

Victory判定には、

**その時点の現在のSupply Network**

を使用する。

したがってPlayerは、

- Checkpointを後退
- Checkpointを放棄
- Supply範囲を縮小

することで、維持不能な地域を統治圏外へ切り離すことが可能。

Supply Network外に、

- Normal Zombie
- Infected Facility
- 感染地域

が残っていても、Final Hordeを殲滅し、現在の統治圏内を完全に安全化できていればVictory可能とする。

これは意図したStrategyとする。

---

# 30. Victoryの意味

Victoryは、

```text
世界中のZombieを絶滅させた
```

ことを意味しない。

Victoryは、

> **Final Hordeを撃退し、Playerが維持する行政・補給圏内からZombieと感染を排除した**

ことを意味する。

Supply Network外の地域は、

- 行政崩壊地域
- 未回復地域
- 感染残存地域

として残り得る。

---

# 31. Defeat Condition

Turn 30以降も既存Defeat Conditionを維持する。

最低限:

- Capital Lost
- Healthy Civilian Population 0

が成立すれば即時Defeat。

Final Hordeを殲滅していても、Victory Condition全体を満たす前にDefeat Conditionが成立した場合は敗北とする。

---

# 32. FoWとVictory

Supply Network内にVision外Zombieが存在する可能性がある。

Victory ConditionはGameState上の真実を判定する。

ただしPlayerへ、

```text
Supply Network内に未排除Zombieが残っている
```

こと自体はVictory未成立として通知可能とする。

敵の正確なHex PositionをVictory判定によって公開してはならない。

つまり、

```text
Secure Zone Not Clear
```

のような情報は表示可能だが、

```text
Zombie remains at q=9,r=11
```

のようなFoW突破情報は表示しない。

---

# 33. Final Hordeと通常Zombie

Final Horde開始時にMap上のすべての通常Zombieへ強制的にCapital Targetを付与することはしない。

通常Zombieは通常どおり、

```text
Visible Population
>
Noise
>
Inherited Horde Target
>
Idle
```

に従う。

Final Horde Zombieが接近した通常ZombieだけがHorde Targetを継承する。

これによりHordeは周辺Zombieを巻き込みながら進軍する。

---

# 34. Hordeのゲーム上の役割

v1.3ではHordeを、

```text
単なる追加Zombie Spawn
```

から、

```text
Strategic Objectiveを持ち、
周辺の散在Zombieへ目的を与える移動する感染波
```

へ変更する。

これにより、

> Hordeが侵入
> ↓
> 周辺のIdle ZombieがHordeを発見
> ↓
> Horde Targetを継承
> ↓
> 既存Zombieまで戦線へ参加

という状況を発生させる。

---

# 35. UI

## 35.1 Terrain

Hex選択時に最低限、

```text
Terrain
Movement Cost
Defense Effect
Road
```

を確認可能にする。

---

## 35.2 Vision

Human Unit選択時、

```text
Vision Range
```

を表示する。

可能であればMap上にVision範囲Overlayを表示する。

---

## 35.3 Fog of War

Vision外HexはTerrain・Road・Facility Location自体は表示する。

Enemy Unitだけ非表示とする。

完全なBlack Fogではなく、

**Known Map / Unknown Enemy**

として表現する。

---

## 35.4 Horde Zombie

通常ZombieとHorde Zombieを視覚的に識別可能にする。

Production Artは不要だが、最低限、

- Icon
- Marker
- Outline
- Label

等で区別する。

---

# 36. Observation API

AgentObservationへ最低限以下を追加または確認する。

Unit:

```text
vision
terrain
movementCost
terrainDefense
```

Map Tile:

```text
terrain
road
movementCost
```

Enemy:

```text
visible enemies only
unitType
hordeZombie distinction
```

Horde:

```text
warningDirection
turnsRemaining
finalHordeStarted
finalHordeRemaining
```

Victory Status:

```text
finalHordeDefeated
suppliedAreaZombieClear
suppliedAreaInfectionClear
```

ただしVictory StatusからHidden Enemyの正確な位置を推測できないようにする。

---

# 37. Zombie Observation

AgentへZombieの内部Targetそのものを公開するかはPlayer-visible情報として慎重に扱う。

基本方針として、

**Zombieの内部Targetは公開しない。**

Player / Agentは、

- Horde Zombieの既知の行動原理
- Position
- Vision
- 周辺Population

から次の動きを推測する。

Debug TraceではTarget Reasonを保存可能とする。

---

# 38. Balanced Agent対応

Balanced AgentはGameStateを直接参照せず、Vision内情報だけで判断する。

最低限以下を考慮する。

- Visible Zombie
- Horde Zombie
- Terrain Movement Cost
- Urban Defense
- Forest Zombie Defense
- Vision Coverage
- Horde Warning
- Supply Network
- Final Victory Conditions

Vision外Zombieの位置を利用してはならない。

---

# 39. Pathfinding

PathfindingはTerrain Movement Costを使用する。

Ground Unitごとに、

```text
remainingMovement >= terrainMovementCost
```

を満たすHexへ進入可能。

RoadおよびUrbanはCost 1。

ForestはCost 2。

MountainはCost 3。

WaterはGround Unitに対して進入不可。

移動途中でMovement Pointが不足するHexへは進入しない。

---

# 40. InterceptionとTerrain

Movement Cost導入後も既存Interception Ruleを維持する。

敵射程へ入った最初の到達HexでInterception判定する。

Terrain DefenseはDamage発生時のDefender Positionを基準にする。

---

# 41. Replay / Determinism

以下をReplay Artifactへ保存・再現可能にする。

- Terrain Map
- Vision Config
- Horde Zombie Type
- Zombie Target選択
- Horde Target継承
- Final Horde Identity
- Final Horde残存数
- Victory判定

同じ、

```text
Version
Config
Map
Seed
Action[]
```

から同じ結果を再現する。

---

# 42. Metrics

v1.3では既存Metricsへ必要に応じて以下を追加する。

```text
finalHordeSpawned
finalHordeKilled
finalHordeRemaining
normalZombiesKilled
hordeZombiesKilled
maxVisibleZombies
turnsAfterFinalHorde
suppliedAreaZombieClearTurn
suppliedAreaInfectionClearTurn
victoryTurn
```

Terrain関連では必要に応じて、

```text
combatInUrban
combatInForest
```

等を追加可能とする。

---

# 43. テスト項目

## Terrain

- Plain Cost 1
- Road Cost 1
- Urban Cost 1
- Forest Cost 2
- Mountain Cost 3
- Water Ground Entry不可
- Forest + RoadはCost 1
- Mountain + RoadはCost 1

## Defense

- Urban外部攻撃でDefense適用
- Plain Defenseなし
- Road Defenseなし
- Forest ZombieのみDefense適用
- Forest Human UnitにはDefenseなし
- Mountain Defenseなし
- Final Damage最低1

## Vision

- Police Vision 5
- National Guard Vision 5
- Zombie Vision 3
- Horde Zombie Vision 3
- TerrainはVisionを遮らない
- Vision外ZombieはObservationから消える

## Normal Zombie

- Visible Populationへ移動
- TargetなしならIdle
- Horde Target継承
- Visible Population出現時にInherited Targetより優先
- Inherited Target消失後Idle可能

## Horde Zombie

- Visible Populationを優先
- Visible TargetなしならCapitalへ向かう
- Visible Target消失後Capitalへ戻る
- 通常ZombieへTarget伝播可能

## Target Propagation

- Horde → Normalのみ
- Normal → Normalは禁止
- 複数Horde時は距離→ID順
- HordeがVision外になってもInherited Target維持

## Victory

- Turn 30だけではVictoryしない
- Final Hordeが残っていればVictoryしない
- Final Horde全滅＋Supply内ZombieありならVictoryしない
- Final Horde全滅＋Supply内InfectionありならVictoryしない
- Final Horde全滅＋Supply内Zombie0＋Infection0でVictory
- Supply外通常Zombieが残っていてもVictory可能
- Supply縮小後の現在範囲でVictory判定
- FoWを突破してZombie位置を公開しない

---

# 44. 実装順序案

1. Terrain Data Model
2. Terrain Movement Cost
3. Terrain Defense
4. Vision Parameter
5. Visible Tile / Enemy判定
6. Agent Observation FoW
7. Horde Zombie Unit Type
8. Normal Zombie Vision-based Targeting
9. Horde Zombie Targeting
10. Horde Target Propagation
11. Final Horde
12. New Victory Condition
13. UI
14. Balanced Agent対応
15. Replay / Metrics
16. Unit Test
17. Seed Regression
18. Batch Simulation
19. LLM Playtest

---

# 45. バランス検証

v1.3では複数の大きな変数が同時に変わるため、勝率だけで評価しない。

特に確認する。

- Forest DefenseがZombieを硬くしすぎないか
- Mountain CostがAI Pathfindingを不自然にしないか
- Normal ZombieがIdleしすぎないか
- HordeによるTarget伝播が強すぎないか
- HordeがMap上のZombieを十分巻き込むか
- FoWによってHuman / LLM Playerが不必要な探索作業へ陥らないか
- Final Horde後の掃討期間が長すぎないか
- Supply縮小Victoryが簡単すぎる逃げ道にならないか
- Final Horde殲滅が現在の経済・Unit数で現実的か

---

# 46. 成功条件

v1.3が成功した状態は以下。

- Terrainによって移動経路を考える意味がある
- Urban Defenseによって施設防衛に地理的意味がある
- ForestがZombieにとって有利な場所として機能する
- Vision外のZombie位置を予測する必要がある
- Normal Zombieが全Map情報を持っていない
- Horde Zombieが通常Zombieとは異なる脅威として認識できる
- Hordeが既存Zombieを戦線へ巻き込む
- Final Hordeが実際のゲーム上のクライマックスになる
- Turn 30到達だけでなく、統治圏を安全化して初めてVictoryになる
- Map全域の最後の1体を探す作業を要求しない
- AgentがHuman Playerと同じ可視情報だけでプレイできる

---

# 47. v1.3の設計意図

v1.2.xまでは、Playerは敵の位置をほぼ完全に把握し、

```text
どのZombieをどのUnitで倒すか
```

を中心に判断できた。

v1.3では、

```text
どこが見えているか
どこを通れば早いか
どこなら守りやすいか
HordeがどのZombieを巻き込むか
どの領域まで政府として守り切るか
```

を判断対象へ追加する。

Final Victoryは、

> 州全土を完全にZombie Freeにすること

ではなく、

> **Final Hordeを撃破し、自ら維持している統治・補給圏からZombieと感染を排除すること**

とする。

この変更により、

**「30ターン生き残った」**

から、

**「最後の危機を撃退し、守ると決めた州政府の領域を取り戻した」**

へVictoryの意味を変更する。