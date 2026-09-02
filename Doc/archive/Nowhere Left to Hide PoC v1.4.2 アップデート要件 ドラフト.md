# Nowhere Left to Hide PoC v1.4.2 アップデート要件 ドラフト

作成日: 2026-09-02
ステータス: Draft
対象Release: `1.4.2`

## 1. 文書の位置づけ

本書はv1.4.2で検討するゲームバランス・Core・Observation・Agent対応のアップデート要件ドラフトである。

実装と検証が完了するまでは、安定版仕様の正本を`Doc/Nowhere Left to Hide PoC 現行仕様.md`とする。v1.4.1で導入したAI Portable Session、Unit別Military Goods、Fuel 0 Emergency Movement等は原則として維持し、本書に明記した変更だけをv1.4.2の差分対象とする。

本ドラフトでは、v1.4.1のAIプレイ検証により長期的な戦略探索余地を再び増やせることが確認できたことを前提に、経済の電力依存、Checkpoint処理能力、Horde進行を再調整する。

## 2. 目的

v1.4.2では次の3点を主目的とする。

1. 生産施設の電力依存を再強化し、発電・Fuel・電力配分を経済戦略の主要要素へ戻す。
2. CheckpointのScreening Capacityを引き上げ、長期戦での難民Queue過密を緩和する。
3. Hordeを単一方向の5Turn周期増加型から、固定Wave Scheduleによる複数方向・長期進行型へ変更し、多正面防衛と国家成長の両方を要求する。

特にHorde間隔を最大15Turnまで広げることで、戦闘の合間に発電、食料、工業、人口、Checkpoint、補給網、軍隊を再編する時間を設ける。

## 3. Version境界（ドラフト案）

以下を暫定Version境界とする。

| 対象 | v1.4.2 Draft |
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
| Balanced Agent | `4.2.0` |
| Random Agent | `2.2.0` |

理由:

- Fixed Map、座標、Road Branch、Facility配置は変更しない。
- Horde State / Configを単一の`nextDirection`と周期式からWave Scheduleへ変更するためGameState / ConfigをMinor更新する。
- Agent ObservationのHorde Warningを単一方向Scalarから複数方向配列へ変更するためAgent / Observation / Browser BridgeはMajor更新候補とする。
- Replay / Artifact内のObservation TraceもHorde構造が非互換となるためArtifact SchemaはMajor更新候補とする。
- SaveはHorde Stateの構造変更を含むためFormatを更新し、v1.4.1以前を暗黙変換しない。
- AI Session Checkpointは従来どおりBuild IDを含むVersion一致を要求する。

## 4. スコープ

### 4.1 変更するもの

- 恒久生産施設の電力依存と標準生産量
- Simple Farmの無電力稼働と電力Boost
- Power Forecast、Strategic Forecast、Help、UI、Agent API Info
- Power allocation priority
- Checkpoint Screening Capacity
- Queue / Throughput ForecastのCapacity追従
- Horde Config / Horde State / Horde Warning
- Waveごとの出現Turn、方向数、方向別Composition
- 複数方向同時Spawn
- Final Horde TurnとFinal Wave判定
- Horde関連Metrics、Replay、Save、Artifact
- Balanced Agentの多正面Warning・長期経済対応

### 4.2 変更しないもの

- Fixed Map、Horde Entrance位置、Road Branch地形
- Zombie / Horde Zombieの基礎HP、Attack、Movement
- v1.4.1のUnit別Fuel / Military Goodsルール
- Fuel 0 Emergency Movement
- Checkpoint Policyの`passThrough / normal / strict`自体
- Policyごとの審査Turn、受入率、感染率
- Refugee arrival interval / people range
- Checkpoint Active / Standby / Dormant / Fallbackルール
- Fog of WarとHidden情報境界
- Noiseルール
- Supply Networkの地理判定
- Victoryの基本原則「Final Horde撃破後、Supplied AreaのZombieと感染を解消する」

## 5. 電力依存の再強化

### 5.1 基本方針

恒久的なResource生産施設は、原則として電力供給がない場合にResourceを生産しない。

v1.4.1で`boost`として扱っている恒久産業施設については、現在の「電力供給あり」の生産量をv1.4.2の標準生産量とする。そのうえで未給電時は生産0とする。

Simple Farmだけを例外とし、電力なしでも低効率で稼働できる分散型食料施設として残す。

### 5.2 Facility別標準

ドラフト標準値:

| Facility | v1.4.2電力条件 | 無電力時 | 給電時 |
|---|---|---:|---:|
| Capital | Required 5 | Civilian Goods 0 | 現行どおり1 / worker |
| City | Required 5 | Civilian Goods 0 | 現行どおり1 / worker |
| Farm | Required 5 | Food 0 | **10 / worker** |
| Civilian Factory | Required 5 | Civilian Goods 0 | **10 / worker** |
| Military Factory | Required 5 | Military Goods 0 | **4 / operating worker** |
| Refinery | Required 5 | Fuel 0 | **5 / worker（暫定）** |
| Simple Farm | Optional Boost 5 | **Food 5 / worker** | **Food 10 / worker** |
| Civilian Drone Base | Required 5 | Vision停止 | 既存Vision |
| Power Plant | 発電施設 | - | 既存発電量 |
| Wind Power Plant | 固定発電施設 | - | 既存固定発電量 |

- Farm / Civilian Factory / Military Factoryは現行`boost`時の2倍生産を標準出力へ繰り上げ、未給電時を0へ変更する。
- Military Factoryの既存Civilian Goods input条件は維持する。電力と入力の両方が揃ったWorkerだけが生産する。
- Capital / Cityは既にRequiredであるため、現行の「未給電時は人口由来Civilian Goods停止」を維持する。
- Refineryはv1.4.1では電力不要のため、v1.4.2ではRequired 5へ変更する。現行に対応するBoost値が存在しないため、給電時Fuel 5 / workerを暫定値とする。
- Power Plant / Wind Power Plant自身へ自己給電要件を課さない。

### 5.3 Simple Farmの例外

Simple Farmは唯一のResource生産施設として、電力がなくても生産を継続する。

- Worker Capacity: 10を維持
- 無電力: Food 5 / worker
- 給電: Food 10 / worker
- Optional Power Demand: 5
- `SetPowerSupply`でBoost要求をON/OFFできる。
- Supply外では既存どおり新規Workerを受け入れないが、既にいるWorkerと施設機能は既存ルールに従う。

意図:

- 大規模恒久施設は高効率だが電力依存。
- Simple Farmは効率が低い代わり、停電時にもFoodを確保できる。
- 電力網喪失が即座にFood生産全停止へ直結する単一障害点を緩和する。

## 6. Power Allocation

### 6.1 RequiredとOptional Boost

v1.4.2ではPower Demandを次の2区分として扱う。

1. **Required Load**: 電力がなければResource生産または機能が停止する。
2. **Optional Boost**: 電力がなくても基礎機能は残るが、給電で性能が上がる。

Simple Farmの5 ElectricityだけをResource生産上のOptional Boostとする。

### 6.2 Power allocation priority（ドラフト標準）

不足時の暫定優先順位を次とする。

1. Capital / City
2. Permanent Farm / Civilian Factory
3. input-ready Military Factory
4. Refinery
5. Civilian Drone Base
6. Simple Farm Boost

- Required LoadをSimple Farm Boostより優先する。
- Military Factoryは既存どおり生産Inputが成立する場合だけPower要求対象とする。
- 同順位内は既存の決定的順序を維持する。
- この優先順位はDraft値であり、AIプレイ検証でResource即死、Fuel自己ロック、Vision過小等が発生する場合は確定版前に再調整する。

### 6.3 Fuelと発電

- Power Plantの既存Fuel消費式`Fuel 1 → Electricity 5`を維持する。
- Wind Power Plantの固定15 Electricityを維持する。
- 発電Fuelは既存どおりUnit Fuel refillより先に確保する。
- 当Turn Refinery生産Fuelを同Turn Powerへ戻さない既存ルールを維持する。
- Refinery自身が停電した場合、そのTurnのFuel生産は0となる。

## 7. Production Forecast / Observation

### 7.1 Facility Observation

各Facilityの公開Production情報は、少なくとも次を正しく反映する。

- `powerMode`
- `requiredPowerCapacity`
- `powerSupplyEnabled`
- `projectedPowerRequested`
- `projectedPowerSupplied`
- `projectedPowerReason`
- `baseProduction`
- `projectedProduction`
- `projectedProductionMultiplier`
- `stoppedReason`

Simple Farmでは、未給電でも`baseProduction`が残り、給電時のみMultiplier 2となる。

恒久Required施設では、未給電時`projectedProduction = 0`、`stoppedReason = power_unavailable`とする。

### 7.2 End Turn Forecast

- Electricity Forecastは全Required LoadとSimple Farm Boost需要を区別できること。
- 既存`industrialBoostDemand`等の名称を維持する場合も、Simple Farm BoostだけがOptionalであることをAPI InfoとHelpで明示する。
- Resource Forecastは未給電停止をCore実処理と同じ計算で反映する。
- Strategic Forecastは停電により次TurnのFood / Civilian Goods / Military Goods / Fuel不足が確定する場合に、それを判断材料として公開する。

## 8. Checkpoint Screening Capacity

### 8.1 標準値

Checkpointの標準Screening Capacityを次へ変更する。

```text
10 → 20 people / Turn
```

### 8.2 維持するPolicy値

Policy自体は変更しない。

| Policy | Screening Turns | Acceptance Rate | Infection Rate | Infected Population Rate |
|---|---:|---:|---:|---:|
| Pass Through | 0 | 100% | 50% | 50% |
| Normal | 2 | 75% | 25% | 25% |
| Strict | 5 | 50% | 0% | 0% |

- Capacity増加はPolicyの感染リスク・受入率を変更しない。
- Strictの安全性と低い人口獲得率は維持する。
- 目的は長期Wave ScheduleでQueueが処理能力不足だけによって無制限に積み上がることを緩和することである。

### 8.3 Observation / Queue Pressure

- `screeningCapacity`を20として公開する。
- `estimatedScreeningThroughput`は新Capacityから再計算する。
- Queue PressureがCapacity比を利用している場合は20へ自然追従させる。
- 固定人数閾値を利用している場合、Pressure区分が旧Capacity 10前提のまま残らないよう更新する。

## 9. Hordeを固定Wave Scheduleへ変更

### 9.1 周期式の廃止

現行の次を標準Configから廃止する。

- `cycle`
- `periodicInitial`
- `periodicIncrement`
- 周期式による自動Composition増加

代わりに、明示的なWave ScheduleをConfigで定義する。

概念Schema:

```ts
horde: {
  warningLeadTurns: 1,
  waves: [
    {
      turn: number,
      directionCount: 1 | 2 | 3 | 4,
      compositionPerDirection: {
        hordeZombie: number,
        zombie: number
      },
      final: boolean
    }
  ]
}
```

- `directionCount < 4`はそのWave開始時にSeeded RNGで重複なしに方向を選ぶ。
- `directionCount = 4`はNorth / East / South / West全方向とする。
- 同一Wave内で同じ方向を二重選択しない。
- 同Seed、同Config、同Action列では方向選択を含め完全に決定的であること。

### 9.2 標準Wave Schedule

| Wave | Spawn Turn | Direction | 1方向あたりComposition | 総Horde Zombie | 総Normal Zombie | 総数 |
|---|---:|---|---|---:|---:|---:|
| 1st | **5** | ランダム1方向 | H2 + N1 | 2 | 1 | **3** |
| 2nd | **10** | ランダム2方向 | 各 H1 + N2 | 2 | 4 | **6** |
| 3rd | **20** | ランダム1方向 | H4 + N4 | 4 | 4 | **8** |
| 4th | **35** | ランダム3方向 | 各 H2 + N4 | 6 | 12 | **18** |
| 5th | **50** | **全4方向** | 各 H4 + N5 | 16 | 20 | **36** |

5th WaveをFinal Hordeとする。

Wave間隔:

```text
Turn 5 → 10  : 5 Turns
Turn 10 → 20 : 10 Turns
Turn 20 → 35 : 15 Turns
Turn 35 → 50 : 15 Turns
```

最大間隔は15Turnとする。

## 10. Waveの方向選択とSpawn

### 10.1 Random Direction Set

- 1st / 3rdは4方向から1方向を選択する。
- 2ndは4方向から2方向を重複なしで選択する。
- 4thは4方向から3方向を重複なしで選択する。
- 5thはRandom選択を行わず全方向とする。
- Random方向はHidden future RNGとして、Warning公開前にAgent Observationから推測可能な差を作らない。

### 10.2 同時Spawn

同一Waveの複数方向は同じHorde PhaseでSpawnする。

- 各方向ごとに独立したSpawn Group IDを持つ。
- 各方向のCompositionをその方向のHorde Entranceから生成する。
- 既存の有効Spawn tile探索、占有回避、Map境界等を共有する。
- 方向間の処理順によって最終結果が非決定的にならないよう、処理順を固定する。
- 一方向のSpawn失敗が他方向のSpawnを無言で消失させない。技術的にSpawn不能な場合は既存の安全な配置規則または明示的なtechnical failureを使用する。

### 10.3 Horde Target

- 各方向から出現したHorde Zombieは既存Strategic Targetルールを維持する。
- 複数Spawn Groupが同時に存在できる。
- Group間でTarget memory、Final判定、統計が上書きされない。

## 11. Warning / Public Information

### 11.1 Wave Scheduleは公開Rule

標準WaveのTurn、Direction Count、1方向あたりComposition、Final WaveであることはGame Ruleとして公開する。

Randomに選ばれる実方向だけを、Warning開始前のHidden情報とする。

### 11.2 Warning

現行の単一`warningDirection`では複数方向Waveを表現できないため、Observationを配列化する。

概念例:

```ts
horde: {
  warningType: 'periodic' | 'final' | 'none',
  warningDirections: CardinalDirection[],
  spawnTurn: number | null,
  turnsRemaining: number,
  waveIndex: number | null,
  finalHordeStatus: 'notStarted' | 'active' | 'defeated'
}
```

- 既定Warning Leadは現行相当の1Turn前を維持する。
- Warning開始時に、そのWaveで選ばれた全方向を同時に公開する。
- `warningDirections`は重複なし。
- Warningなしでは空配列とする。
- `waveIndex`は1～5の公開番号とする。
- 将来のRandom draw、Spawn座標、個別Zombie IDは公開しない。

### 11.3 旧Scalar Alias

`warningDirection` / `direction`のScalar aliasは複数方向で意味が不明確になるため、Agent API 4.0.0では削除候補とする。

Browser UIが一時的な互換表示を必要とする場合も、Agentが最初の方向だけを「全Warning」と誤認するFieldは残さない。

## 12. Final HordeとVictory

- `finalHordeTurn`の標準値を30から**50**へ変更する。
- 5th Waveの4方向すべてを一つのFinal Waveとして扱う。
- `finalHordeDefeated`は5th Waveに属する全Spawn Groupの全Zombieが撃破された時だけtrueとする。
- 一方向だけを全滅させてもFinal Horde defeatedにしない。
- Final Wave撃破後も既存どおりゲームは即終了せず、次の3条件すべてを要求する。

```text
finalHordeDefeated
suppliedAreaZombieClear
suppliedAreaInfectionClear
```

- Defeat判定はVictoryより優先する既存原則を維持する。
- 5th Wave後にGame Rule上のTurn Limitを追加しない。

## 13. Horde State / Save / Replay

### 13.1 Horde State

現行の単一`nextDirection`中心Stateを、複数Waveを表現できる形へ変更する。

最低限保持する情報:

- nextWaveIndex
- nextSpawnTurn
- selected warning directions for current/next warned wave
- lastSpawnTurn
- current warning state
- Final Horde status
- Final Wave Spawn Group IDs
- Wave別Spawn済み状態

完全な将来方向列をGameStateへ先行生成する必要はない。生成する場合もPrivate Stateに留め、Public Observationへ漏らさない。

### 13.2 Save / Checkpoint

- Save Format 7で新Horde Stateを完全保存する。
- Warning済み方向、Wave進行、Final Groupを保存し、ロード後に方向を再抽選しない。
- Turn 5 / 10 / 20 / 35 / 50直前・直後のSave Round Tripを検証する。
- AI Session CheckpointからResumeしても同じWave方向、Spawn数、RNG progressionを再現する。

### 13.3 Replay / Artifact

- Replayは全方向のWarningとSpawn Eventを再現できる。
- `horde_spawned` Public Eventは既存FoW境界を維持しつつ、公開可能なWave番号・Direction等を扱えるよう更新する。
- Hidden Spawn coordinate、非可視Unit ID / count等をArtifact経由で漏らさない既存制約を維持する。

## 14. Metrics

最低限、次をWave単位またはDirection単位で検証可能にする。

- WaveごとのSpawn Turn
- Waveごとの選択Direction
- WaveごとのHorde Zombie / Normal Zombie Spawn数
- Direction別Spawn数
- Wave別撃破数
- Final Wave Spawn総数 / Kill総数
- Final Horde defeated Turn
- Turns after Final Horde
- Multi-frontでのCheckpoint loss / fallbackとの相関を既存Metricsで追跡可能にする。

既存のperiodic / final aggregate metricsを維持する場合も、固定Wave Scheduleの合計と一致すること。

標準Configの予定総Spawn数はWaveだけで次となる。

```text
Horde Zombie: 2 + 2 + 4 + 6 + 16 = 30
Normal Zombie: 1 + 4 + 4 + 12 + 20 = 41
Total Wave Zombies: 71
```

初期配置Zombie、Facility overrun等による追加Spawnはこの71へ含めない。

## 15. Human UI / Help

### 15.1 Power

- Facility PanelでRequired / Optional Boostを区別する。
- 未給電Required施設はResource production停止を明示する。
- Simple Farmは「無電力でもFood 5 / worker、給電時10 / worker」を表示する。
- Power不足時にどの施設が停止し、どのSimple FarmがBoostを失うかをForecastで確認できる。

### 15.2 Horde

- 複数方向Warningを同時表示する。
- Wave番号、Spawn Turn、警告方向を表示する。
- 固定Wave ScheduleをHelpで一覧化する。
- Random DirectionはWarning前にUIへ表示しない。
- 5th WaveがFinalで全方位であることはGame Ruleとして事前公開する。

### 15.3 Checkpoint

- Screening Capacity 20をHelp / Panel / Observationで統一する。
- Queue Pressure説明が旧Capacity 10前提にならないよう更新する。

## 16. Agent / AI Portable

### 16.1 Agent API Info

`getApiInfo()`は固定Wave Scheduleを機械可読に公開する。

最低限:

- Wave index
- Spawn Turn
- Direction count
- Composition per direction
- Final flag
- Warning lead turns

### 16.2 Agent Observation

AIは次を再計算せず利用できること。

- 現在の全Warning directions
- 次Wave Spawn Turn
- turns remaining
- Wave number
- Final Horde status
- FacilityごとのPower状態とProjected production
- Screening Capacity / Throughput

### 16.3 Balanced Agent

Balanced Agentは少なくとも次へ対応する。

- 複数方向Warningを1方向だけに縮約しない。
- 2nd / 4th / 5th Waveで全戦力を一方向へ集中させない。
- 5～15Turnの準備期間を利用し、電力、Fuel、Military Goods、人口、Unit数、Checkpoint depthを再評価する。
- Guaranteed DefeatやCritical Resource Dependencyが示す電力起因不足を優先して修復する。
- Simple Farmを停電耐性の選択肢として認識する。

AI Portable Session / Checkpoint / Decision Trace自体の仕様はv1.4.1を維持する。

## 17. Core Test要件

### 17.1 Power

最低限次を自動テストする。

1. Farm未給電でFood 0、給電で10 / worker。
2. Civilian Factory未給電でCivilian Goods 0、給電で10 / worker。
3. Military Factoryは電力と入力が両方必要で、給電時4 / operating worker。
4. Refinery未給電でFuel 0、給電で5 / worker（Draft値）。
5. Capital / City未給電でCivilian Goods 0。
6. Simple Farmは未給電5 / worker、給電10 / worker。
7. Drone Base未給電でVision 0。
8. Power不足時のAllocationが決定的である。
9. Forecastと実End Turnが全Resourceで一致する。
10. 当Turn Refinery outputを同Turn発電へ使用しない。

### 17.2 Checkpoint

1. Screening Capacityが20。
2. 20人を超えるQueueを1Turnで21人以上審査しない。
3. Policy turns / acceptance / infection ratesが変更されていない。
4. Throughput Forecastと実処理が一致する。
5. Queue PressureがCapacity 20に追従する。

### 17.3 Horde Schedule

標準Configで必ず次を検証する。

1. Turn 5: 1方向、H2/N1。
2. Turn 10: 異なる2方向、各H1/N2。
3. Turn 20: 1方向、H4/N4。
4. Turn 35: 異なる3方向、各H2/N4。
5. Turn 50: 全4方向、各H4/N5。
6. 予定Turn以外に周期Spawnしない。
7. 同SeedでDirection setが一致する。
8. 異なるSeedでRandom Direction分布が固定1方向へ偏る実装になっていない。
9. 同Wave内Direction重複がない。
10. 5th WaveのみFinal扱い。
11. 全Final Group撃破まで`finalHordeDefeated`がfalse。
12. Wave総数H30/N41と一致する。

### 17.4 Warning / FoW

1. Warning前にRandom DirectionがObservation差分から漏れない。
2. Warning開始後はそのWaveの全Directionだけを公開する。
3. Hidden Spawn coordinate、Hidden Unit ID、Hidden target memoryを公開しない。
4. Browser Bridge / Run Artifact / Decision Traceでも同じ境界を維持する。

### 17.5 Save / Replay

1. 各Wave直前Checkpointから再開して同じ方向・Compositionを再現する。
2. Warning後Checkpointから再開してDirectionを再抽選しない。
3. Multi-direction Spawn後Replayが全Groupを再現する。
4. v1.4.1 Saveをv1.4.2 Stateへ暗黙変換しない。

## 18. AI Playtest要件

実装後はBuilt-in AgentだけでなくAI Portableを用いて長期プレイを確認する。

最低限の観察項目:

- Turn 5 / 10の初期Waveが国家建設を完全に阻害しないか。
- Turn 10の二正面で戦力分散判断が発生するか。
- Turn 20までに電力依存経済を再構築できるか。
- Turn 20→35の15Turnを経済・人口・Checkpoint準備へ使うか。
- Turn 35の三正面でStandby / Fallback / Supplyの価値が現れるか。
- Turn 50までにNormal / Strict等の人口政策が意味のある差を作るか。
- Final全方位36体が「準備すれば対応可能だが無準備では危険」な水準か。
- Simple Farmが停電リスクへの実用的な冗長化となるか。
- Resourceが恒常的に過剰蓄積するだけの経済へ戻っていないか。
- Power不足が頻発しすぎて他の戦略選択を消していないか。

Final Waveの36体は初期Draft値として一度そのまま検証する。実プレイで明確に過剰または不足と判断された場合にのみCompositionを再調整する。

## 19. 実装順序案

1. Config / GameState Version更新
2. Power生産ルール変更とSimple Farm例外
3. Power Forecast / Strategic Forecast更新
4. Screening Capacity 20
5. Horde Wave Config / State導入
6. Multi-direction Warning
7. Multi-direction Spawn / Final判定
8. Save Format / Replay / Artifact更新
9. Human UI / Help
10. Agent Observation / API Info / Browser Bridge
11. Balanced Agent更新
12. Core / Agent / Browser / Save / Replay回帰テスト
13. AI Portable長期Playtest
14. 数値再調整後に確定版化

## 20. 未確定・確定版前レビュー項目

以下は本Draftで実装候補値を置くが、確定版前に再確認する。

1. **Refinery給電時生産量**: 現行はBoost定義がないため5 / workerを暫定維持する。電力依存化と同時に10へ引き上げるかはPlaytestで判断する。
2. **Power Allocation Priority**: Required Load優先を原則とし、Refinery / Drone Base / Simple Farm Boostの相対順をPlaytestで確認する。
3. **Horde Warning Lead**: 現行相当1Turn前を暫定維持する。Turn 35 / 50の多正面Waveで準備猶予が不足する場合は変更候補とする。
4. **5th Wave Composition**: H16/N20、合計36を初期値として検証し、先に弱体化しない。
5. **Queue Pressure閾値**: Capacity比ベースへの追従を優先し、固定閾値を残す場合は20基準へ更新する。

## 21. 完了条件

v1.4.2は少なくとも次を満たした時点で完了候補とする。

- Required生産施設が未給電で停止する。
- Simple Farmだけが無電力Food生産を維持し、給電でBoostする。
- Power Forecastと実処理が一致する。
- Checkpoint Screening Capacityが20で全UI / API / Helpに一致する。
- Wave 1～5がTurn 5 / 10 / 20 / 35 / 50に正しい方向数とCompositionで発生する。
- Multi-direction WarningがFoWを破らない。
- Final Wave全Group撃破前にVictory progressが誤成立しない。
- Save / AI Session Resume / ReplayがWave進行とRandom方向を完全再現する。
- Agentが複数方向Warningを認識できる。
- Core、Agent、Browser Bridge、Save、Replay、CIがGreenである。
- AI PortableでTurn 50以降まで継続可能であり、経済・人口・多正面防衛の複数戦略を検討できる。

---

本書はDraftであり、特にRefineryの給電時出力、Power Allocation Priority、Warning Lead、Final Wave難易度はPlaytestを経て確定版で固定する。
