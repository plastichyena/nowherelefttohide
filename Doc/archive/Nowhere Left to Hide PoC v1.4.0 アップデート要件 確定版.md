# Nowhere Left to Hide PoC v1.4.0 アップデート要件 確定版

## Large Theater / Fuel Logistics / Forward Infrastructure / Strategic Readability

- 作成日: 2026-08-31
- ステータス: 現行仕様へ反映済み・アーカイブ
- 基準Version: v1.3.3
- 対象Release: v1.4.0

---

# 1. 文書の位置づけ

本書は、単一Release `v1.4.0` で追加・変更する部分の確定要件である。

- 実装・テスト・動作確認が完了するまでは、`Nowhere Left to Hide PoC 現行仕様.md`を安定版の唯一の正本とする。
- 本書に変更記載のないゲームルール、UI、Agent、保存、Replay、CI要件は現行仕様を維持する。
- 実装・テスト・動作確認完了後、本書を現行仕様へ反映し、Version、実装、テスト、Helpとの整合を確認してから本書を`Doc/archive/`へ移す。
- 日本語UIでもタイトルは`Nowhere Left to Hide`と表記する。

---

# 2. 目的

v1.4.0では、v1.3.3のCheckpoint冗長化、Terrain、Combat Noise、人口・感染・経済を維持したまま、次を一つのLogistics Systemとして導入する。

```text
Large Theater
-> Human Mobility
-> Unit Fuel Endurance
-> Supply Network
-> Forward Infrastructure
-> Reconnaissance / Food Redundancy
-> Strategic Forecast
-> Battlefield Selection
-> Survival
```

中心となる判断は次である。

- 広いMapで全戦線へ同時対応できない前提で部隊を配分する。
- 長距離移動、発電、Unit補給の間でFuelを配分する。
- Checkpoint前進によってSupplyと建設可能域を拡張する。
- Simple FarmでFood生産を冗長化し、Civilian Drone Baseで前方Visionを確保する。
- 戦闘上優勢でも経済敗北が確定する状況をCore Forecastから理解する。

---

# 3. Version境界

| 契約 | v1.4.0 |
|---|---|
| App / Release | `1.4.0` |
| Game Rules / GameState / Config | `2.0.0` |
| Fixed Map ID | `fixed-31x31-v1` |
| Save Format | `5` |
| Agent API / Observation API / Browser Bridge API | `2.0.0` |
| Artifact Schema | `2.0.0` |
| Balanced Agent | `4.0.0` |
| Random Agent | `2.0.0` |

- v1.3.3以前のSave、Replay、Artifactは変換しない。
- Version不一致は現在State、保存領域、PRNGを変更せず理由付きで拒否する。
- Build IDは現行どおり結果と乱数へ影響させない。

---

# 4. スコープ

## 4.1 追加・変更するもの

- 31×31固定Mapと新しい固定Map ID
- 初期Zombie 6体
- Human Unit Movement Budget 10
- Unit固有Fuel Pool、移動Fuel、補給
- Wind Power Plant
- Constructible Facility共通Rule
- Simple Farm
- Civilian Drone Base
- Strategic Forecastと警告
- Fuel、建設、Forecastに対応するHuman UI、Agent、Balanced Agent、Metrics、Replay、Save、Help
- Artifact内の固定Map重複削減

## 4.2 今回変更しないもの

- Random Map、LOS、高低差、視界遮蔽
- Zombie／Horde ZombieのMovement、Combat性能、Target優先順位、Noise Rule
- Periodic Horde Cycle 5、Final Horde Turn 30、標準Composition
- 既存人口、感染、Checkpoint Fallback、Victory／Defeatの基本Rule
- 既存4支線の考え方
- Live Agent ObservationとProduction Browser Bridgeが自己完結した完全Observationを返す境界
- State Delta Replay

---

# 5. 固定Map

## 5.1 寸法・中心・入口

- Mapは`31×31`、有効座標は`x=0..30`、`y=0..30`とする。
- Capitalは`(15,15)`とする。
- Horde EntranceはNorth `(15,0)`、East `(30,15)`、South `(15,30)`、West `(0,15)`とする。
- Road BranchはNorth、East、South、Westの4支線とする。
- Standard MapにWaterは配置しない。列挙されない基礎TerrainはPlainとする。
- Random MapとSeedによるTerrain生成は行わない。

## 5.2 Road

Capital Junction `(15,15)`をRoad Overlayとし、各支線を次で固定する。

```text
North: (15,y), y=0..14
East:  (x,15), x=16..30
South: (15,y), y=16..30
West:  (x,15), x=0..14
```

- Entranceと恒久FacilityがあるRoad Hexも支線構造へ含めるが、Facility HexはCheckpoint候補外とする。
- Sectorは現行の最寄り支線Ruleで決定し、同距離は複数Sectorへ属する。
- Active Checkpointの支線半径は現行どおり`max(initialSupplyRadius, CapitalからActiveまでの距離)`とする。

## 5.3 恒久Facility座標

恒久Facilityは17施設とし、次へ固定する。

| ID | Type | 座標 | 初期状態 |
|---|---|---:|---|
| `capital` | Capital | `(15,15)` | owned |
| `city-1` | City | `(15,8)` | disconnected |
| `city-2` | City | `(22,15)` | disconnected |
| `city-3` | City | `(15,22)` | disconnected |
| `city-4` | City | `(8,15)` | disconnected |
| `farm-1` | Farm | `(13,15)` | owned |
| `farm-2` | Farm | `(14,4)` | disconnected |
| `farm-3` | Farm | `(16,26)` | disconnected |
| `civilian-factory-1` | Civilian Factory | `(17,15)` | owned |
| `civilian-factory-2` | Civilian Factory | `(25,16)` | disconnected |
| `military-factory-1` | Military Factory | `(26,15)` | disconnected |
| `military-factory-2` | Military Factory | `(11,15)` | disconnected |
| `refinery-1` | Refinery | `(15,13)` | owned |
| `refinery-2` | Refinery | `(14,6)` | disconnected |
| `power-plant-1` | Power Plant | `(15,17)` | owned |
| `power-plant-2` | Power Plant | `(16,24)` | disconnected |
| `wind-power-plant-1` | Wind Power Plant | `(16,14)` | owned |

- 初期所有Facilityはすべて初期Supply Radius内とする。
- 初期未確保のMilitary Factoryを最低1つ初期Supply Radius内に配置する。
- 各恒久Facility座標の基礎TerrainはPlainとする。
- Facilityは現行どおりUrban Overlayを持つ。Road座標上の恒久FacilityはRoad Overlayも維持する。

## 5.4 初期Unit・Zombie座標

| 対象 | 座標 |
|---|---:|
| Police | `(14,15)` |
| National Guard | `(16,15)` |
| Normal Zombie 1 | `(9,9)` |
| Normal Zombie 2 | `(21,21)` |
| Normal Zombie 3 | `(21,9)` |
| Normal Zombie 4 | `(9,21)` |
| Normal Zombie 5 | `(15,6)` |
| Normal Zombie 6 | `(15,24)` |

- 初期Zombieは3組の180度回転対称配置とする。
- 初期ZombieはNormal Zombie 6体で、初期所有Facilityまで最低4 Hexを確保する。
- Zombie Movementは現行値のため、最初のZombie Turnに初期所有Facilityへ到達できないことをMap Testで保証する。

## 5.5 Terrain座標

180度回転を`R(x,y) = (30-x, 30-y)`とする。範囲`x=a..b, y=c`は同じ`y`上の両端を含む全座標を表す。

Mountainは、次のSeed集合とその`R`像の和集合とする。

```text
y=3:  x=8..10
y=4:  x=7..10, x=20..22
y=5:  x=7..9,  x=21..23
y=6:  x=6..8,  x=22..24
```

Forestは、次のSeed集合とその`R`像の和集合とする。

```text
y=1:  x=2..6,   x=24..28
y=2:  x=2..7,   x=23..28
y=3:  x=3..6,   x=24..28
y=4:  x=2..5,   x=24..27
y=5:  x=3..6,   x=25..28
y=6:  x=2..5,   x=25..28
y=7:  x=3..7,   x=23..27
y=8:  x=3..6,   x=24..27
y=10: x=4..8
y=11: x=3..8
y=12: x=4..8
y=13: x=5..9
y=14: x=4..8
```

Terrain集合の確定順は次とする。

1. Mountain Seedと`R`像を配置する。
2. Forest Seedと`R`像を配置する。
3. MountainとForestが重複した場合はMountainを優先する。
4. Road、Capital、恒久Facilityの全座標を両集合から除外してPlain基礎Terrainにする。
5. その他をPlainとする。

## 5.6 Map不変条件

- Capital、Entrance、恒久Facility、初期Unitは重複しない。ただしRoad／UrbanはOverlayとして共存できる。
- Mountain、Forest、Plainの各集合は相互排他的で、全961 Hexを一度だけ被覆する。
- 4支線はCapitalへ接続し、各Entranceまで途切れない。
- 各支線のEntranceからCapitalまでのRoad距離は15とする。
- ゲーム開始時のSupply内に、施設、Road、Unitを除いた静的な建設可能Plain Hexを最低12個確保する。
- 各支線のSupply半径6..15の各拡張帯に、Road外Plain Hexを最低2個確保する。
- Map Query、UI、Observation、Save、Replay、Testは同じMap定義を使用する。

---

# 6. 初期状態

- 初期民間人口100人、Police 1隊、National Guard 1隊を維持する。
- 人口配置はCapital 41、Farm 23、Civilian Factory 23、Refinery 10、Power Plant 3を維持する。
- Wind Power PlantはWorker 0固定のため人口を再配分しない。
- 初期資源はFood 230、Civilian Goods 230、Military Goods 75、State Fuel 92とする。
- 初期Police／National GuardのUnit Fuel Poolは満タンとし、そのFuelをState Fuel 92から差し引かない。
- Capitalの初期Supply Radiusは5 Hexとする。

---

# 7. Human Unit MovementとFuel

## 7.1 Movement Budget

- Police、National Guardの標準Movement Budgetは10とする。
- 経路合法性は現行どおり進入Terrain Costの累積`<= 10`で判定する。
- Fuel CostはTerrain Costでなく、実際に進入したHex数を使う。
- 移動しない場合はFuelを消費しない。Attack、Wait、Counterattack、Interception、自動鎮圧はFuelを消費しない。

## 7.2 Fuel Cost

Police:

```text
distance = 0    -> 0
distance = 1..5 -> 1
distance >= 6   -> 1 + (distance - 5)
```

National Guard:

```text
distance = 0    -> 0
distance = 1..5 -> 1
distance >= 6   -> 1 + 2 * (distance - 5)
```

| Hex数 | Police | National Guard |
|---:|---:|---:|
| 1..5 | 1 | 1 |
| 6 | 2 | 3 |
| 7 | 3 | 5 |
| 8 | 4 | 7 |
| 9 | 5 | 9 |
| 10 | 6 | 11 |

- Police `maxFuel = 12`、National Guard `maxFuel = 22`とする。
- Move開始時に予定経路のFuelを保有しないActionは拒否する。
- Hidden Enemyによって経路途中で停止した場合は、実際に進入したHex数からFuel Costを再計算して消費する。
- Unit死亡時の残Fuelは失われ、State Fuelへ返還しない。

## 7.3 EndTurn Refuel

- Player EndTurnのEconomy処理で、発電Fuel割当後、施設生産前にUnit補給を行う。
- 補給判定時点で生存し、Player Supply Network内にいるHuman Unitだけが対象となる。
- `refillDemand = maxFuel - currentFuel`とし、補給実績分だけState Fuelを消費する。
- Supply外Unitは補給しない。
- State Fuel不足時はUnit ID昇順の1 Fuel単位Round Robinで、満タンUnitを飛ばしながらFuelが尽きるまで配分する。
- 当TurnのRefinery生産Fuelは発電にもUnit補給にも使わず、次Turnから利用可能とする。
- ForecastとEndTurnは同じ純粋計算経路を使用する。

## 7.4 新規編成Unit

- 初期配置以外のUnitは完成時に`currentFuel = 0`で生成し、直後にState Fuelから最大容量まで補給を試みる。
- 同時完成時は新UnitをUnit ID昇順の1 Fuel単位Round Robinで補給する。
- 補給実績分だけState Fuelを消費し、不足時は部分補給とする。
- 完成UnitはそのPlayer Turnから、保有Fuelで支払える合法Moveを実行できる。
- 無料の完成時Fuelを生成しない。

---

# 8. Fuelと発電

## 8.1 処理順

EndTurnのFuel関連順序を次へ固定する。

```text
Turn-start State Fuel確定
-> Wind供給量確定
-> Power需要とPower Plant物理Capacity確定
-> Windを先に電力需要へ割当
-> 不足分だけPower PlantでFuel発電
-> 発電実績分のState Fuel消費
-> 残FuelからSupply内UnitをRefuel
-> Facility生産
-> Refinery生産FuelをEnding Stockへ追加
```

## 8.2 発電式

```text
availablePower
= operationalWindCapacity
 + min(powerPlantPhysicalCapacity, turnStartFuel * 5)
```

- Wind電力を需要へ先に割り当てる。
- Windで満たせない実割当5 ElectricityごとにState Fuel 1を消費する。
- 余剰Power Plant CapacityへFuelを消費しない。
- 当Turn Refinery生産FuelはEnding Stockへ入るが、当TurnのPowerとUnit Refuelへ入れない。

## 8.3 Fuel Forecast

最低限、次を区別する。

```text
turnStartFuel
windPowerAvailable
powerPlantPhysicalCapacity
projectedPowerFuelDemand
projectedPowerFuelUsed
fuelAfterPower
projectedUnitRefillDemand
projectedUnitFuelRefilled
projectedTotalFuelDemand
projectedRefineryProduction
projectedEndingFuel
powerFuelShortage
unitRefillFuelShortage
totalFuelShortage
```

---

# 9. Wind Power Plant

- 初期所有Facilityとして1基を追加する。
- Workerは0固定で、割当・撤収を拒否する。
- 稼働中はFuel消費なしでElectricity 15を提供する。
- 稼働中は通常所有Facilityと同じVision 1を提供する。
- Supply Sourceにはならない。
- `healthyPopulation = 0`、`zombieTargetValue = 5`を分離する。
- Zombie Target Valueは人口、消費、過密、Defeat判定へ加算しない。

状態遷移:

```text
operational
-> zombie occupied / disabled
-> human recapture
-> recovering
-> next Player Turn operational
```

- ZombieがWind HexでZombie Turnを終了すると感染処理でなく`disabled`にする。
- `disabled`と`recovering`では発電0、Vision 0とする。
- Human UnitがHex上のZombieを排除して進入すると`recovering`にする。
- 再確保した次Player Turn開始時に`operational`へ戻す。
- 感染者Pool、通常Facilityの感染者下限、陥落時追加Zombieを作らない。
- Windは破壊・再建対象にせず、常に恒久Facilityとして残る。

---

# 10. Constructible Facility共通Rule

## 10.1 Typeと上限

対象TypeはSimple FarmとCivilian Drone Baseとする。

```text
limitPerType = ceil(roadBranchCount / 2)
```

- 4支線MapではSimple Farm最大2、Civilian Drone Base最大2とする。
- 上限はTypeごとに独立する。
- 建設中、operational、empty、disabled、recoveringは上限に数える。
- 感染陥落で消滅した施設は上限に数えない。
- 上限は現在存在数から導出し、累計建設数では制限しない。

## 10.2 Build条件

- 新Action `BuildConstructibleFacility`は`facilityType`と`position`を受ける。
- Player Supply Network内だけで建設できる。
- 基礎TerrainがPlainで、Road Overlay、Urban Overlay、Horde EntranceのないHexだけを候補とする。
- Facility、Checkpoint、Player Unit、Visible ZombieがいるHexへ建設できない。
- Hidden Zombieは候補、合法性、Reason Codeへ反映しない。
- Hidden Zombieが実在するHexへのActionは受理し、一時的な同居を許す。次のZombie Turn終了時に通常の占有・感染処理を行う。
- Simple FarmはCivilian Goods 15、Civilian Drone BaseはCivilian Goods 25を受理時に即時消費する。
- 建設1回は共通Player Action 1を消費する。Type別・支線別の追加回数制限は設けない。
- Action上限と資源が許せば同Turnに複数建設できる。
- 不正ActionはState、Resource、Action回数、PRNGを変更しない。

## 10.3 建設・操作解禁

- 受理時にFacilityを生成し、建設Turnは無人・非稼働とする。
- 建設TurnはWorker配置、Power需要、生産、Visionを持たない。
- 次Player Turn開始時に操作可能となり、Worker配置とPower Supply ONが有効になる。
- 移設、売却、任意撤去Actionは導入しない。
- Constructible Facility自身はSupply Sourceにならない。

## 10.4 Supply喪失

- Supply外になってもWorker、所有、状態を維持する。
- 配置済みWorkerと給電があれば生産またはVisionを継続する。
- Supply外ではWorker増員を禁止し、減員・都市への帰還を許可する。
- Supply内へ戻った時点から、通常の安全・操作可能条件を満たせば同じPlayer Turnに増員できる。
- Supply喪失だけでdisabled、recovering、破壊にしない。

## 10.5 Power Supply

- 両Typeは`SetPowerSupply`でON/OFFできる。
- 建設解禁時とRecovery完了時の既定値はONとする。
- 切替はResource、Unit行動権、共通Player Actionを消費せず、Forecastを即時更新する。
- OFF、無人、建設Turn、disabled、recoveringではPower需要を持たない。
- 5 Electricity未満の部分給電はしない。

Power割当順位:

```text
1. Capital / City
2. Simple Farm
3. 恒久Farm / Civilian Factory
4. Military Factory
5. Civilian Drone Base
```

- 同区分内は確保・建設が古い順、同順位はFacility ID昇順とする。
- Windを含む利用可能電力をこの順で割り当てる。

## 10.6 人口Rule

- Workerは既存生産施設と同じ人口移動経路で都市から配置し、撤収時は都市へ戻す。
- Worker 1人はFood 1、Civilian Goods 1を毎Turn消費する。
- 健全Workerは州全体の健全民間人口と人口0 Defeat判定へ含める。
- 配置元／帰還先都市の人口、都市生産、過密へ通常どおり影響する。
- Constructible Facility自身には都市SoftCapと過密を持たない。
- 手動撤収または資源不足でWorker 0になっても施設は消滅せず、emptyになる。

## 10.7 Infection・Destroy

- Worker 1人以上では通常の有人Facilityと同じ感染進行、駐留封じ込め、自動鎮圧を使用する。
- 感染によって健全Workerが0になった時だけ施設を即時消滅させる。
- 施設と内部感染者Poolを同時に除去し、Ruined Facilityを残さない。
- Constructible Facility用の感染者下限を作らない。
- 通常施設陥落と同じ配置RuleでNormal Zombie 2体を周辺へ生成する。
- 元HexはRoad／UrbanのないPlainへ戻り、新規Build候補になれる。

Worker 0でZombieに占有された場合:

1. Zombieが施設HexでZombie Turnを終了すると`disabled`になる。
2. 感染者、追加Zombie、施設消滅は発生しない。
3. Zombie排除後にHuman Unitが進入すると`recovering`になる。
4. 次Player Turn開始時に`operational empty`へ戻る。
5. disabled／recoveringではWorker配置、Power需要、生産、Visionを停止する。
6. 所有とType別上限消費を維持する。

---

# 11. Simple Farm

- Worker Capacityは10とする。
- Required Powerは5とする。
- 給電時だけWorker 1人あたりFood 5／Turnを生産する。
- 最大生産はFood 50／Turnとする。
- 無給電、Power Supply OFF、Worker 0、建設Turn、disabled、recoveringでは生産0とする。
- 恒久FarmのPower Boost Ruleを流用せず、Required Power型として扱う。
- `zombieTargetValue = healthyWorkers`とする。

---

# 12. Civilian Drone Base

- Worker Capacityは5とする。
- Required Powerは5とする。
- Supplyを提供しない。
- 給電中のVision Radiusは`healthyWorkers * 2`とする。

| Worker | Vision Radius |
|---:|---:|
| 0 | 0 |
| 1 | 2 |
| 2 | 4 |
| 3 | 6 |
| 4 | 8 |
| 5 | 10 |

- Visionは既存Shared Visibility Unionへ加える。
- 無給電、Power Supply OFF、Worker 0、建設Turn、disabled、recoveringではVision 0とする。
- 固定の施設Zombie Target Valueを持たず、`zombieTargetValue = healthyWorkers`とする。
- 空のDrone BaseをZombie誘導用の人口Targetにしない。

---

# 13. Zombie Target Value

- 実人口とZombie Target評価を別のCore値として扱う。
- `zombieTargetValue`をAgent Observation、Facility UI、Help、`getApiInfo()`へ公開する。
- Windは5、Simple FarmとDrone Baseは健全Worker数を返す。
- Defeat、Population、Consumption、Overcrowdingは実人口だけを使用する。
- Zombie AIのTarget候補以外の既存優先順位を変更しない。

---

# 14. Strategic Forecast

Strategic ForecastはHidden情報を追加せず、現在の公開StateとConfigから純粋かつ決定的に導出する。UI、Observation、Balanced Agentは同じCore結果を使用する。

## 14.1 Critical Resource Dependency

Food、Civilian Goods、Military Goods、Fuel、Electricityごとに次を返す。

- currentProductionまたはcurrentSupply
- currentDemand
- Facility別寄与量と構成比
- largestContributorFacilityId
- largestContributor喪失後のprojectedSupply
- largestContributor喪失後のshortage
- `singlePointOfFailure`
- `currentlyShort`

`singlePointOfFailure`は次が両方成立する場合だけtrueとする。

```text
現在Forecastでは不足しない
かつ
最大寄与Facilityを1つ失ったForecastでは不足する
```

- 備蓄を含む次EndTurn Forecastで不足しない場合は警告を出さないが、構成比は常に公開する。
- すでに不足中の場合は`currentlyShort`を使い、Single Point of Failureと混同しない。
- 仮想喪失計算は対象Facilityだけを非稼働にした純粋計算とし、StateとPRNGを変更しない。

## 14.2 Guaranteed Defeat Forecast

- 現在の公開状態のままEndTurnした際の経済処理だけを対象とする。
- Food不足、続いてCivilian Goods不足を現行順で適用し、健全民間人口0が確定する場合にtrueとする。
- 原因Resource、各不足量、予測健全民間人口、Defeat Reasonを返す。
- Zombie行動、Hidden Zombie、潜伏感染、避難民乱数、将来Horde接触を含めない。
- 通常不足Warningより上位のCritical Warningとして表示する。
- Balanced Agentは対応可能なDomestic ActionをImmediate Combat Opportunityより優先する。ただし現在Actionで回避不能な場合は不正なAction Loopを作らない。

## 14.3 Checkpoint Projected Supply Effect

Build／Relocate／Activateの各Checkpoint Candidateへ最低限次を追加する。

```text
currentBranchRadius
projectedBranchRadius
newlySuppliedHexCount
newlyUnsuppliedHexCount
newlySuppliedFacilityIds
newlyUnsuppliedFacilityIds
suppliedFacilityDelta
newlyBuildableConstructibleHexCount
```

- 合法性、Reason Code、Supply差分は同じCore ValidationとSupply導出を使用する。
- Visible Zombieだけを阻害へ使い、Hidden Enemyの存在、位置、IDを差分から漏らさない。
- Candidate Actionを仮適用する純粋計算とし、StateとPRNGを変更しない。

## 14.4 Queue Pressure

```text
queuePeople = waiting + screening + approved
capacity = screeningCapacity

none:   queuePeople == 0
low:    0 < queuePeople <= capacity
medium: capacity < queuePeople <= capacity * 2
high:   queuePeople > capacity * 2
```

Checkpoint Branch Observationは次を返す。

- waiting、screening、approvedとqueuePeople
- screeningCapacity
- currentPolicyとcurrentPolicyTurns
- `estimatedScreeningThroughput = capacity / max(1, currentPolicyTurns)`
- arrivalIntervalMin／Max
- arrivalPeopleMin／Max
- queuePressureClass

- 将来到着乱数と潜伏感染乱数を公開しない。
- 標準Capacity 10では1..10がlow、11..20がmedium、21以上がhighとなる。

---

# 15. Agent Observation・API

## 15.1 Unit

最低限、次を追加する。

```text
currentFuel
maxFuel
fuelCostByLegalMove
projectedFuelAfterMove
inSupply
projectedRefillDemandIfTurnEndsNow
projectedRefillAmountIfTurnEndsNow
```

- Legal MoveごとのFuel CostはCore Pathと同じ経路を使う。
- Fuel不足MoveをLegal Actionsへ含めない。

## 15.2 Facility

- Wind、Simple Farm、Civilian Drone BaseのTypeと状態
- Constructible Facilityのbuild／disabled／recovering状態
- Worker Capacity、Required Power、Power Supply、予測／実績給電
- Food OutputまたはVision Radius
- `zombieTargetValue`と実人口
- Supply状態と増員可否

## 15.3 Static Rules

`getApiInfo()`へ次を追加する。

- Unit Type別Movement、maxFuel、Fuel Cost式
- Refuel時点、Supply条件、State Fuel不足時Round Robin
- Wind優先発電とPower／Unit Fuel順
- Wind状態、Vision、Zombie Target Rule
- Constructible Facility Build条件、費用、上限式、状態遷移
- Simple Farm Worker／Power／Production
- Drone Worker／Power／Vision
- Strategic Forecast SchemaとQueue Pressure閾値

---

# 16. Balanced Agent 4.0.0

- Guaranteed Defeat回避をHard Priorityとし、回避可能な内政ActionをImmediate Combat Opportunityより優先する。
- Resource別Single Point of Failureと現在不足を区別する。
- Food単一障害点があり建設可能ならSimple Farmを候補化する。
- Move距離とUnit Type別Fuel Cost、Move後残Fuel、Supply内補給見込みを評価する。
- National Guardの6 Hex以上をPoliceより高い長距離展開Costとして扱う。
- Supply外で次Turnに移動不能となる進出を減点し、Horde緊急防衛は上書き可能とする。
- Horde Warning方向、Fog、給電余力を考慮してDrone Baseを評価する。
- Guaranteed Defeat、Food、Fuel、Defenseを犠牲にしてDroneを建設・給電しない。
- CheckpointはProjected Supply Effectを評価し、半径増加0、供給Facility増加0、建設可能Hex増加0の前進を低Priorityにする。
- Queue Pressure highを前線人口Riskとして扱い、Policy変更、処理待ち、防衛を評価する。
- 公開ObservationとLegal Actionsだけを使用し、Hidden情報を推測しない。
- 同一Stateでは安定Action Keyにより決定的なActionを選ぶ。

Random Agentは新しいLegal Actionsと共通Runnerを使用し、GameStateを直接参照しない。

---

# 17. Human UI・Help

## 17.1 Unit Fuel

Unit Bottom SheetとMove確認へ次を表示する。

- Current／Max Fuel
- 選択中MoveのFuel Cost
- Move後Fuel
- EndTurn補給需要と予測補給量
- Supply外またはState Fuel不足による未補給理由

## 17.2 Fuel HUD・Forecast

- Wind供給、Power Plant発電Fuel需要／実使用、Unit補給需要／実績、合計需要、Refinery生産、予測終了Fuelを分離する。
- 発電がUnit補給より先であること、当Turn Refinery生産を当Turn補給へ使えないことをHelpで説明する。

## 17.3 Build Mode

- Simple Farm／Civilian Drone Baseを選ぶBuild Modeを追加する。
- Core Candidate Queryが全Mapの候補とReason Codeを安定座標順で返す。
- 合法Plain Hexを強調し、不合法候補ではSupply外、Terrain、Road、Urban、Entrance、既存Object、Visible Zombie、上限、資源、Action上限等の最初のCore Reasonを日英表示する。
- State、Type、候補位置が変わった場合は古いReasonを残さない。
- Hidden Zombieを候補差分から漏らさない。

## 17.4 Facility UI

- Windは発電15、Fuel 0、Vision 1、Zombie Target 5、disabled／recoveringを表示する。
- Simple Farmは費用、上限、Worker、Required Power、Food 5／worker、予測生産、Supply、状態を表示する。
- Droneは費用、上限、Worker、Required Power、現在／最大Vision、Supply、状態を表示する。
- Power Supply ON/OFFと給電順位を説明する。
- Build Turn、disabled、recovering、無給電、Supply外の差を同じ「停止」だけで表現しない。

## 17.5 Strategic Warning

強い順に次の階層とする。

```text
Critical: Guaranteed Defeat
High: current Resource shortage / high Queue Pressure
Warning: Single Point of Failure / Fuel shortage / no-gain Checkpoint move
Info: low / medium Queue Pressure and normal Forecast
```

- 警告の正データはCore Forecastだけとし、UI独自計算を作らない。
- Mobile 390×844でCritical Warning、Horde Warning、Turn、資源を折りたたみ領域だけへ隠さない。

## 17.6 Asset・Legend

- Wind、Simple Farm、Civilian Drone Baseの通常Zoom／LOD AssetとFallbackをUI専用Asset Registryへ追加する。
- Board Legend、盤面、Helpは同じRegistryとCore状態Mappingを使用する。
- Runtime PNG合計3 MiB以下の現行上限を維持する。
- Asset Path、Load状態、LODはGameState、Save、Observation、Replayへ含めない。

---

# 18. GameAction・Core境界

最低限、次を追加または拡張する。

```text
Move                 // Fuel検証・消費
SetPowerSupply       // Constructible Facility対応
BuildConstructibleFacility
AssignWorkers        // Constructible Facility対応
EndTurn              // Wind -> Power Fuel -> Unit Refuel -> Production
```

- UI、Agent、Headlessは同じGameActionをGameEngineへ渡す。
- UI独自のFuel、Build、Power、Forecast合法性を持たない。
- Candidate Query、`getLegalActions()`、実Actionは同じCore Validationを使う。
- Forecast QueryはState、Resource、Action回数、PRNGを変更しない。
- Game CoreへPhaser、DOM、Asset Path、UI状態を入れない。

---

# 19. Save・Replay・Artifact

- Map ID、Unit Fuel、Wind状態、Constructible Facility、Power Supply、Build／Recovery時点、Strategic Forecastの元StateをSaveする。
- Forecast、Supply、Vision、上限、Queue Pressure等の導出値は正データから再計算し、重複する可変正データにしない。
- 同一Version、Config、Map、Seed、Action列からUnit Fuel、Fuel配分、発電、施設状態、Vision、Supply、結果を一致させる。

Artifact Schema 2.0.0では次を行う。

- 固定Map情報をゲーム単位で1回だけ保存する。
- TurnごとのObservation Traceは`mapId`で固定Mapを参照し、Terrain、Road、恒久Facility座標を重複保存しない。
- 所有、感染、Power、Constructible Facility、Unit、Enemy、Visibility等の動的情報はTraceへ残す。
- Replay Loaderはゲーム単位固定MapとTurn動的情報から検証可能なObservationを再構成する。
- Live Agent ObservationとBrowser Bridgeは完全Observationを返し、参照差分形式へ変更しない。
- State Delta Replayはv1.4.0対象外とする。

---

# 20. Metrics

最低限、次を追加する。

## Map・Mobility

- mapWidth／mapHeight
- humanHexesMovedByType
- maxSingleMoveDistanceByType
- longMoves6PlusByType

## Fuel

- unitFuelConsumedByType
- unitFuelRefilledByType
- commissioningFuelByType
- turnsUnitsEndedOutOfSupplyByType
- unitsUnableToMoveForFuel
- stateFuelSpentOnPower
- stateFuelSpentOnUnits
- fuelShortageTurns

## Wind

- windPowerGenerated
- windDisabledTurns
- windOverruns
- windRecoveries

## Constructible Facility

- simpleFarmsBuilt／Destroyed
- simpleFarmFoodProduced
- droneBasesBuilt／Destroyed
- maxDroneVisionRadius
- constructibleFacilityOverruns
- constructibleBuildRejectedByReason

## Strategic Readability

- guaranteedDefeatWarnings／Ignored
- resourceSinglePointFailureTurnsByResource
- checkpointMovesWithNoSupplyGain
- checkpointQueuePressureTurnsByClass

- Hidden Enemyを推測できるMetricsは現行の完全検証Artifact境界を維持し、Production Observation、公開Event、Browser Bridge Artifactへ出さない。

---

# 21. Test要件

## 21.1 Map

- 31×31、Capital、4 Entrance、Road、17恒久Facility、初期Unit、初期Zombie 6体の座標
- Terrain生成順、180度回転集合、重複なし、Waterなし
- 4支線接続、距離15、Sector決定性
- 初期所有FacilityがSupply 5内、外部Facilityが複数Supply外
- 初期Zombie安全距離と初回Turn未到達
- Constructible用Plain候補数

## 21.2 Movement・Fuel

- Movement Budget 10とTerrain Cost
- Hex数基準のPolice／National Guard Fuel表
- Fuel不足拒否とState／PRNG不変
- Hidden Enemy途中停止時の実移動Fuel
- Supply内EndTurn補給、Supply外補給なし
- Unit ID昇順Round Robin
- Power優先、Unit補給後の残Fuel
- 当Turn Refinery生産利用禁止
- 新Unitの有償・部分補給
- Unit死亡時Fuel喪失
- Save／Replay一致

## 21.3 Wind

- Worker割当拒否
- Fuel 0で15 Electricity
- Wind優先割当と不足分だけFuel消費
- Vision 1、Supply Sourceでない
- Zombie Target 5が人口・Defeat・Consumptionへ入らない
- Zombie占有、再確保、次Player Turn復旧

## 21.4 Constructible Facility

- Plain、Roadなし、Supply内、費用、上限、Action消費
- Hidden Zombie非漏洩と同居後処理
- Build Turn操作不可、次Turn解禁
- Power Supplyと確定割当順位
- Supply外の増員拒否、減員・既存機能継続
- Type別上限と消滅後再建
- 手動／不足人口0では残存、感染人口0では消滅
- 感染者Pool除去とNormal Zombie 2体生成
- Empty占有、disabled、recovering、復旧

## 21.5 Simple Farm

- Worker 0..10
- Power 5全量給電
- Food 5／worker、最大50
- 無給電0
- Zombie Targetと実人口一致

## 21.6 Drone Base

- Worker 0..5
- Vision `workers * 2`
- PowerなしVision 0
- Shared Visibility反映
- Supply Sourceにならない
- 空施設Zombie Target 0

## 21.7 Forecast・公平性

- Resource Dependencyと仮想最大Facility喪失
- Single Point of FailureとcurrentlyShortの分離
- Guaranteed DefeatのFood／Civilian Goods順
- Zombie、潜伏感染、将来乱数をGuaranteed Defeatへ含めない
- Checkpoint Projected Supply Effect
- Queue Pressure境界0／10／11／20／21
- UI、Observation、Balanced AgentのCore結果一致
- QueryによるState／PRNG不変
- Hidden Enemy情報非漏洩

## 21.8 Artifact

- 固定Mapがゲーム単位で1回だけ保存される。
- Turn Traceから固定Map重複が除かれる。
- Replay再構成とLive Observationの意味が一致する。
- Schema不一致を状態変更なしで拒否する。

---

# 22. Simulation・Playtest

## 22.1 感度分析

次の全12組合せをRandom／Balancedの同一Seed 1..100で比較する。

| 軸 | 値 |
|---|---|
| Police／Guard maxFuel | `12／22`, `6／11` |
| Simple Farm Food／worker | `5`, `10` |
| Final Horde Turn | `30`, `35`, `40` |

標準Configは`12／22`、Food 5、Final Turn 30とする。

主要観測:

- 勝率、Game Over Reason、Final Turn
- Food、Fuel、Civilian Goods不足
- Single Point of Failure継続Turn
- Simple Farm／Drone建設率
- Unit Fuel切れ、長距離移動、Supply外Turn
- Power／Unit別Fuel消費
- Checkpoint Supply拡張量とno-gain移動
- Horde Spawnから接触までのTurn
- Unit Loss、Civilian Loss

## 22.2 合否とRelease確認

- 技術的失敗0、決定性、Replay一致、Hidden情報非漏洩を必須とする。
- 特定勝率を機械的な合否条件にしない。
- 重大な破綻が見つかった場合は、確定要件を黙って変更せず、要件変更として記録して再検証する。
- Release前に標準ConfigのBalancedを固定Seed 1..300で完遂する。
- Random／Balancedの標準固定Seed 1..100をUnit／Invariant Testと別に完遂する。

---

# 23. 実装順

1. Version、型、Config、固定Map、Map Test
2. Unit Fuel、Wind、経済ForecastのCore実装
3. Constructible Facility共通State／Action／Validation
4. Simple Farm、Drone、感染・Recovery
5. Strategic ForecastとCheckpoint Candidate拡張
6. Observation、API、Save、Replay、Artifact Schema
7. Balanced／Random AgentとMetrics
8. Human UI、Asset、日英Help／Legend
9. Unit／Invariant／Browser Test、感度Simulation
10. Release前Seed 1..300、Build、Pages、Portable Package
11. 確定要件を現行仕様へ反映し、実装・Help・Testとの整合確認

Game Core境界、共有型、経済処理順、統合、競合解消、最終検証は分割実装しても単一の責任範囲として扱う。

---

# 24. 完成条件

1. Appが`1.4.0`、内部契約が本書のVersion表と一致する。
2. 31×31固定Mapが座標付録と一致し、4支線、17施設、初期Zombie 6体を持つ。
3. Human UnitがMovement 10とType別Fuelを使い、発電後の残Fuelから決定的に補給される。
4. WindがFuelなし15 Electricity、Vision 1、Zombie Target 5、Disable／Recoveryで動作する。
5. Simple FarmとDrone BaseがSupply内Plainへ建設でき、費用、上限、Power、人口、感染、消滅、Recoveryが確定Ruleどおり動く。
6. FuelとPower ForecastがWind、発電、Unit補給、Refinery生産を分離し、EndTurn実績と一致する。
7. Strategic ForecastがSingle Point of Failure、Guaranteed Defeat、Projected Supply、Queue Pressureを公開情報だけから返す。
8. UI、Agent、Headless、Browser Bridgeが同じGameAction、Validation、Forecastを使用する。
9. Save、Replay、ArtifactがVersion境界と決定性を満たし、固定Map重複を削減する。
10. Balanced Agent 4.0.0が経済敗北、冗長化、Fuel、Drone、Supply効果を公開Observationだけから評価する。
11. Mobile／Desktop UI、日英Help、Board Legend、Asset Fallbackが新要素を説明・操作できる。
12. 全Unit Test、不変条件試験、Browser Smoke、Seed Simulation、Build、Pages、Portable Packageが成功する。
13. 実装完了後に本書が現行仕様へ漏れなく反映され、旧文書がarchiveへ整理される。

---

# 25. 設計意図

Wind、Fuel、Checkpoint、Simple Farm、Drone、Forecastを独立した追加機能にしない。

- Windが発電用Fuelを解放する。
- 解放したFuelでUnitを長距離展開する。
- Checkpoint前進でSupplyとPlain建設可能域を拡張する。
- Droneで前方を確認し、Simple FarmでFood単一障害点へ備える。
- Forecastによって、戦闘上優勢でも国家が崩壊する状態をPlayerとAgentが同じ公開情報から理解する。

この連鎖が一つのLogistics Systemとして機能することをv1.4.0の成功基準とする。
