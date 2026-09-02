# Nowhere Left to Hide PoC v1.4.3 アップデート要件 確定版

- 作成日: 2026-09-02
- ステータス: 確定
- 対象Release: `1.4.3`
- 基準安定版: `v1.4.2`
- 実装状態: 実装・現行仕様反映済み（長時間BatchはRelease Validation Workflowで起動確認）

## 1. 文書の位置づけ

本書はv1.4.3で実装した差分要件を確定した文書である。実装、テスト、UI、Help、Save、Replay、Artifact、Agent、Browser Bridgeの照合内容は本書に従う。

実装・テスト・動作確認の完了に伴い、`Doc/Nowhere Left to Hide PoC 現行仕様.md`へ本書を反映した。現在の安定版判断では現行仕様を唯一の正本とし、本書はv1.4.3差分の照合資料として扱う。

実装、テスト、Help、公開API、Version表と現行仕様の整合を確認済みである。本書で変更しない事項はv1.4.2から維持する。今回の作業指示に従い既存の`Doc/archive/`文書は変更せず、本書は`Doc/`直下に保持する。

---

## 2. 背景と目的

v1.4.2の外部AIプレイ（Seed 1）では、Simple FarmとCivilian Drone Baseを建設せず、National Guardを12 Unitまで増強し、Human Unit損失0のままTurn 57で勝利できた。

v1.4.3ではZombieの基礎HPやAttackを単純に上げず、次を相互作用させる。

1. National Guard大量運用のCombat Noise Riskを増やす。
2. 固定Wave Scheduleの各方向へNormal Zombieを追加する。
3. 現行6体を維持したまま、州都から遠い初期Normal Zombieを6体追加する。
4. Forest／MountainへPlayer Ground Vision限定のLOS遮蔽を導入する。
5. Civilian Drone Baseへ地上LOSでは代替できない航空偵察価値を与える。
6. Facility／Checkpointの感染陥落とNormal Zombie生成を実感染者数へ連動させる。
7. 密集拠点の感染連鎖と、Combat Noiseによる陥落拠点からの再流出を導入する。
8. Human UIとAgentへ同じ公開情報とRuleを提供する。

狙いは「National Guardを大量生産し、射程2で見えている敵だけを処理する」単一解を弱め、偵察、地形、部隊配置、Noise、施設防衛、感染封じ込めを関連させることである。

---

## 3. Version境界

| 対象 | v1.4.3 |
|---|---:|
| App / Release | `1.4.3` |
| Game Rules / GameState / Config | `2.3.0` |
| Fixed Map | `fixed-31x31-v2` |
| Save Format | `8` |
| Agent API | `5.0.0` |
| Observation API | `5.0.0` |
| Browser Bridge API | `5.0.0` |
| Artifact Schema | `4.0.0` |
| Checkpoint Schema | `1.0.0` |
| Session Schema | `1.0.0` |
| Balanced Agent | `4.3.0` |
| Random Agent | `2.2.0` |

- Fixed MapのTerrain、道路、Urban、Horde Entrance、Horde Spawn Reserve、17恒久Facilityは変更しない。
- `initialZombiePositions`を6件から12件へ変更するため、Fixed Map IDを`fixed-31x31-v2`へ更新する。
- v1.4.2以前のSave、Replay、Artifact、AI Portable Session、Checkpointを暗黙変換しない。Version不一致として明示拒否し、元データを変換、削除、上書きしない。
- Save Format 8は新しいAutosave Namespaceを使用し、旧Namespaceを上書きしない。
- AI SessionとCheckpointはGame Rules、公開Schema、Build ID、Map ID、Configの一致を要求する現行原則を維持する。

---

## 4. 変更概要

| 項目 | v1.4.2 | v1.4.3 |
|---|---|---|
| Police Combat Noise | Radius 4 / `medium` | 変更なし |
| National Guard Combat Noise | Radius 5 / `medium` | Radius 8 / `large` |
| 固定Wave Normal Zombie | 現行Composition | 全Waveの各方向へ2体加算 |
| 初期Normal Zombie | 固定6体 | 既存6体を維持し、遠方固定6体を追加 |
| Player Ground Vision | Terrain遮蔽なし | Forest／Mountainが遮蔽 |
| 州都Vision | 実装5、現行仕様書に1の齟齬 | Ground Vision 5として明文化・Config分離 |
| Zombie Vision | Terrain遮蔽なし | 変更なし |
| Civilian Drone Base | `workers × 2` | Radiusを維持し、Ground LOS遮蔽を無視 |
| 感染陥落時Spawn | 原則固定2体、Capacity補正あり | 実感染者5人につき1体、最大6体、隣接のみ |
| Checkpoint感染陥落Spawn | 固定2体、Capacity補正あり | Facilityと同じ人数連動Rule |
| 陥落拠点の残存感染 | Noiseへ反応しない | Combat Noise範囲内で隣接再Spawnを試行 |
| 感染通知 | 一般Event中心 | Toastと重要イベント履歴を追加 |

---

## 5. National Guard Combat Noise

### 5.1 Core Rule

```text
Police:
  noiseRadius = 4
  publicNoiseClass = medium

National Guard:
  noiseRadius = 8
  publicNoiseClass = large
```

- National Guardが参加する通常Combatで発生するCombat Noiseの内部Radiusを5から8へ変更する。
- Policeの内部Radius 4は変更しない。
- Player Attack、Zombie／Horde ZombieからHuman UnitへのAttack、Interceptionで、Human UnitのいるHexをCenterとするNoise PulseをCombatごとに1回発生させる。
- 同一Combat内のCounterattackでは二重Pulseを発生させない。
- Normal ZombieだけがNoise Targetを取得し、Horde ZombieはNoise Targetを持たない現行Ruleを維持する。
- Terrain、Road、Urban、Forest、MountainはNoiseを遮蔽・減衰しない。
- LOSとNoiseは独立したRuleとする。
- 既存Noise Targetを新しいNoiseで上書きしない等、Target優先順位は本書で変更する箇所以外v1.4.2を維持する。

### 5.2 公開情報

- Production UI、Help、Unit詳細、Combat Log、Board Legend、Observation、`getApiInfo()`、Public Event、Browser Bridgeで、Policeを`medium`、National Guardを`large`として公開する。
- Production経路から正確なRadius、反応したZombie数、Zombie ID、Noise Targetを直接公開しない。
- 実際に発生した陥落拠点再Spawnと感染者減少から、PlayerまたはAgentがNoise Radiusを間接推測することは許容する。これはFair Play違反としない。
- 開発Build、Verification Artifact、内部Configでは決定性検証のため正確なRadiusを保持できる。

---

## 6. 固定Wave ScheduleのNormal Zombie増加

### 6.1 基本Rule

- 新しい追加数抽選、追加数State、追加用PRNG消費は導入しない。
- 固定Wave Configの各`compositionPerDirection.zombie`へ2体を直接加算する。
- 通常WaveとFinal Waveの全Waveを対象にする。
- Warning方向の抽選Rule、PRNG消費順、Wave Turn、方向数、Warning Lead、Final flag、Horde Zombie数は変更しない。
- 追加個体は同じWaveのNormal Zombieとして`spawnGroupId`と`hordeKind`を持つ。

### 6.2 標準Schedule

| Turn | 方向数 | 方向 | 方向別Composition | Wave合計 |
|---:|---:|---|---|---:|
| 5 | 1 | Random | H2 / N3 | 5 |
| 10 | 2 | Random | H1 / N4 | 10 |
| 20 | 1 | Random | H4 / N6 | 10 |
| 35 | 3 | Random | H2 / N6 | 24 |
| 50 | 4 | North / East / South / West | H4 / N7 | 44 |

- 全Wave合計はHorde Zombie 30体、Normal Zombie 63体、合計93体とする。
- Final Wave合計はHorde Zombie 16体、Normal Zombie 28体、合計44体とする。
- Warning前からConfig上の方向別Composition、方向数、Turn、Final flagは公開できるが、Random Waveの将来方向は公開しない。
- Warning開始後は確定した全方向と方向別最終CompositionをHuman UIとAgent Observationへ公開する。
- `horde_warning`と`horde_spawned` Event、Metrics、Help、Board Legendは同じConfig値を使用する。

---

## 7. 初期Normal Zombie 12体

### 7.1 固定配置

現行6体の座標と配列順を変更しない。

```text
(9, 9), (21, 21), (21, 9),
(9, 21), (15, 6), (15, 24)
```

次の6座標を配列末尾へ追加する。

```text
(16, 2), (28, 2), (28, 14),
(14, 28), (2, 28), (2, 16)
```

- 追加6体はすべて州都`(15, 15)`からHex Distance 13である。
- 追加座標はFacility、Road、Urban、Horde Spawn Reserve、既存初期Unit、既存初期Zombieと重複しない。
- 追加座標は州都を中心とする対向3組とし、特定方向へ偏らせない。
- Map validationは12件の固定初期Zombie位置を要求する。
- `economy.initialZombieCount`の合法範囲を0..12へ変更し、標準値を12とする。指定数だけ固定配列の先頭から使用する。
- 初期Zombie配置はPRNGを消費しない。同じMapとConfigから常に同じ位置を得る。
- 初期配置の乱数化はv1.4.3対象外とし、将来のランダムマップ実装時に同時検討する。
- 初期ZombieはHorde由来でなく、`spawnGroupId = null`、`hordeKind = null`とする。

---

## 8. Player Ground LOS

### 8.1 SourceとRadius

次をGround Vision Sourceとする。

| Source | Radius | 提供条件 |
|---|---:|---|
| Police | 5 | 生存中 |
| National Guard | 5 | 生存中 |
| Capital | 5 | Player所有、未陥落で`building`／`disabled`／`recovering`ではない |
| Capital以外の通常Facility | `config.vision.ownedFacility`、標準1 | Player所有、未陥落で`building`／`disabled`／`recovering`ではない |
| Active Checkpoint | `config.vision.operationalCheckpoint`、標準1 | Activeかつ稼働中 |

- Capital Vision用に`config.vision.capital = 5`を新設する。
- Capital Visionと`checkpoint.initialSupplyRadius = 5`は別Rule・別Configとして扱う。
- 無人停止中または感染中でも、未陥落で上表の除外状態でなければ通常FacilityはVisionを提供する現行挙動を維持する。
- Standby、Dormant、Remnant、Ruined、Abandoned CheckpointはVisionを提供しない。

### 8.2 Blocking Terrain

- ForestとMountainはPlayer Ground VisionのLOSを遮蔽する。
- Source Hex自身は遮蔽判定へ含めない。
- Sourceから見て最初のForest／Mountain Hex自体はVisibleとし、その先をHiddenとする。
- Target Hexが最初のForest／MountainならTarget HexはVisibleとする。
- Plainは遮蔽しない。
- Road／Urban Overlayは遮蔽判定を変更しない。基礎TerrainがForest／MountainならRoad／Urbanの有無にかかわらず遮蔽する。
- SourceがForest／Mountain上にいる場合もSource Hex自身では遮蔽されないが、その先の別のBlocking Hexは通常どおり遮蔽する。

例:

```text
Unit -> Forest -> Plain
```

ForestはVisible、奥のPlainはHidden。

```text
Unit -> Forest -> Forest
```

手前のForestだけVisible。

```text
Unit standing in Forest -> adjacent Forest -> next Forest
```

Source Hexは遮蔽せず、隣接ForestはVisible、その奥はHidden。

### 8.3 Hex Lineの決定性

- 既存Core関数`hexLine(start, end)`を唯一のHex Line判定元とする。
- 既存の軸座標直線補間、`cubeRound`、同率時の補正優先順位を変更しない。
- UI、Observation、Agent、Replay、Legal ActionはCoreの同じ可視Hex集合を使用し、独自近似を持たない。
- LOS関数へ固定Map固有の座標、Facility ID、Terrain表を埋め込まず、渡されたMap Stateの基礎Terrainを参照する純粋関数とする。
- この境界により、将来Terrain／Facility配置をランダム化しても同じLOS関数を再利用できること。

### 8.4 Combat、Zombie、Noise

- Terrain LOSはVisionだけへ適用し、攻撃射線を遮らない。
- 別のGround SourceまたはAerial Sourceが敵を可視化していれば、射程内のHuman UnitはForest／Mountain越しに攻撃できる。
- Normal Zombie／Horde ZombieのVision Radius 3とTargetingはTerrain LOS遮蔽を受けない。
- Combat NoiseはTerrain LOS遮蔽を受けない。

### 8.5 Fog of War

- Player Visibilityは全Ground SourceとAerial Sourceの可視Hex集合の和集合とする。
- Map Terrain、Road、Urban、Facility／Checkpoint位置等の静的公開情報は従来どおりFoW外でも公開する。
- Visibility外Enemyの位置、個体情報、Target、移動、正確なSpawn位置、Last Known Positionを公開しない。

---

## 9. Civilian Drone BaseのAerial Vision

- Civilian Drone BaseはAerial Vision Sourceとし、Ground LOS判定を行わない。
- 給電、Worker、稼働条件はv1.4.2を維持する。

```text
visionRadius = workers * 2
```

- 給電・稼働中はRadius内をForest／Mountainに関係なくVisibleにする。
- Forest／Mountain内部やその奥のEnemyもRadius内なら可視化する。
- 無給電、Power Supply OFF、Worker 0、`building`／`disabled`／`recovering`／陥落時はVision 0とする。
- Ground SourceからHiddenでもDroneからVisibleなら、Human UIとAgent ObservationのEnemy配列へ出す。
- HelpとBoard Legendで「地形遮蔽を無視する航空偵察」と明記する。

---

## 10. Vision公開Schema

Human PlayerとAgentの情報差を作らない。

各公開Vision Sourceは、既存の現在有効な`vision`に加えて次を返す。

```text
visionMode: "ground" | "aerial"
terrainLosBlocking: boolean
```

- Police、National Guard、Capital、通常Facility、Active Checkpointは`ground / true`とする。
- Civilian Drone Baseは`aerial / false`とする。
- `getApiInfo()`はForest／MountainのGround LOS Rule、Blocking Hex自身がVisibleであること、Zombie VisionとNoiseが遮蔽されないこと、Capital Vision 5を機械可読に返す。
- 内部Line探索履歴やEnemy別の検出理由をProduction Observationへ出さない。

---

## 11. 感染陥落時のNormal Zombie生成

### 11.1 対象

次の感染陥落またはZombie占有による破壊を共通処理の対象とする。

- Capital、City、Farm、Civilian Factory、Military Factory、Refinery、Power Plant
- Simple Farm、Civilian Drone Base
- Active、Standby、Dormant、Remnantを含む感染可能なCheckpoint

Wind Power Plantは感染者Poolを持たず、Zombie占有時に`disabled`となるため、感染者由来Spawn対象外とする。

### 11.2 実感染者原則

- 陥落判定時点の実際の感染者Poolを`infectedAtFall`とする。
- v1.4.2の「現在値とCapacity 50%の大きい方」への補正をFacilityとCheckpointの両方から撤廃する。
- `fallBackCapacityRate`と`fallBackCapacityRounding`および陥落時の潜在感染者自動加算はConfig、Core Rule、公開説明から除去する。
- 配置・流入した実人口から発生した感染者だけを使用し、陥落時に人口を水増ししない。

### 11.3 Spawn式

標準Ruleは次とする。

```text
requestedSpawnCount = min(
  infection.maxZombieSpawnPerResolution,
  floor(currentInfected / infection.zombieSpawnPopulationPerUnit)
)

actualSpawnCount = min(requestedSpawnCount, eligibleAdjacentHexCount)

remainingInfected =
  currentInfected
  - actualSpawnCount * infection.zombieSpawnPopulationPerUnit
```

標準Config:

```text
infection.zombieSpawnPopulationPerUnit = 5
infection.maxZombieSpawnPerResolution = 6
infection.zombieSpawnRadius = 1
infection.noiseRespawnEnabled = true
```

- 感染者0～4人は0体、5～9人は1体、10～14人は2体、15～19人は3体、20～24人は4体、25～29人は5体、30人以上は最大6体を要求する。
- 感染者数から差し引くのは、実際に配置に成功したZombie 1体につき5人だけとする。
- 空き不足で生成できなかった5人単位は、恒久Facility／Checkpointの感染者Poolへ残す。
- 感染者0人の空CheckpointがZombie占有で破壊された場合、新しいZombieは生成しない。

### 11.4 Spawn候補

候補は次をすべて満たすHexに限定する。

- 発生拠点からHex Distance 1
- Map内
- Unitが存在しない
- Normal Zombieが進入可能な基礎Terrain

Facility、Checkpoint、Road、Urban、Horde Spawn Reserve上への生成は許可する。

- Distance 2以上を探索しない。
- 候補を座標順へ正規化し、同距離候補から既存どおりSeed付きPRNGで1Hexずつ選ぶ。
- 生成のたびに占有状態を更新し、同じHexへ複数Unitを生成しない。
- 配置不能はTechnical Failureにせず、未変換感染者を拠点内へ保持する正常結果とする。

### 11.5 拠点Type別の陥落後処理

- 恒久FacilityはRuined、Checkpointは現行のRuined／Remnant状態となり、`remainingInfected`を保持する。
- 復旧には盤上Zombieの排除、Human Unitの進入、残存感染者の自動鎮圧による0人化を必要とする現行原則を維持する。
- Simple Farm／Civilian Drone Baseは現行どおり感染陥落時に消滅する。
- Constructible Facilityでは、生成成功分を差し引いた残存感染者を建物消滅に伴う死亡として計上し、陥落後感染者を0とする。
- Capitalも共通式、配置、即時感染、Event、Metricsを処理した後に即時敗北とする。

### 11.6 生成Unitの行動と即時占有処理

- 生成Unitは通常のNormal Zombieと同じType、HP、Attack、Movement、Vision、Targeting、Noise Ruleを持つ。
- 生成された同じZombie Phase中には移動、通常Attack、Targetingを行わず、次回Zombie Phase Snapshotから通常行動へ参加する。
- ただし生成先にFacility／Checkpointがある場合、生成直後に通常のZombie Phase終了時と同じ占有処理を1回だけ行う。
- 健全人口がいる拠点ではNormal ZombieのAttack値を使う通常の感染変換を1回行う。
- Wind Power PlantまたはWorker 0のConstructible Facilityでは感染者を作らず、通常Ruleどおり即時`disabled`とする。
- 既に陥落済みで健全人口を持たない拠点へ追加の感染変換を行わない。

### 11.7 連鎖陥落

- 生成直後の占有処理で別拠点が陥落した場合、その拠点からも本章の共通式でZombieを生成する連鎖を許可する。
- 生成ZombieをUnit ID順のFIFOキューで処理する。
- 先に生成されたZombieから即時占有処理を1回ずつ実行し、新たに生成されたZombieはキュー末尾へ追加する。
- 各生成Zombieの即時占有処理は最大1回とし、同じUnitを再処理しない。
- Queueが空になるか即時敗北が確定した時点で連鎖を終了する。
- 同一Seed、Config、Map、Action列から同じUnit ID、配置、連鎖順、最終Stateを得る。

---

## 12. Combat Noiseによる陥落拠点再Spawn

### 12.1 対象と発生条件

- `infection.noiseRespawnEnabled = true`のとき、Combat Noise Centerから該当Human Unitの内部Noise Radius以内にある陥落済み恒久FacilityとRuined／Remnant Checkpointを対象にする。
- 未陥落の感染中拠点、Wind Power Plant、消滅済みConstructible Facilityは対象外とする。
- `currentInfected >= infection.zombieSpawnPopulationPerUnit`の対象だけSpawnを試みる。
- Player Attack、Zombie／Horde Zombie Attack、Interceptionを含む既存の全Combat Noise発生条件を使う。
- Counterattackは同一CombatのPulseに含め、二重処理しない。

### 12.2 解決順

- Normal ZombieへのNoise Target付与は現行どおりCombat開始時のPulseで行う。
- 陥落拠点再Spawnは、攻撃、反撃、死亡等を含むそのCombat全体の解決直後に行う。
- 再Spawnと連鎖陥落を処理してから、Action後のDefeat／Victory判定へ進む。
- Noise範囲内の複数拠点は拠点ID昇順で処理する。同一IDが存在する場合はFacilityを先、Checkpointを後とする。
- 先に処理した拠点が共有隣接Hexを使用した場合、後続拠点は更新後の空きHexで判定する。

### 12.3 Spawn数

各対象拠点について次を計算する。

```text
spawnCount = min(
  floor(currentInfected / 5),
  eligibleAdjacentHexCount,
  6
)
```

- 成功1体につき感染者5人を差し引く。
- 感染者または隣接空きが残れば、後のCombat Noise Pulseで再試行できる。
- Noise再Spawnで生成されたZombieにも11.6と11.7の即時占有処理と連鎖陥落を適用する。
- Spawn結果からNoise Radiusを間接推測できることを許容するが、正確なRadiusや範囲内未反応拠点一覧を公開APIへ直接出さない。

---

## 13. Infection／Overrun UI

### 13.1 通知対象

次の状態変化を重要イベントとする。

1. Facility／Checkpointが健全状態から初めて感染状態になった。
2. Facility／Checkpointが感染またはZombie占有で陥落した。
3. 陥落またはNoise由来Spawnで即時感染・連鎖陥落した。
4. Combat Noiseにより陥落拠点からZombieが再Spawnした。

感染者が既に1人以上いる拠点で人数だけが増えた場合は、毎回Toastを出さない。Core Eventと通常詳細表示には増加を反映する。

### 13.2 Toastと重要イベント履歴

- 新規重要イベント発生時に、日英の対象名、状態、必要な数値を含むToastを表示する。
- 同一解決Queueで複数拠点に連鎖した場合、Toastは「3拠点で連鎖感染」のように集約し、連続Toastの氾濫を防ぐ。
- Bottom Sheet内に最新50件の重要イベント履歴を設ける。
- 履歴には各拠点のEventを個別に残し、Turn、対象名、感染開始／陥落／Noise流出、生成数、残存感染者数、連鎖起点を表示する。
- 履歴項目のタップで盤面を対象Hexへ移動し、そのFacility／Checkpointを選択する。
- 履歴はCore Eventから導出し、Save／Load後も復元する。
- Load時に過去EventのToastを再表示せず、Load後に発生した新規EventだけをToast対象にする。
- Artifact／ReplayはUIの50件上限と無関係に全Eventを保持する。
- Noise流出Eventは視界外でも拠点名、生成数、残存感染者数を表示できるが、Hidden Zombieの個体IDと配置先Hexは表示しない。

### 13.3 Vision Overlay

- 選択中Ground Vision Sourceについて、Coreが返す実可視Hexを強調する。
- Radius内だがForest／Mountain LOSで欠けたHexと遮蔽境界を、可視Hexと区別できる暗い境界表示で示す。
- Aerial Vision OverlayはGround Visionと視覚的に区別し、Radius内がTerrainで欠けないことを示す。
- UIはCoreの結果を描画するだけとし、独自LOS計算を持たない。

### 13.4 Help／Board Legend

最低限、日英で次を説明する。

- Police Noise `Medium / 中`、National Guard Noise `Large / 大`
- National Guardはより広い範囲のNormal Zombieと陥落拠点を反応させ得ること
- Forest／MountainはGround Visionを遮り、Blocking Terrain自体は見えるが奥は見えないこと
- Zombie Vision、Combat Noise、攻撃射線はTerrain LOS遮蔽を受けないこと
- CapitalはGround Vision 5であること
- Civilian Drone BaseはForest／Mountainを無視するAerial Visionであること
- 各固定Waveの方向別最終Composition
- 感染者5人につきNormal Zombie 1体、1回最大6体、隣接空き不足分は感染者として残ること
- 陥落拠点がCombat Noiseで再流出し、密集拠点では連鎖陥落し得ること
- Constructible Facilityは感染陥落で消滅すること

---

## 14. Event、Observation、Fair Play

### 14.1 Event

Core Eventは最低限次を区別できるSchemaを持つ。

- 初回感染開始
- 感染陥落／空拠点のZombie占有破壊
- 陥落直後Spawn
- Noise再Spawn
- 生成直後の即時感染
- 連鎖陥落

陥落EventとNoise流出Eventは最低限次を持つ。

- Site Kind、Facility／Checkpoint ID、Type、座標
- 原因
- 陥落時または処理前感染者数
- Requested Spawn数
- Actual Spawn数
- 処理後残存感染者数
- Constructible消滅時の残存感染者死亡数
- 連鎖起点Event IDまたは`null`

### 14.2 公開範囲

- Facility／Checkpointの位置、状態、感染者数は現行どおり公開情報とする。
- 視界外でも、対象ID／Type、陥落時感染者数、生成数、残存感染者数、連鎖陥落かどうかをPublic Event、Observation、Run Artifactへ出す。
- 視界外に生成されたZombieの個体ID、正確な配置Hex、Target、Noise Targetは公開しない。
- 視界内の生成Zombieは通常のEnemy Visibility Ruleに従って公開する。
- Verification Artifactは決定性確認用の完全な内部Eventを保持できる。

---

## 15. Balanced Agent

Balanced Agentは公開情報だけで次を評価する。

1. National Guardの`large`をPoliceの`medium`より高いNoise Riskとして扱う。
2. Forest／Mountainで遮られたHexをVisibleと仮定しない。
3. Ground Vision CoverageとAerial Vision Coverageを区別する。
4. 重要Facility周辺がGround LOSで欠ける場合、Civilian Drone Baseの建設価値を加点する。
5. Warning後は新しい固定Compositionで方向別脅威を評価する。
6. 多人口Facility／Checkpointの感染陥落Spawn Riskを防衛優先度へ加える。
7. 感染者5人以上を残す陥落拠点付近のCombatをNoise Riskとして減点し、可能なら先に鎮圧する。
8. 即時州都防衛等ではNoise Riskより必要なCombatを優先できる。
9. 正確なNoise Radius、Hidden Enemy位置、内部LOS Line、内部Spawn候補を推測・使用しない。

Balanced Agentの目的は最適化保証ではなく、Human Playerと同じ公開情報で新Ruleを理解し、技術的失敗なく完走することである。

---

## 16. Metrics

### 16.1 Wave／初期配置

- 初期Normal Zombie数
- Wave別・方向別のNormal／Horde Zombie数
- 全WaveのNormal 63、Horde 30、合計93
- Final WaveのNormal 28、Horde 16、合計44

### 16.2 Noise

- Noise Class別Combat回数
- Police／National Guard Combat Noise発生回数
- Noiseで反応した陥落拠点数
- Noise再Spawn試行回数
- Noise再Spawnで実際に生成したNormal Zombie数
- 隣接空き不足で残った感染者数
- Noise起点の即時感染数と連鎖陥落数
- Police起点／National Guard起点の内訳

Hidden Enemyや正確なRadiusに関係する内訳はVerification／Batch専用とし、Active Game Observation、Production終了結果、公開Browser Bridge Artifactへ出さない。

### 16.3 LOS／Drone

各Player Turn開始時に次を記録する。

- `groundVisionPotentialHexes`: Terrain遮蔽がない場合のGround Source和集合
- `groundVisionVisibleHexes`: LOS適用後のGround Source和集合
- `groundVisionBlockedHexes`: 上2集合の差
- Run単位のBlocked Hex最大値とTurn平均
- Civilian Drone Base建設数と最大Vision Radius
- Aerial VisionがGround Blocked範囲内で新たに可視化したEnemy数

重複SourceはHex集合の和として1回だけ数える。Aerial VisionによるEnemy発見数はVerification／Batch専用とする。

### 16.4 感染／陥落／人口

- Site Kind／Type別の初回感染、感染陥落、Zombie占有破壊
- 陥落時実感染者数
- Requested／Actual Spawn数
- 陥落由来／Noise由来Normal Zombie数
- 最大6体Spawn発生回数
- 生成不能で残った感染者数
- 連鎖陥落数、最大Chain長、Chain起点
- `infectedPopulationConvertedToZombies`
- Constructible消滅時の残存感染者死亡数
- Turn 5以前のFacility／Checkpoint損失
- Human Unit損失、Civilian感染・死亡、Game Over Turn、Win Rate

健常者が感染した時点で既存の`civilianLosses`／`infectionLosses`へ計上する。感染者がZombie Unitへ変換されたときは1体につき5人を`infectedPopulationConvertedToZombies`へ計上し、同じ人を`civilianLosses`へ再加算しない。Constructible消滅時にZombie化しなかった残存感染者だけを死亡として計上する。

---

## 17. Save、Replay、Artifact

- GameStateはGame Rules 2.3.0のConfig完全コピー、Fixed Map v2、PRNG State、Event、感染者Poolを保存する。
- UIのToast表示済み状態、Bottom Sheet開閉、Map Camera、Vision Overlay開閉はGameStateへ保存しない。
- 重要イベント履歴は保存済みCore Eventから再構築する。
- Replayは同一Version、Config、Map、Seed、Action列から、Wave方向、LOS、Noise反応、陥落Spawn、配置PRNG、即時感染、FIFO連鎖、最終Stateを決定的に再現する。
- Save／Load、Session Resume、Checkpoint分岐の前後で、感染者数、生成済みUnit、Queue解決済み結果、Event列が一致する。
- 解決途中のQueueを外部から観測・保存可能な中間Stateにしない。1 Action内で原子的に最後まで解決してCommitする。
- Production ArtifactはHidden Enemy、正確なNoise Radius、内部Noise Target、非公開Spawn位置を含めない。

---

## 18. テスト要件

### 18.1 Noise

- Police Radius 4／`medium`を維持する。
- National Guard Radius 8／`large`となる。
- TerrainはNoiseを遮蔽しない。
- Horde ZombieはNoise Targetを持たない。
- Player Attack、Enemy Attack、Interceptionで1 Combat 1 Pulse、Counterattackで二重Pulseしない。
- Production Observationから正確なRadiusを直接取得できない。
- 実結果からRadiusを間接推測できても公開Schemaに内部値が含まれない。

### 18.2 Wave

- 標準5 Waveが5、10、10、24、44体をSpawnする。
- 全WaveがH30／N63／計93、FinalがH16／N28／計44となる。
- Normal追加用PRNGを消費しない。
- Warning前のRandom方向を公開しない。
- Warning後の方向別CompositionがUI、Observation、Event、Configで一致する。
- 同一Seed、Config、Action列で方向とSpawn結果が一致する。

### 18.3 Initial Zombie／Map

- Fixed Map IDが`fixed-31x31-v2`である。
- 固定配列の先頭6座標がv1.4.2から変わらない。
- 追加6座標が指定値、州都距離13、対向3組となる。
- 12座標が重複せず、Facility、Road、Urban、Reserve、初期Human Unitと重ならない。
- 標準Gameで初期Normal Zombieが12体となる。
- `initialZombieCount` 0..12を受理し、範囲外を状態・PRNG不変で拒否する。
- 初期配置でPRNGを消費しない。
- 全初期ZombieがHorde帰属を持たない。

### 18.4 LOS

- `Unit -> Forest -> Plain`でForestはVisible、PlainはHidden。
- `Unit -> Forest -> Forest`で手前ForestだけVisible。
- `Unit -> Mountain -> Plain`でMountainはVisible、PlainはHidden。
- SourceがForest／Mountain上でもSource自身は遮蔽しない。
- Road／Urban上でも基礎TerrainのBlockingを使用する。
- PlainだけのLineはVision RadiusまでVisible。
- Capital Ground Visionが5、初期Supply Radiusが5で独立Configとなる。
- Ground Source、UI、Observation、Agent、Replayで可視Hexが一致する。
- Zombie Vision、Noise、Combat射線はForest／Mountainで遮られない。
- 複数Sourceの和集合と`hexLine` Tie-breakを固定Scenarioで検証する。

### 18.5 Drone／Vision Schema

- DroneはForest／Mountain越しをVisibleにできる。
- Radiusは`workers × 2`を維持する。
- 無給電／OFF／Worker 0／非稼働時はVision 0となる。
- Ground SourceからHiddenでもDroneからVisibleならEnemyをObservationへ出す。
- 全公開Vision Sourceの`visionMode`、`terrainLosBlocking`、`vision`がRuleと一致する。
- Vision OverlayがCore Visibilityと一致し、遮蔽欠損とAerial範囲を区別する。

### 18.6 陥落Spawn境界

隣接空きが6Hex以上ある場合:

```text
infected 0  -> spawn 0, remaining 0
infected 1  -> spawn 0, remaining 1
infected 4  -> spawn 0, remaining 4
infected 5  -> spawn 1, remaining 0
infected 9  -> spawn 1, remaining 4
infected 10 -> spawn 2, remaining 0
infected 14 -> spawn 2, remaining 4
infected 15 -> spawn 3, remaining 0
infected 20 -> spawn 4, remaining 0
infected 25 -> spawn 5, remaining 0
infected 29 -> spawn 5, remaining 4
infected 30 -> spawn 6, remaining 0
infected 31 -> spawn 6, remaining 1
infected 60 -> spawn 6, remaining 30
```

- Capacity 50%補正を行わず、実感染者数だけを使用する。
- Checkpoint、Capital、恒久Facility、Constructible Facilityへ共通式を適用する。
- 空Checkpointは0体で破壊される。
- Spawnは距離1だけを使い、距離2以上へ配置しない。
- 空き4Hexで6体要求なら4体生成し20人だけ差し引く。
- Constructible消滅時の残存感染者を死亡として計上する。
- Wind Power Plantを感染者由来Spawn対象にしない。
- 生成Unitは次回Zombie Phaseまで移動・通常Attackしない。

### 18.7 即時占有／連鎖

- 生成先の健全Facility／Checkpointへ通常感染を1回適用する。
- 生成先のWind Power Plant／空Constructibleを即時Disableする。
- 即時感染で陥落した拠点から追加Spawnする。
- Unit ID順FIFOで各生成Unitを1回だけ処理する。
- 距離1、Zombie進入可能Terrain、Unit非占有の候補だけを使う。
- Chainが有限に終了し、同一Seedで同じ結果となる。
- 州都連鎖陥落は全Event／Spawn処理後に即時敗北となる。

### 18.8 Noise再Spawn

- 感染者5人未満、未陥落拠点、Wind、消滅Constructibleは反応しない。
- Police／National Guardそれぞれの内部Radiusを使用する。
- Combat全体の解決後に、拠点ID昇順で処理する。
- 感染者、隣接空き、最大6の最小値だけ生成する。
- 生成数×5だけ感染者を減らし、未生成分を保持する。
- 後のNoise Pulseで再試行できる。
- Noise再Spawnから即時感染と連鎖陥落が発生する。
- 共有隣接Hexの競合が処理順どおり決定的となる。
- Event／Metrics／Public ProjectionがHidden Spawn位置を漏らさない。

### 18.9 UI／Event

- 初回感染、陥落、Noise流出でToastと重要イベント履歴を更新する。
- 継続感染増加だけではToastを出さない。
- 同一ChainのToastを集約し、履歴は拠点別に残す。
- 履歴を最新50件に制限し、タップで正しいHexを選択する。
- Save／Load後に履歴が復元され、過去Toastを再表示しない。
- 視界外EventからHidden Zombie ID／配置Hexが漏れない。

### 18.10 Version／永続化

- Save Format 8だけを読み込み、旧データを明示拒否する。
- Fixed Map v1、Game Rules 2.2.0、Agent／Observation／Bridge 4.x、Artifact 3.xを暗黙変換しない。
- 拒否時に現在State、PRNG、旧データを変更しない。
- Save Round Trip、Replay、Artifact、Session、Checkpoint分岐でv1.4.3の全変更結果が一致する。

---

## 19. バランス検証と受入条件

### 19.1 自動Batch

- Random AgentとBalanced Agentを標準Config、Seed 1～100、Runner上限Turn 100で完遂する。
- Balanced Agentを標準Config、Seed 1～300、Runner上限Turn 100で完遂する。
- 技術的失敗、Invariant違反、決定性違反、Replay／Checkpoint不一致、FoW漏洩を0件とする。
- 勝率自体は自動テストの合否条件にしない。
- v1.4.2を同じSeed集合と上限で実行し、比較可能なJSON／CSV Artifactを保存する。

### 19.2 バランス再調整トリガー

次のいずれかに該当した場合、実装不合格とはせず、リリース前にバランス再調整を行う。

1. Balanced AgentのTurn 5到達前敗北率が、同じSeed 1～300のv1.4.2基準より10ポイント以上増える。
2. Balanced Agentの初回Wave到達率が80%未満になる。
3. 連鎖陥落だけで、健全な州都からPlayerの操作機会なしに即敗北する事例がSeed 1～300で発生する。

該当時は、初期Zombie数12と固定WaveのNormal Zombie増加量を最初に独立調整する。LOS、Drone、実感染者連動、Noise再Spawn、連鎖陥落の構造は可能な限り維持して再評価する。

### 19.3 外部AI Fair Play E2E

- 標準Config、Seed 1で外部AIをGame Overまで完走させる。
- API違反、Hidden情報利用、Replay不一致を0件とする。
- 勝利は合格条件にしない。
- v1.4.2のTurn 57勝利と比較し、Drone建設、Simple Farm建設、National Guard編成数、Human Unit損失、感染・連鎖陥落、勝敗Turnを記録する。

---

## 20. 本更新で変更しないもの

- Police／National GuardのHP、Attack、Movement、Attack Range、Vision Radius 5
- Normal Zombie／Horde ZombieのHP、Attack、Movement、Vision Radius 3
- Urban／ForestのCombat Defense
- Combat射線とTerrain Defenseの関係
- Supply Network
- Checkpoint Screening Capacity 20
- `passThrough / normal / strict`のPolicy率とTurn
- Fixed Wave Turn 5 / 10 / 20 / 35 / 50、Warning Lead 2、方向数、Horde Zombie数
- Horde ZombieのNoise無視
- Civilian Drone BaseのWorker Capacity、Required Power、`workers × 2` Vision Radius
- Simple FarmのFood出力とPower不要Rule
- Final Horde撃退、Supply内Zombie 0、Supply内感染0を要求する3条件Victory
- AI Portable Session、Checkpoint、Decision Traceの基本原則
- Hidden Enemyを直接公開しないFair Play境界
- Random Map、初期配置乱数化

---

## 21. 実装順

1. Version、Config、Fixed Map v2、初期12体、固定Wave Compositionを更新する。
2. `hexLine()`を使うGround LOS、Capital Vision分離、Aerial Vision、共通Visibilityを実装する。
3. 実感染者連動Spawn、隣接候補、Capacity補正撤廃、Checkpoint共通化を実装する。
4. 生成直後占有処理、FIFO連鎖、Noise再Spawn、原子的Action解決を実装する。
5. Event、Public Projection、Observation、Agent API、Browser Bridge、Save、Replay、Artifactを更新する。
6. Vision Overlay、Toast、重要イベント履歴、日英Help／Legendを更新する。
7. Balanced AgentとMetricsを更新する。
8. Unit、Invariant、Save、Replay、Artifact、Session、Browser Smoke、Buildを完遂する。
9. Seed 1～100、Balanced Seed 1～300、外部AI Seed 1を実行し、v1.4.2比較と再調整条件を確認する。
10. 実装・テスト・動作確認完了後に本書を現行仕様へ反映する。既存archive文書は変更しない。

---

## 22. 完了条件

- 本書の必須要件がGame Core、UI、Help、Agent、永続化、Artifactへ同じRuleから反映されている。
- UI／PhaserがGameStateを直接変更せず、全状態変更がGameAction → GameEngine経由である。
- LOS、Spawn、連鎖、Noise再SpawnがCoreの共通純粋関数または決定的処理を唯一の判定元とする。
- 全自動テスト、Invariant、Build、Browser Smoke、Save／Replay／Session検証が成功する。
- 複数Seed Batchと外部AI E2Eが技術的失敗なく完遂する。
- バランス再調整トリガーを確認し、該当時は再調整後に同じ検証を再実行する。
- v1.4.3確定要件、実装、Test、Help、公開Version、最終的な現行仕様の間に齟齬がない。
