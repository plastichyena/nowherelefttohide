# Nowhere Left to Hide PoC v1.5.4 アップデート要件 ドラフト

- ドラフト作成日: 2026-09-07
- 状態: **ドラフト。未実装・未検証。**
- 対象Release: `1.5.4`
- 基準: [Nowhere Left to Hide PoC 現行仕様](./Nowhere%20Left%20to%20Hide%20PoC%20現行仕様.md)（v1.5.3）
- 目的: v1.5.3で確認されたHorde進行停止・Final Horde観測上のRejected Bonus不一致を修正し、人口過密に対するPlayer選択肢、建造可能な電力・住宅インフラ、電力需要の再調整を追加する。

本書はv1.5.4で変更する部分の実装目標である。変更を記載していないゲーム規則はv1.5.3現行仕様を維持する。本書の「ドラフト」は実装済み・検証済みを意味しない。

---

## 1. 更新範囲

v1.5.4では次を対象とする。

1. Horde ZombieがUnit占有による経路詰まりで恒久停止し得る問題を修正する。
2. 健全民間人口0のPlayer所有CapitalへZombieが到達してもCapitalが陥落しない穴を修正する。
3. Horde Spawn ReserveをMap端1列から2列へ拡張し、大規模WaveとRejected Bonusの配置余裕を増やす。
4. Rejected CounterによるHorde増援、とくにFinal Hordeで「増えていないように見える」問題を調査結果に基づいて修正し、Human／Agent双方でSpawn後の実総数を確認可能にする。
5. Rejected Bonus個体も固定Normal Zombieではなく、当該Waveの非Horde Slotと同じ特殊Zombie抽選Tableの対象にする。
6. Soldier ZombieのAttackを5から10へ変更する。
7. 次回人口配置で過密が発生する場合と、現在のEndTurnで過密追加消費が発生する場合をHuman／Agent双方へ警告する。
8. Constructible Facility「仮設住宅街」を追加する。
9. Constructible Facilityとして「風力発電」を追加する。
10. Wind Power PlantのZombie Target Value 5を廃止し、毎Turn Radius 8の共通Noise Pulseを発生させる。
11. Capital／City／Civilian Factory／Military Factory／Refineryの固定電力需要を引き上げる。
12. Power Plantの発電量をWorker 1人あたり10から15へ引き上げる。
13. Simple Farmの建設Civilian Goodsを15から25へ変更する。
14. Civilian Drone Baseの建設Civilian Goodsを25から50へ変更する。

Mapランダム化、新規Human Unit、新規Zombie Type、最低射程、Zombie同士の重複占有・すり抜け、電力蓄電、住宅専用Resourceは今回の対象にしない。

---

# 2. Horde進行停止の修正

## 2.1 現行実装で確認した停止要因

v1.5.3のHorde Zombieは、Zombie Phase開始時SnapshotでVision内に有効Population Targetがあればそれを選び、なければCapital座標をStrategic Anchorとして選ぶ。Capitalの健全民間人口が0でもTarget自体は消えない。

一方、現行`targetPath`は自分以外の全Unit占有Hexを経路探索上のBlockerとして扱う。Target HexにUnitがいる場合はTarget隣接の空きHexを到着候補にするため、Target周辺がZombieを含むUnitで埋まると`targetPath = null`になり得る。Zombie Phase実行時に`targetPath`がnullの場合、Hordeは別の前進先へ再評価せず、そのTurnを移動0で終了する。

この挙動は一時的な混雑なら自然に解消し得るが、Capital周辺など全個体が同一Strategic Anchorへ集中する地点では自己固定状態を作り得る。

またv1.5.3では、空のOperational CheckpointはZombie占拠だけでも荒廃する一方、健全民間人口0・感染者0のCapitalはZombieがHexへ到達しても`converted = 0`のため通常の感染陥落条件へ入らない。これがCapital周辺の混雑をGame Overで解消しない状態を作り得る。

## 2.2 採用する修正方針

Zombie同士を経路上ですり抜け可能にはしない。現行の次の規則を維持する。

- 1 Hex 1 Unit。
- Human／Zombieを問わず、占有中Hexへ移動終了しない。
- Human Unitへの隣接足止めを維持する。
- 移動中のHuman interception、Army Base interception、Gas死亡効果、Noise、移動終了順を維持する。
- Unit占有Hexを通常の実移動では通過しない。

すり抜けを許可すると「占有Hexへ進入した時点で迎撃・足止めを評価する」という現行Movement契約と衝突するため、v1.5.4では採用しない。

## 2.3 Horde congestion fallback

Horde Zombieだけに、通常Targetへの実経路がUnit占有によって得られない場合の軽量Fallbackを追加する。

通常処理:

1. 従来どおり`Visible Population > Capital`でTargetを決める。
2. 従来どおり、現在Unit占有をBlockerとした`targetPath`を求める。
3. 経路があれば従来どおり移動・迎撃・足止め・攻撃を処理する。

Fallback処理:

1. `targetPath`がnullで、行動開始時にHuman Unit隣接によるpinがなく、即時攻撃対象もない場合だけ実行する。
2. 対象Targetへの**Unit占有を無視したTerrain-only weighted distance field**を求める。同じTargetに向かうHordeが複数いる場合はZombie Phase内だけ共有し、GameState／Saveへ保持しない。
3. 現在のUnit占有、通行可能Terrain、通常Movement Cost、当該HordeのMovement Budgetを使い、既存`findReachablePaths`相当でそのTurnに合法に到達できる空きHexを列挙する。
4. 現在地よりTerrain-only weighted distanceが小さい候補だけを前進候補とする。
5. 最小Terrain-only distance、次に実移動Cost、最後に座標安定順で選ぶ。乱数は使わない。
6. 前進候補がなければ移動0を許容する。Unit重複、強制押し出し、Zombie同士の位置交換は行わない。
7. Fallback移動にも通常の1 Hex進入ごとのHuman interception、Army Base interception、隣接pin、Horde Movement Noiseを適用する。

このFallbackは通常経路探索が成功する大多数のTurnでは実行しない。距離FieldもZombie Phase内のTarget単位で再利用し、Map全体への複数回A*を各Hordeごとに繰り返さない。

## 2.4 空Capitalの占拠

- Player所有Capitalの`workers === 0`かつ`infected === 0`の状態でZombie陣営UnitがCapital Hexを占拠した場合、感染人数0でもCapitalを即時`ruined`として扱う。
- 原因Eventは`zombie_occupation`系の既存Facility陥落経路へ接続し、独立したGame State変更経路を作らない。
- 感染者0なので、その陥落自体から感染者由来Zombieを生成しない。
- `capitalLost`を即時判定し、その後のZombie／Horde処理を停止する。
- Capitalに健全民間人口が残っている場合はv1.5.3の感染・陥落ルールを維持する。単にZombieが接触しただけで即死敗北へ変更しない。

## 2.5 診断

ProductionのHidden情報を増やさず、Verification／developmentだけで次を記録できるようにする。

- Hordeが通常Target pathを取得できなかった回数。
- congestion fallbackを使用した回数。
- fallbackでも前進候補が無かった回数。
- 空Capital占拠による`capitalLost`回数。

Production Agent Observationへ内部TargetやBlocker Unit IDは公開しない。

---

# 3. Horde Spawn Reserveを2列へ拡張

## 3.1 新しいReserve

51×51固定Mapでは、Horde Spawn Reserveを外周1列から外周2列へ変更する。

Reserve条件:

```text
q <= 1
OR q >= 49
OR r <= 1
OR r >= 49
```

- Reserveは392 unique Hexとなる。
- Horde Entrance自体は従来どおりMap最外周のNorth / East / South / West幹線道路端に置く。
- SpawnはEntranceをoriginとして、2列Reserve内の合法空きHexへ決定的に展開できる。
- Player Unitの進入・通過・配置は禁止する。
- Build／Relocate／Activate Checkpointは禁止する。
- Simple Farm、Civilian Drone Base、Temporary Housing、player-built Wind Power Plantを含む全Constructible Facility建設を禁止する。
- Reserve内ZombieへのPlayer Attack、Counterattack、Interception、Damageは従来どおり可能。
- Initial Normal Zombie、Hunter Zombie、Gas Zombieの初期配置候補から2列Reserveを除外する。
- UI overlay／Legend／Agent Mapの`hordeSpawnReserve`は2列を正しく表す。

## 3.2 Map contract

外周2列化はStatic Map contract変更なので、Map IDを新しい固定IDへ更新する。ドラフト時点の予定値は`fixed-51x51-v3`とする。

Save／Replay／Sessionの互換性は新Map shapeを旧Map IDとして黙って扱わない。少なくともMap validation、Save validation、Replay fixedMap validation、Portable package fixtureを更新する。

v1.5.3 Saveの自動migrationを行う場合は、新Reserve内にPlayer Unit／Checkpoint／Constructibleが存在しないことを検証してからStatic Map metadataを更新する必要がある。安全なmigrationを実装しない場合はv1.5.3 Saveを非対応として明示する。

---

# 4. Rejected Counter / Final Horde増援

## 4.1 現行実装調査結果

v1.5.3 Coreでは次を確認した。

- `TurnAwayCheckpointRefugees`はFinal Wave Spawn前ならDirection別`turnedAway`へ人数を加算する。
- Normal／Strict審査不合格も対応Counterへ加算する。
- Wave Spawn時にDirection別3 Counterを合算し、`ceil(rejectedTotal / 5)`を追加個体数として`spawnHordeComposition`へ渡す。
- Final Waveでも同じ処理を通り、全4 DirectionのCounterを適用後にresetする。
- `finalSpawnedCount`および内部`finalHordeSpawned`は実際にSpawnした全個体数を使う。

したがって現行ソース上、Final HordeだけRejected Bonusを無視する一般的なCore分岐は確認できない。

一方、Agent向け公開`horde_spawned` EventはFair Play境界で**実際のSpawn countではなく固定Wave Scheduleからpayloadを再構築**しており、Rejected BonusとHidden特殊Typeを意図的に隠している。このため外部AIはFinal Waveが基礎52体より増えた場合でも、公開Eventだけを見ると52体相当として認識する。

v1.5.4では「Core適用の回帰保証」と「Spawn後の実総数の公開」を両方行い、実装不具合と観測不具合を分離する。

## 4.2 Final Horde Rejected Bonus回帰保証

- Final Wave直前に各Directionへ既知のRejected Counterを設定したfixtureを作る。
- 標準Final Waveの基礎52体に対し、実Spawn総数が`52 + Σ ceil(directionRejected / 5)`になることをCore testで固定する。
- Turn Away、Normal reject、Strict rejectを個別・混合で試験する。
- 以前のPeriodic Waveへ参加してreset済みのDirectionと、非参加で持ち越したDirectionを分けて試験する。
- Spawn placement failure時はCounterをresetせず、部分SpawnをCommitしない既存原子性を維持する。
- Final Group IDへRejected Bonus全個体が含まれ、VictoryのFinal Horde全滅条件に含まれることを試験する。

## 4.3 Spawn後のHuman／Agent公開情報

未来のCounterを事前公開しない既存Fair Play境界は維持する。ただしWaveが成功Spawnした後は、実際に出現した**集約総数**を公開する。

Public `horde_spawned`およびHuman Horde履歴へ次を追加する。

- `baseWaveUnitCount`: Schedule上の基礎総数。
- `actualWaveUnitCount`: Rejected Bonusを含む成功Spawn実総数。
- `reinforced`: `actualWaveUnitCount > baseWaveUnitCount`のboolean。

公開しないもの:

- Direction別Rejected Counter。
- Counterの内訳（Normal／Strict／Turn Away）。
- Direction別Bonus数。
- Hidden個体のID／座標。
- Visibility外の特殊Zombie Type内訳。
- Spawn前の実Bonus数。

Final Wave Spawn後はHuman UI／Agentが「基礎52 / 実出現XX」のように確認できる。これにより外部AIが「Rejected Bonusが発生していない」と誤認しない。

---

# 5. Rejected Bonusの特殊Zombie抽選

v1.5.3のRejected Bonusは追加Normal Zombie固定である。v1.5.4では追加**非Horde Slot**として扱い、当該Waveの既存特殊Zombie抽選Tableへ通す。

- Bonus個体数の算定`ceil(rejectedTotal / 5)`は維持する。
- Bonusは基礎Compositionの置換ではなく追加個体なのでWave総数を増やす。
- 各Bonus Slotは`chooseHordeSlotType`相当の同一決定的抽選を使う。
- 最後の2 Waveより前はGasを候補に含めない。
- 最後の2 WaveではGasを含む現行Tableを使う。
- Riot Zombie、Hunter Zombie、Gas Zombieのper-direction per-wave Capは**基礎SlotとRejected Bonus Slotを合算して共有**する。BonusだからCapを超えない。
- Cap到達Typeを除外後、残りWeightを再正規化する既存規則を維持する。
- Bonus Slotも同じDirectionのWave Group IDと`periodic | final` Horde kindを持つ。
- Final Bonus由来の特殊ZombieもFinal Horde全滅条件に含む。
- Rejected Bonusを理由にHorde Zombie数そのものは増やさない。

内部Metricsは「Rejected Bonus総数」と「Bonus由来Type別数」を検証可能にしてよいが、Production公開では第4.3節の集約総数だけを必須とする。

---

# 6. Soldier Zombie調整

Soldier Zombieの標準値を次へ変更する。

| 項目 | v1.5.3 | v1.5.4 |
| --- | ---: | ---: |
| HP | 20 | 20 |
| Attack | 5 | **10** |
| Movement | 5 | 5 |
| Range | 1 | 1 |
| Vision | 5 | 5 |
| 最大Attack Charge | 1 | 1 |

- Soldier Zombieは引き続きNormal AI系。
- National Guard死亡時Reanimation、Wave特殊Slot、Rejected Bonus SlotのSoldier Zombieすべて同じAttack 10を使う。
- Help／Legend／Agent API／Unit詳細はConfigから10を表示する。

---

# 7. 人口過密のHuman／Agent警告

## 7.1 目的

v1.5.3はEndTurn Forecastに現在のOvercrowdingと追加Food／Civilian Goods消費を持つが、Playerが人口移送・避難民受入・建設判断を行うための「次回人口配置で過密になる」警告と「このEndTurnで追加消費が確定する」警告を共通構造として扱う。

## 7.2 警告を2種類に分ける

### A. `overcrowding_imminent`

次のPlayer Turn Startまでに**既に公開・決定している人口配置**だけを使って、現在Soft Cap以下のCity系FacilityがSoft Cap超過になると予測できる場合に出す。

対象に含めてよいもの:

- 現在の`approved` Refugees。
- 現在進行中Screening Batchで、Policyと残りTurnから次回配置人数が決定的に求められる部分。
- 既に予約済みで人口移動結果が確定している公開状態。

対象に含めないもの:

- 将来のRefugee Arrival人数の未確定RNG。
- 潜伏感染抽選結果。
- Hidden Enemyによる将来損失。
- Playerがまだ選んでいないAction。

Public Facts例:

```text
facilityId
currentPopulation
softCap
projectedPopulation
projectedExcess
```

### B. `overcrowding_penalty_projected`

現在の`forecastEndTurn()`でOvercrowding追加消費が1以上なら出す。

Public Facts例:

```text
cities
additionalFood
additionalCivilianGoods
```

## 7.3 Human UI

- Crisis Strip／Overviewの共通公開Projectionを使い、独自UI計算を作らない。
- `overcrowding_imminent`はWarning、`overcrowding_penalty_projected`はWarningとする。
- EndTurn自体は合法のまま。
- 同じ原因を毎renderでToast連打しない。状態遷移で新規発生・悪化した場合に通知し、常設Strip／Overviewで再確認できる。
- 対象City／Temporary Housingを選択できる導線を持たせてよい。

## 7.4 Agent

- Crisis Summaryへ安定Reason Codeを追加する。
  - `overcrowding_imminent`
  - `overcrowding_penalty_projected`
- Agent ObservationとSession Compact Responseで同じPublic Factsを返す。
- Balanced Agentの既存`reduce_overcrowding` PriorityはこのProjectionを使い、独自に未来RNGを推測しない。
- Temporary Housing建設が合法で、過密回避に有効な場合は候補評価へ加える。

---

# 8. Constructible Facility「仮設住宅街」

## 8.1 基本定義

日英名:

- 日本語: `仮設住宅街`
- 英語: `Temporary Housing`
- Core Type案: `temporaryHousing`

標準値:

| 項目 | 値 |
| --- | ---: |
| Build Civilian Goods | **50** |
| Worker / Resident Soft Capacity | **10** |
| Required Power | **5** |
| Food production | 0 |
| Civilian Goods production | 0 |
| Military Goods production | 0 |
| Fuel production | 0 |
| Supply source | No |
| Build count limit | **なし** |

## 8.2 建設条件

- Player Supply Network内。
- Base TerrainがPlain。
- Road Hexではない。
- Horde Entranceではない。
- 2列Horde Spawn Reserveではない。
- Facility／Checkpointが存在しない。
- Player Unitが存在しない。
- 可視Zombieが存在しない。
- Hidden Zombieは建設候補・合法性を妨げない既存Fair Play境界を維持する。
- `BuildConstructibleFacility`の共通Actionを拡張し、専用の直接State変更経路を作らない。
- Build Action 1回を消費する。
- 建設Turn中は`building`、次Player Turn Startから通常利用可能とする既存Constructible timingを維持する。

## 8.3 City扱い

Temporary Housingは人口処理上のCityとして扱う。

- `isCityFacility`へ含める。
- City Population SnapshotのSupply／Reception対象となる。
- City間人口移送のfrom／to対象となる。
- Approved Refugeesの自動配置先となる。
- Overcrowding Soft Cap判定の対象となる。
- Soft Cap 10までは優先的な空きCapacityとして使い、既存`distributeToReceptionCities`のSoft Cap充填順に参加する。
- 10を超えて人口を持つ場合は通常Cityと同じOvercrowding追加消費を発生させる。
- Police／Riot Policeなど既存`city`系Recruitment Facilityを許可するUnit Typeでは、Temporary HousingもCity系Recruitment Hubとして扱う。
- Civilian Goods生産は0。Capital／通常Cityの1人あたりCivilian Goods生産を継承しない。

Power 5はRequired Power Demandへ含める。給電不足でも既存住民を即時消滅・強制退去させないが、FacilityはPower不足状態をHuman／Agentへ表示する。

## 8.4 陥落

- Constructible Facilityとして扱う。
- Zombie／感染により陥落条件を満たした場合、Temporary Housing自体はMapから消滅する。
- 陥落時感染者は既存Constructibleの`zombieSpawnPopulationPerUnit`と隣接Spawn上限を使ってZombieへ変換する。
- 配置不能分を既存Constructibleと同様にPopulation death／verification metricへ処理する。
- 陥落したTemporary Housingを恒久Ruined FacilityとしてMapへ残さない。
- 住民0・感染0の空Temporary HousingへZombieが到達した場合の処理は他のConstructible規則へ揃え、無限にZombie Targetになる状態を作らない。

## 8.5 Asset方針

2020年代のアメリカで大規模災害後に避難民を収容する仮設住宅群をイメージする。

推奨Visual:

- 複数のプレハブ住宅／モジュラーハウス／コンテナ型住宅。
- 白～薄灰色の簡易外壁、規則的な列配置。
- 小型発電・配電設備、仮設照明、給水タンク、簡易道路、フェンス等で「一時的な住宅インフラ」と分かる。
- 軍事基地・刑務所・スラム表現へ寄せない。
- テントだけのキャンプではなく、数か月～年単位の避難生活を想定したFEMA系Temporary Housing Siteに近い印象とする。
- 既存Comic-painted top-down Asset style、256×256 transparent PNG、LOD／Fallback規則へ従う。

---

# 9. Constructible Wind Power Plant

## 9.1 基本定義

既存`windPowerPlant` TypeをPlayer建造可能にする。性能は既存Wind Power Plantを共有する。

| 項目 | 値 |
| --- | ---: |
| Build Civilian Goods | **100** |
| Workers | 0 |
| Fixed Power Generation | **15** |
| Required Power | 0 |
| Supply source | No |
| Player-built count limit | **`state.map.roadBranches.length`** |

標準固定Mapでは幹線道路支線数4なので、Player-built Wind Power Plantは最大4基。初期固定Wind Power Plantはこの「Player-built count」へ数えない。

## 9.2 建設条件

Temporary Housingと同じStatic Constructible条件を使う。

- Supply内。
- Plain。
- 非Road。
- 非Horde Entrance。
- 非Horde Spawn Reserve。
- Facility／Checkpoint／Player Unit／可視Zombieなし。

既存Windと同じFacility Type／Production Ruleを共有し、別の`constructedWindPowerPlant` Typeを作らない。

## 9.3 状態遷移

- 建設Turnは`building`、次Player Turn Startから`operational`。
- Worker配置Actionは持たない。
- Zombie占拠時は既存Wind Power Plantと同じ`disabled`／Recovery規則を使用する。
- Constructibleだからという理由だけで陥落時に完全消滅させず、Wind専用の既存Disabled Facility規則を優先する。
- Decommission Actionは今回追加しない。

---

# 10. Wind Power Plant Noise

## 10.1 Zombie Target Value廃止

Wind Power Plantの`zombieTargetValue = 5`を廃止し、`0`へ変更する。

Zombieの通常Population Target候補へWind Power Plantを「人口5人相当」として直接入れない。

## 10.2 毎Turn Noise

Player所有かつ`operational`なWind Power Plantは、各EndTurnにつき1回、自身のHexをCenterとしてRadius 8の共通Noise Pulseを発生させる。

- 初期固定WindとPlayer-built Windの両方に適用する。
- Worker不要。
- Supply内外を問わない。
- `disabled`、`building`、`recovering`、非Player所有状態では発生しない。
- 同じ施設が1Turnに複数Pulseを出さない。
- 複数Windがある場合はFacility ID安定順で1基ずつPulseを生成する。

## 10.3 Timing

Internal Infection処理後、Zombie PhaseのTarget Snapshotを作る直前にWind Noiseを積む。

```text
ECONOMY
REFUGEES
INTERNAL INFECTION
WIND NOISE EMIT
ZOMBIE TARGET SNAPSHOT
ZOMBIE MOVE / COMBAT
HORDE SPAWN
```

この順序により、そのEndTurnのZombie PhaseでNormal AI系ZombieがWind Noiseへ反応可能とする。

## 10.4 共通Noise規則

- Source Kindへ`windPowerPlant`を追加する。
- Normal AI系Zombieは反応する。
- Horde Zombieは反応しない。
- Terrainで減衰しない。
- 既存Noise Target Priority `Visible Population > Horde継承 > Noise > Idle`を維持する。
- Fallen SiteのNoise Respawnも共通Noise規則として発生する。
- Radius 8は公開ルールとする。
- CenterはPlayer所有Facilityの公開位置なのでHuman／Agentへ公開してよい。
- `noise_emitted` Public Eventは`sourceKind: windPowerPlant`、facility ID／位置、Radius 8を安全に表せるようにする。

---

# 11. 電力需要・発電量の再調整

## 11.1 Required Power

| Facility Type | v1.5.3 | v1.5.4 |
| --- | ---: | ---: |
| Capital | 5 | **10** |
| City | 5 | **10** |
| Temporary Housing | - | **5** |
| Farm | 5 | 5 |
| Civilian Factory | 5 | **15** |
| Military Factory | 5 | **20** |
| Refinery | 5 | **10** |
| Civilian Drone Base | 5 | 5 |
| Army Base recruitment reservation | 5 | 5 |
| Simple Farm | 0 | 0 |
| Power Plant | 0 | 0 |
| Wind Power Plant | 0 | 0 |

「それ以外は現状維持」とする。

## 11.2 Power Plant

Power Plantの物理発電Capacityを変更する。

```text
v1.5.3: workers × 10
v1.5.4: workers × 15
```

- Worker Capacity 30は維持。
- Fuel消費はv1.5.3の`実割当電力5につきFuel 2`を維持する。
- 発電可能量が15刻みになっても、総Available Generation Capacity／割当は既存の5 Capacity単位で扱う。
- Wind fixed generation 15は維持する。
- Same-turn production、Fuel timing、Unit refill timingは変更しない。

## 11.3 Power allocation order

既存Priority Orderを維持し、新Temporary HousingはCity系Tierへ含める。

City系Tier内の安定順は既存secured order／ID規則へ従う。Temporary Housingだけを常にCapitalより先・後にする独自Priorityは追加しない。

---

# 12. Constructible Cost変更

| Facility | v1.5.3 | v1.5.4 |
| --- | ---: | ---: |
| Simple Farm | 15 | **25** |
| Civilian Drone Base | 25 | **50** |
| Temporary Housing | - | **50** |
| Player-built Wind Power Plant | - | **100** |

- Civilian Drone BaseのDecommission refundは既存の「Build Costの半額・ceil」規則を維持するなら25となる。
- Simple Farm／Temporary Housing／Windに新しいrefundは追加しない。
- UI、Agent API、Legal Action、候補ProjectionはConfig値から表示し、固定文字列を持たない。

---

# 13. Constructible共通設計の拡張

v1.5.3の`ConstructibleFacilityType = simpleFarm | civilianDroneBase`前提を一般化する。

v1.5.4対象Type:

```text
simpleFarm
civilianDroneBase
temporaryHousing
windPowerPlant
```

LimitはTypeごとに定義する。

- Simple Farm: `roadBranches.length`（既存）。
- Civilian Drone Base: 既存式を維持。
- Temporary Housing: unlimited。
- Player-built Wind Power Plant: `roadBranches.length`。

`unlimited`を巨大な数値で表現せず、Limit有無をConfig／validatorで明示する。

Position Candidate生成は4 Typeに対応するが、巨大な全Map候補を通常Compact Agent responseへ常時重複させない。既存Query／Pagination境界を維持する。

---

# 14. Human UI変更

最低限次を追加する。

- Constructible選択にTemporary HousingとWind Power Plantを追加。
- 建設Cost、Power、Capacity、Output、Limitを表示。
- Temporary HousingにResident 0～10 Soft Capacity、Overcrowding状態を表示。
- WindにFixed Power 15、毎TurnNoise Radius 8を表示。
- Horde Card／HistoryでWave Spawn後の`baseWaveUnitCount`と`actualWaveUnitCount`を表示。
- Horde Spawn Reserve overlayを2列へ拡張。
- Soldier Zombie Attack 10をUnit panel／Legendへ反映。
- Overcrowding imminent／penalty warningをCrisis UIで表示。
- Power demand変更をFacility panel／Power Forecastへ反映。

UI独自のBonus計算、Overcrowding未来RNG推測、Constructible合法性計算を作らない。

---

# 15. Agent / Browser Bridge / Session変更

## 15.1 Observation

Agent Observationは次を追加・更新する。

- Facility Type `temporaryHousing`。
- Constructible `windPowerPlant`。
- Temporary HousingのResident Capacity／Power／production 0。
- Windの毎TurnNoise Radius 8公開ルール。
- 2列`hordeSpawnReserve`。
- Soldier Zombie Attack 10。
- Overcrowding Crisis Reason 2種。
- Spawn済みWaveの`baseWaveUnitCount`／`actualWaveUnitCount`または同等の公開Event情報。

Spawn前のRejected Counter、Direction別Bonus、特殊Type抽選結果は公開しない。

## 15.2 Legal Actions

- `BuildConstructibleFacility`で`temporaryHousing`と`windPowerPlant`を受理する。
- API schema／examples／`query construction`／`legal-actions`を更新する。
- Hidden Zombieを理由にAgentだけ建設候補を除外しない。

## 15.3 Balanced Agent

- Soldier Zombie Attack 10を公開Observationから評価する。
- `overcrowding_imminent`／`overcrowding_penalty_projected`を`reduce_overcrowding`へ接続する。
- Temporary Housingは、過密回避効果、Civilian Goods 50、Power 5、Supply内建設位置を評価する。
- Windは、Fixed Power 15とCivilian Goods 100に加え、毎TurnNoise 8が敵を誘引するTrade-offを評価する。
- NoiseによるHidden個体反応数を推測しない。

Random AgentはLegal Actionsから新Constructibleを通常どおり扱う。

---

# 16. Version / Save / Replay境界

今回の変更はStatic Map、Facility Type、Game Rules、Agent Observation、Replay shapeへ影響するため、Versionを同一Release内で一貫して更新する。

ドラフト時点の予定:

| Contract | v1.5.3 | v1.5.4予定 |
| --- | --- | --- |
| App | 1.5.3 | **1.5.4** |
| Game Rules | 5.0.0 | **6.0.0** |
| Save Format | 12 | **13** |
| Agent API | 10.0.0 | **11.0.0** |
| Observation API | 10.0.0 | **11.0.0** |
| Browser Bridge API | 10.0.0 | **11.0.0** |
| Artifact Schema | 9.0.0 | **10.0.0** |
| Checkpoint / Session Schema | 6.0.0 | **7.0.0** |
| Balanced Agent | 5.0.0 | **6.0.0** |

Random AgentはAction schema互換処理だけならVersion据え置きでもよいが、Artifact metadataとRelease validationで一意に識別できるようにする。

v1.5.3 Replay Artifactをv1.5.4 Coreで「同じRule」として再生しない。旧Artifactは旧Releaseで保持する。

---

# 17. Test / Acceptance Criteria

## 17.1 Horde stall

最低限次を固定fixture化する。

1. Capitalへ向かう複数Hordeが互いに経路を塞いでも、通常pathが無い後続個体が合法な空きHexへfallback前進する。
2. FallbackはHuman Unit／Zombie Unitをすり抜けない。
3. Fallback中にHuman interceptionが起きたら既存順序で停止する。
4. Fallback中にArmy Base interceptionが起きたら既存順序で停止する。
5. Human隣接pin中はfallbackしない。
6. 空CapitalへZombieが到達したら`capitalLost`になる。
7. Capitalに健全民間人口が残る通常ケースは従来感染処理を維持する。
8. fallback tieは乱数を消費せず決定的。

## 17.2 Spawn Reserve

- Reserve unique count 392。
- 2列すべて`playerOccupancyAllowed=false`。
- それ以外はtrue。ただし別の既存Static occupancy制約は維持。
- Human Move、Checkpoint、4 Constructible TypeがReserveへ入れない。
- Initial Normal／Hunter／GasがReserveへ出ない。
- 標準Final 52体に加え十分大きいRejected Bonus fixtureでも全個体を配置できるケースを作る。
- 配置不能時のAtomic Failureを維持する。

## 17.3 Rejected Bonus

- Turn Away 1～5人でBonus 1 Slot、6～10人で2 Slot。
- Normal／Strict rejectも加算。
- Direction参加WaveだけCounter reset。
- Final 4方向へ全Counter適用。
- Core実総数を厳密比較。
- Public EventはSpawn前Counterを漏らさず、Spawn後のBase／Actual総数だけを返す。
- Bonus Slotが特殊Tableを使い、Riot／Hunter／Gas Capを基礎Slotと共有する。
- Same Seed / Same StateでBonus Type列が完全決定的。

## 17.4 Overcrowding

- 現在Penaltyありで追加Food／Civilian Goodsと警告が一致。
- Approved Refugees等の決定済み次回配置でSoft Cap超過を予測。
- 未確定Arrival RNGは警告へ使わない。
- Human CrisisとAgent Crisisが同じReason／facts。
- Temporary Housing追加で過密予測が解消するfixture。

## 17.5 Temporary Housing

- Cost 50。
- Plain／Supply内のみ。
- Build limitなし。
- Capacity 10。
- City Snapshot Supply／Receptionへ参加。
- Refugee placement／Transfer／Recruitment hubとしてCity同等。
- Civilian Goods production 0。
- Required Power 5。
- Overcrowding対象。
- 陥落でFacility消滅、感染者由来Zombie Spawn。

## 17.6 Wind

- Constructible Cost 100。
- Player-built limit = road branch count。
- Fixed generation 15。
- Worker不要。
- `zombieTargetValue=0`。
- Operational owned Wind 1基につき毎TurnNoise 1回、Radius 8。
- Normal AIが反応しHordeは反応しない。
- Multiple WindはID安定順。
- Disabled WindはNoiseを出さない。

## 17.7 Economy

固定値を回帰試験する。

```text
Capital 10
City 10
Temporary Housing 5
Farm 5
Civilian Factory 15
Military Factory 20
Refinery 10
Drone 5
Army Base reservation 5
Power Plant 15 / worker
Simple Farm build 25
Drone build 50
```

Fuel 2 per allocated electricity 5は維持する。

## 17.8 End-to-End

- Human UI build／load／play。
- Browser Bridge。
- AgentGame Replay。
- AI Portable Session `new/status/play-turn/query/artifact`。
- Balanced multi-seedでFinal Horde Spawn後に最低1Turn以上継続するRun。
- Rejected Bonus付きFinal Hordeを通過する専用fixture。
- Horde ZombieがFinal Spawn後に複数Turn連続で「Targetを持つ・攻撃対象なし・fallback可能なのに移動0」とならないことを検証する。

---

# 18. Performance / Determinism要件

- Horde congestion fallbackは通常path成功時に追加Map-wide探索を行わない。
- Terrain-only distance fieldはZombie Phase内の同Targetで共有し、Save／Artifactへ保持しない。
- Constructible Type増加により通常Compact responseへ全Map候補を常時載せない。
- 4 Constructible TypeのPosition Candidate全件生成はQuery時または必要時に限定し、既存Cache／Revision境界を維持する。
- Wind Noiseが複数基あってもPulseごとの全Map再計算を避ける。Normal AI側は既存pending Pulse選択を再利用する。
- Same Seed、Same Config、Same Action列でState／RNG／Event列が決定的であること。

---

# 19. Documentation / Asset更新

実装完了時に最低限次を更新する。

- `Doc/Nowhere Left to Hide PoC 現行仕様.md`
- `README.md`
- `PLAY_WITH_AI.md`
- `public/agent-api.html`
- Human Help／Legend／i18n
- Board Asset Registry
- `public/assets/board/ASSET_MANIFEST.md`
- Release validation fixture／performance evidenceの必要箇所

新Asset:

- `facility_temporary_housing.png`
- Player-built Windは既存`facility_wind_power_plant.png`を再利用する。

Temporary Housingの生成・後加工・出所をAsset Manifestへ記録する。

---

# 20. v1.5.4完了条件

次をすべて満たした時点でv1.5.4実装完了とする。

1. Horde congestion fixtureで恒久stallを再現でき、修正後は解消する。
2. Zombie同士のすり抜け・重複占有を導入せず、既存迎撃／pin順序を維持する。
3. 空Capital占拠が`capitalLost`へ進む。
4. Spawn Reserveが外周2列392 Hexになる。
5. Rejected Bonus付きFinal WaveでCore実総数が期待値と一致する。
6. Human／AgentがSpawn後のBase／Actual総数を確認できる。
7. Rejected Bonus Slotが特殊Zombie抽選TableとCapを使用する。
8. Soldier Zombie Attack 10が全経路へ反映される。
9. Overcrowding imminent／penalty警告がHuman／Agentで共通Projectionになる。
10. Temporary HousingがCity人口プールとして機能し、陥落時に消滅・Zombie Spawnする。
11. Player-built WindがCost 100、最大4基、Fixed Power 15で建設できる。
12. Wind Target Value 5が廃止され、Operational Windが毎TurnRadius 8 Noiseを発生する。
13. 新しいPower Demand／Power Plant generation／Constructible CostがForecastと実処理で一致する。
14. Unit、Core、Agent、Session、Save、Replay、UIの回帰試験が成功する。
15. 現行仕様、README、Agent documentationを実装結果へ更新する。
