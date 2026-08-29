# Nowhere Left to Hide PoC v1.3 アップデート要件 確定版
## Terrain / Fog of War / Zombie Sensing / Horde Resolution

作成日: 2026-08-29  
ステータス: 確定・実装前

---

# 1. 文書の位置づけ

本書は、v1.3で追加・変更する部分の確定要件である。

- 実装・テスト・動作確認が完了するまでは、`Nowhere Left to Hide PoC 現行仕様.md`を安定版の正本とする。
- 本書はv1.3の実装目標として、現行仕様から変更する範囲だけを優先する。
- 本書に変更記載のない経済、人口、感染、Checkpoint、Supply、戦闘、保存容器、Agent実行基盤等は現行仕様を維持する。
- 実装・テスト・動作確認完了後、本書を現行仕様へ反映し、両者の整合を確認してから本書をarchiveへ移す。
- 日本語UIでもタイトルは`Nowhere Left to Hide`と表記する。

---

# 2. 目的と中心体験

v1.3では、次を導入する。

1. 地形による移動・防御差
2. UnitおよびPlayer管理施設によるVision
3. 敵Unitだけを隠すFog of War
4. 通常Zombieの視界依存TargetingとIdle
5. Horde専用Zombie TypeとTarget伝播
6. Turn 30のFinal Horde化
7. Final Horde撃退と現在の統治圏安全化による新Victory

中心体験は次のとおりとする。

> **見えない敵を、地形と敵の行動原理から読む。**

敵を単純に強化するのではなく、PlayerとZombieの双方が限定された情報を使い、地形、視界、Hordeの進路、守る統治圏を判断対象へ加える。

---

# 3. スコープ

## 3.1 追加・変更する要素

- Terrain Typeと固定Terrain Map
- Road／Urbanと基礎Terrainの分離
- Terrain Movement Cost
- Terrain Defense
- Unit／Facility Vision
- Player／Agent向けFog of War
- FoWを突破しないLegal Actions、公開Event、UIログ
- 通常ZombieのVision依存Targeting、Idle、Target記憶
- `hordeZombie` Unit Type
- Horde ZombieのStrategic Target
- Hordeから通常ZombieへのTarget伝播
- Periodic HordeとFinal Hordeの型分離・追跡
- `maxTurns`廃止と`finalHordeTurn`導入
- 新Victory条件
- Terrain／Vision／FoW／Final Horde対応UI
- Observation／Browser Bridge／Agent／Replay／Metrics更新
- v1.3用Version／Save境界

## 3.2 今回実装しない要素

- Noise
- 車両、航空機、水上移動
- Forest／Mountainへの車両進入制限
- Vision Line of Sight
- TerrainによるVision遮蔽や減衰
- 高低差、Building Occlusion
- 建設一般、大型Map、手続き型Map生成
- Road上のCost 1以外の詳細移動Bonus
- Last Known Position、Ghost Marker、最終確認Turn、推定位置
- Zombie／Survivor Variantの追加
- XP、地域別Supply
- Final Horde以外の新Victory Condition

---

# 4. Version境界

| 対象 | v1.3 Version |
|---|---|
| App / Release | `1.3.0` |
| Game Rules / GameState / Config | `1.4.0` |
| Fixed Map ID | `fixed-15x15-v2` |
| Save Format | `3` |
| Agent API | `1.4.0` |
| Observation API | `1.4.0` |
| Browser Bridge API | `1.4.0` |
| Artifact Schema | `1.4.0` |
| Balanced Agent | `3.0.0` |
| Random Agent | `1.2.0` |

- v1.2.7のGame Rules等が`1.3.0`であるため、v1.3では`1.4.0`へ更新する。
- FoW対応でBalanced Agentの判断原理が変わるためmajor更新とする。
- Random Agentの基本選択アルゴリズムは維持し、公開情報対応をminor更新とする。
- Build IDは現行仕様どおり乱数とゲーム結果へ影響させない。

---

# 5. 固定MapとTerrain Data Model

## 5.1 固定Mapの維持

- Mapは15×15の固定Mapを維持する。
- 道路、16施設、4方向のHorde侵入口、道路支線、初期Human Unit、初期Zombieの座標を変更しない。
- SeedによるTerrain自動生成は行わない。
- v1.3では各Hexへ基礎Terrainを追加し、Map IDを`fixed-15x15-v2`へ更新する。

## 5.2 TerrainとOverlay

基礎Terrainは次の4種類とする。

```text
plain
forest
mountain
water
```

Road、Facility、Capital、City、Checkpointは基礎Terrainとは別のOverlay／Hex属性として保持する。

```text
Base Terrain + Road + Facility / Checkpoint
```

の組合せを表現可能にし、TerrainとRoadを同一enumへ格納しない。

## 5.3 標準Mapの固定Terrain配置

座標は現行Mapと同じAxial `q,r`を使う。以下に列挙しないHexはすべて`plain`とする。`water`は標準Mapへ配置しない。

### Forest（49 Hex）

```text
(3,4) (4,4) (4,5) (3,5) (4,6) (5,6) (5,4) (3,6)
(9,2) (10,2) (9,3) (10,3) (11,4) (9,4) (10,4) (12,4)
(2,9) (3,9) (3,10) (4,10) (4,11) (5,10) (5,11) (2,10)
(9,9) (10,9) (11,9) (9,10) (10,10) (11,10) (10,11) (11,11) (12,10)
(7,2) (12,7) (7,12) (2,7)
(5,2) (6,2) (6,3) (12,5) (13,5) (12,6)
(1,8) (2,8) (3,8) (6,12) (6,13) (5,12)
```

### Mountain（32 Hex）

```text
(1,1) (2,1) (1,2) (2,2) (3,2) (1,3) (2,3)
(12,1) (13,1) (11,2) (12,2) (13,2) (12,3) (13,3)
(1,11) (2,11) (1,12) (2,12) (3,12) (1,13) (2,13)
(12,11) (13,11) (11,12) (12,12) (13,12) (12,13) (13,13)
(7,1) (13,7) (7,13) (1,7)
```

### 配置上の意図

- 中央都市圏と全主要施設への経路を閉鎖しない。
- 外縁へMountain、各象限へForestを置き、道路を使う経路と道路外の短絡を比較できるようにする。
- `(7,2)`、`(12,7)`、`(7,12)`、`(2,7)`はForest＋Roadとする。
- `(7,1)`、`(13,7)`、`(7,13)`、`(1,7)`はMountain＋Roadとする。
- 初期Zombie 4体のうち`(4,4)`と`(11,10)`はForest、`(11,3)`と`(3,11)`はPlainとし、初期戦闘で地形差を確認可能にする。
- Forest上のFacilityはUrban処理を優先し、防御を重複させない。

---

# 6. Movement CostとPathfinding

## 6.1 基礎Cost

| Terrain | Cost | Ground Human | Zombie |
|---|---:|---|---|
| Plain | 1 | 進入可 | 進入可 |
| Forest | 2 | 進入可 | 進入可 |
| Mountain | 3 | 進入可 | 進入可 |
| Water | — | 進入不可 | 進入不可 |

## 6.2 Overlay優先順位

- Road上の実効Movement Costは基礎Terrainに関係なく1とする。
- Capital、City、生産施設、稼働／非稼働Checkpoint、Remnant等のUrban Hexは状態に関係なくCost 1とする。
- RoadまたはUrbanのCost 1を基礎Terrainより優先する。
- Water上にRoad／Urbanを置くMapはv1.3標準Mapでは作らない。

## 6.3 Movement Point消費

- 進入先Hexの実効Movement Costを進入時に消費する。
- 開始HexのCostは消費しない。
- `remainingMovement >= destinationCost`の場合だけ進入できる。
- 残Movement Pointが不足するHexへ部分進入しない。
- Ground UnitはWaterへ進入せず、Pathfindingでも通行不能とする。

## 6.4 Pathfinding

- Human Unit、通常Zombie、Horde Zombieは同じCoreの重み付きPathfindingを使用する。
- 最小の合計Movement Costを持つ経路を選ぶ。
- 同Costの経路は安定した座標順で決定し、UI、Headless、Agent、Replayで分岐させない。
- Interceptionは実際に進入した各Hexで現行ルールどおり判定する。

---

# 7. Terrain Defense

## 7.1 標準値

| Defense Source | 対象 | Damage Multiplier |
|---|---|---:|
| Urban | そのHexのHuman／Zombie Ground Unit | `0.5` |
| Forest | そのHexの通常Zombie／Horde Zombie | `0.5` |
| Plain | なし | `1.0` |
| Mountain | なし | `1.0` |
| Road | Road自体の追加防御なし | — |

各MultiplierはConfig化する。

## 7.2 Urban Hex

次のHexは所有・稼働・陥落・荒廃・放棄状態に関係なくUrban防御を提供する。

- Capital
- City
- Farm
- Civilian Factory
- Military Factory
- Refinery
- Power Plant
- 稼働Checkpoint
- Checkpoint Remnant
- 荒廃／放棄Checkpoint

## 7.3 Road／Forest／Urbanの優先

- Roadは基礎Terrainの防御効果を消さない。
- Forest＋Road上のZombieにはForest防御を適用する。
- Urban HexではUrban防御を優先し、Forest防御と重複させない。
- 1回のDamageに適用するTerrain Defenseは最大1種類とする。

## 7.4 適用対象

Terrain Defenseを適用するのは、別Hexから受ける次の通常Combat Damageだけとする。

- 通常攻撃
- 反撃
- 迎撃

施設感染、内部感染、自動鎮圧、Infection Suppression、資源不足、過密、その他非Combat処理には適用しない。

```text
Final Damage = max(1, ceil(Base Damage × Terrain Damage Multiplier))
```

---

# 8. Vision

## 8.1 Unit Vision標準値

| Unit | Vision |
|---|---:|
| Police | 5 |
| National Guard | 5 |
| Zombie | 3 |
| Horde Zombie | 3 |

- VisionはMovementと独立したConfig値とする。
- `hexDistance(observer, target) <= vision`をVisibleとする。
- Observer自身のHexを含む。
- Terrain、Road、Facility、UnitはVisionを遮らない。
- LOS、高低差、Forest減衰、Mountain遮蔽は実装しない。

## 8.2 Player管理Facility Vision

- Capitalは初期Supply Radiusと同じ範囲をVisionとする。標準値は5で、`checkpoint.initialSupplyRadius`と同じConfig値から導出する。
- Player所有中で陥落していないCity／生産施設はVision 1とする。
- Player管理中の稼働CheckpointはVision 1とする。
- 施設／Checkpoint Vision 1は将来変更できるようConfig化する。
- 連絡途絶、陥落、荒廃、放棄、Checkpoint RemnantはVisionを提供しない。
- 感染中でもPlayer所有を維持し、陥落していない施設はVisionを提供する。

## 8.3 Player Visibility

Player Visibilityは次の和集合とする。

```text
Human Unit Vision
+ Capital Vision
+ Player-owned Facility Vision
+ Operational Checkpoint Vision
```

- Unit移動の各Hex到達時、各GameAction受理後、各自動処理サブフェーズ後に再計算する。
- 移動途中で新たに視認したEnemyによる迎撃は現行Combat Ruleで処理する。
- UIとAgent Observationは同じ純粋関数からVisibilityを取得する。

---

# 9. Fog of Warと公開情報

## 9.1 基本原則

PlayerおよびAgentは、現在のPlayer Visibility外にいる通常Zombie／Horde Zombieの正確な位置と個体情報を取得できない。

Enemy Unitは次のとおり扱う。

```text
Visible   -> UI / Observationへ含める
Invisible -> UI / Observationから完全に除外する
```

Last Known Position、Ghost Marker、推定位置は保持・表示しない。

## 9.2 常時既知情報

次はVision外でも公開する。

- Map Terrain
- Road
- Facility／Checkpoint LocationとType
- 公開済みのFacility／Checkpoint状態
- 自軍Unit
- Supply Network
- Horde Warningの方向、残りTurn、発生Turn
- Final Hordeの未開始／進行中／撃退済み状態
- Victory進捗の真偽値

## 9.3 公開Eventとログ

FoWは次のPlayer-facing経路すべてへ適用する。

- Human UI盤面
- UIログ
- Agent Observation
- Legal Actions
- Agent StepResult
- Browser Bridge
- Player-facing Replay表示
- 公開Event

Vision外Zombieの移動、Target、Target継承、正確なSpawn座標、個体IDを公開しない。方向と到着時期は公開する。内部Replay、Failure Artifact、Debug Traceは完全情報を保持できるが、Player-facing APIへ流さない。

## 9.4 Hidden EnemyとMovement Legal Actions

Config変更でHuman UnitのVisionがMovement未満になっても、非表示Enemyの位置をLegal Actionsから推測できないようにする。

- 経路計画と公開Legal Actionsの生成では、Vision外ZombieのHexを空きとして扱う。
- 実移動中に非表示Zombieの占有Hexへ進入しようとした場合、直前の空きHexで停止する。
- 停止後にVisibilityを再計算し、VisibleになったEnemyだけを公開する。
- 移動は実行済み扱いとする。
- Unitが生存し攻撃権を持つ場合、通常どおり攻撃または待機できる。
- 不可視Enemyを理由に、移動候補を欠落させたり事前拒否したりしない。

## 9.5 Checkpoint建設とHidden Zombie

- Checkpoint新設／移設を妨げるZombieは、Action評価時にPlayer Visibility内にいる個体だけとする。
- Visibility外Zombieが候補Supply範囲にいても、新設／移設とSupply拡張は成立する。
- 拡張後のHidden Zombieは襲撃、Supply内Zombie残存、Victory未達成として通常どおり処理する。
- Hidden Zombieを理由にLegal Actionを消したり拒否理由を返したりしない。

---

# 10. Zombie Type

Zombie陣営を次の2 Unit Typeへ分離する。

```text
zombie
hordeZombie
```

## 10.1 通常Zombie

- 初期Map上の4体は`zombie`とする。
- 既存個体をHorde Zombieへ変換しない。
- Vision内Target、継承Target、Idleを使用する。

## 10.2 Horde Zombie

- Periodic HordeとFinal Hordeで生成する個体はすべて`hordeZombie`とする。
- HP、Attack、Movement、Rangeは通常Zombieと同じ標準値を使う。
- Vision標準値は3とする。
- 通常Zombieとの差はUnit Type、Targeting、Target伝播元、Horde追跡属性とする。
- UI、Observation、Replay、Metrics、Victory Trackingで通常Zombieと識別する。

---

# 11. Zombie Targeting共通ルール

## 11.1 Population Target候補

Zombie自身のVision内にあり、到達経路を持つ次を有効Target候補とする。

- Facilityの健全民間人口
- Checkpointの`waiting`、`screening`、`approved`健常3プール
- Police／National GuardのUnit Population

感染者だけのLocation、人口0のLocation、死亡Unitは候補にしない。

## 11.2 Target選択順

現行AIの意味を維持し、候補は次で選ぶ。

1. Terrain Movement Costを考慮した最小経路コスト
2. 同Costなら対象健常人口が多いTarget
3. 同数ならSeed付き乱数

単純なHex Distanceではなく、重み付き最短経路コストを使う。乱数呼出順を固定し、同じVersion、Config、Map、Seed、Action列から同じ結果を得る。

## 11.3 Zombie Phase Snapshot

Unit処理順によるTarget差を防ぐ。

1. Zombie Phase開始時の盤面をTarget決定用Snapshotとして固定する。
2. Snapshotから全Horde ZombieのCurrent Targetを確定する。
3. Snapshotと確定済みHorde Targetから全通常ZombieのCurrent Targetを確定する。
4. 全Target確定後、安定したUnit ID順で移動・戦闘を解決する。

同じZombie Phase中にHorde Zombieが接近して新たにVision内へ入った場合、そのHordeからの伝播は次のZombie Phase開始時に判定する。

---

# 12. 通常Zombie Targeting

通常Zombieの優先順位は次とする。

```text
1. Visible Population Target
2. Inherited Horde Target
3. Idle
```

Noiseはv1.3で実装しないが、将来はVisible PopulationとInherited Targetの間へ追加可能な構造にする。

## 12.1 Idle

Visible Population TargetもInherited Horde Targetもない通常Zombieは、そのZombie Phaseに移動しない。合法な通常Combat条件が存在する場合は現行Combat Ruleを適用する。

## 12.2 継承Targetの記憶

- Hordeから継承するのはEntityへの追跡参照ではなく、継承時点の目標Hex座標とする。
- Target Unitが移動したり、Vision外で人口が0になったりしても遠隔では察知しない。
- 継承TargetはHorde Zombieを見失っても保持する。
- Visible Population Targetが現れたPhaseはそちらを優先するが、継承座標の記憶は維持する。
- 継承座標へ到達し、有効なVisible Population Targetがなければ記憶を解除する。
- 解除後に別のHorde Zombieを視認していれば、新しいTargetを継承できる。

---

# 13. Horde Zombie Targetingと伝播

## 13.1 Horde Zombieの優先順位

```text
1. Visible Population Target
2. Capital
```

- Vision内Targetは第11章の共通ルールで選ぶ。
- Vision内に有効TargetがなければCapital座標へ進む。
- CapitalはHorde Zombieだけが常時知るStrategic Anchorとする。
- 一時的なVisible Targetが次のSnapshotでVision外または無効になった場合、Capitalへ戻る。
- Horde ZombieはVisible Targetの座標をVision外まで記憶・追跡しない。

## 13.2 Target伝播

通常ZombieがVisible Population Targetも有効な継承記憶も持たず、自身のVision内にHorde Zombieがいる場合、そのHorde ZombieのSnapshot上のCurrent Target座標を継承する。

```text
hordeZombie -> zombie
```

だけを許可し、次は禁止する。

```text
zombie -> zombie
zombie -> hordeZombie
```

## 13.3 複数Horde Zombie

継承候補が複数いる場合は次で参照元を決める。

1. Hex Distanceが短いHorde Zombie
2. 同距離ならUnit ID昇順

ここでは経路コストではなく視認上の近さを使う。

---

# 14. Horde Spawn

## 14.1 Periodic Horde

- 標準周期は現行どおり5 Turnとする。
- Turn 5は2体、以後5 Turnごとに2体ずつ増加する。
- Turn 5、10、15、20、25の標準規模は2、4、6、8、10体とする。
- 方向は現行どおりSeed付きで東西南北から決め、方向と残りTurnを事前公開する。
- 規模、方向選択、Spawn配置はConfigとSeedから決定する。
- 生成個体はすべて`hordeZombie`とする。
- `finalHordeTurn`以後はPeriodic Hordeを生成しない。

## 14.2 Final Horde

- `finalHordeTurn`の標準値は30とする。
- 標準Final Horde規模は12体とする。
- 規模、発生Turn、方向選択をConfig化する。
- Turn 30のZombie Phase終了後、事前警告された1方向の既存Horde侵入口を基準に生成する。
- Turn 30中は行動せず、Turn 31のZombie Phaseから行動する。
- 全個体へFinal Hordeを識別する決定的なSpawn Group ID／属性を付与する。
- Map上の通常Zombieや過去のPeriodic Horde個体をFinal Hordeへ変換しない。

## 14.3 Warning

- Final Hordeの警告は通常Hordeと区別し、`Final Horde`と明示する。
- 方向、残りTurn、発生Turnを常時表示する。
- 規模と正確なSpawn位置はPlayer-facing状態として表示しない。
- 発生後は`未開始`から`進行中`へ、全滅後は`撃退済み`へ切り替える。

---

# 15. Turn 30以降

- ゲームルール上の`maxTurns`を廃止する。
- `finalHordeTurn`を導入し、標準30とする。
- GameStateのTurn上限を設けず、VictoryまたはDefeatまでTurn 31、32、33…を継続する。
- Final Horde後はPeriodic Hordeだけを停止する。
- 経済、電力、避難民到着、Checkpoint審査、感染、自然回復、Unit編成、Supply等は通常どおり継続する。
- 新規ゲーム設定UIの`最大ターン`は`Final Horde発生Turn`へ置き換える。
- Agent／Batch RunnerのTurn安全上限はゲームルールと別管理し、標準100を維持する。
- Runner上限到達は勝敗ではなく技術的失敗とする。

---

# 16. VictoryとDefeat

## 16.1 Victory条件

Final Horde生成後、次の3条件をすべて満たした時点でVictoryとする。

### 条件1: Final Horde全滅

Final Horde Spawn Groupに属する全Horde Zombieが死亡している。現在のSupply Network内外を問わない。

### 条件2: Supply Network内Zombie 0

現在のPlayer Supply Network内に通常Zombie／Horde Zombieが1体も存在しない。Final Horde以外のZombieがSupply外に残っていてもよい。

### 条件3: Supply Network内Infected Population 0

現在のSupply範囲内にある全Facility／Checkpoint状態の感染者合計が0である。所有状態に関係なく、次を含む。

- Player所有施設
- 連絡途絶施設
- 陥落／荒廃施設
- 稼働／荒廃／放棄Checkpoint
- Checkpoint Remnant
- その他Infected Populationを保持可能なLocation

## 16.2 現在のSupply Network

- Victory判定には判定時点のSupply Networkを使用する。
- Checkpointの後退、移設、荒廃等でSupplyが縮小し、範囲外になった通常Zombieや感染地域は条件2・3から除外する。
- Supply縮小による統治圏の切り離しは意図した戦略とする。
- Final Horde個体だけはSupply内外を問わず全滅が必要である。

## 16.3 判定タイミング

- 各GameAction受理後にDefeat、続いてVictoryを判定する。
- 各自動処理サブフェーズ後にもDefeat、続いてVictoryを判定する。
- 3条件が揃った瞬間に即時Game Overとし、EndTurnを待たない。
- 同じ処理単位でDefeatとVictoryが同時成立した場合はDefeatを優先する。
- 既存Defeat条件であるCapital陥落、所有施設の健全民間人口合計0を維持する。
- Unit Population、Checkpoint人口、感染者は既存どおりDefeat回避人口に数えない。

## 16.4 Victoryの意味

Victoryは世界全体またはMap全域のZombie絶滅を意味しない。

> **Final Hordeを撃退し、Playerが現在維持している行政・補給圏内からZombieと感染を排除した。**

ことを意味する。

## 16.5 FoW下のVictory進捗

Player／Agentへ次の真偽値を公開する。

```text
finalHordeDefeated
suppliedAreaZombieClear
suppliedAreaInfectionClear
```

- 真偽値はGameState上の事実から判定する。
- Hidden Zombieの正確な数、Unit ID、座標は公開しない。
- `finalHordeRemaining`の全残存数はPlayer-facing APIへ出さない。
- UIは`未達成／達成`または同等の状態だけを表示する。

---

# 17. Human UI

## 17.1 Terrain

Hex選択時に最低限次を表示する。

```text
Base Terrain
Road / Urban Overlay
Effective Movement Cost
Defense Source
Damage Multiplier
```

- Plain、Forest、Mountainを色・Texture・Patternのいずれかで識別する。
- RoadとFacilityの視認性をTerrain表示より優先する。
- 色だけに依存せず、選択情報へ名称を表示する。

## 17.2 Vision／Fog of War

- 現在Playerが視認しているHexの合成範囲を薄いOverlayで表示する。
- Human UnitまたはVisionを持つFacility／Checkpoint選択時、その個別Vision範囲を強調する。
- Terrain、Road、FacilityはVision外でも通常表示する。
- Enemy UnitだけをVisibility外で非表示にする。
- 選択中Human UnitのVision値を表示する。
- 視認状態は移動中とAction後に更新する。

## 17.3 Horde Zombie／Final Horde

- 通常ZombieとHorde ZombieをIcon、Marker、Outline、Label等で視覚的に区別する。
- Production Artは完了条件にしない。
- Final Horde警告は通常Hordeと区別する。
- Victory進捗3条件をEnemy座標なしで表示する。

## 17.4 Mobile

- 既存のスマートフォン縦向き3状態パネルとパン／ズームを維持する。
- Terrain情報、Vision Overlay、Final Horde警告によって主要操作領域を塞がない。

---

# 18. Agent ObservationとFair Play

## 18.1 境界

```text
GameState        = Internal Truth
AgentObservation = Player-visible Information
```

を維持する。

- Balanced Agent、Random Agent、Browser Bridge、外部LLM PlayerはVision外Zombieを意思決定に利用しない。
- GameState、PRNG内部状態、Zombie内部Target、Target継承記憶、Hidden Spawn座標を公開しない。
- Observation、Legal Actions、StepResult、Browser BridgeはHuman UIと同じVisibility関数を使う。

## 18.2 Observation追加・変更

Map Tileは最低限次を返す。

```text
terrain
road
facility / checkpoint overlay
effectiveMovementCost
terrainDefenseSource
terrainDamageMultiplier
visibleToPlayer
```

Human Unit／公開Enemy Unitは最低限次を返す。

```text
unitType
vision
positionTerrain
effectiveMovementCostAtPosition
terrainDefenseSource
terrainDamageMultiplier
```

Enemy配列には現在Visibleな`zombie`／`hordeZombie`だけを含める。

Horde状態は最低限次を返す。

```text
warningType: periodic | final | none
warningDirection
turnsRemaining
spawnTurn
finalHordeStatus: notStarted | active | defeated
```

Victory状態は第16.5章の3真偽値を返す。

## 18.3 Zombie内部Target

- ZombieのCurrent Target、Inherited Target、Target ReasonはAgent Observationへ公開しない。
- Player／Agentは公開された行動原理、Visible Position、Vision、周辺人口から推測する。
- Debug Traceと完全情報Artifactには機械可読なTarget Reasonを保存できる。

## 18.4 Balanced Agent 3.0

Balanced Agentは公開ObservationとLegal Actionsだけから最低限次を評価する。

- Visible ZombieとHorde Zombieの区別
- Terrain Movement Costを使う移動・射撃位置
- Urban防御とForest Zombie防御
- Human Unit／Facility Visionと視界Coverage
- Hidden Enemyを前提にした施設・Supply内の巡回
- Horde警告と既知のCapital指向
- Final Horde後の3 Victory条件
- `suppliedAreaZombieClear`がfalseでVisible Enemyがいない場合の探索
- 現行の経済、感染、Supply、Checkpoint、接触拒否判断

内部GameStateやHidden Enemyを参照する近道を作らない。

---

# 19. Replay／Save／Determinism

## 19.1 Save境界

- Save Formatを`3`とする。
- v1.2.7以前の自動保存、セーブコード、JSON Saveを一律で移行しない。
- 旧SaveはVersion不一致として現在Stateを変更せず、理由を日本語・英語で表示する。
- 旧Saveを自動変換、上書き、削除しない。
- v1.3新規ゲームから新Saveキー／Version境界で保存する。

## 19.2 Replay／Artifact境界

- v1.2.7以前のReplay／Artifactは移行せず、状態変更なしで理由付き拒否する。
- v1.3 ArtifactはTerrain Map、Vision Config、Visibility判定に必要なConfig、Zombie Type、Horde Spawn Group、Target決定、Target伝播、Final Horde、Victory判定を再現可能にする。
- Player-facing Replay表示にはFoWを適用する。
- 検証用の完全Replay／Failure Artifactは内部情報を保持できる。

## 19.3 Determinism

次が同じなら最終結果、公開Observation列、完全Replay結果を一致させる。

```text
Version
Config
Map
Seed
Accepted Action[]
```

Target Snapshot、重み付きPathfinding、同Cost経路、複数Horde選択、Unit処理順、Spawn配置、乱数呼出順を決定的にする。

---

# 20. EventとMetrics

## 20.1 Event

既存Eventへ最低限次を追加する。

- Terrain Defense適用と軽減前後Damage
- Enemy発見／Visibility喪失
- 通常Zombie Idle
- Horde Target継承／解除
- Periodic／Final Horde Spawn Group
- Final Horde撃破進捗の内部Event
- Victory条件ごとの達成／未達成変化

公開Eventは第9章のFoW境界を通し、内部Eventと分離する。

## 20.2 必須Metrics

既存Metricsへ最低限次を追加する。

```text
finalHordeSpawned
finalHordeKilled
finalHordeDefeated
normalZombiesKilled
hordeZombiesKilled
maxVisibleZombies
turnsAfterFinalHorde
suppliedAreaZombieClearTurn
suppliedAreaInfectionClearTurn
victoryTurn
terrainEntriesByType
urbanDefenseApplications
urbanDefenseDamagePrevented
forestDefenseApplications
forestDefenseDamagePrevented
normalZombieIdleCount
hordeTargetInheritedCount
hordeTargetClearedCount
```

公開ReportへHidden Zombieのゲーム途中の座標履歴を載せない。完遂後の検証Artifactは権限分離された内部情報を持てる。

---

# 21. 必須テスト

## 21.1 Terrain／Map

- Map ID、225 Hex、16施設、道路、侵入口、初期配置が固定される。
- Forest 49 Hex、Mountain 32 Hex、Water 0 Hex、残りPlainとなる。
- Terrain座標が本書と完全一致する。
- Plain 1、Forest 2、Mountain 3、Water進入不可となる。
- Road／UrbanがCost 1を優先する。
- 進入先Costだけを消費する。
- 重み付き最短経路と同Cost Tie-breakが決定的である。

## 21.2 Defense

- Urban外部攻撃、反撃、迎撃へ`0.5`を適用する。
- Forest内Zombieだけへ`0.5`を適用する。
- Human UnitはForest防御を得ない。
- Forest＋RoadのZombieはForest防御を得る。
- Urban＋ForestはUrbanだけを適用する。
- Plain、Mountain、Road自体に追加防御がない。
- 非Combat感染・鎮圧・不足処理へ適用しない。
- 端数切り上げ、最低Damage 1となる。

## 21.3 Vision／FoW

- Unit Visionが5／5／3／3となる。
- Capital Visionが初期Supply Radiusと一致する。
- Player所有City／生産施設／稼働CheckpointがVision 1を提供する。
- 連絡途絶、陥落、荒廃、放棄、RemnantがVisionを提供しない。
- TerrainがVisionを遮らない。
- Visibilityが移動各Stepと各Action／サブフェーズ後に更新される。
- Vision外EnemyがUI、Observation、Legal Actions、StepResult、Bridge、公開Eventから消える。
- Hidden Enemyの移動経路接触が直前Hex停止となり、合法手から位置を推測できない。
- Checkpoint建設を妨げるのがVisible Zombieだけとなる。
- Human UIとAgent ObservationのVisible Enemy集合が一致する。

## 21.4 Zombie AI

- Target候補にFacility、Checkpoint健常3プール、Human Unit Populationを含める。
- Vision外Targetを選ばない。
- 最小経路Cost、人口、Seed付き乱数の順で選ぶ。
- 通常ZombieがTargetなしでIdleする。
- Horde ZombieがVisible Targetを優先し、なければCapitalへ向かう。
- Zombie Phase開始Snapshotで全Targetを確定する。
- Horde移動による新規伝播が次Phaseまで発生しない。
- Hordeから通常ZombieへだけTargetを伝播する。
- 複数HordeはHex Distance、Unit ID順で選ぶ。
- 継承Targetが座標記憶で、Entityを遠隔追跡しない。
- Visible Target優先中も継承記憶を保持する。
- 継承座標到達後、Target不在なら記憶を解除する。

## 21.5 Horde／Victory

- Periodic HordeがTurn 5～25に2／4／6／8／10体生成される。
- Periodic／Final Hordeが`hordeZombie`となる。
- Turn 30到達だけではVictoryしない。
- Final Horde 12体がTurn 30 Zombie Phase後に生成される。
- Final HordeがTurn 31 Zombie Phaseから行動する。
- Final Horde後にPeriodic Hordeを生成しない。
- Turn 31以降も全非Hordeシステムが動く。
- Final Horde残存、Supply内Zombie、Supply内感染の各未達でVictoryしない。
- 所有外／荒廃LocationのSupply内感染もVictoryを妨げる。
- Supply外通常Zombie／感染はVictoryを妨げない。
- Supply縮小後の現在範囲で再判定する。
- Final HordeはSupply外でも全滅が必要となる。
- 各Action／サブフェーズ後に即時判定する。
- Victory／Defeat同時成立時にDefeatを優先する。
- 公開進捗が3真偽値だけで、Hidden数／座標を漏らさない。

## 21.6 Save／Replay／Agent

- v1.2.7以前のSave／Replay／Artifactを状態変更なしで拒否する。
- Save Format 3の保存・復元が決定的に成功する。
- ReplayがTerrain、Target Snapshot、伝播、Final Horde、Victoryを再現する。
- Observation取得がStateを変更せず、返却値と内部参照を共有しない。
- Balanced／RandomがGameStateを参照せず公開情報だけで動作する。
- AgentGameとBrowser Bridgeの静的契約が一致する。

---

# 22. バランス検証と自動合否

## 22.1 技術的な自動合否

標準Configで次を必須とする。

- Random Agent固定Seed 1～100を技術的失敗なく完遂する。
- Balanced Agent固定Seed 1～100を技術的失敗なく完遂する。
- 同一Seedの決定性、不変条件、Observation Fair Play、Replay一致を満たす。
- Runner安全上限到達を技術的失敗として検出する。
- Production Build、Browser Bridge Smoke、Portable Package Smokeを成功させる。
- 外部AIでAPI発見、不正Action訂正、Game Over、Result／Artifact取得、ReplayをE2E確認する。

## 22.2 レビュー対象

Balanced Agent固定Seed 1～300を実行し、v1.2.7基準と主要Metricsを比較する。特定の勝率や資源量は自動合否条件にしない。

特に次をレビューする。

- Forest防御でZombieが硬くなりすぎないか
- Mountain Costで不自然な経路や停滞が生じないか
- 通常ZombieのIdle率が高すぎないか
- Horde Target伝播が弱すぎる／強すぎる状態にならないか
- FoWが探索作業だけを増やしていないか
- Vision 1の施設が情報源として強すぎないか
- Final Horde 12体が既存経済とUnit数で撃退可能か
- Turn 31以降の掃討が長すぎないか
- Supply縮小Victoryが過度に容易でないか
- Balanced AgentがHidden情報なしでSupply内探索とFinal Horde対応を完遂できるか

Config調整を行った場合は、標準値、本書、テスト、UI説明、Agent静的ルールを同時に更新する。

---

# 23. 実装順序

## Phase 1: Version／Map／State

- Version定数、Fixed Map ID、Save Format
- Terrain Data Modelと固定座標
- Road／Urban Overlay分離
- `maxTurns`から`finalHordeTurn`へのGameState／Config変更
- 旧Save／Replay／Artifact拒否

## Phase 2: Movement／Defense Core

- 重み付きPathfinding
- Movement Point消費
- Terrain Defense共通計算
- Combat／Interception統合
- Map、Path、Combat Unit Test

## Phase 3: Vision／FoW境界

- Unit／Facility Vision
- 共通Visibility純粋関数
- Hidden Enemy移動接触
- Visible ZombieだけのCheckpoint阻害
- Observation、Legal Actions、StepResult、公開EventのFilter

## Phase 4: Zombie／Horde Core

- `hordeZombie` Type
- Zombie Phase Target Snapshot
- Vision依存TargetingとIdle
- 座標Target記憶とHorde伝播
- Periodic Horde更新とFinal Horde Spawn Group

## Phase 5: Turn／Victory

- Turn上限廃止
- Final Horde後の継続処理
- 3 Victory条件とDefeat優先
- Victory進捗の公開境界

## Phase 6: UI／Agent／Artifact

- Terrain、Vision Overlay、FoW、Horde Marker、Final警告
- Observation／Bridge `1.4.0`
- Balanced Agent `3.0.0`、Random Agent `1.2.0`
- Replay、Event、Metrics、Report
- 日英ヘルプ、Tips、`PLAY_WITH_AI.md`、API説明、README

## Phase 7: 統合検証

- Unit／Integration／Fair Play／Save／Replay Test
- Random／Balanced Seed 1～100
- Balanced Seed 1～300比較
- Production Build、Pages／Portable Smoke、外部AI E2E
- 実装結果の本書・現行仕様への反映と整合確認

CoreのTerrain、Pathfinding、Defense、Visibility、Targeting、VictoryはGameAction → GameEngine経由の同じ純粋計算経路を使い、Human UI、Headless、Agent、Browser Bridgeへ別ルールを作らない。

---

# 24. 成果物と完了条件

## 24.1 成果物

- Fixed Map `fixed-15x15-v2`
- Terrain／Road／Urban Data Model
- 重み付きPathfindingとTerrain Defense
- 共通Visibility／FoW境界
- 通常Zombie／Horde Zombie Targeting
- Target伝播とFinal Horde
- Turn上限なしの新Victory／Defeat処理
- Terrain／Vision／FoW／Final Horde Human UI
- Agent／Observation／Browser Bridge `1.4.0`
- Balanced Agent `3.0.0`、Random Agent `1.2.0`
- Save Format 3、Artifact Schema `1.4.0`
- Replay、Event、Metrics、Simulation Report
- 更新済み日英ヘルプ、Tips、README、`PLAY_WITH_AI.md`、API説明
- Unit／Integration／Simulation／外部AI E2E結果

## 24.2 完了条件

次をすべて満たした時点でv1.3実装完了とする。

1. 固定Terrain座標、Road／Urban Overlay、Movement Costが本書と一致する。
2. Terrain DefenseがCombatだけへ決定的に適用される。
3. Unit／Facility VisionとFoWがHuman／Agentで同じ結果を返す。
4. Legal Actions、公開Event、BridgeからHidden Enemy位置が漏れない。
5. 通常ZombieがVision、重み付き距離、継承座標、Idleで行動する。
6. Horde ZombieがCapital指向と一方向Target伝播を持つ。
7. Zombie Phase Snapshotにより処理順依存を排除する。
8. Final Horde 12体がTurn 30後に発生し、Turn 31から行動する。
9. Final Horde後もPeriodic Horde以外の全システムが継続する。
10. 3 Victory条件、現在Supply、Defeat優先、即時判定が機能する。
11. 旧Save／Replay／Artifactを拒否し、v1.3 Format 3が安全に保存・復元できる。
12. Terrain、Vision、Horde、VictoryのUIと日英説明がCoreルールと一致する。
13. Balanced／Randomが公開ObservationとLegal Actionsだけで決定的に動作する。
14. 必須Metricsと完全／公開Artifact境界が機能する。
15. 第21章の必須テストが成功する。
16. Random／Balanced Seed 1～100が技術的失敗なく完遂する。
17. Balanced Seed 1～300比較をレビューし、重大なバランス異常がないことを確認する。
18. Production Build、Portable Package、外部AI Game Over／Artifact／Replay E2Eが成功する。
19. 実装・テスト・動作確認後、本書を現行仕様へ反映し、Version、Save、UI、AI資料を整合させる。

---

# 25. v1.3の設計意図

v1.2.xまでの中心判断は、見えている全ZombieへどのUnitを割り当てるかだった。

v1.3では次を判断対象へ加える。

```text
どこが現在見えているか
どの地形と道路を使えば早いか
どの地点なら守りやすいか
Hordeがどの通常Zombieを巻き込むか
どこまでを州政府の統治圏として維持するか
```

Victoryは「30ターン生存した」ではなく、次を意味する。

> **最後の危機を撃退し、守ると決めた州政府の領域を取り戻した。**

Map全域の通常Zombie絶滅は要求しない一方、Final Hordeは全個体の撃破を要求し、クライマックスとしての責任を残す。
