# Nowhere Left to Hide PoC v1.4.4 アップデート要件 ドラフト

- 作成日: 2026-09-03
- ステータス: ドラフト
- 対象Release: `1.4.4`
- 基準安定版: `v1.4.3`
- 実装状態: 未実装

## 1. 文書の位置づけ

本書はv1.4.3を基準とし、v1.4.4で検討するマップ拡張、機動性再設計、避難民・Checkpoint経済、拒否者由来Horde増加、新規Zombie Typeを定義するドラフトである。

本書で明示的に変更しないルールはv1.4.3を維持する。

本ドラフトでは、51×51マップ上の恒久Facility総数・Type別内訳・全座標については設計作業中とし、勝手に固定しない。実装着手前に固定Map定義として確定する。

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
| 恒久Facility | 17 | 増加・広域再配置。具体数／座標は別途確定 |
| 初期Normal Zombie | 固定12体 | Seed付きランダム25体 |
| 初期Zombie Capital除外 | 固定配置 | CapitalからHex Distance 8以内を禁止 |
| Police Movement Budget | 10 | 15 |
| National Guard Movement Budget | 10 | 変更なし |
| Civilian Drone Base Vision | `workers × 2`、最大10 | `workers × 3`、最大15 |
| Simple Farm上限 | `ceil(roadBranchCount / 2)`、標準2 | `roadBranchCount`、4支線Mapでは4 |
| Civilian Drone Base撤去 | 不可 | 条件付きで可能 |
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

- 51×51化に伴いTerrainと恒久Facility配置を全面的に再設計する。
- 恒久Facility数はv1.4.3の17から増加させ、州内へより広範囲に配置する。
- Facility総数、Type別内訳、座標、初期所有状態、Terrain seedは実装着手前に固定Map定義として確定する。
- Facility増加は単純な生産力の面積比例増加を目的としない。Supply Branchの選択、代替生産拠点、前線防衛、冗長性の選択を増やすことを目的とする。
- 初期所有経済圏、内側都市・産業圏、外縁Facility、Checkpoint Frontierが地理的に分離される配置を目標とする。
- 51×51化後もMobile UIで可読性と操作性を維持する。低Zoom LOD、Fog、Overlay、選択UIの負荷を検証する。

### 4.3 Version境界

Fixed Map IDは新しい51×51用IDへ更新する。具体的なIDは実装時に固定する。

Map寸法、Terrain、Facility、初期Zombie配置方式が変わるため、Game Rules / Save / Replay / Artifact / Session / Checkpointの互換境界を更新し、v1.4.3以前を暗黙変換しない。

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

CapitalからDistance 8以内を除外する根拠は、v1.4.3の初期Supply Radius 5とNormal Zombie Vision 3の合計を安全境界として扱い、初期状態からCapital経済圏へ即時に可視Population Targetを持つ個体を避けるためである。

初期ZombieはHorde由来ではなく、`spawnGroupId = null`、`hordeKind = null`とする。

配置候補の安定順、PRNG消費順、候補不足時のConfig rejectionを決定的にする。

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

撤去条件:

- Player所有。
- Building中でない。
- Worker 0。
- infected 0。
- Hex上にZombieがいない。
- Game Over後でない。

撤去時:

- FacilityをMapから除去する。
- 建設費は返却しない。
- 人口、Resource、PRNGを追加変更しない。
- Actionは共通Player Action 1回を消費する。
- 撤去されたDrone BaseはConstructible Facility Type上限を消費しない。

Simple Farmの任意撤去は本ドラフトの対象外とする。

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

EndTurn開始時に通常人口と同様に必要量を固定し、同TurnのFood shortageによる死亡等でCivilian Goods必要量を遡及変更しない。

Queue維持不足時の人口損失処理では、既存の都市・生産施設人口損失ルールとの優先順位を実装時に明文化し、ForecastとEndTurn実績を一致させる。

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

仮称:

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
- `count`は整数1以上。
- `count <= waiting`。
- Player Action Phaseである。
- Game Overでない。

`screening`、`approved`、`infected`はTurn Away対象外とする。

受理時に`waiting`から指定人数を減らし、対応Road Branch／Directionの`turnedAway` Counterへ同人数を加算する。

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

UI、Observation、Metricsでは3内訳と合計を公開可能とする。

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

Warning開始後は、その時点のRejected Counterから算出した追加Normal Zombie数を方向別Compositionへ表示する。

Warning開始後に追加の不合格／Turn Awayが発生した場合も、Spawn直前まで公開予定Compositionを更新する。

例:

```text
Base: H4 / N7
Rejected bonus: N+3
Final: H4 / N10
```

将来Directionが未確定のWaveについて、Warning前に方向別Counterから将来抽選Directionを推測できる情報を新たに公開しない。Counter自体を方向別に常時公開する場合は、これは行政情報でありHidden Enemy情報ではないものとして扱う。

---

## 13. Final Wave以後のRefugee Arrival停止

標準固定ScheduleのFinal WaveがSpawnされた時点を、自然Refugee Arrivalの最終境界とする。

- Final Wave Spawn以前に予定され、Final Wave Spawn前のRefugee Phaseで到着する避難民は通常処理する。
- Final Waveが正常にSpawn Commitされた後は、新しいRoad Branch Arrivalを発生させない。
- Final Wave後に`nextArrivalTurn`を新規抽選しない。
- 既にCheckpoint内にいる`waiting / screening / approved / infected`は通常どおり処理を継続する。
- Final Wave後もTurn Away、Screening完了、配置待ち処理は可能だが、以後Scheduled Hordeがないため新規Rejected Counterを発生させる操作については、Counterを無意味に残さないようUIで明示する。

Final Wave後の既存Queueに対するNormal／Strict不合格・Turn AwayをRejected Counterへ加算するかは、実装時に次のどちらかへ統一する。

1. Final Wave Spawn後はRejected Counterへ加算せず単純な州外退去として扱う。
2. Counterへ記録はするが、Metrics専用でHorde Spawnへは使用しない。

本ドラフトでは新規Arrival停止を確定事項とし、この細部は実装着手前に固定する。

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
- Civilian Drone Base撤去用Action。名称は既存Action命名規則に合わせて確定する。

Observation / Browser Bridge / Agent APIへ最低限次を公開する。

- Police Movement Budget 15とLegal MoveごとのFuel Cost。
- Civilian Drone Base `workers × 3` Vision。
- Checkpoint Queue人数を含むFood／Civilian Goods Forecast。
- Checkpointの今回Build／Relocate Cost。
- Direction別Rejected Counter内訳と、Warning後の追加Normal Zombie数。
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
- 低Zoom LODで4 Zombie Typeを識別できる。
- Police / National Guard / Normal / Horde / Police Zombie / Soldier Zombieの視認性を確保する。

### 18.2 Police

Unit詳細へMovement 15、Fuel Cost、Emergency 3 MPを表示する。

### 18.3 Drone

Worker数ごとのAerial Vision 0 / 3 / 6 / 9 / 12 / 15を表示する。

撤去Actionは条件と返金なしを確認可能にする。

### 18.4 Checkpoint

Checkpoint Bottom Sheet／Branch Panelへ次を表示する。

- `waiting / screening / approved`がFood／Civilian Goodsを消費すること。
- 現在のQueue維持需要。
- 初回／以降Build Cost。
- Relocate 25 CG。
- Turn Away入力。
- Direction別Normal rejected / Strict rejected / Turned away。
- 現在のRejected bonus Zombie数。

Warning後はBase CompositionとRejected Bonusを分離して表示する。

### 18.5 Final Wave

Final Wave Spawn後は「新規避難民流入停止」をRoad Branch UIとHelpへ表示する。

---

## 19. Event / Metrics

追加Event候補:

- `checkpoint_refugees_turned_away`
- `checkpoint_refugees_rejected`
- `horde_rejected_bonus_applied`
- `refugee_arrivals_ended`
- `constructible_decommissioned`
- `human_unit_reanimated`

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
- Facility座標、Terrain、Reserve非重複。
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
- Drone撤去条件、返金なし、上限解放。

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

### 22.7 Final Arrival Stop

- Final Wave Spawnまで通常Arrival。
- Final Wave Commit後に新規Arrival 0。
- 新規nextArrivalを抽選しない。
- 既存Queue処理継続。

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

## 24. 未確定事項

本ドラフト作成時点で、次は未確定とする。

1. 51×51固定MapのTerrain全座標。
2. 恒久Facilityの最終総数、Type別内訳、全座標、初期状態。
3. 新しいFixed Map ID / Game Rules Version / Save Format / API / Artifact Version。
4. Queue維持不足時にCheckpoint健常者をどの優先順位で死亡させるか。
5. Final Wave Spawn後に既存Queueから発生する不合格／Turn AwayをRejected Counterへ記録するか、単純な州外退去として扱うか。
6. Civilian Drone Base撤去Actionの正式名称。
7. 51×51化に伴うWave Schedule／Base Compositionの追加調整が必要か。Rejected Bonus導入効果を先に検証し、必要なら別途調整する。

---

## 25. v1.4.4ドラフト完成条件

v1.4.4要件を確定版へ移す前に最低限次を決定する。

1. 51×51 Terrain / Facility固定配置。
2. Facility総数と経済バランス。
3. Version境界。
4. Queue shortageの人口損失順。
5. Final後既存QueueのRejected記録Rule。
6. 標準Seed群で初期25 Zombieの接敵Timingが過度に早すぎず遅すぎないこと。
7. Police MP15が即応性を生む一方、Fuel消費と51×51距離によって万能Unitにならないこと。
8. Drone Radius15が広域偵察として有効だがMap全体を事実上常時可視化しないこと。
9. Queue維持・Checkpoint 25 CG・Rejected HordeがStrict一択を崩しつつ、Normal／Pass Throughを無条件最適にしないこと。
10. Soldier Zombie Move5とHuman Unit Loss時Reanimationが理不尽な同Phase連続行動を起こさないこと。
11. Random／Balanced固定Seed試験、Save／Replay、Browser Bridge、AI Portable Sessionが技術的失敗なく完遂すること。

---

## 26. 将来検討（v1.4.4対象外）

- Police（暴徒鎮圧装備）等の追加Human Unit Type。
- National Guard級の耐久・Attackを持ち、Range 1でFacility感染制圧へ特化した重装Police系Unit。
- 追加Facility Type。
- 51×51余白を利用したイベント地点・追加戦略拠点。
- Random Map生成。

これらはv1.4.4では実装せず、51×51化とUnit役割差別化が安定した後に検討する。
