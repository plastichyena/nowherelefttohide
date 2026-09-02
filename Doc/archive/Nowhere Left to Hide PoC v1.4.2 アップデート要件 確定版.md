# Nowhere Left to Hide PoC v1.4.2 アップデート要件 確定版

作成日: 2026-09-02  
確定日: 2026-09-02  
ステータス: 確定版  
対象Release: `1.4.2`

## 1. 文書の位置づけ

本書はv1.4.2で実装するゲームバランス、Game Core、Map Rule、Observation、Agent、Save、Replay、UI、Helpの差分要件を定める。

実装、テスト、動作確認が完了するまでは、安定版仕様の正本を`Doc/Nowhere Left to Hide PoC 現行仕様.md`とする。v1.4.1で導入したAI Portable Session、Unit別Military Goods、Fuel 0 Emergency Movement等は、本書に明記した変更を除いて維持する。

実装と検証の完了後、本書を現行仕様へ反映して実装、テスト、Help、公開APIとの整合を確認する。反映完了までは本書と現行仕様が異なる箇所について、本書を次期実装目標、現行仕様を安定版の判断根拠とする。

## 2. 目的

v1.4.2では次を実現する。

1. 恒久生産施設の電力依存を強め、発電、Fuel、電力配分を経済戦略の主要要素へ戻す。
2. Simple Farmを電力不要の低効率Food源として明確化し、停電時の冗長性を与える。
3. CheckpointのScreening Capacityを引き上げ、長期戦でのQueue過密を緩和する。
4. Hordeを固定Wave Scheduleへ変更し、最大15Turnの再編期間と複数方向の防衛判断を作る。
5. Map外周をHorde Spawn Reserveとし、PlayerによるSpawn地点の占有をCore Ruleで防ぐ。
6. 上記変更をHuman UI、Agent、Save、Replay、Artifact、Session、Metricsへ同じCore判定から公開する。

## 3. Version境界

| 対象 | v1.4.2 |
|---|---|
| App / Release | `1.4.2` |
| Game Rules / GameState / Config | `2.2.0` |
| Fixed Map | `fixed-31x31-v1` |
| Save Format | `7` |
| Agent API | `4.0.0` |
| Observation API | `4.0.0` |
| Browser Bridge API | `4.0.0` |
| Artifact Schema | `3.0.0` |
| Checkpoint Schema | `1.0.0` |
| Session Schema | `1.0.0` |
| Balanced Agent | `4.2.0` |
| Random Agent | `2.2.0` |

- Fixed Mapの寸法、座標、道路支線、Horde Entrance、恒久Facility配置は変更しないためMap IDを維持する。
- Map RuleとしてHorde Spawn Reserveを追加するが、固定Mapの地形・配置自体は変更しない。
- v1.4.1以前のSave、Replay、Artifactを暗黙変換しない。
- AI SessionとCheckpointは従来どおりGame Rules、Schema、Build ID、Map、Configの一致を要求する。
- App Version差だけでは互換データを拒否しない既存原則を維持する。

## 4. スコープ

### 4.1 変更するもの

- FacilityのPower Mode、電力条件、標準出力
- Power allocation、Power Forecast、Strategic Forecast
- `SetPowerSupply`対象とHuman UI
- Checkpoint Screening Capacity、Throughput、Queue Pressure
- Horde Config、State、Warning、固定Wave Schedule
- 複数方向同時Spawn、Spawn Group、Final Horde判定
- Horde Spawn ReserveとPlayer占有制限
- HordeおよびPower関連のObservation、API Info、Agent、Metrics
- Save、Replay、Artifact、Browser Bridge、Help、テスト

### 4.2 変更しないもの

- Fixed Mapの31×31形状、Terrain、Road Branch、Horde Entrance位置
- Zombie / Horde Zombieの基礎HP、Attack、Movement、Targeting
- Unit別Fuel / Military Goods、Fuel 0 Emergency Movement
- Checkpoint Policyの`passThrough / normal / strict`
- Policyごとの審査Turn、受入率、感染率
- Refugee arrival interval / people range
- Checkpoint Active / Standby / Dormant / Fallback
- Fog of War、Noise、Supply Networkの地理判定
- Final撃破後もSupplied AreaのZombieと感染の解消を要求するVictory原則
- AI Portable Sessionのコマンド、排他、Checkpoint、Decision Traceの基本仕様

## 5. Facility電力・生産

### 5.1 Power Mode

v1.4.2の標準Ruleで使用するPower Modeは次の2種とする。

1. `required`: 電力がなければ対象のResource生産または機能が停止する。
2. `none`: 電力を要求せず、電力配分の影響を受けない。

旧`boost` Power Modeは廃止する。旧`industrialBoostDemand`と`industrialBoostAllocated`もGameState、Forecast、Observation、Agent API、Browser Bridge、UIから削除する。

### 5.2 Facility別標準

| Facility | Power Mode | Demand | 未給電／OFF | 給電時または通常出力 | 切替 |
|---|---|---:|---|---|---|
| Capital | required | 5 | Civilian Goods 0 | Civilian Goods 1 / worker（SoftCapまで） | 不可 |
| City | required | 5 | Civilian Goods 0 | Civilian Goods 1 / worker（SoftCapまで） | 不可 |
| Farm | required | 5 | Food 0 | Food 10 / worker | 可 |
| Civilian Factory | required | 5 | Civilian Goods 0 | Civilian Goods 10 / worker | 可 |
| Military Factory | required | 5 | Military Goods 0 | Military Goods 4 / operating worker | 可 |
| Refinery | required | 5 | Fuel 0 | Fuel 5 / worker | 可 |
| Civilian Drone Base | required | 5 | Vision 0 | 既存Vision | 可 |
| Simple Farm | none | 0 | 該当なし | Food 5 / worker | 不可 |
| Power Plant | none | 0 | 該当なし | 既存発電量 | 不可 |
| Wind Power Plant | none | 0 | 該当なし | Electricity 15 | 不可 |

- Farm、Civilian Factory、Military Factoryはv1.4.1の給電Boost時出力をv1.4.2の標準出力とし、未給電時は0とする。
- RefineryはRequired Power 5へ変更し、給電時Fuel 5 / workerを維持する。
- Military FactoryはTurn-start Civilian Goodsを使う既存Input条件を維持する。電力と割当済みInputの両方があるWorkerだけが稼働する。
- Capital / Cityは人口由来Civilian Goodsだけが停止し、人口保持、移住、編成、所有、補給、感染、防衛は停電時も維持する。
- Power Plant / Wind Power Plant自身へ自己給電要件を課さない。

### 5.3 Simple Farm

Simple Farmは電力不要の低効率Food源とする。

- Worker Capacity 10を維持する。
- 常時Food 5 / workerとする。
- Power Demand、Power Boost、`SetPowerSupply`、電力切替UIを持たない。
- `powerMode`は`none`、`powerSupplyEnabled`は公開Schema上不要なら削除し、残す場合も常にfalseの正データとしない。
- Supply外のWorker配置制約等は現行Ruleを維持する。

### 5.4 Power Supply切替

Farm、Civilian Factory、Military Factory、Refinery、Civilian Drone Baseは次に従う。

- 新規確保、建設完了、感染復旧時はPower Supply ONとする。
- 所有中、安全、操作解禁済みなら`SetPowerSupply`でON/OFFを変更できる。
- 切替はResource、Unit行動権、共通Player Action回数を消費せず、同一Player Phase中に何度でも行える。
- OFF時はPower Demand 0かつ対象生産・機能0とする。
- ONでもWorker 0、感染、陥落、未稼働、Military FactoryのInput不成立時はDemand 0とする。
- OFF、電力不足、人口なし、Inputなし、感染、陥落を別のReason Codeで返す。
- Capital / Cityは健全民間人口1人以上なら自動要求し、切替不可とする。

## 6. Power AllocationとForecast

### 6.1 配分順

不足時は次の順で施設単位に5 Electricityを全量配分する。部分給電は行わない。

1. Capital / City
2. Farm / Civilian Factory
3. Turn-start Civilian Goods Inputを1人分以上確保したMilitary Factory
4. Refinery
5. Civilian Drone Base

- Simple Farmは配分対象外とする。
- 各段階内は確保・建設時期が古い順、同順位はFacility ID昇順とする。
- Playerは切替可能施設をOFFにして、後順位施設へ電力を回せる。
- Military Factory Input判定は、給電済みCapital / City / Civilian Factoryの同Turn Civilian Goods予測で市民維持予約を減らした後、残るTurn-start Civilian Goodsを既存の決定的順序で割り当てて行う。

### 6.2 Fuelと発電

- Power Plantの`Fuel 1 → Electricity 5`を維持する。
- Wind Power Plantの固定15 Electricityを維持する。
- 発電FuelはUnit Fuel refillより先に確保する。
- 当Turn Refinery生産Fuelを同Turnの発電またはUnit補給へ戻さない。
- RefineryがOFFまたは未給電なら、そのTurnのFuel生産は0とする。

### 6.3 Forecast / Observation

Electricity Forecastは最低限次を返す。

- physical generation capacity
- fuel-limited generation capacity
- available generation capacity
- required power demand
- required power allocated
- shortage
- Facility別の要求、割当、停止理由

Facility Production Observationは最低限次を返す。

- `powerMode`
- `requiredPowerCapacity`
- 切替対象では`powerSupplyEnabled`
- `projectedPowerRequested`
- `projectedPowerSupplied`
- `projectedPowerReason`
- `baseProduction`
- `projectedProduction`
- `stoppedReason`

Required施設は給電時の標準出力を`baseProduction`とし、未給電またはOFFでは`projectedProduction = 0`とする。Simple FarmはPower Fieldを非該当として扱い、`baseProduction`と`projectedProduction`をFood 5 / workerで一致させる。

Resource ForecastとStrategic ForecastはCoreの実EndTurnと同じ純粋計算を使い、停電に起因するFood、Civilian Goods、Military Goods、Fuel不足とGuaranteed Defeatを反映する。QueryはState、Resource、Action回数、PRNGを変更しない。

## 7. Checkpoint Screening Capacity

### 7.1 CapacityとPolicy

`screeningCapacity`を10から20へ変更する。Capacityは1 Turnあたりの完成人数ではなく、1回のScreening Batchへ入れられる最大人数とする。

| Policy | Screening Turns | Batch Capacity | 理論最大Throughput | Acceptance Rate | Infection Rate | Infected Population Rate |
|---|---:|---:|---:|---:|---:|---:|
| Pass Through | 0 | 20 | 20 / Turn | 100% | 50% | 50% |
| Normal | 2 | 20 | 10 / Turn | 75% | 25% | 25% |
| Strict | 5 | 20 | 4 / Turn | 50% | 0% | 0% |

- 同時に複数Batchを審査しない現行構造を維持する。
- Capacity増加はPolicyの審査時間、感染リスク、受入率を変更しない。
- Activeまたは既存Rule上のRemnantだけが新規Batchを開始する。
- `estimatedScreeningThroughput`はCapacityとPolicy Turnsから再計算する。

### 7.2 Queue Pressure

Queue人数は現行どおり`waiting + screening + approved`とし、次へ固定する。

| Class | 人数 |
|---|---:|
| none | 0 |
| low | 1～20 |
| medium | 21～40 |
| high | 41以上 |

Help、Panel、Observation、Forecast、Balanced Agent、Metricsで同じCore関数を使う。

## 8. Horde Spawn Reserve

### 8.1 Map Rule

Map DefinitionはHorde Spawn ReserveのHex集合を公開の静的Map Ruleとして持つ。Fixed Mapでは次のいずれかを満たす外周1HexをReserveとする。

```text
q = 0
q = 30
r = 0
r = 30
```

判定を移動や建設処理へ個別にハードコードせず、Map Definitionと共通の純粋関数を唯一の判定元にする。将来のランダムMapではGeneratorがMap形状、外周、Horde Entranceに応じたReserve集合を生成できる設計とする。

### 8.2 Player制限

Reserveでは次を禁止する。

- Player Unitの進入、通過、停止
- Player Unitの初期配置、完成時配置、復帰配置
- CheckpointのBuild、Relocate、Activate先
- Constructible FacilityのBuild先
- 将来のRandom MapにおけるPlayer所有Facilityの初期配置

禁止はCore validation、Legal Actions、位置候補、Pathfinding、Save validation、不変条件で共通に適用する。Reason Codeは共通のReserve理由を返し、State／RNGを変更しない。

### 8.3 許可するもの

- Zombie / Horde ZombieのSpawn、進入、通過、停止
- Reserve内Zombieを対象とするPlayer Attack、Counterattack、Interception
- 将来追加する範囲、継続、環境その他のDamage判定
- Vision、Fog of War、Supply、Targeting、射程計算

Reserveは無敵領域ではなく、Player側の占有だけを禁止する。攻撃やDamageにはその時点の通常の視界、射程、Terrain、Combat Ruleを適用する。

### 8.4 公開表示

- 盤面Overlay、Board Legend、Helpで常時識別可能にする。
- Agent API InfoとMap Observationで各HexのPlayer占有可否を機械可読にする。
- Legal Move、Checkpoint、Constructible候補はReserve理由を返す。
- Reserve情報は静的公開Ruleであり、Hidden Zombieの有無によって変化させない。

## 9. 固定Wave Schedule

### 9.1 Config Schema

旧`cycle`、`periodicInitial`、`periodicIncrement`、`finalComposition`、独立した`finalHordeTurn`をConfigから削除する。

```ts
horde: {
  warningLeadTurns: number,
  waves: Array<{
    turn: number,
    directionCount: 1 | 2 | 3 | 4,
    compositionPerDirection: {
      hordeZombie: number,
      zombie: number
    },
    final: boolean
  }>
}
```

`finalHordeTurn`は`final: true`のWaveの`turn`から導出し、UIとObservationでは利便性のため導出値を公開する。

Configは次をすべて満たす場合だけ受理する。

- Waveが1件以上ある。
- `turn`は1以上の整数、昇順、重複なし。
- `directionCount`は1～4の整数。
- Composition値は0以上の整数で、方向ごとの合計が1体以上。
- Normal Zombieを含む場合はHorde Zombieも1体以上含む。
- `final: true`は最後のWaveだけ、かつ必ず1件。
- `warningLeadTurns`は1以上の整数。

不正Configは新規開始、Load、Session ResumeのいずれでもStateとRNGを変更せず拒否する。

### 9.2 標準Schedule

標準`warningLeadTurns`は2とする。

| Wave | Spawn Turn | Direction | 1方向あたりComposition | H総数 | N総数 | 総数 |
|---|---:|---|---|---:|---:|---:|
| 1st | 5 | Random 1方向 | H2 + N1 | 2 | 1 | 3 |
| 2nd | 10 | Random 2方向 | 各 H1 + N2 | 2 | 4 | 6 |
| 3rd | 20 | Random 1方向 | H4 + N4 | 4 | 4 | 8 |
| 4th | 35 | Random 3方向 | 各 H2 + N4 | 6 | 12 | 18 |
| 5th | 50 | 全4方向 | 各 H4 + N5 | 16 | 20 | 36 |

5th WaveをFinal Waveとする。予定総Spawn数はHorde Zombie 30、Normal Zombie 41、合計71とする。初期配置、Facility overrun等による追加Spawnは含めない。

通常の新規ゲーム画面ではWave Scheduleを編集させず、上記標準値を使用する。Config、Headless、Testでは検証済みScheduleを差し替え可能にする。旧6入力のHorde設定UIは削除する。

## 10. 方向抽選とWarning

### 10.1 抽選

- `directionCount < 4`はWarning開始時にSeed付きRNGでNorth / East / South / Westから重複なしに抽選する。
- `directionCount = 4`はRNGを消費せず全方向とする。
- Warning開始はPlayer Turn Startの`spawnTurn - warningLeadTurns`とする。
- 新規Game開始時点ですでにWarning期間なら初期化時に抽選する。
- 抽選結果をGameStateへ保存し、Spawn時やLoad後に再抽選しない。
- Waveごとに独立抽選し、前Waveと同じ方向を許可する。同一Wave内だけ重複を禁止する。
- State、Observation、UI、Spawnの方向配列は`north / east / south / west`の固定順へ正規化する。
- 同Seed、同Config、同Action列から同じ抽選とRNG progressionを得る。

### 10.2 Observation

次Waveについて、Warning前から次を公開する。

- next Wave index
- next Spawn Turn
- turns remaining
- direction count
- composition per direction
- Final flag

Warning前は`warningType = none`、`warningDirections = []`とする。Warning開始後は`warningType = periodic | final`とし、抽選済みの全方向を同時に公開する。

Spawn後は次Waveへ進め、次のWarning開始前なら再び空配列とする。Final Spawn後は次Wave情報を`null`とし、`finalHordeStatus`を公開する。

未警告Waveの方向、将来RNG、Spawn Hex、個体ID、内部Targetは公開しない。Warning前にObservation、Legal Actions、Artifact、Metricsの差から方向を推測できる情報を作らない。

### 10.3 旧Field

Agent / Observation / Browser Bridge API 4.0.0では次を削除し、互換Aliasや暗黙変換を設けない。

- `warningDirection`
- 単一方向を表す旧`direction`
- 旧Horde Config Field一式

## 11. Multi-direction Spawn

### 11.1 Spawn処理

- 同一Waveの全方向を同じHorde PhaseでSpawnする。
- Waveは現行どおり対象TurnのZombie Phase後にSpawnし、そのWaveのZombieは次Turnから行動する。
- 各方向のHorde Entranceを起点に、既存の占有回避、Map境界、Mixed Horde配置条件を使う。
- 方向間の計画・Commit順は`north / east / south / west`へ固定する。
- 各方向は独立したSpawn Group IDを持つ。IDからWave番号と方向を一意に識別できること。
- 各Group内のHorde ZombieとNormal Zombieは同じGroup IDとHorde kindを持つ。
- Group間でTarget memory、Final所属、統計を上書きしない。

### 11.2 原子性

Waveの全方向・全個体の配置計画をStateへCommitする前に検証する。必要個体をすべて決定的に配置できない場合は次に従う。

- 一部方向または一部個体だけをSpawnしない。
- Wave進行、Unit ID、Statistics、Events、RNGを部分更新しない。
- 明示的なTechnical FailureとしてActionをCommitしない。
- Runner、Replay、Session、Human UIで原因を診断可能なErrorを残す。

Fixed Mapと標準ConfigではSpawn Reserveを含む配置余地により全Waveが成立することを自動テストする。

## 12. Final HordeとVictory

- 5th Waveの4方向を一つのFinal Waveとして扱う。
- Final Waveは方向ごとに4つのSpawn Group IDを持つ。
- 4 Groupに属するHorde ZombieとNormal Zombie全36体が死亡した場合だけ`finalHordeDefeated = true`とする。
- 一方向の全滅、Horde Zombieだけの全滅、Supply内のFinal個体だけの全滅では成立しない。
- Supply外へ移動したFinal個体も撃破対象とする。
- Final個体の残数、ID、Hidden位置をVictory Progressから公開しない。
- Final Wave撃破後も即時勝利せず、次をすべて要求する。

```text
finalHordeDefeated
suppliedAreaZombieClear
suppliedAreaInfectionClear
```

- Defeat判定をVictoryより優先する。
- Final Wave後もGame Rule上のTurn Limitを設けない。

## 13. Horde State、Save、Replay

### 13.1 State

Horde Stateは最低限次を保持する。

- next Wave index
- next Spawn Turn
- warned Waveの抽選済み方向
- last Spawn Turn
- current Warning state
- Wave別Spawn済み状態
- Wave別・方向別Spawn Group ID
- Final Wave Spawn Group ID配列
- Final Horde status: `notStarted | active | defeated`

完全な将来方向列を先行生成しない。Warning開始時にだけ抽選する。

### 13.2 Save / Checkpoint

- Save Format 7でWave Configと新Horde Stateを完全保存する。
- Warning済み方向、Wave進行、Group IDを保存し、Load後に再抽選しない。
- Turn 3 / 5、8 / 10、18 / 20、33 / 35、48 / 50のWarning開始、Spawn直前、Spawn直後をRound Tripする。
- AI Session ResumeとCheckpoint分岐後も方向、Composition、Group ID、RNG progressionを一致させる。
- Horde Spawn Reserve内にPlayer UnitまたはPlayer配置物を持つv1.4.2 Stateを不変条件違反として拒否する。

### 13.3 Replay / Artifact / Event

- Replayは全方向のWarning、Spawn、Group、Final判定を再現する。
- Public EventはWave番号、Spawn Turn、Final flag、選択された全方向、方向別予定Compositionを扱える。
- 標準ScheduleとWarning後の方向は公開情報とする。
- Spawn Hex、非可視個体ID、非可視位置、内部Targetは公開Event、Production Artifact、Decision Trace、Browser Bridgeへ含めない。
- 個体情報は通常のFog of Warで視認された時点から公開する。

## 14. Human UI / Help

### 14.1 Power

- Required / noneを明示し、Boost表現を削除する。
- 未給電またはOFFのRequired施設は対象生産・機能の停止を表示する。
- Farm、Civilian Factory、Military Factory、Refinery、Civilian Drone Baseへ切替UIを表示する。
- Simple Farmに切替UIを表示せず、電力不要でFood 5 / workerと説明する。
- Forecastで要求、割当、停止施設、停止理由、Resourceへの影響を確認できる。
- 電力HUDは`requiredPowerDemand / availableGenerationCapacity`を表示する。

### 14.2 Horde

- 次Wave番号、Spawn Turn、残りTurn、方向数、方向別Composition、Final flagを常時表示する。
- Warning開始後は選択された全方向を同時表示する。
- Warning前はRandom方向を表示しない。
- Helpに固定Wave ScheduleとWarning Lead 2を一覧化する。
- FinalがTurn 50の全方向Waveであることを事前公開する。
- 旧Horde設定入力を新規Game UIから削除する。

### 14.3 Spawn Reserve

- 外周を盤面Overlayで常時識別可能にする。
- Board LegendとHelpでPlayer Unitの進入・配置・建設は禁止だが、攻撃とDamageは可能と説明する。
- 不法候補にはCore Reason Codeの日英文言を表示する。

### 14.4 Checkpoint

- Capacity 20がBatch上限であることをHelp、Panel、Observationで統一する。
- Policyごとの審査Turnと理論Throughputを区別して表示する。
- Queue Pressure区分をCapacity 20基準へ更新する。

## 15. Agent / AI Portable

### 15.1 API Info / Observation

`getApiInfo()`は最低限次を機械可読に公開する。

- 全Waveのindex、Spawn Turn、direction count、composition per direction、Final flag
- Warning Lead 2
- Final Horde Turnの導出Rule
- Spawn ReserveとPlayer占有制限
- Power Mode、Facility別需要・出力・切替可否
- Screening Batch Capacity、Policy Turns、Throughput、Queue Pressure閾値

Observationは次を再計算不要な形で返す。

- 次Wave情報と現在の全Warning directions
- Final Horde status
- Map HexごとのPlayer占有可否
- FacilityごとのPower要求、割当、停止理由、Projected production
- Screening Capacity、Throughput、Queue Pressure

### 15.2 Balanced / Random Agent

Balanced Agent 4.2.0は最低限次へ対応する。

- 複数方向Warningを単一方向へ縮約しない。
- 2nd / 4th / 5th Waveで全戦力を一方向へ集中させない。
- 5～15Turnの準備期間に電力、Fuel、Military Goods、人口、Unit数、Checkpoint depthを再評価する。
- 電力起因のGuaranteed DefeatとCritical Resource Dependencyを優先して修復する。
- Simple Farmを電力不要のFood冗長化として評価する。
- Required施設のPower Supply切替で不足資源と将来Fuelを調整する。
- Spawn Reserveへ移動・配置Actionを生成せず、Reserve内のVisible Zombieへの合法Attackは評価する。

Random Agent 2.2.0も新Legal Actionsと同じ公開境界を使い、GameStateを直接参照しない。AI Portable Session / Checkpoint / Decision Traceの操作仕様はv1.4.1を維持する。

## 16. Metrics

最低限次を追加または更新する。

### 16.1 Power

- Facility Type別Power requested / supplied / unavailable Turns
- Power Supply OFF Turns
- 電力不足によるResource別生産損失
- Refinery停電Turn、次Turn Fuel不足との相関
- Simple Farm生産量とFood不足回避Turn

### 16.2 Checkpoint

- Policy別Batch開始人数、完了人数、平均Queue
- Capacity利用率、推定Throughput、Queue Pressure Turns
- 旧Capacity 10を前提とする固定閾値を残さない。

### 16.3 Horde

- Wave別Spawn Turn、選択Direction、H / N Spawn数
- Direction別Spawn数、撃破数
- Wave別撃破数、最終個体撃破Turn
- Final Wave Spawn総数36、Kill総数36
- Final Horde defeated Turn、Turns after Final Horde
- Multi-front時のCheckpoint loss / fallbackとの相関

既存periodic / final集計を残す場合も、固定Scheduleの総数H30 / N41 / Total 71と一致させる。Hidden個体を推測できる内部MetricsをProduction Observation、公開Event、Browser Bridge Artifactへ出さない。

## 17. テスト要件

### 17.1 Power

1. Farm未給電／OFFでFood 0、給電で10 / worker。
2. Civilian Factory未給電／OFFでCivilian Goods 0、給電で10 / worker。
3. Military Factoryは電力とInputの両方を要求し、給電時4 / operating worker。
4. Refinery未給電／OFFでFuel 0、給電で5 / worker。
5. Capital / City未給電でCivilian Goods 0だが他機能を維持する。
6. Simple Farmは電力Fieldと切替なしで常時Food 5 / worker。
7. Drone Base未給電／OFFでVision 0。
8. Allocation Priorityと段階内順序が決定的である。
9. Forecastと実EndTurnが全Resourceで一致する。
10. 当Turn Refinery出力を同Turn発電・Unit補給へ使用しない。
11. `boost`と旧Boost Forecast Fieldが公開Schemaに残らない。

### 17.2 Checkpoint

1. Batch Capacityが20。
2. 1 Batchへ21人以上を入れない。
3. Pass Through / Normal / Strictが0 / 2 / 5 Turnを維持する。
4. Policyの受入率、感染率が変更されていない。
5. Throughput Forecastと実処理が一致する。
6. Queue Pressureが0、1～20、21～40、41以上に一致する。

### 17.3 Spawn Reserve

1. Fixed Map外周120 HexがReserveである。
2. Player UnitのMove、Path、初期・完成配置がReserveを拒否する。
3. CheckpointとConstructibleの候補・ActionがReserveを拒否する。
4. 拒否時にState、Resource、Action回数、RNGを変更しない。
5. ZombieはReserveへSpawn・移動・停止できる。
6. Reserve内ZombieへのAttack、Counterattack、Interception、Damageが成立する。
7. UI、Observation、API Info、Reason Codeが同じReserve集合を使う。
8. Map DefinitionからReserve集合を差し替えてもCoreの各判定が追従する。

### 17.4 Horde Schedule

1. Turn 5: 1方向、H2/N1。
2. Turn 10: 異なる2方向、各H1/N2。
3. Turn 20: 1方向、H4/N4。
4. Turn 35: 異なる3方向、各H2/N4。
5. Turn 50: 全4方向、各H4/N5。
6. 予定Turn以外に周期Spawnしない。
7. Warningを各Spawnの2Turn前に開始する。
8. Warning開始時に抽選し、同SeedでDirection setとRNG progressionが一致する。
9. 同Wave内に方向重複がなく、Wave間の方向重複は許可する。
10. 方向配列と処理順が固定方角順である。
11. 異なるSeedでRandom方向分布が固定方向へ偏る実装になっていない。
12. Final WaveだけがFinal扱いである。
13. 全Final Groupの全36体撃破まで`finalHordeDefeated`がfalse。
14. Wave総数H30 / N41 / Total 71と一致する。
15. 配置不能時に部分SpawnせずTechnical Failureとなり、ActionをCommitしない。

### 17.5 Warning / FoW

1. Warning前もSchedule情報を公開するが、Random方向は空配列である。
2. Warning前にObservation、Legal Actions、Artifact、Metrics差分から方向が漏れない。
3. Warning開始後はそのWaveの全方向と予定Compositionを公開する。
4. Hidden Spawn Hex、非可視Unit ID、位置、Target memoryを公開しない。
5. Browser Bridge、Run Artifact、Decision Traceでも同じ境界を維持する。

### 17.6 Save / Replay / Session

1. 各Warning開始、Wave直前・直後のSave Round Tripで方向とRNGを再現する。
2. Warning後Checkpointから再開して方向を再抽選しない。
3. Multi-direction Spawn後Replayが全Groupを再現する。
4. v1.4.1 Saveをv1.4.2 Stateへ暗黙変換しない。
5. Spawn Reserve違反Stateを拒否する。
6. Session Resumeと分岐が連続実行と同じObservation、Action、Event、Result、hashを返す。

### 17.7 UI / Help / Agent

1. Mobile 390×844とDesktop 1280×720でPower、全方向Warning、Schedule、Reserve、Checkpoint Capacityを確認できる。
2. 新規Game UIに旧Horde設定入力が残らない。
3. Helpの日英説明とCore値が一致する。
4. Balanced / Random AgentがReserve違反を行わず、複数方向WarningでLegal Actionだけを選ぶ。
5. Forecast QueryとObservation取得がStateとPRNGを変更しない。

## 18. AI Playtest / Release検証

最低限、次を観察する。

- Turn 5 / 10のWaveが国家建設を完全に阻害しないか。
- Turn 10の二正面で戦力分散判断が発生するか。
- Turn 20までに電力依存経済を再構築できるか。
- Turn 20→35の15Turnを経済、人口、Checkpoint準備へ使えるか。
- Turn 35の三正面でStandby、Fallback、Supplyの価値が現れるか。
- Turn 50までに人口Policyが意味のある差を作るか。
- Final全方位36体が準備可能だが無準備では危険な水準か。
- Simple Farmが停電リスクへの実用的な冗長化となるか。
- 電力不足が他の戦略選択を消すほど頻発しないか。
- Spawn Reserveが沸き潰しを防ぎつつ、射撃防衛を不当に妨げないか。

Schedule、Composition、Warning Lead、Refinery出力は本書の確定値である。Playtest結果だけで実装中に変更せず、変更が必要なら本書を改訂する。

Release検証は次を必須とする。

- Random / Balancedを標準Config、Seed 1～100、Runner上限Turn 100で完遂する。
- Balancedを標準Config、Seed 1～300、Runner上限Turn 100で完遂する。
- 技術的失敗、決定性違反、Replay / Checkpoint不一致、FoW漏洩を0件とする。
- 勝率自体は合否条件にしない。
- Wave別敗北率、Resource不足、Power停止、Checkpoint喪失、Fallback、Final後収束をレビューする。
- 全Unit、Invariant、Save、Replay、Artifact、Session、Browser Smoke、Portable Package Smoke、Build、Pages検証を成功させる。

## 19. 実装順

1. Version、共有型、Config validation、Map DefinitionのReserve集合
2. Player占有共通Validation、Pathfinding、候補、不変条件
3. Power Mode整理、Facility生産、Simple Farm例外、切替対象
4. Power allocation、Forecast、Strategic Forecast
5. Screening Capacity、Throughput、Queue Pressure
6. Wave Config、Horde State、Warning開始時抽選
7. 複数方向の原子的Spawn、Group、Final判定
8. Save Format、Replay、Artifact、Session Resume
9. Observation、API Info、Browser Bridge、Metrics
10. Human UI、Board Overlay、Legend、Help
11. Balanced / Random Agent
12. Core、Invariant、Agent、Browser、Save、Replay、Sessionテスト
13. 固定Seed Simulation、AI Portable長期Playtest、Build、Pages、Portable Package
14. 本書を現行仕様へ反映し、実装・テスト・Helpとの整合を確認

Game CoreはPhaser、DOM、CLIから分離し、状態変更をGameAction → GameEngine経由に限定する。UI、Agent、Session CLIは同じLegal Actions、Map Rule、Core validation、Forecastを使用する。

## 20. 完了条件

1. Version境界が本書と一致し、旧非互換データを状態不変で拒否する。
2. Required施設の未給電・OFF時停止と給電時出力がFacility表どおり動く。
3. Simple Farmが切替なし・電力需要なしでFood 5 / workerを生産する。
4. `boost`と旧Boost Forecast Fieldが残らない。
5. Power Forecastと実EndTurnが一致する。
6. Screening Batch Capacity 20、Policy Turns、Throughput、Queue Pressureが全UI / API / Helpで一致する。
7. Horde Spawn Reserveが全Player占有経路を拒否し、ZombieとDamageを妨げない。
8. Wave 1～5がTurn 5 / 10 / 20 / 35 / 50に正しい方向数とCompositionで発生する。
9. Warningを2Turn前に開始し、抽選済み全方向だけを公開する。
10. Multi-direction Spawnが原子的かつ決定的である。
11. Final 4 Group・全36体撃破前に`finalHordeDefeated`が成立しない。
12. Save、AI Session Resume、ReplayがWave進行、方向、Group、RNGを完全再現する。
13. Agentが複数方向、電力停止、Reserve、Checkpoint Capacityを公開情報だけから判断する。
14. Core、Agent、Browser Bridge、Save、Replay、Session、CIがGreenである。
15. 固定Seed SimulationとRelease検証を満たす。
16. 実装完了後、本書の変更を現行仕様へ漏れなく反映し、反映済み文書をarchiveへ整理する。
