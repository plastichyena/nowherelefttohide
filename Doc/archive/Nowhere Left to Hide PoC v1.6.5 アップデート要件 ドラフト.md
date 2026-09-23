# Nowhere Left to Hide PoC v1.6.5 アップデート要件 ドラフト

> Status: Archived / v1.6.5確定版へ統合済み。現行判断には使用しない。
> Base: v1.6.4  
> 作成日: 2026-09-23  
> 主な根拠: v1.6.4 Claudeプレイテスト、および現行 main 実装確認

## 0. 目的

v1.6.5では、v1.6.4 Claudeプレイテストで確認されたAI向けQuery / Preview APIの使い勝手を改善し、大規模戦闘TurnにおけるAIとの往復量を削減する。

同時に、経済・電力・Horde Wave・Zombie AIのバランスを調整し、新施設 **Air Base / 空軍基地**、新ユニット **Multipurpose Helicopter / 多目的ヘリコプター**、新Action **Military Drone Launch / 軍用ドローン発進**、および航空輸送システムを追加する。

航空システムは多目的ヘリコプター専用の場当たり的な例外処理にせず、将来の航空ユニット追加にも利用できるよう、Ground / AirのMovement Domain、Occupancy、Targeting Capability、Cargo、Temporary Visionを共通ルールとして実装する。

Game Rules、Agent API、WebMCP、Replay、Normal UIの間で同じ状態・情報公開ルールを維持する。

v1.6.5はUnit / Facility / Map / Save / Replay / Session / Observationの構造変更を伴うため、v1.6.4以前のSave / Replay / Session / Checkpoint / Artifactとの互換性は持たせない。旧データは保管したまま、新規v1.6.5ゲームを開始する。

---

# 1. v1.6.4プレイテスト由来のAgent API改善

## 1.1 生産が合法でない理由を事前取得可能にする

v1.6.4の **legal-actions** は合法なActionのみを返すため、ProduceUnitが候補に存在しない場合、

- Production Slotが埋まっている
- 完成後の配置先が塞がっている
- Population不足
- Resource不足
- Facility状態不良
- Unit固有のLifetime Production Limit到達

等のどれが原因かを事前に判別できない。

**legal-actions自体は後方互換のため「合法Actionのみ」の意味を維持する。**

代わりに、新しいQuery Target **production-candidates** を追加する。

少なくとも以下を返す。

- facilityId
- unitType
- legal
- reasonCode
- reason
- populationCost
- civilianGoodsCost
- militaryGoodsCost
- fuelCost
- productionTurns
- productionSlotOccupied
- readyTurn
- projectedPlacementHex
- placementReasonCode
- lifetimeProducedCount
- lifetimeProductionLimit

代表的reasonCode:

- production_slot_occupied
- production_destination_blocked
- insufficient_population
- insufficient_civilian_goods
- insufficient_military_goods
- insufficient_fuel
- facility_not_owned
- facility_not_operational
- unit_not_producible_here
- lifetime_production_limit_reached

特に多目的ヘリコプターの1ゲーム生涯1機制限には、一般的なproduction_limit_reachedではなく **lifetime_production_limit_reached** を使用する。

実際に違法Actionを送った場合も、Session層で一律 action_not_legal に丸めず、CoreのValidationで得られた具体的reasonCodeを返す。

## 1.2 Worker減員時のPopulation移動先をPreviewへ追加

AssignWorkers等で施設から住民を減らした場合、減らしたPopulationがどのCity / Capital / Temporary Housingへ戻るかをAction実行前に確認できるようにする。

Previewへ以下を追加する。

### populationMovements

- fromFacilityId
- toFacilityId
- people
- reason

### facilityResidentDeltas

- facilityId
- before
- after
- delta

Capitalのbefore / afterだけを返す既存Previewは維持してよいが、Population移動の完全な判断材料として全移動先を公開する。

Preview結果と実Action適用結果は、乱数を伴わないPopulation再配置について完全に一致させる。

## 1.3 可視Enemy専用Queryを追加

既存 **units** QueryはPlayer Unit専用のまま維持する。

新たに **enemies** Queryを追加し、現在Playerから可視のEnemy Unitだけを返す。

Observationと同一のFog of War / Visibility Ruleを使用し、新しい隠し情報は公開しない。

少なくとも以下を返す。

- id
- type
- position
- hp
- attack
- range
- movement
- vision
- attackChargesRemaining
- maxAttackCharges
- canMove
- canAttack
- isScheduledWaveMember
- isFinalWaveMember
- canTargetAir

これにより、直前ActionのObservationを保存していなくても最新のEnemy状態をQueryだけで再取得できる。

## 1.4 checkpoint_supply_zombie_blockedの原因Enemy IDを公開

Checkpoint Candidateが **checkpoint_supply_zombie_blocked** となった場合、原因となるEnemyを以下で返す。

- blockingEnemyIds: string[]

対象は、

- 現在Playerから可視
- 実際にそのCandidateをBlockしている

Enemyだけとする。

複数存在する場合はすべて返す。

不可視Enemyの存在をこのフィールドによって新たに漏らしてはならない。

## 1.5 Batch Preview

WebMCP / Session APIへ複数Actionを一度にPreviewできるBatch Previewを追加する。

入力された複数Actionは、すべて同一baseRevisionの**現在Stateから独立に**Previewする。

前のPreview結果を次のActionへ順番に適用するSequence Simulationにはしない。

主な用途:

- 複数移動候補をまとめてPreview
- 複数建設候補をまとめてPreview
- 複数砲撃候補をまとめてPreview
- 複数Drone偵察候補をまとめてPreview
- 複数生産候補をまとめてPreview

Batch PreviewはLive State / Live RNG / Action Sequence / Event Sequence / Revisionを変更しない。

Artillery Scatter、Emergency Landing等の未確定乱数結果は予言しない。

## 1.6 全部隊Attack Candidate Query

新しいQuery Target **attack-candidates** を追加する。

unitIdを指定した場合はそのUnitだけ、unitIdを省略した場合は現在の全Player Unitについて攻撃候補をまとめて返す。

各候補には最低限以下を含める。

- attackerId
- targetId または targetHex
- distance
- legal
- reasonCode
- projectedAttack
- militaryGoodsCost
- projectedMilitaryGoodsRemaining
- attackChargesRemaining
- counterattackPossible
- interceptionRelevant
- friendlyFirePossible
- artilleryPreview該当情報

Enemy対象は現在可視のものだけとする。

大規模戦闘TurnでUnitごとにlegal-actions / previewを数十回往復する必要を減らすことを目的とする。

---

# 2. Temporary Housing / 仮設住宅

Temporary Housingは**過密回避・Population収容専用施設**へ変更する。

v1.6.5では、Temporary Housingから発生するCivilian Goods生産を完全に廃止する。

これは「固定生産0」だけではなく、以下をすべて含む。

- 固定Civilian Goods生産 = 0
- Worker / Resident 1人あたりCivilian Goods生産 = 0
- Resident数に比例するCivilian Goods生産 = 0
- Worker数に比例するCivilian Goods生産 = 0
- Forecast上のResident Rated Output = 0
- Production Capacity上のResident Output = 0

**何人収容していてもCivilian Goods生産は常に0。**

Temporary Housingの役割は、

- Population収容
- 過密回避
- Refugee受け皿

のみとする。

Config上すでにoutputsが空であっても、City系共通ロジック、Resident Output、Forecast、Help、UI、Replay、Agent APIのいずれにもPopulation比例Civilian Goods生産が残らないことをAcceptance Testで確認する。

---

# 3. 施設要求電力を一律2倍

v1.6.4でPower Requirementが0より大きい施設は、要求電力を一律2倍にする。

Power Requirementが0の施設は0のままとする。

| Facility | v1.6.4 | v1.6.5 |
|---|---:|---:|
| Capital | 10 | **20** |
| City | 10 | **20** |
| Farm | 5 | **10** |
| Temporary Housing | 5 | **10** |
| Civilian Factory | 15 | **30** |
| Military Factory | 20 | **40** |
| Refinery | 10 | **20** |
| Civilian Drone Base | 5 | **10** |
| Army Base | 5 | **10** |
| Air Base | - | **10** |
| Simple Farm | 0 | 0 |
| Power Plant | 0 | 0 |
| Wind Power Plant | 0 | 0 |
| Nuclear Power Plant | 0 | 0 |
| Oil Field | 0 | 0 |

発電量そのものは変更しない。

Config Validation内のExpected Power Capacityにも新値を反映し、Forecast / Public Config / Helpを一致させる。

---

# 4. Military Goods生産レート変更

Military Factoryの1 Workerあたり生産レートを以下へ変更する。

- Civilian Goods **2消費**
- Military Goods **1生産**

つまり、

**Civilian Goods 2 → Military Goods 1**

とする。

v1.6.4の Civilian Goods 1 → Military Goods 4 から大幅に変更される。

Military Goodsを使用する、

- Soldier
- Recon Team
- Special Forces
- Field Artillery
- Multipurpose Helicopter
- Army Base / Air BaseのLocal Military Goods
- Attack / Refill / Upkeep

を含め、固定Seedで経済回帰試験を行う。

---

# 5. Help / Board Legend整理

Help本文の説明が複数箇所へ分散している状態を整理する。

大分類を最低限以下へ整理する。

- Victory / Defeat
- Economy & Population
- Power
- Facilities
- Human Units
- Zombie Units
- Supply
- Vision / Noise
- Horde Waves
- Construction
- AI / Fair Play

「ルールそのもの」と「Board上のアイコンやAssetが何を表すか」を分離する。

Field ArtilleryのBoard上の見た目・Packed / Deployed Asset説明はHelp本文ではなくBoard Legendへ移動する。

Board Legendには少なくとも以下を追加・整理する。

- Field Artillery Packed
- Field Artillery Deployed
- Air Base
- Multipurpose Helicopter Landed
- Multipurpose Helicopter Airborne
- Military Drone Vision

同一説明をHelpとBoard Legendで重複させない。

---

# 6. Zombie AIの航空対応

## 6.1 基本方針

v1.6.4のZombie AIの基本挙動、

- 可視Population Target優先
- Horde Target継承
- Noise Target
- Capital Anchor
- Congestion Fallback

等は維持する。

ただし**Airborne状態の航空Unitを通常Zombie AIのTarget候補から除外する。**

Airborne Unitは通常Zombieにとって、

- Visible Population Target
- Immediate Attack Target
- Movement Target
- Counterattack Target
- Interception Target

にならない。

## 6.2 Hunter / Pack例外

以下のみAirborne Unitを攻撃可能とする。

- Hunter Zombie
- Pack Zombie

Unit Typeのif分岐を各Combat箇所へ散らさず、共通Capability **canTargetAir** を導入する。

- Hunter Zombie: canTargetAir = true
- Pack Zombie: canTargetAir = true
- その他Zombie: canTargetAir = false

Airborne HelicopterとHunter / Packが同一Hexへ存在する場合も攻撃不能にならないよう、対航空TargetingではRange 1 UnitについてHex Distance 0～1を有効攻撃距離とする。

Landed HelicopterはGround Unit扱いなので、すべてのZombieから通常通りTarget / Attack対象となる。

---

# 7. Horde Wave調整

## 7.1 Special Zombie抽選Weight

v1.6.5ではGas ZombieとHunter Zombieの抽選Weightを3倍の15へ変更し、その分Normal枠を減らす。

| Type | Weight |
|---|---:|
| Normal Zombie | **45** |
| Police Zombie | 10 |
| Soldier Zombie | 10 |
| Riot Zombie | 5 |
| Hunter Zombie | **15** |
| Gas Zombie | **15** |
| Screamer Zombie | 5 |

Normal ZombieがWave Roster抽選で選ばれた場合、v1.6.4と同様にHorde Zombieへ正規化する。

Gas Zombieの方向別上限は設けない。これはv1.6.4で既に撤廃済みであり、回帰要件として維持する。

Hunter Zombieは既存の **1方向につき最大1体** を維持する。

## 7.2 Wave総数を各方向+10%

各方向の基本Wave Unit数を1.1倍し、端数は切り上げる。

| Turn | v1.6.4 / direction | v1.6.5 / direction |
|---|---:|---:|
| 10 | 8 | **9** |
| 20 | 8 | **9** |
| 35 | 15 | **17** |
| 50 | 12 | **14** |
| 70 | 16 | **18** |

固定Horde Slotは現在値を維持し、増加分はVariant / Special抽選Slotへ加える。

したがって基本構成は、

- T10: Fixed Horde 5 + Variant Slots 4
- T20: Fixed Horde 3 + Variant Slots 6
- T35: Fixed Horde 8 + Variant Slots 9
- T50: Fixed Horde 5 + Variant Slots 9
- T70: Fixed Horde 8 + Variant Slots 10

とする。

Refugee Reject Bonus Slotはこの基本数とは別に従来通り追加する。

---

# 8. Nuclear Power Plant早期確保期限

Nuclear Power Plantの早期確保Reward期限を、

**Turn 20 → Turn 10**

へ変更する。

Turn 10以内に条件を満たして確保した場合:

- Special Forces Reward

Turn 10を経過して未確保の場合:

- Pack Zombie Spawn

Turn 10以前でもNuclear Power Plantが陥落した場合:

- Pack Zombie Spawn

deadline値をEngine内へハードコードせずConfigへ置く。

Air Baseでも同型の早期確保Objectiveを使用するため、Nuclear専用処理を複製せず、期限付きFacility Objectiveの共通処理へ整理する。

---

# 9. Air Base / 空軍基地

## 9.1 基本仕様

固定Map内に**1施設のみ**配置する。

基本Facility仕様はArmy Baseと同じとする。

- Neutral Facility
- Capture可能
- 中立時の反撃あり
- Worker Capacity / Infection / Fall / Recoveryの基本処理はArmy Base準拠
- Power Requirement = 10
- Local Military Goods / Interception系の共通処理を可能な限りArmy Baseと共有する

Air Baseで生産可能なUnitは以下のみ。

- Soldier
- Multipurpose Helicopter

仕様書上の **Soldier / 兵士** は既存内部Unit Type **nationalGuard** を指す。

新規Unit Type soldierは追加しない。

Player向けDisplay NameはSoldier / 兵士、内部互換IDはnationalGuardを維持する。

Air BaseではField Artillery、Police、Riot Police、Recon Team等は生産できない。

## 9.2 早期確保Objective

Turn 10以内に初回確保した場合:

- Regular Special Forces ×1

Turn 10を経過して未確保の場合:

- Air Base位置にPack Zombie ×1

Turn 10以前でもAir Baseが陥落した場合:

- Air Base位置にPack Zombie ×1

Nuclear Power Plantと同じ共通Timed Facility Objective処理を利用する。

## 9.3 初期配置

Air Base候補地点を複数用意し、Seeded RNGで1地点を選択する。

条件:

- Army Baseと重複しない
- 他Facilityと重複しない
- Horde Spawn Reserveと重複しない
- Ground Unitが到達可能
- Road Accessを生成可能
- Initial Zombieの視界内に入らない

Army Base / Air Baseの両方の位置を先に確定してからInitial Zombie配置候補を作る。

Initial Zombieごとの実際のVision値に従って、Army BaseとAir Base双方のVisibility除外を行う。

Fixed Map IDを更新する。

---

# 10. Military Drone Launch / 軍用ドローン発進

新規Action **LaunchMilitaryDrone** を追加する。

## 10.1 実行条件

- Air BaseをPlayerが所有
- Air Baseが使用可能状態
- ActiveなMilitary Drone Visionが存在しない
- 必要Fuelを国家Fuel Stockから支払える
- Target HexがMap内

## 10.2 Fuel Cost

TargetはMap内の任意Hex。

距離制限なし。

Fuel Cost:

**hexDistance(Air Base, Target Hex) × 5**

FuelはAir Base専用Poolではなく、**国家Fuel Stockから消費**する。

## 10.3 Vision

Target Hexを中心にHex Distance **10** の視界を確保する。

Drone Visionは地上Unitの通常Visionとは別のTemporary Vision Sourceとして実装する。

- Terrainによる地上視線遮蔽を無視
- 対象範囲のTile / Facility / Enemyを通常Player Visibilityへ統合
- 未公開Wave Roster等の隠し情報は公開しない

## 10.4 持続

発進Turnを含む**5 Player Turn**持続する。

例:

Turn 20で発進した場合、T20～T24は有効。T25 Player Turn開始時に視界を削除し、同時に再発進可能になる。

Active中の再発進はRejectする。

## 10.5 Preview

Previewでは最低限以下を返す。

- target
- distance
- fuelCost
- currentFuel
- resultingFuel
- visionRadius
- activeThroughTurn
- legal
- reasonCode

---

# 11. Multipurpose Helicopter / 多目的ヘリコプター

内部Unit Typeは **multipurposeHelicopter** とする。

## 11.1 Production

生産場所:

**Air Baseのみ**

生産コスト:

| 項目 | 値 |
|---|---:|
| Population | **2** |
| Civilian Goods | **100** |
| Military Goods | **140** |
| Fuel | **500** |
| Production Time | **1 Turn** |

Production Fuel 500は発注時に国家Fuel Stockから確保・消費し、完成したHelicopterをFuel 500の状態で配備する。

### Lifetime Production Limit

多目的ヘリコプターは**1ゲームを通して生涯1機のみ生産可能**。

- Pending Productionは上限に含む
- 完成後はLifetime Produced扱い
- 撃墜・破壊されても枠は戻らない
- 死亡後の再生産は禁止
- Productionが成立前にForfeitされた場合の扱いは既存Lifetime Production共通機構に合わせる

生涯上限到達時のAgent API reasonCodeは、

**lifetime_production_limit_reached**

とする。

## 11.2 基本Stat

| Stat | Value |
|---|---:|
| HP | **100** |
| Recruit ATK | **13** |
| Range | **2** |
| Vision | **10** |
| Military Goods Pool | **40** |
| Fuel Pool | **500** |
| Airborne MP | **50** |
| Landed MP | **0** |
| Air Movement Cost | **1 / Hex** |
| Fuel Cost | **5 / MP** |
| Attack MG Cost Range 1 | **2** |
| Attack MG Cost Range 2 | **4** |
| Attack Noise Radius | **8** |
| End Turn Noise Radius | **15** |

通常のHuman Unit Experienceシステムへ参加させる。

Regular / VeteranのAttack倍率・Attack Chargeは、特別指定のない部分について既存Human Unit共通ルールを利用する。

## 11.3 Flight State

Artilleryのpacked / deployedとは別に、Helicopter専用Flight Stateを持つ。

- landed
- airborne

新規Action:

- TakeOff
- Land

### Landed状態から開始したTurn

TakeOff後に移動できる。

ただし同じTurnにはLandできない。

つまり、

TakeOff → Move

は可能。

TakeOff → Move → Land

は不可。

### Airborne状態から開始したTurn

移動後にLandできる。

つまり、

Move → Land

は可能。

この状態管理は単なるcanMoveフラグだけでなく、「このPlayer TurnにTakeOffしたか」を明示的に保持してValidationする。

## 11.4 Airborne Movement

Airborne時:

- MP 50
- Terrainに関係なく1Hex = 1MP
- Mountain / Forest / Water等のGround Movement Costを無視
- Ground Unit / Zombieと同一Hexへ滞在可能
- Facility上空へ滞在可能
- Ground Occupancy制限を受けない
- Map外および明示的に禁止された領域へは移動不可

移動したMP ×5 Fuelを消費する。

## 11.5 Landed

Landed時:

- MP 0
- Ground Unit扱い
- Ground Occupancyを使用
- 他Ground Unitとの同一Hex滞在不可
- Enemy Ground Unitとの同一Hex着陸不可
- Player Occupancy / TerrainのGround制限を受ける

Military GoodsおよびFuelの補給は、

- Landed
- Supply Network内

の両方を満たした場合のみ行う。

Airborne状態ではSupply Hex上空でも補給されない。

## 11.6 Combat / Interception

Airborne中は、

- Hunter Zombie
- Pack Zombie

以外のZombieからAttack / Counterattack / Interceptionを受けない。

Hunter / PackだけがAirborne HelicopterをTarget可能。

Landed状態では全Zombieに対して通常Ground Unitとして扱う。

## 11.7 Noise

Attack時:

- Noise Radius 8

Player Turn終了時:

- 現在Hexを中心に必ずNoise Radius 15を発生

移動・攻撃を行っていない場合でも発生する。

このEnd Turn NoiseはHuman Combat Noiseとは別の発生契機だが、既存Fallen Site Noise Respawnへ接続する。

## 11.8 Fuel枯渇時Emergency Landing

移動途中でFuelが0になった場合、そのHexで直ちにEmergency Landing判定を行う。

### Case 1: 現在HexへGround Landing可能で空いている

そのHexで強制着陸する。

### Case 2: 現在HexのGround LayerにZombieが存在

隣接6Hexから、

- Map内
- Ground Landing可能
- Ground Occupancyなし
- Enemyなし

の候補を抽出する。

候補が1つ以上あればGameplay Seeded RNGで1Hexを選び強制着陸する。

### Case 3: 現在HexがWater等でGround Landing不能

Case 2と同様に隣接する合法Landing Hexを検索する。

### Case 4: 合法な隣接Landing Hexが存在しない

Helicopterを破壊する。

### Case 5: Case 4かつ元のEmergency Landing HexにZombieが存在

元HexのZombieを撃破し、Helicopterも破壊する。

この処理はSeeded RNGを使用してReplayで再現可能にする。

Previewでは、

- Emergency Landing Risk
- possibleEmergencyLandingHexes
- noSafeLandingPossible

等は公開してよいが、Live RNGが実際に選ぶLanding Hexを事前に公開してはならない。

## 11.9 Helicopter破壊とReanimation

**多目的ヘリコプター本体はReanimation Sourceにならない。**

Cargoを搭載していないHelicopterが破壊された場合:

- ZombieをSpawnしない
- Soldier ZombieもSpawnしない

Cargo搭載中にHelicopterが破壊された場合:

1. Helicopterを破壊
2. Cargo Unitも死亡
3. Cargo Unit Typeに対する**既存Reanimation Rule**を適用
4. Helicopter本体由来のSoldier Zombieは追加しない

したがって、Cargo Reanimationは既存定義に従う。

- Police → Police Zombie
- Riot Police → Riot Zombie
- Soldier / internal nationalGuard → Soldier Zombie
- Recon Team → 既存Recon Team Reanimation Rule
- Special Forces → 既存Special Forces Reanimation Rule

Recon Team / Special Forcesについて新しい例外Typeを作らず、現在のUnit Catalog / Human Unit Reanimation設定をそのまま使用する。

---

# 12. Infantry CapabilityとHelicopter Transport

## 12.1 Infantry判定

以下のHuman Unitに **infantry** Capabilityを付与する。

- Police
- Riot Police
- Soldier / internal nationalGuard
- Recon Team
- Special Forces

以下はInfantryではない。

- Field Artillery
- Multipurpose Helicopter

個別Unit Type比較をBoard / Disembark実装各所へ散らさず、共通Capabilityとして判定する。

## 12.2 Cargo Capacity

Multipurpose HelicopterはInfantry Unitを**最大1 Unit**搭載可能。

CargoはUnit PopulationではなくUnit単位で管理する。

## 12.3 Boarding

新規Action:

**BoardAircraft**

条件:

- Helicopterがlanded
- Cargo Slotが空
- 対象Unitがinfantry
- InfantryがHelicopterの隣接1Hexに存在
- InfantryがそのTurnにBoarding可能な状態

HelicopterはLanded時にGround Occupancyを使用するため、搭乗前のInfantryをHelicopterと同一Hexへ移動させる必要はない。隣接Hexから直接搭乗する。

搭乗後:

- InfantryをMap Occupancyから除外
- 独立Visionを提供しない
- 独立Supply判定を行わない
- Target / Attack対象にならない
- Move / Attack / Suppress等を行えない
- Observation上はtransportedByUnitIdを公開する

BoardingはCargo側InfantryのそのTurnの行動を消費する。

Helicopter側のMovementはBoardingだけでは消費しない。

したがって、

Board → TakeOff → Move

は可能。

## 12.4 Disembark

新規Action:

**DisembarkAircraft**

Helicopterがlandedの場合のみ実行可能。

隣接1Hexを明示指定する。

DestinationはGround Unitとして合法な配置先でなければならない。

Reject理由は機械可読にする。

代表的reasonCode:

- aircraft_not_landed
- aircraft_has_no_cargo
- disembark_destination_out_of_bounds
- disembark_destination_occupied
- disembark_destination_enemy_occupied
- disembark_destination_impassable
- disembark_destination_player_occupancy_forbidden

有効な降機先がない場合、理由を通知してActionをRejectする。

DisembarkしたInfantryはそのTurn行動済み扱いとし、次Player Turnから通常行動可能とする。

Airborne状態でTurn開始:

Move → Land → Disembark

は可能。

---

# 13. Movement Domain / Occupancy共通化

現在のMovement Domainがgroundのみであるため、v1.6.5で最低限以下へ拡張する。

**MovementDomain = ground | air**

共通Helper / Capabilityを設ける。

- isAirborne(unit)
- isInfantry(unit)
- canTargetAir(unit)
- occupiesGroundLayer(unit)
- canOccupyGroundHex(...)
- canOccupyAirHex(...)

1Hex 1Unitという既存前提をそのまま全Unitへ適用しない。

Ground Layer:

- 原則1 Unit
- Landed HelicopterはGround Unitとしてカウント

Air Layer:

- Airborne HelicopterをGround Unitと同一Hexに置ける

v1.6.5ではMultipurpose Helicopter同士は生涯1機制限により同時複数機が存在しないため、Air-Air Occupancyの複数機制限は将来拡張扱いでよい。

---

# 14. Air Base / Helicopter Art Assets

## 14.1 Air Base

Air Base専用Facility Assetを追加する。

見た目はArmy Baseと明確に区別し、**滑走路が視認できること**を必須とする。

小縮尺のBoard上でも「航空基地」であることが分かるシルエットとする。

## 14.2 Multipurpose Helicopter

ブラックホークをモチーフにした中型多目的軍用ヘリコプターとしてデザインする。

実在機の厳密な複製ではなく、Nowhere Left to Hideの既存Unit Asset Styleへ合わせた独自ゲームAssetとする。

Landed / Airborneで**別Asset**を用意する。

### Landed Asset

- 地上に接地
- Landing Gear / Ground姿勢が分かる
- **Main Rotorが完全停止していることが明確**
- Rotor Bladeを静止状態で描画
- 飛行中に見えないこと

### Airborne Asset

- 飛行姿勢
- **Main Rotorが稼働・回転していることが明確**
- Rotor Blur等を使用してLanded Assetと一目で区別可能
- Ground Shadow等は既存Board Styleに合わせる

State-aware Asset ResolverがFlight Stateを見て、

- multipurpose_helicopter_landed
- multipurpose_helicopter_airborne

を切り替える。

Normal Game / Replay / WebMCP Live Viewerのすべてで同じAsset Resolverを使用する。

---

# 15. Agent APIへの航空情報公開

Player Unit Observationへ航空Unit用の公開状態を追加する。

Multipurpose Helicopterでは最低限以下を返す。

- flightState
- movementDomain
- currentFuel
- maxFuel
- currentMilitaryGoods
- maxMilitaryGoods
- cargoUnitId
- cargoUnitType
- canTakeOff
- canLand
- canBoard
- canDisembark
- canRefuel
- canResupplyMilitaryGoods

Cargo Infantry側Observationでは、

- transportedByUnitId

を返す。

Enemy Observationには、

- canTargetAir

を返す。

Drone Visionについては、

- active
- sourceFacilityId
- center
- radius
- startedTurn
- expiresBeforeTurn
- relaunchAvailable

を公開する。

---

# 16. Preview要件

v1.6.5で追加する航空Actionも既存Preview原則に従う。

## TakeOff

- legal / reasonCode
- resultingFlightState
- resultingMovement
- sameTurnLandingAllowed = false

## Land

- legal / reasonCode
- destination occupancy reason
- resultingFlightState
- supply / refill eligibility

## BoardAircraft

- legal / reasonCode
- cargoUnitId
- resultingCargoState

## DisembarkAircraft

- legal / reasonCode
- destination
- destinationReasonCode

## LaunchMilitaryDrone

- distance
- fuelCost
- resultingFuel
- visionRadius
- activeThroughTurn

## Multipurpose Helicopter Production

- lifetimeProducedCount
- lifetimeProductionLimit = 1
- lifetime_production_limit_reached
- cost / readyTurn / placement information

PreviewはLive RNGを進めない。

Emergency LandingのランダムDestination、Artillery Scatter等を事前に確定値として公開しない。

---

# 17. Replay / Determinism

以下はすべてCore側のSeeded RNGで決定する。

- Air Base seeded placement
- Initial Zombie placement
- Horde Wave roster
- Artillery Scatter
- Emergency Landing candidate selection
- Zombie AI tie break
- Cargo死亡後の既存Reanimationで乱数を使用する既存処理

UI / Replay / WebMCPは結果を描画するだけとする。

Replayには最低限以下のEvent / State Changeを再現可能な形で記録する。

- Air Base Objective update
- Military Drone launch / expire
- TakeOff / Land
- Helicopter movement / fuel consumption
- Emergency Landing
- Helicopter destruction
- Board / Disembark
- Cargo death / reanimation
- End Turn helicopter noise

---

# 18. Map / Initial Placement要件

Air Base追加に伴いFixed Map schema / validation / mapIdを更新する。

Initial Zombie candidate selectionは、

- Capital安全距離
- Army Base Vision exclusion
- Air Base Vision exclusion
- Facility occupancy
- Initial Human occupancy
- Impassable terrain

をすべて満たす候補から行う。

Army Base / Air BaseのSeeded Placement RNG順序を固定し、Save / Replay / Testで同じSeedから同じMapを生成できること。

既存Seed検証関数もAir Baseを含める。

---

# 19. Config / State設計

最低限以下をConfig / Stateへ追加・整理する。

## Facility

- airBase
- timedFacilityObjective共通設定

## Human Unit

- multipurposeHelicopter
- movementDomain
- canTargetAir
- infantry
- productionLimitPerGame
- productionFuel
- flight configuration
- transport capacity

## UnitState

- flightState
- tookOffTurn
- cargoUnitId またはTransport State
- transportedByUnitId

Cargo Unitをstate.unitsから完全削除して別Object化すると既存Unit Lifecycle / Statistics / Replayが複雑になるため、Unit Identityは維持しつつMap Occupancyから除外する方式を優先する。

## Temporary Vision

- sourceKind: militaryDrone
- sourceFacilityId
- center
- radius
- startTurn
- expireTurn

## Timed Facility Objective

Nuclear / Air Baseで共有可能な、

- facilityId
- rewardDeadlineTurn
- rewardState
- failureSpawnState
- rewardUnitType
- failureUnitType

相当を共通化する。

---

# 20. 実装順序

推奨順:

**Agent Validation Reason伝播**  
→ **production-candidates / enemies / attack-candidates / Batch Preview**  
→ **Worker Population Preview / Checkpoint blocker IDs**  
→ **Temporary Housing完全0化**  
→ **Power Requirement ×2**  
→ **Military Factory 2:1**  
→ **Horde Weight / Wave Size変更**  
→ **Nuclear deadline 10**  
→ **Ground / Air Movement Domain共通基盤**  
→ **Ground / Air Occupancy分離**  
→ **Zombie canTargetAir Capability**  
→ **Timed Facility Objective共通化**  
→ **Air Base Map Placement / Capture / Production**  
→ **Military Drone Temporary Vision**  
→ **Multipurpose Helicopter Production / Lifetime Limit**  
→ **Flight State / Fuel / Movement**  
→ **Combat / Interception / Noise**  
→ **Emergency Landing**  
→ **Infantry Capability / Cargo**  
→ **Board / Disembark**  
→ **Cargo死亡 / Reanimation**  
→ **Help / Board Legend**  
→ **Assets**  
→ **Replay / WebMCP / Regression / Playtest**

---

# 21. 必須Regression / Acceptance Test

## Agent API

1. ProduceUnitが違法な理由をproduction-candidatesだけで事前取得できる。
2. 実際の違法ActionもCoreと同じreasonCodeを返す。
3. Multipurpose Helicopter生涯上限到達時にlifetime_production_limit_reachedを返す。
4. Worker減員Previewと実ActionのPopulation移動先が一致する。
5. enemies Queryが現在可視Enemyのみ返す。
6. enemies QueryだけでEnemy attackChargesRemainingを再取得できる。
7. checkpoint_supply_zombie_blockedが可視Blocker IDを返す。
8. 不可視Enemy IDをblocker情報から漏らさない。
9. Batch PreviewがLive State / RNG / Revisionを変更しない。
10. attack-candidatesの合法候補が個別Validationと一致する。

## Economy

11. Temporary Housingは0人でも10人でもCivilian Goods生産0。
12. Temporary HousingのResident Rated Outputが0。
13. Temporary HousingのProduction Capacity Civilian Goods寄与が0。
14. 各Power-consuming Facilityの要求電力が正確に2倍。
15. Power Requirement 0 Facilityは0のまま。
16. Military FactoryはCivilian Goods 2に対してMilitary Goods 1を生産。

## Horde / Zombie AI

17. Horde Wave各方向の基本数が9 / 9 / 17 / 14 / 18。
18. Gas Zombie Weight = 15。
19. Hunter Zombie Weight = 15。
20. Normal Weight = 45。
21. Gas Zombieに方向別上限が存在しない。
22. Hunter Zombieは最大1 / direction。
23. Normal ZombieがAirborne HelicopterをTargetにしない。
24. Horde ZombieがAirborne HelicopterをTargetにしない。
25. Police / Soldier / Riot / Gas / Screamer ZombieがAirborne HelicopterをTargetにしない。
26. Hunter ZombieがAirborne HelicopterをAttack可能。
27. Pack ZombieがAirborne HelicopterをAttack可能。
28. Landed Helicopterは全Zombieの通常Targetになる。

## Nuclear / Air Base

29. Nuclear Reward DeadlineがTurn 10。
30. Turn 10境界でReward / Failureが仕様通り。
31. Air BaseはMap内に1つのみ。
32. Army BaseとAir Baseが重複しない。
33. Air BaseがInitial Zombieの視界外。
34. Air Base中立時反撃がArmy Base準拠。
35. Air Base Turn 10 RewardでRegular Special Forces。
36. Air Base期限超過でPack Zombie。
37. Air Base期限前陥落でPack Zombie。

## Military Drone

38. 任意Map HexをTarget可能。
39. Fuel Cost = Air Base距離 ×5。
40. 国家Fuel Stockから消費。
41. Vision Radius = 10。
42. 5 Player Turn継続。
43. Active中は再発進不可。
44. Expireと同時に視界が消え再発進可能。
45. Drone Visionが未公開情報を追加公開しない。

## Multipurpose Helicopter Production

46. Production Population = 2。
47. Civilian Goods = 100。
48. Military Goods = 140。
49. Fuel = 500。
50. Production Time = 1 Turn。
51. Air Baseでのみ生産可能。
52. SoldierとHelicopter以外をAir Baseで生産できない。
53. Helicopterは1ゲーム生涯1機。
54. 撃墜後も再生産不可。

## Flight / Occupancy

55. Landed MP = 0。
56. Airborne MP = 50。
57. Air movementはTerrain無関係で1Hex = 1MP。
58. 1MPにつきFuel 5。
59. Airborne HelicopterとGround Unitが同一Hexに存在可能。
60. Landed HelicopterとGround Unitは同一Hex不可。
61. TakeOff → Move可能。
62. TakeOff → Move → Landは同一Turn不可。
63. Airborne開始時Move → Land可能。
64. Airborne補給不可。
65. Landed + Supply内のみFuel / Military Goods補給。

## Combat / Noise / Emergency Landing

66. Helicopter HP = 100。
67. Recruit ATK = 13。
68. Range = 2。
69. Vision = 10。
70. MG Pool = 40。
71. Fuel Pool = 500。
72. Range 1 AttackでMG 2消費。
73. Range 2 AttackでMG 4消費。
74. Attack Noise Radius = 8。
75. End TurnごとにNoise Radius = 15。
76. 移動途中Fuel 0でEmergency Landing。
77. 空きGround Hexならその場へ着陸。
78. Ground Zombie占有時は隣接合法HexからSeeded RNG選択。
79. Water等Landing不能時も隣接合法Hexを検索。
80. 安全なLanding HexなしでHelicopter破壊。
81. 安全なLanding Hexなし＋元HexZombieありでZombieとHelicopter双方破壊。
82. PreviewがEmergency Landingの実乱数Destinationを漏らさない。

## Reanimation

83. CargoなしHelicopter破壊でZombie Spawnなし。
84. CargoなしHelicopter破壊でSoldier Zombie Spawnなし。
85. CargoありHelicopter破壊でCargoも死亡。
86. Cargo Unit Typeの既存Reanimation Ruleを使用。
87. Cargo死亡に加えてHelicopter由来Soldier Zombieを追加しない。
88. Recon Team / Special Forcesも既存Unit CatalogのReanimation先を使用。

## Infantry Transport

89. Police / Riot Police / nationalGuard / Recon / Special ForcesがInfantry。
90. Field ArtilleryはInfantryではない。
91. HelicopterはInfantryではない。
92. Cargo Capacity = 1 Unit。
93. Landed時のみBoard可能。
94. 隣接HexからBoard可能。
95. Cargo UnitがMap Occupancy / Visionから外れる。
96. Board後TakeOff → Move可能。
97. Landed時のみDisembark可能。
98. Disembark先は隣接1Hex指定。
99. 不正Destinationで具体的reasonCode。
100. DisembarkしたUnitはそのTurn行動済み。
101. Airborne開始Move → Land → Disembark可能。

## UI / Assets / Replay

102. Air Base Assetに滑走路が視認できる。
103. Helicopter Landed AssetのMain Rotorが完全停止している。
104. Helicopter Airborne AssetでMain Rotor稼働が明確。
105. Landed / Airborne Assetが一目で識別可能。
106. Normal Game / Replay / WebMCPが同じState-aware Asset Resolverを使用。
107. Field Artillery表示説明がBoard Legendにある。
108. Air Base / Helicopter / Drone VisionがBoard Legendにある。
109. ReplayでDrone、Flight State、Emergency Landing、Cargo処理を完全再現できる。
110. 同じSeed / Action列でCore / Replayの最終State Digestが一致する。

---

# 22. 実装上の注意

- Soldierは表示名であり、内部ID nationalGuardを変更しない。
- Temporary Housingは「Config outputsが空」で終わりとせず、Resident / Worker共通ロジックによるCivilian Goods寄与が完全に0であることを確認する。
- Helicopter本体は一切Reanimationしない。Zombie化する可能性があるのはCargo Unitのみ。
- Cargo Reanimation先を航空輸送専用に再定義せず、既存Unit Catalog / Unit Configのreanimation ruleを唯一のSource of Truthとする。
- Airborne判定をZombie Typeごとのif文で分散実装しない。canTargetAir Capabilityへ集約する。
- Ground / Air Occupancy判定をgetUnitAt等の既存単一Occupancy前提から明示的に分離する。
- Batch PreviewはSequence Plannerではない。全候補を同じbaseRevisionから独立Previewする。
- production-candidates等のIllegal Candidate Queryは既存construction / population-transfers / worker-assignmentsと同じ「合法・違法＋reasonCode」思想へ揃える。
- Military Drone VisionはPlayer Visibilityへ統合するが、Game Rules上非公開のWave rosterや不可視Stateを直接Exposeしない。
- Helicopter Emergency Landing、Horde roster、Objective Spawn等のゲーム結果を決める乱数はCoreだけが消費する。
- Asset生成時にはAir Baseの滑走路、HelicopterのLanded / Airborne差、停止 / 回転Rotorが小縮尺Boardでも視認できることをAcceptance条件とする。

---

# 23. 要件確認の回答記録（確定版へ統合済み）

以下は依頼者との1問1答で確定した変更の履歴。本文と受入条件へ統合した `../Nowhere Left to Hide PoC v1.6.5 アップデート要件 確定版.md` を作成済み。本ドラフトに残る旧記述は現行判断に使わない。実装・検証済みを意味しない。

| 問 | 確定した内容 |
| --- | --- |
| 1 | 着陸中のヘリは自発的攻撃不可、反撃・迎撃のみ可能。 |
| 2 | ターン終了時の半径15の騒音は飛行中のみ。着陸中の戦闘音は別扱い。 |
| 3 | 歩兵は移動後も搭乗可能。攻撃・鎮圧などの後は不可。搭乗で残りの行動を全消費。 |
| 4 | 着陸後は同一ターンに再離陸不可。 |
| 5 | 離陸後の攻撃と攻撃後のその場への着陸を許可。攻撃後の移動は不可。同一ターンに離陸した場合の通常着陸禁止は維持。 |
| 6 | 緊急着陸は同一ターンの離陸後着陸禁止の例外。 |
| 7 | 燃料枯渇地点に味方地上部隊がいる場合も隣接する合法な空き着陸先を検索。候補なしならヘリと搭乗歩兵が死亡、地上の味方は無傷。 |
| 8 | 歩兵搭載可能な輸送ユニットすべての共通搭乗処理として、搭乗先の燃料が0の場合のみ歩兵から燃料を移送する。 |
| 9 | 移送は輸送先の容量まで。超過分は歩兵が保持。 |
| 10 | 燃料移送後、通常の離陸条件を満たせば同一ターンに離陸可能。そのターンに通常着陸・緊急着陸した場合は不可。 |
| 11 | 移動燃料5/MPに加え、飛行状態のターン終了時に燃料1を消費。 |
| 12 | 終了時は飛行騒音→燃料1消費→0なら緊急着陸の順。敵行動前に解決。 |
| 13 | 飛行中の残燃料1～4でも1マス移動でき、全残燃料を消費して移動先で緊急着陸する。 |
| 14 | ヘリは両状態とも施設確保・復旧、検問所復旧、感染鎮圧・封じ込め不可。 |
| 15 | 飛行中のヘリは同Hexの敵へ攻撃可能。距離0の軍需品消費は2。 |
| 16 | 飛行中は野戦砲爆風・Gas死亡爆発の対象外。着陸中は両方の被害を受ける。 |
| 17 | 飛行中は地形防御補正なし。着陸中は通常地上Unitと同じ。 |
| 18 | ヘリの視界は飛行中のみ地形遮蔽を無視。着陸中は通常地上視界規則。 |
| 19 | ヘリの自然回復は着陸中のみ。通常の回復条件も必要。 |
| 20 | 搭乗中の歩兵は維持費を通常どおり負担し、補給・自然回復は停止。 |
| 21 | 降機後はそのターンの移動・自発的攻撃・鎮圧等不可。ただし敵ターンの反撃・迎撃は可能。 |
| 22 | 搭乗したターンの降機は不可。 |
| 23 | 水上でヘリが撃墜された場合、搭乗歩兵は死亡するがZombieは出現しない。 |
| 24 | 通常Zombieも飛行騒音の発生地点へ向かう。ヘリ本体への攻撃・追跡対象判定と分離。 |
| 25 | 空軍基地は期限内確保後の陥落によるペナルティPackを出現させない。 |
| 26 | 空軍基地報酬にはTurn10以内の初回確保、健康な生存者1人以上、未確保中の陥落歴なしを必要とする。質問時の「原発と同じ生存者条件」という説明は不正確。原発は問35により現行条件を維持する。 |
| 27 | 空軍基地初回確保で食料100・軍需品100。期限内の条件を満たせば特殊部隊1隊も追加。兵士の追加報酬なし。 |
| 28 | 発進済み軍用Droneは空軍基地陥落後も期限まで視界を維持。 |
| 29 | Drone発進には給電・補給網接続の両方が必要。 |
| 30 | Wave抽選WeightはNormal40、Police10、Soldier10、Riot5、Hunter15、Gas15、Screamer5の合計100。 |
| 31 | ヘリ初期軍需品40は生産費140に含み追加徴収なし。追加指示としてHunterの方向別個体数上限を撤廃し、同方向複数出現を許可。 |
| 32 | ヘリは必要軍需品未満なら攻撃・反撃・迎撃不可。距離0～1は2、距離2は4が必要。 |
| 33 | ヘリは着陸状態・Recruitで配備。地上配置先が塞がっていれば既存規則で配置待ち。 |
| 34 | 組み込みAIもヘリ生産・戦闘・補給・歩兵輸送とDrone偵察を判断対象にする。 |
| 35 | 原発は期限をTurn10に短縮する以外、現行の報酬条件を維持。生存者抽選・生存者条件は追加しない。 |
| 36 | 空軍基地は報酬条件を満たさない期限内確保でも期限切れPackを回避。確保前の陥落による生成済みPack・出現予約は取り消さない。 |
| 37 | ヘリは飛行・着陸状態を問わず固定軍需品維持費1/ターン。 |
| 38 | 空軍基地の全配置候補へ序盤の地上部隊が地形・経路上Turn10以内に到達可能とする。戦闘・確保成功は保証しない。 |
| 39 | 地上墜落地点が占有済みなら搭乗歩兵の再アニメーション先を最寄り合法Ground Hexへ決定的に移す。全候補が塞がれば出現待ち。水上は問23の出現なしを優先。 |

アセットは要件確定後、このタスクで生成し、採用した画像を実装へ使用する。
