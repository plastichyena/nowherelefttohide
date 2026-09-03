# Nowhere Left to Hide PoC v1.4.4 アップデート要件 確定版

- 作成日: 2026-09-03
- ステータス: 確定
- 対象Release: `1.4.4`
- 基準安定版: `v1.4.3`
- 実装状態: 未実装

## 1. 文書の位置づけ

本書はv1.4.3を基準とし、v1.4.4で実装するマップ拡張、機動性再設計、避難民・Checkpoint経済、拒否者由来Horde増加、新規Zombie Type、盤面Unit Asset更新を定義する確定要件である。

本書で明示的に変更しないルールはv1.4.3を維持する。

51×51マップ上のTerrain、恒久Facility総数・Type別内訳・全座標は本書を正本として固定し、実装時に別の配置へ変更しない。

---

## 2. 背景と目的

v1.4.3 Seed 1の外部AIプレイでは、Simple Farmを建設せずに勝利可能であり、終盤にはCivilian Goods、Military Goods、Fuelが大きく余剰となった。一方でCheckpoint Queueには多数の避難民が残り、現行ではQueue内人口がFood／Civilian Goods維持を消費しないため、Strict運用の長期Queueが経済的負担になりにくい。

また今後、Human Unitを単純な上位互換ではなく役割で差別化する余地を確保する。v1.4.4ではPoliceを「州内の即応・感染鎮圧」、National Guardを「Hordeに対する主力野戦戦力」としてより明確に分ける。将来追加候補であるPoliceの重装・暴徒鎮圧系Unit等を見据え、固定Map自体を拡張して距離と配置の意味を増やす。

v1.4.4の主な目的は次のとおり。

1. 固定Mapを31×31から51×51へ拡張し、将来のFacility／Unit追加余地を確保する。
2. Policeの高機動化とNational Guardの事前配置型運用を地理的に差別化する。
3. Civilian Drone Baseを広域Mapに適した航空偵察施設へ強化する。
4. Checkpoint Queueへ維持費を導入し、Strict審査の安全性へ経済コストを持たせる。
5. Checkpoint多重化・Relocationへ実質的なCivilian Goods投資を要求する。
6. Refugeeを拒否する判断を、将来のHorde強化という時間差コストへ接続する。
7. Police／National Guardの損失を敵戦力化し、Human Unit損失の局地的危険を増やす。
8. 初期Normal Zombieを固定座標からSeed付きランダム配置へ変更し、初動の再現性とプレイごとの差を両立する。

---

## 3. 変更概要

| 項目 | v1.4.3 | v1.4.4案 |
|---|---|---|
| Fixed Map | 31×31 | 51×51 |
| Capital | `(15,15)` | `(25,25)` |
| Horde Entrance | 外周4方向 | North `(25,0)` / East `(50,25)` / South `(25,50)` / West `(0,25)` |
| Road Branch距離 | 各15 Hex | 各25 Hex |
| 恒久Facility | 17 | 29。Type別内訳・全座標を固定 |
| 初期Normal Zombie | 固定12体 | Seed付きランダム25体 |
| 初期Zombie Capital除外 | 固定配置 | CapitalからHex Distance 8以内を禁止 |
| Police Movement Budget | 10 | 15 |
| National Guard Movement Budget | 10 | 変更なし |
| Civilian Drone Base Vision | `workers × 2`、最大10 | `workers × 3`、最大15 |
| Simple Farm上限 | `ceil(roadBranchCount / 2)`、標準2 | `roadBranchCount`、4支線Mapでは4 |
| Civilian Drone Base撤去 | 不可 | 条件付きで可能。建設費の半額を切り上げて返却 |
| Checkpoint Queue維持 | Food／Civilian Goods消費なし | 健常Queue人口を通常維持へ加算 |
| Checkpoint Build | 5 CG | 支線初回5 CG、以降25 CG |
| Checkpoint Relocate | 5 CG | 25 CG |
| Checkpoint Activate | 0 CG | 変更なし |
| Refugee Turn Away | 不可 | `waiting`から任意人数を追い返し可能 |
| 審査不合格者 | 州外退去のみ | 方向別Rejected Counterへ加算 |
| Turn Away人口 | 消滅 | 方向別Rejected Counterへ加算 |
| Rejected Horde追加 | なし | 対象方向Waveへ`ceil(counter / 5)` Normal Zombie追加 |
| Rejected Counter reset | なし | その方向がWave参加した時だけreset |
| Refugee Arrival | Final後も継続 | Final Wave発生を最後に新規流入停止 |
| Police Zombie | なし | 追加 |
| Soldier Zombie | なし | 追加 |
| Human Unit死亡 | Unit消滅 | 対応Zombieを死亡Hexへ生成 |
| Human Unit盤面Asset | Policeは紋章、National Guardは装備Icon | 承認済み人物Group Assetへ更新 |
| 最小Zoom | `0.55` | `0.35` |

---

## 4. 51×51 Fixed Map

### 4.1 基本座標

固定Mapを51×51へ拡張する。

```text
q = 0..50
r = 0..50
Capital = (25,25)
North Entrance = (25,0)
East Entrance  = (50,25)
South Entrance = (25,50)
West Entrance  = (0,25)
```

Capital Junctionを通る東西・南北の幹線道路を維持し、各Road BranchはCapitalからEntranceまで25 Hexとする。

外周1 HexをHorde Spawn Reserveとする現行原則を維持する。51×51では`q = 0 | 50`または`r = 0 | 50`の重複を除く200 HexがReserveとなる。

Player Unit、Checkpoint、Constructible FacilityのReserve占有禁止、Zombie／Horde ZombieのSpawn・移動・停止、Reserve内ZombieへのAttack等のv1.4.3原則を維持する。

### 4.2 Terrain・Facility再配置

- Terrainは全2601 Hexを固定定義し、Waterは配置しない。
- 180度回転を`R(q,r) = (50-q, 50-r)`とする。Mountain／Forestは次のNorth側Seed集合とその`R`像から生成する。

```text
Mountain seed
r=4:  q=14..18
r=5:  q=13..18
r=6:  q=12..17, q=36..39
r=7:  q=11..16, q=35..39
r=8:  q=10..15, q=34..38
r=9:  q=9..14,  q=34..37
r=10: q=8..13,  q=33..36

Forest seed
r=1:  q=2..9,   q=38..48
r=2:  q=2..11,  q=36..48
r=3:  q=3..13,  q=35..47
r=4:  q=3..12,  q=34..46
r=5:  q=4..12,  q=33..45
r=6:  q=4..11,  q=32..44
r=7:  q=3..10,  q=31..43
r=8:  q=4..9,   q=31..44
r=9:  q=3..8,   q=32..45
r=10: q=4..7,   q=32..46
r=11: q=33..45
r=12: q=34..44
r=13: q=5..11
r=14: q=4..12
r=15: q=5..13
r=16: q=6..14
r=17: q=7..15
```

- Mountainを先、Forestを後に配置し、重複時はMountainを優先する。その後Roadと恒久FacilityのHexをPlainへ戻す。
- 最終Terrain内訳はPlain 1961、Forest 514、Mountain 126、Water 0の全2601 Hexとする。
- 恒久Facilityは29施設とし、座標と初期状態を次へ固定する。

| ID | Type | 座標 | 初期状態 |
|---|---|---:|---|
| `capital` | Capital | `(25,25)` | owned |
| `city-1` | City | `(25,20)` | disconnected |
| `city-2` | City | `(24,8)` | disconnected |
| `city-3` | City | `(33,25)` | disconnected |
| `city-4` | City | `(43,24)` | disconnected |
| `city-5` | City | `(25,34)` | disconnected |
| `city-6` | City | `(26,43)` | disconnected |
| `city-7` | City | `(16,25)` | disconnected |
| `city-8` | City | `(7,26)` | disconnected |
| `farm-1` | Farm | `(23,25)` | owned |
| `farm-2` | Farm | `(21,11)` | disconnected |
| `farm-3` | Farm | `(39,20)` | disconnected |
| `farm-4` | Farm | `(29,39)` | disconnected |
| `farm-5` | Farm | `(10,29)` | disconnected |
| `civilian-factory-1` | Civilian Factory | `(27,25)` | owned |
| `civilian-factory-2` | Civilian Factory | `(29,13)` | disconnected |
| `civilian-factory-3` | Civilian Factory | `(22,38)` | disconnected |
| `civilian-factory-4` | Civilian Factory | `(11,28)` | disconnected |
| `military-factory-1` | Military Factory | `(21,25)` | disconnected |
| `military-factory-2` | Military Factory | `(22,10)` | disconnected |
| `military-factory-3` | Military Factory | `(28,40)` | disconnected |
| `refinery-1` | Refinery | `(25,23)` | owned |
| `refinery-2` | Refinery | `(38,21)` | disconnected |
| `refinery-3` | Refinery | `(25,39)` | disconnected |
| `refinery-4` | Refinery | `(11,30)` | disconnected |
| `power-plant-1` | Power Plant | `(25,27)` | owned |
| `power-plant-2` | Power Plant | `(40,22)` | disconnected |
| `power-plant-3` | Power Plant | `(10,28)` | disconnected |
| `wind-power-plant-1` | Wind Power Plant | `(26,24)` | owned |

- Type別内訳はCapital 1、City 8、Farm 5、Civilian Factory 4、Military Factory 3、Refinery 4、Power Plant 3、Wind Power Plant 1とする。
- Capitalを除く全Facility Typeは最低1基がCapitalからHex Distance 5以内にある。配置だけを保証し、初期所有はv1.4.3と同じ6基に限定する。
- Policeは`(24,25)`、National Guardは`(26,25)`へ初期配置する。初期人口、初期資源、初期Unit Fuel／携行Military Goodsは本書で変更しない。
- Facility増加は面積比例の無条件な生産増加ではなく、Supply Branch、代替生産拠点、前線防衛、冗長性の選択を増やすためのものとする。
- Facility配置は厳密な回転対称を要求せず、各方向の総合価値を均等化する。Terrainの180度回転対称は維持する。
- 51×51化後もMobile UIで可読性と操作性を維持し、低Zoom LOD、Fog、Overlay、選択UIの負荷を検証する。

### 4.3 Version境界

Fixed Map IDは`fixed-51x51-v1`とする。

Version境界は次へ更新し、v1.4.3以前を暗黙変換しない。

| 境界 | Version |
|---|---|
| App / Release | `1.4.4` |
| Game Rules / GameState / Config | `2.4.0` |
| Fixed Map | `fixed-51x51-v1` |
| Save Format | `9` |
| Agent / Observation / Browser Bridge API | `6.0.0` |
| Artifact Schema | `5.0.0` |
| Checkpoint Schema | `2.0.0` |
| Session Schema | `2.0.0` |
| Balanced Agent | `4.4.0` |
| Random Agent | `2.3.0` |

---

## 5. 初期Normal Zombie 25体のSeed付きランダム配置

### 5.1 基本Rule

標準初期Normal Zombie数を25体とする。

v1.4.3の固定12座標は使用せず、新規ゲーム開始時にGame Seedを使って25体を決定的にランダム配置する。同じVersion、Map、Config、Seedから同じ初期Zombie座標とUnit ID順を得る。

### 5.2 配置禁止条件

初期Zombie候補は最低限次を満たす。

- Map内。
- Capital `(25,25)`からHex Distance 9以上。Distance 0..8は禁止する。
- Facility Hexではない。
- 初期Human Unit Hexではない。
- Horde Spawn Reserveではない。
- Zombieが進入可能なTerrainである。
- 既に別の初期Zombieを配置したHexではない。

Road／Urban Hexは、それ自体を禁止理由にせず候補へ含める。

CapitalからDistance 8以内を除外する根拠は、v1.4.3の初期Supply Radius 5とNormal Zombie Vision 3の合計を安全境界として扱い、初期状態からCapital経済圏へ即時に可視Population Targetを持つ個体を避けるためである。

初期ZombieはHorde由来ではなく、`spawnGroupId = null`、`hordeKind = null`とする。

配置候補は安定座標順に並べ、現行Seed付きPRNGを用いて置換なしで25 Hexを選ぶ。PRNG消費順、Unit ID付与順、候補不足時のConfig rejectionを決定的にする。

---

## 6. Human Unit機動性

### 6.1 Police

Policeの通常Movement Budgetを10から15へ変更する。

```text
Police movementBudget = 15
National Guard movementBudget = 10
```

Policeは州内の即応・感染鎮圧用Unit、National GuardはHorde迎撃・戦線保持用Unitとして差別化する。

### 6.2 Fuel

Policeの`maxFuel = 12`と通常移動Fuel Cost式はv1.4.3から変更しない。

```text
Police Fuel Cost:
distance <= 5 ? 1 : 1 + (distance - 5)
```

したがって平地15 Hex移動はFuel 11を必要とし、Policeは満タン時に長距離緊急展開できる一方、連続した高速展開には補給を必要とする。

National GuardのMovement Budget、Fuel Cost、maxFuelは変更しない。

Fuel 0時Emergency MovementはPolice 3 MP、National Guard 2 MPの現行値を維持する。

---

## 7. Civilian Drone Base

### 7.1 Aerial Vision

給電中Civilian Drone BaseのVision Radiusを次へ変更する。

```text
visionRadius = workers × 3
workers = 0..5
maxVisionRadius = 15
```

WorkerごとのRadiusは0 / 3 / 6 / 9 / 12 / 15となる。

Aerial VisionがForest／MountainによるGround LOS遮蔽を無視するv1.4.3原則は維持する。

Required Power 5、Worker上限5、Zombie Target Value等は本書で変更しない。

### 7.2 Decommission

Civilian Drone BaseをPlayer Actionで任意撤去できるようにする。

正式Action名は`DecommissionConstructibleFacility`とし、v1.4.4での合法対象はCivilian Drone Baseだけとする。Simple Farmは拒否する。

撤去条件:

- Player所有。
- Building中でない。
- Worker 0。
- infected 0。
- Hex上にZombieがいない。
- Player Action Phaseである。
- Game Over後でない。

Supply内外を問わない。`operational`、`disabled`、`recovering`はいずれも条件を満たせば撤去可能とし、`building`中は拒否する。

撤去時:

- FacilityをMapから除去する。
- 保存済みConfigの当該Facility建設費の半額を切り上げ、Civilian Goodsへ返却する。標準Cost 25では13 CGを返却する。
- 返却するCivilian Goods以外の人口、Resource、PRNGを変更しない。
- Actionは共通Player Action 1回を消費する。
- 撤去されたDrone BaseはConstructible Facility Type上限を消費しない。

Simple Farmの任意撤去は本更新の対象外とする。

---

## 8. Simple Farm上限

Simple Farm Type上限を次へ変更する。

```text
maxSimpleFarms = roadBranchCount
```

標準51×51固定MapがNorth / East / South / Westの4 Branchを維持する場合、上限は4基となる。

Civilian Drone BaseのType上限はv1.4.3値を維持する。

Simple Farmの建設Cost、Worker上限、Food 5 / worker、Power不要等は本書で変更しない。

---

## 9. Checkpoint Queue人口の維持消費

### 9.1 対象人口

Checkpoint内の健常3PoolをFood／Civilian Goods通常維持人数へ加算する。

```text
checkpointHealthyMaintenancePopulation
= waiting + screening + approved
```

`infected`は通常維持消費へ加算しない。

### 9.2 Economy

FoodとCivilian Goodsの通常維持必要量を次へ変更する。

```text
maintenance population
= city residents
+ production facility workers
+ Police population
+ National Guard population
+ checkpoint waiting
+ checkpoint screening
+ checkpoint approved
```

Checkpoint人口は都市過密率の計算には加えない。

ただし既存の都市過密率から算出する追加消費は、Checkpoint健常者を含む通常消費全体へ適用する。

EndTurn開始時に通常人口と同様に必要量を固定し、同TurnのFood shortageによる死亡等でCivilian Goods必要量を遡及変更しない。

Food不足、続くCivilian Goods不足の各処理では、Checkpoint健常者を都市・生産施設人口より先に減らす。複数CheckpointはNorth / East / South / WestのBranch固定順、同Branch内はCheckpoint ID昇順とし、各Checkpoint内は`waiting → screening → approved`の順とする。その後、v1.4.3の都市住民、生産施設労働者の順を使う。

不足で死亡したCheckpoint人口はNormal／Strict rejectionまたはTurn AwayではないためRejected Counterへ加算せず、不足死亡Metricsだけへ記録する。ForecastとEndTurn実績は同じ純粋計算経路を使う。

---

## 10. Checkpoint Cost再設計

### 10.1 支線初回Build

各Road Branchでゲーム開始以来最初にBuildするCheckpointだけ、v1.4.3と同じCivilian Goods 5とする。

```text
first checkpoint build on branch = 5 CG
```

「現在Activeが存在しない」ことは初回判定に使用しない。一度でもそのBranchへCheckpointを建設した履歴があれば、その後は初回価格へ戻らない。

Branchごとに初回Build済み履歴をSave / Replay可能なGameStateとして保持する。

### 10.2 2基目以降とRelocate

```text
subsequent BuildCheckpoint = 25 CG
RelocateCheckpoint = 25 CG
ActivateCheckpoint = 0 CG
```

Standby新設も2基目以降のBuildに該当する。

Automatic Fallback、RecoveryはResourceを消費しない。

Build／Relocate／Activateの支線別1Turn 1回制限等、変更されていない現行Ruleは維持する。

---

## 11. Refugee Turn Away

### 11.1 新Action

Checkpointの`waiting` PoolからPlayer指定人数を州外へ追い返すGameActionを追加する。

正式名称:

```text
TurnAwayCheckpointRefugees
```

入力:

```text
checkpointId
count
```

### 11.2 合法条件

- 対象Checkpointが存在する。
- 対象Checkpointの導出Roleが`active`または`remnant`である。
- `count`は整数1以上。
- `count <= waiting`。
- Player Action Phaseである。
- Game Overでない。

`screening`、`approved`、`infected`はTurn Away対象外とする。

受理時に`waiting`から指定人数を減らし、対応Road Branch／Directionの`turnedAway` Counterへ同人数を加算する。

Final Wave Spawn Commit後は`waiting`から人数を減らすが、Rejected Counterへは加算しない。

Turn Awayは共通Player Action 1回を消費する。Resource、Unit行動権、PRNGは消費しない。

---

## 12. Rejected Refugee CounterとHorde増援

### 12.1 Direction別Counter

North / East / South / Westごとに、最低限次を記録する。

```text
normalRejected
strictRejected
turnedAway
```

Pass Throughは合格率100%のためRejected Counterを持たない。

Normal／Strict Screening完了時の不合格人数をそれぞれ該当Counterへ加算する。

Turn Away人数は`turnedAway`へ加算する。

3内訳と合計は非公開のGameState正データとし、開発Buildの読み取り専用診断、Internal Event、完全検証Artifact／Metricsだけで確認可能にする。

### 12.2 Horde追加数

対象方向の未受入人数合計を次で求める。

```text
rejectedTotal
= normalRejected
+ strictRejected
+ turnedAway

extraNormalZombies
= ceil(rejectedTotal / 5)
```

0人なら追加0体とする。

端数は切り上げるため、1～5人で1体、6～10人で2体となる。

追加個体はそのWave方向のNormal ZombieとしてSpawnし、同じWave Groupの`spawnGroupId`と`hordeKind`を持つ。性能・AIはNormal Zombieと同一である。

### 12.3 Reset

CounterはWave全体発生時に一律resetしない。

**そのDirectionが実際にWaveへ参加し、Spawnが成功Commitした場合だけ、そのDirectionの`normalRejected / strictRejected / turnedAway`を0へresetする。**

Waveに参加しなかったDirectionのCounterは次回以降へ持ち越す。

Wave SpawnがTechnical FailureでCommitされなかった場合はCounterをresetしない。

### 12.4 Warningと公開情報

Production UI、Agent Observation、Browser Bridge、公開Event、Player-facing Replay／Artifact、終了結果へ、Rejected Counterの方向別内訳・合計、算出された追加Normal Zombie数を出さない。Warning前後を問わず具体値を非公開とする。

Wave Warningはv1.4.3と同じ基礎Compositionだけを表示する。加えて「拒絶した避難民はどこかでZombieとなり、将来のHordeを強化する可能性がある」という定性的な警告を日英UI／Helpへ表示する。Warning中も追加数や最終Compositionは表示しない。

実際の追加個体はSpawn後も通常のFog of War境界に従い、可視になった個体だけを公開する。開発Buildの読み取り専用診断と完全検証経路では、Counter、算出値、適用方向、reset結果を確認可能にする。

---

## 13. Final Wave以後のRefugee Arrival停止

標準固定ScheduleのFinal WaveがSpawnされた時点を、自然Refugee Arrivalの最終境界とする。

- Final Wave Spawn以前に予定され、Final Wave Spawn前のRefugee Phaseで到着する避難民は通常処理する。
- Final Waveが正常にSpawn Commitされた後は、新しいRoad Branch Arrivalを発生させない。
- Final Wave後に`nextArrivalTurn`を新規抽選しない。
- 既にCheckpoint内にいる`waiting / screening / approved / infected`は通常どおり処理を継続する。
- Final Wave後もTurn Away、Screening完了、配置待ち処理は可能とする。
- Final Wave Spawn Commit後に既存Queueから発生するNormal／Strict不合格とTurn AwayはRejected Counterへ加算せず、単純な州外退去として扱う。累積のPolicy別不合格／Turn Away Metricsには記録する。
- Final Wave自体には、Spawn直前までに各方向へ蓄積されたRejected Bonusを適用する。Finalは全4方向参加のため、正常Spawn Commit後に全方向Counterをresetする。

---

## 14. 新規Zombie Type

### 14.1 Type

Zombie陣営へ次の2 Typeを追加する。

- `policeZombie`
- `soldierZombie`

### 14.2 Stats

| Unit | HP | Attack | Move | Range | Vision |
|---|---:|---:|---:|---:|---:|
| Normal Zombie | 10 | 5 | 3 | 1 | 3 |
| Police Zombie | 10 | 5 | 3 | 1 | 5 |
| Horde Zombie | 20 | 5 | 3 | 1 | 3 |
| Soldier Zombie | 20 | 5 | 5 | 1 | 5 |

Police ZombieはNormal Zombieと同じ性能を基本とし、Visionだけ5とする。

Soldier ZombieはHP／AttackをHorde Zombie相当とし、Move 5、Vision 5とする。平地だけなら1 Zombie Turnに最大5 Hex進める。

### 14.3 AI

Police ZombieとSoldier Zombieは**両方ともNormal Zombieと同じAI／Target priority**を使用する。

```text
Visible Population Target
> inherited Horde Target
> Noise Target
> Idle
```

Normal Zombieに適用されるNoise Target取得、Horde Target継承、Visible Population優先、記憶clear等を同様に適用する。

両特殊ZombieはHorde ZombieのCapital Strategic Anchorを持たず、Horde Zombie扱いもしない。

`spawnGroupId = null`、`hordeKind = null`を基本とし、Scheduled / Final Horde個体数には含めない。

VictoryのSupply内Zombie clear判定には含める。

---

## 15. Human Unit Loss時のZombie生成

### 15.1 Police

Police UnitがHP 0となり盤面から除去される場合、その死亡HexへPolice Zombie 1体を生成する。

### 15.2 National Guard

National Guard UnitがHP 0となり盤面から除去される場合、その死亡HexへSoldier Zombie 1体を生成する。

### 15.3 Spawn順序

Human Unit死亡由来Zombieは、v1.4.3のFacility陥落由来Zombieに準じた「生成直後行動不可、即時占有あり」のRuleを使用する。

```text
Human Unit HP reaches 0
→ Human Unitを盤面から除去
→ 死亡Hexへ対応Zombieを生成
→ 同じPhase中の通常Move / Attack / Targetingは禁止
→ 死亡HexにFacility / Checkpointがある場合、生成直後の即時占有・感染処理を1回実行
→ その結果の感染・陥落・感染者由来Spawn・FIFO連鎖を既存共通Ruleで解決
→ 次回Zombie Phaseから通常AIで行動
```

生成Zombieは死亡したHuman UnitのFuel、Military Goods、HP状態、Target等を継承しない。

Human Unitの死亡時に残Fuel／Military GoodsをState備蓄へ返さない現行Ruleを維持する。

### 15.4 施設内死亡

Human UnitがFacility／Checkpoint Hex上で死亡した場合、生成されたPolice Zombie／Soldier ZombieはそのHexを即時占有したものとして感染判定を発生させる。

この即時感染は通常Move／Attackとはみなさず、生成直後行動禁止に違反しない。

即時占有が施設陥落を引き起こした場合、v1.4.3の実感染者数連動SpawnとFIFO連鎖をそのまま使用する。

---

## 16. GameState / GameAction / Observation追加

最低限、次の正データをGameStateへ追加する。

- 51×51 Fixed Map ID。
- Branchごとの`hasBuiltCheckpoint`相当の初回Build履歴。
- Direction別`normalRejected / strictRejected / turnedAway`。
- Final Wave後Arrival停止状態。Final Wave stateから導出できる場合は重複保存しない。
- Police Zombie / Soldier Zombie Type。

追加GameAction:

- `TurnAwayCheckpointRefugees`
- `DecommissionConstructibleFacility`。入力は`facilityId`とし、v1.4.4ではCivilian Drone Baseだけを合法対象とする。

Observation / Browser Bridge / Agent APIへ最低限次を公開する。

- Police Movement Budget 15とLegal MoveごとのFuel Cost。
- Civilian Drone Base `workers × 3` Vision。
- Checkpoint Queue人数を含むFood／Civilian Goods Forecast。
- Checkpointの今回Build／Relocate Cost。
- Rejected Counterと追加Normal Zombie数は公開せず、拒絶が将来Hordeを強化し得るという定性情報だけを公開する。
- Police Zombie / Soldier ZombieのVisible個体と公開Stats。
- Final Wave後に新規Refugee Arrivalが停止した状態。

Hidden Zombie位置、将来Wave Direction等のv1.4.3 Fair Play境界は維持する。

---

## 17. Economy / Forecast

Food／Civilian Goods ForecastはCheckpoint健常Queueを維持人口へ含める。

Checkpoint Build / Relocate候補は、支線初回履歴に応じた実Costを返す。

Strategic Forecastは51×51化後も同一純粋計算経路を使い、Map拡張によってUI／Agentだけ別計算を持たない。

Simple Farm最大4基によるFood生産と、Queue増加によるFood需要を同じForecastで扱う。

---

## 18. UI / Help

### 18.1 Map

- 51×51全体をMobile／Desktopでパン・ズーム可能にする。
- 最小Zoomを`0.35`とし、`0.75`未満ではLODへ切り替える。
- 低Zoom LODで4 Zombie Typeを識別できる。
- Police / National Guard / Normal / Horde / Police Zombie / Soldier Zombieの視認性を確保する。

### 18.2 Police

Unit詳細へMovement 15、Fuel Cost、Emergency 3 MPを表示する。

### 18.3 Drone

Worker数ごとのAerial Vision 0 / 3 / 6 / 9 / 12 / 15を表示する。

撤去Actionは条件と標準13 CGの返却額を確認可能にする。

### 18.4 Checkpoint

Checkpoint Bottom Sheet／Branch Panelへ次を表示する。

- `waiting / screening / approved`がFood／Civilian Goodsを消費すること。
- 現在のQueue維持需要。
- 初回／以降Build Cost。
- Relocate 25 CG。
- Turn Away入力。
- 拒絶した避難民が将来Hordeを強化し得るという定性的説明。

Warning後も基礎Compositionだけを表示し、Rejected Counter、Bonus、最終Compositionの具体値を表示しない。

### 18.5 Final Wave

Final Wave Spawn後は「新規避難民流入停止」をRoad Branch UIとHelpへ表示する。

### 18.6 Unit Asset

v1.4.4の必須Asset更新として次の4点を作成・承認し、Runtimeへ組み込む。

- Policeはアメリカ風の制服を着た警察官5人組として描く。
- National Guardは武装した州兵小隊と分かる5人Groupとして描く。5人構成と10人構成の比較結果から、256×256での過密回避と人物・装備の可読性を優先して5人構成を承認した。描画人数はゲーム上のUnit人口10人とは独立した視覚表現である。
- Police Zombieは破れた濃紺巡回制服の3人Groupとして新規作成する。1 Tokenが1 Zombie Unitを表し、描画人数3人は視覚表現である。
- Soldier Zombieは破損した迷彩服・Helmet・装具を着た5人Groupとして新規作成する。1 Tokenが1 Zombie Unitを表し、描画人数5人は視覚表現である。

全Assetは既存盤面と併用できるcomic-painted調、256×256 px透過PNGとし、Zombieの傷・血痕・損傷表現は既存Zombie Assetを超えてGraphicにしない。`0.75`未満では人物数の細部に依存せず、陣営色と小隊Silhouetteで識別可能にする。

全4 Assetの構成および`Art/reference/v1.4.4-unit-concepts/runtime-candidates/units/`の256×256 RGBA候補は承認済みとし、実装本番ではこの4候補を必ず使用する。Asset Path、Registry、Manifest、Preload、Fallback、Fog Layer、3 MiB上限等はv1.4.3の共通Ruleを維持する。

---

## 19. Event / Metrics

追加Event候補:

- `checkpoint_refugees_turned_away`
- `checkpoint_refugees_rejected`
- `horde_rejected_bonus_applied`
- `refugee_arrivals_ended`
- `constructible_decommissioned`
- `human_unit_reanimated`

Rejected関連EventのProduction公開Payloadは具体的な人数、Counter、Bonus数を含めず、必要な定性的通知だけを返す。Internal Event／完全検証経路は決定性検証に必要な全数値を保持する。

Metricsへ最低限次を追加する。

- 初期Normal Zombie配置数25とSeed付き座標検証。
- Police 11～15 MP移動回数、距離別Fuel消費。
- Drone最大Vision、Aerial発見数。
- Checkpoint Queue由来Food／Civilian Goods維持需要・消費。
- Direction / Policy別Rejected人数。
- Turn Away人数。
- Direction別Rejected Bonus Normal Zombie生成数。
- Counter reset回数。
- Police Zombie / Soldier Zombie生成・撃破・最終生存数。
- Human Unit Type別Reanimation発生数。
- Reanimation直後のFacility／Checkpoint感染・陥落・連鎖数。
- Final Wave後に防止されたRefugee Arrival回数またはFinal後Arrival 0の不変条件。

Production公開MetricsはHidden Enemy情報を漏らさない。
Rejected Counter、Direction / Policy別Rejected人数、Turn Away人数、Rejected Bonus生成数とreset回数はInternal Metrics／完全検証Artifactだけに保存し、Production公開Metrics、Agent、Player-facing Artifact／Replay／終了結果へ含めない。

---

## 20. Save / Replay / Artifact

51×51 Map、ランダム初期Zombie、Rejected Counter、新Zombie Type、Checkpoint初回Build履歴を完全に保存・再現する。

初期Zombie配置はSeedから再導出可能であっても、Save validationとReplay一致検証でMap／Seed／PRNG順の整合を確認する。

新しいGame Rules / Save Formatを設定し、v1.4.3以前のSave / Replay / Artifact / Session / Checkpointは暗黙変換しない。

同じVersion、Config、Map、Seed、Action列から次が一致すること。

- 初期25 Zombie座標。
- Refugee arrival / screening / rejection。
- Rejected Bonus Horde数。
- Direction Counter reset。
- Police / Soldier Zombie生成。
- 即時感染／陥落連鎖。
- Final Refugee Arrival停止。
- 最終Result。

---

## 21. Balanced / Random Agent

Balanced Agentは最低限次を考慮する。

- Police 15 MPを州内即応・感染／Checkpoint危機対応へ活用する。
- National GuardをHorde迎撃・接触拒否の主力として扱う現行方針を維持する。
- Policeの長距離移動Fuel消費を評価し、緊急性の低い15 Hex移動を常用しない。
- Queue人口がFood／Civilian Goodsを消費するため、Strict長期Queueの経済圧力を評価する。
- Food不足時にSimple Farm最大4基を選択肢として評価する。
- Queue Pressure、維持不足、Rejected Bonusを見てTurn Awayを評価する。
- Turn Awayは即時経済改善と次Horde強化のTradeoffとして扱う。
- 追加Checkpoint 25 CGとRelocate 25 CGをStrategic Forecastへ反映する。
- Police / Soldier ZombieをNormal AI系Enemyとして評価し、Soldier ZombieのMove 5による接触Threatを高く扱う。
- Human Unitが死亡したHexで特殊Zombieが生成されるため、Facility内でのUnit Lossを特に危険として評価する。

Random Agentは新Actionを合法手から決定的に扱い、不変条件を維持する。

---

## 22. 必須テスト

### 22.1 Map

- 51×51、2601 Hex。
- Capital `(25,25)`。
- 4 Entrance。
- 4 Branch各25 Hex。
- 外周200 Reserve Hex。
- 29恒久FacilityのType別内訳・全座標・初期状態。
- Plain 1961、Forest 514、Mountain 126、Water 0、180度回転対称、Road／Facility Plain化、Reserve非重複。
- Mobile／Desktop描画と操作。

### 22.2 Initial Zombie

- 標準25体。
- 同Seed同配置。
- 異Seedで配置差が生じる。
- Capital Distance 0..8へ配置されない。
- Facility / Initial Human / Reserve / 不可Terrain / Zombie同士と重複しない。
- PRNG順とReplay一致。

### 22.3 Police / Drone

- Police MP 15境界。
- Fuel 11で平地15 Hex、Fuel 10以下では拒否。
- Emergency 3 MP維持。
- Drone 1..5 WorkerでVision 3 / 6 / 9 / 12 / 15。
- Ground LOS遮蔽無視。
- Drone撤去条件、Supply内外と`operational / disabled / recovering`、標準13 CG返却、上限解放、Simple Farm拒否。

### 22.4 Queue Economy

- waiting / screening / approvedをFood／CG維持へ加算。
- infected除外。
- ForecastとEndTurn一致。
- Queue人口を都市過密へ加算しない。

### 22.5 Checkpoint Cost

- 各Branch初回5。
- 失陥／削除／Active不在後も初回へ戻らない。
- 2基目以降25。
- Relocate 25。
- Activate 0。
- 不正Actionで履歴・資源・RNG不変。

### 22.6 Turn Away / Rejected Horde

- waitingのみ対象。
- 任意人数。
- Action 1回消費。
- Normal／Strict／Turn Awayを別Counterへ記録。
- `ceil(total / 5)`。
- 1人→1体、5人→1体、6人→2体。
- Wave参加Directionだけreset。
- 非参加Direction持越し。
- Spawn failure時resetなし。
- Bonus個体はNormal Zombie、同Wave Group所属。
- Final Waveにも方向別Bonusを適用し、正常Commit後に全方向reset。
- Warning前後の公開経路がCounter／Bonus具体値を漏らさず、定性的警告だけを表示。

### 22.7 Final Arrival Stop

- Final Wave Spawnまで通常Arrival。
- Final Wave Commit後に新規Arrival 0。
- 新規nextArrivalを抽選しない。
- 既存Queue処理継続。
- Final Spawn後の不合格／Turn AwayはCounterへ加算せず、累積実績Metricsだけへ記録。

### 22.8 New Zombie Types

- Police Zombie stats。
- Soldier Zombie stats。
- 両方Normal Zombie AI。
- Horde Capital Anchorなし。
- Noise / inherited Horde TargetをNormal同様に扱う。
- Scheduled / Final Horde groupへ混入しない。
- Supply clear Victoryには含まれる。

### 22.9 Human Unit Reanimation

- Police死亡→Police Zombie。
- National Guard死亡→Soldier Zombie。
- 同死亡Hex生成。
- 生成Phase中Move／Attack不可。
- Facility／Checkpoint同Hexなら即時感染。
- 即時陥落後の感染者Spawn／FIFO連鎖。
- 次Zombie Phaseから通常行動。
- Human UnitのFuel／Military Goodsを継承・返却しない。

### 22.10 Asset / Zoom

- Police 5人組、National Guard承認済み小隊、Police Zombie、Soldier Zombieの4 Assetが存在し、Registry／Legend／Fallbackへ対応する。
- 256×256 px透過PNG、既存comic-painted調、Runtime PNG合計3 MiB以下。
- 通常Zoomと`0.75`未満LODで6 Unit Typeを識別でき、最小Zoom`0.35`で操作可能。
- 390×844と1280×720でパン、ズーム、Fog、Unit／Facility Offset、選択UIを実ブラウザ確認する。

---

## 23. 不変条件追加

既存v1.4.3不変条件に加え、最低限次を満たす。

```text
MapWidth == 51
MapHeight == 51
InitialZombieCount == 25 (standard config)
InitialZombieDistanceFromCapital >= 9
RejectedCounters >= 0
PoliceMovementBudget == 15
0 <= DroneVisionRadius <= 15
```

- 同じDirectionのRejected Counterは対象Wave Spawn Commit時だけresetされる。
- Final Wave Spawn後、新規Refugee Arrivalを生成しない。
- Police Zombie / Soldier ZombieはHuman UnitではなくZombie陣営Unitである。
- Police Zombie / Soldier ZombieはHorde Zombie用Capital Strategic Anchorを持たない。
- Human Unit Loss由来Zombieは生成Phase中に通常行動しない。
- 1 Hex 1 Unit不変条件を維持する。

---

## 24. 確定事項とAsset承認境界

- 51×51固定MapのTerrain、29恒久Facility、初期部隊座標、Version境界、Queue不足順、Final後Rejected処理、Action名、Costは本書で確定済みとする。
- 基礎Wave Schedule／Base Compositionはv1.4.3を維持し、Rejected Bonusだけを追加する。
- Police Assetは制服警察官5人組で確定する。
- Police 5人、National Guard 5人、Police Zombie 3人、Soldier Zombie 5人の構成、承認済み原画、最終256×256 RGBA候補を`Art/reference/v1.4.4-unit-concepts/`へ固定する。
- 承認結果は`public/assets/board/ASSET_MANIFEST.md`と対応するArt reference READMEへ記録し、実装はその承認済みAssetを使用する。

---

## 25. v1.4.4実装完了条件

1. 本書の51×51 Terrain / Facility固定配置とVersion境界がCore、UI、Save、Replay、Artifactで一致する。
2. 標準Seed群で初期25 Zombieの接敵Timingが過度に早すぎず遅すぎない。
3. Police MP15が即応性を生む一方、Fuel消費と51×51距離によって万能Unitにならない。
4. Drone Radius15が広域偵察として有効だがMap全体を事実上常時可視化しない。
5. Queue維持・Checkpoint 25 CG・Rejected HordeがStrict一択を崩しつつ、Normal／Pass Throughを無条件最適にしない。
6. Soldier Zombie Move5とHuman Unit Loss時Reanimationが同Phase連続行動を起こさない。
7. Rejected Counter／Bonus具体値がProduction UI、Agent、Browser Bridge、公開Event、Player-facing Artifact／Replay／終了結果から漏れない。
8. 承認済み4 Unit Assetと最小Zoom`0.35`をMobile／Desktopで検証し、Runtime PNG合計3 MiB以下を維持する。
9. Random／Balanced固定Seed試験、Save／Replay、Browser Bridge、AI Portable Sessionが技術的失敗なく完遂する。

---

## 26. 将来検討（v1.4.4対象外）

- Police（暴徒鎮圧装備）等の追加Human Unit Type。
- National Guard級の耐久・Attackを持ち、Range 1でFacility感染制圧へ特化した重装Police系Unit。
- 追加Facility Type。
- 51×51余白を利用したイベント地点・追加戦略拠点。
- Random Map生成。

これらはv1.4.4では実装せず、51×51化とUnit役割差別化が安定した後に検討する。
