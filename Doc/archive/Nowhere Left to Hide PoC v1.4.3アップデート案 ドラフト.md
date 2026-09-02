# Nowhere Left to Hide PoC v1.4.3 アップデート案 ドラフト

作成日: 2026-09-02  
ステータス: ドラフト  
対象Release: `1.4.3`

## 1. 文書の位置づけ

本書はv1.4.2のAIプレイ検証結果を踏まえ、v1.4.3で検討するゲームバランス、Combat Noise、Zombie配置・Wave、Player Vision / LOS、Civilian Drone Base、Facility感染陥落、Observation、Agent、Save、Replay、UI、Help、Metrics、Testの差分要件を整理するドラフトである。

安定版仕様の正本は引き続き`Doc/Nowhere Left to Hide PoC 現行仕様.md`とする。本書は実装確定前の次期案であり、現行仕様と矛盾する箇所では現行仕様を安定版の判断根拠、本書をv1.4.3候補要件として扱う。

本書で明記しないv1.4.2の仕様は維持する。

---

## 2. 背景と狙い

v1.4.2の外部AIプレイ（seed 1）では、Final Hordeを含む全Waveを撃退しTurn 57で勝利した。プレイ中はSimple FarmおよびCivilian Drone Baseを建設せず、最終的にNational Guardを12 Unitまで増強し、Human Unit損失0で勝利できた。

また、CheckpointのScreening Capacity 20によりStrict Policyでも人口供給が継続し、5 TurnのScreening Timeを持ちながら長期戦で人口を維持できた。Final局面では感染が大きく増加したものの、軍事戦線が崩壊する前にHordeを掃討できた。

この結果からv1.4.3では、ZombieのHPや基礎Attackを単純に上げるのではなく、次を強める。

1. National Guard大量運用のNoise Riskを増やす。
2. 各WaveへNormal Zombieを追加し、施設接触・感染の圧力を増やす。
3. 初期Normal Zombieを増やし、Wave外の平時脅威を増やす。
4. Forest / MountainへPlayer限定LOS遮蔽を導入し、地上偵察の情報量を制限する。
5. Civilian Drone Baseへ地上LOSでは代替できない航空偵察価値を与える。
6. Facility感染陥落時のNormal Zombie生成数を感染規模へ連動させ、大規模施設の陥落を局地的なアウトブレイクへ発展させる。

狙いは「州兵を大量生産し、射程2で見えている敵だけを処理する」単一解を弱め、偵察、地形、部隊配置、Noise、施設防衛、感染封じ込めを相互に関連させることである。

---

## 3. 変更概要

| 項目 | v1.4.2 | v1.4.3ドラフト |
|---|---|---|
| Police Combat Noise | 内部Radius 4 / Public Class `medium` | 変更なし |
| National Guard Combat Noise | 内部Radius 5 / Public Class `medium` | 内部Radius 8 / Public Class `large` |
| Wave追加Normal Zombie | なし | Wave単位で追加2～8体 |
| 初期配置Normal Zombie | 現行値 | 合計12体 |
| Player VisionのTerrain遮蔽 | なし | Forest / MountainがGround LOSを遮蔽 |
| Zombie VisionのTerrain遮蔽 | なし | 変更なし。遮蔽を受けない |
| Civilian Drone Base Vision | 給電時`workers × 2`、Terrain遮蔽なし | Vision Radiusは維持し、Ground LOS遮蔽を明示的に無視 |
| Facility感染陥落時Normal Zombie | 原則固定2体 | 感染者数連動、最低2・最大6体 |

---

## 4. National Guard Combat Noise強化

### 4.1 Core Rule

National Guardが参加する通常Combatで発生するCombat Noiseの内部Radiusを`5`から`8`へ変更する。

Policeは現行どおり内部Radius `4`を維持する。

```text
Police:
  noiseRadius = 4
  publicNoiseClass = medium

National Guard:
  noiseRadius = 8
  publicNoiseClass = large
```

Combat Noiseの発生条件、Normal Zombieだけが対象であること、Noise Targetの優先順位、既存Noise Targetを上書きしないこと、Horde ZombieがNoiseを無視すること等は現行仕様を維持する。

Terrain、Road、Forest、Mountain、UrbanによるNoiseの遮蔽・減衰は追加しない。LOSとNoiseは別ルールとする。

### 4.2 UI / Help

Production UIでは正確なNoise Radiusを表示しない現行原則を維持する。

- Police: `Noise: Medium` / `ノイズ: 中`
- National Guard: `Noise: Large` / `ノイズ: 大`

Help、Unit詳細、Combat Log、Board Legend等でPoliceとNational GuardのNoise Class差を説明する。

National Guardについては、強力な射程2火力と引き換えに広い範囲のNormal Zombieを誘引し得ることを明示する。

### 4.3 Observation / Agent API

公開Observation、`getApiInfo()`、Public Event、Browser BridgeではNational GuardのNoise Classを`large`へ変更する。

公開経路では従来どおりHidden Enemyを推測できる正確なRadius、反応Zombie数、対象ID、Noise Targetを返さない。

開発Build、Verification Artifact、内部Configでは決定的Replayと検証のため正確なRadius `8`を保持できる。

Balanced AgentはNational GuardのNoise Riskを`large`として評価し、視界外Normal Zombieを正確に推定してはならない。

---

## 5. 各WaveへのNormal Zombie追加

### 5.1 基本要件

固定Wave Scheduleの各Waveへ、既存Compositionに加えてNormal Zombieを`2～8体`追加する。

本ドラフトでは追加数は**Wave全体の合計**とし、方向ごとに2～8体を追加する意味ではない。

標準Ruleでは各Wave Spawn時にGame PRNGから整数`2..8`を1回だけ決定する。

```text
extraNormalZombieCount = randomIntInclusive(2, 8)
```

同一Seed、同一Config、同一Action列では同じ追加数となること。

### 5.2 対象Wave

通常WaveとFinal Waveの両方を対象とする。

既存のHorde Zombie数、既存Normal Zombie数、Wave Turn、方向数、Warning Lead、Final flagは本変更だけでは変更しない。

追加個体は既存Normal Zombieと同じ`zombie` Type、HP、Attack、Movement、Targeting、Noise Ruleを使用する。

Horde由来Normal Zombieとして、そのWaveの`spawnGroupId` / `hordeKind`帰属を持つ現行原則を維持する。

### 5.3 方向配分

複数方向Waveでは、追加Normal ZombieをWave全体の対象方向へ可能な限り均等に配分する。

```text
base = floor(extra / directionCount)
remainder = extra % directionCount
```

全方向へ`base`体ずつ追加し、`remainder`体はWarningで確定した方向配列の先頭から1体ずつ追加する。

この配分自体では追加PRNGを消費しない。

### 5.4 Warning / Observation

Warning発生後は、既存Compositionに加え、そのWaveで確定した追加Normal Zombie数および方向別の最終予定CompositionをHuman UIとAgent Observationへ公開する。

Warning前は、現行のFog / Future Random Information境界を維持し、未確定追加数や将来方向を公開しない。

`horde_warning`および`horde_spawned` Eventは最終的な方向別Normal Zombie数と合計数を反映する。

---

## 6. 初期配置Normal Zombie増加

新規ゲーム開始時の初期配置Normal Zombie合計数を`12体`へ変更する。

初期配置Zombieは従来どおりHorde由来ではなく、`spawnGroupId = null`、`hordeKind = null`とする。

配置位置、禁止Hex、重複防止、Seed付き乱数、初期視界による公開範囲等は現行の初期配置ルールを維持する。

本変更ではNormal Zombie自体のHP、Attack、Movement、Vision、Targetingは変更しない。

初期配置数増加によって序盤難易度が過度に上昇していないかを、Turn 5以前のCheckpoint / Facility損失率、敗北率、初回Wave到達率で重点確認する。

---

## 7. Forest / MountainのPlayer限定LOS遮蔽

### 7.1 基本原則

ForestおよびMountainをPlayer側Ground Visionに対するLOS Blocking Terrainとする。

Zombie / Horde Zombieは臭覚・聴覚等により人間より優れた探知能力を持つ世界設定とし、Terrain LOS遮蔽を受けない。Zombie Vision Radius `3`とTargetingの基本原則は維持する。

Combat NoiseもLOS遮蔽を受けない。

### 7.2 Ground LOS Source

Ground LOS判定を使用するPlayer側Vision Sourceは次とする。

- Police
- National Guard
- Capital
- Player所有かつ未陥落の通常Facility
- Active Checkpoint
- その他、将来追加される地上Vision Source

現行ではCapital / Facility / Active CheckpointのVision Radiusは1のため、Forest / Mountain遮蔽による実質的な影響は主にPolice / National GuardのVision Radius 5に発生する。

Civilian Drone Baseは航空偵察SourceとしてGround LOS判定から除外する。

### 7.3 LOS判定

Player Ground Vision SourceからTarget HexまでHex lineを決定的に引く。

- Source Hex自身は遮蔽判定へ含めない。
- Sourceから見て最初に現れるForest / Mountain HexそのものはVisibleとする。
- そのForest / Mountain Hexより先にあるHexは、そのLOS上ではVisibleにしない。
- Target Hex自身が最初のForest / Mountainである場合、そのTarget HexはVisibleとする。
- Targetまでの途中HexにForest / Mountainが1つでもある場合、その先のTargetはVisibleにしない。
- Plain、Road、Urbanは本変更ではLOSを遮蔽しない。
- RoadがForest / Mountain上に存在する場合でも、基礎TerrainがForest / MountainならLOS Blockerとして扱う。

例:

```text
Unit -> Forest -> Plain
```

ForestはVisible、奥のPlainはHidden。

```text
Unit -> Forest -> Forest
```

手前のForestはVisible、奥のForestはHidden。

```text
Unit -> Plain -> Mountain -> Plain
```

PlainとMountainまではVisible、Mountainの奥のPlainはHidden。

```text
Unit standing in Forest -> adjacent Forest -> next Forest
```

Source Hex自身は遮蔽しないため隣接ForestはVisibleだが、その奥はHidden。

### 7.4 Hex Lineの決定性

Hex格子上で境界を通る等、複数の同等Line候補が生じ得る場合もUI、Core、Agent、Replayで同じ結果を返す必要がある。

LOS判定は共通の純粋関数を唯一の判定元とし、描画側やAgent側で独自に近似しない。

Tie-break規則は実装時に固定し、同一Map / Source / Targetに対して常に同じLineを選ぶ。

### 7.5 Fog of War

Player Visibilityは各Vision Sourceの可視Hex集合の和集合とする現行原則を維持する。

あるGround UnitからLOSが遮られていても、別のGround SourceまたはCivilian Drone BaseからVisibleならそのHexはPlayer Visibleとなる。

Visibility外Enemyの位置、個体情報、Target、移動、正確なSpawn位置、Last Known Positionを公開しない現行Fair Play境界を維持する。

---

## 8. Civilian Drone Baseの航空偵察

Civilian Drone BaseはForest / Mountain LOSの影響を一切受けない。

給電・Worker条件とVision Radiusは現行どおり維持する。

```text
visionRadius = workers * 2
```

Civilian Drone Baseが提供するVisionは、Radius以内のHexをTerrainに関係なくVisibleにする。

- Forestを越えて視認できる。
- Mountainを越えて視認できる。
- Forest / Mountain内部のEnemyもRadius内ならVisibleにできる。
- Ground Unit LOSのBlocking計算を行わない。

これは空中からの偵察による特性とする。

将来のFlying Unit / Aerial Recon Sourceを追加する場合も、原則として同じ`ignoresGroundLosBlocking = true`系の能力として扱える設計を推奨する。

Human UIとHelpではCivilian Drone Baseを「地形遮蔽を無視する航空偵察」と明記し、Simple Farmと同様に任意建設Facilityを選ぶ意味を明確化する。

Balanced AgentはHorde Warning方向、Forest / MountainによるVision Coverage欠損、重要Facility周辺のFog、電力余力を評価し、Civilian Drone Base建設価値へ反映する。

---

## 9. Facility感染陥落時のNormal Zombie生成数

### 9.1 対象

感染によってFacility内の健全な人間が0となり、Facilityが陥落する処理を対象とする。

対象には、感染陥落時にNormal Zombieを生成する既存の恒久FacilityおよびConstructible Facilityを含む。

Wind Power Plantのように感染者Poolを持たず、Zombie占有で`disabled`となるだけのFacilityは対象外とする。

### 9.2 Spawn Count

陥落判定時点のFacility内感染者数を`infectedAtFall`とする。

生成するNormal Zombie Unit数は次で求める。

```text
spawnCount = clamp(floor(infectedAtFall / 5), 2, 6)
```

最低2 Unitを保証し、最大6 Unitとする。

例:

| 陥落時感染者数 | Spawn Normal Zombie |
|---:|---:|
| 1～14 | 2 |
| 15～19 | 3 |
| 20～24 | 4 |
| 25～29 | 5 |
| 30以上 | 6 |

`infectedAtFall`が0では感染陥落条件そのものが成立しないものとする。

### 9.3 感染者Poolからの減算

陥落判定時点で`infectedAtFall >= 30`の場合、Facility内感染者数から次を減算する。

```text
spawnedPopulationEquivalent = spawnCount * 5
remainingInfected = infectedAtFall - spawnedPopulationEquivalent
```

30人未満の場合は、この減算を行わない。

例:

| 陥落時感染者数 | Spawn数 | 減算 | 陥落後感染者数 |
|---:|---:|---:|---:|
| 25 | 5 | 0 | 25 |
| 29 | 5 | 0 | 29 |
| 30 | 6 | 30 | 0 |
| 31 | 6 | 30 | 1 |
| 40 | 6 | 30 | 10 |
| 60 | 6 | 30 | 30 |

この30人閾値は本ドラフトの明示仕様とし、実装側で「全感染者数から常にspawnCount×5を引く」ルールへ読み替えない。

### 9.4 Spawn Timing / Behavior

生成されるUnitは既存Normal Zombieと同じType、HP、Attack、Movement、Vision、Targetingを持つ。

Spawn位置、同Hex処理、隣接配置、Unit ID付与、行動開始タイミングは既存のFacility陥落時Zombie生成ルールを維持する。

既存Ruleが「陥落した同Zombie Phase中には新規生成Unitを行動させず、次のZombie Phase SnapshotからTargetingへ参加させる」場合はその挙動を維持し、生成数変更だけで追加即時行動を導入しない。

### 9.5 UI / Observation / Event

Facility陥落Eventは最低限次を公開できるようにする。

- Facility ID / Type
- 陥落理由が感染であること
- 陥落時感染者数（そのFacilityがPlayer公開情報として既知である範囲）
- 生成されたNormal Zombie数
- 陥落後に残る感染者数

Hidden Facility / Hidden Enemy情報を新たに漏らさない。

Human UIでは大人口Facilityほど陥落時に多数のZombieが溢れ出す可能性をHelpへ明記する。

---

## 10. Observation / API / Fair Play要件

v1.4.3ではLOSとNoise Classの変更により、Human UIとAgent Observationの情報差を作らない。

### 10.1 Terrain / Visibility

Map Terrainは従来どおり公開し、各Hexの`visibleToPlayer`は新しいLOS Core Ruleから計算する。

AgentはForest / MountainがGround LOSを遮蔽する静的Ruleを`getApiInfo()`から知ることができる。

Observationからは各自軍Unit / Vision Sourceの公開Vision特性として最低限次を判断できるようにする。

- Ground / Aerial Visionの区分、または同等の公開Capability
- Vision Radius
- Terrain LOS Blockingを受けるか

ただしHidden Enemy位置を逆算できる内部Line探索結果やEnemy別検出Reasonを公開する必要はない。

### 10.2 Noise

Public Noise Classは次へ更新する。

- Police: `medium`
- National Guard: `large`

正確なRadiusはProduction Observationへ出さない現行原則を維持する。

### 10.3 Wave

Warning後のObservationは追加Normal Zombieを含む最終Compositionを返す。

Warning前には未確定の追加数を返さない。

### 10.4 Facility Fall

Playerが公開情報として把握できるFacility陥落について、Event / Observation / Run Artifactは生成Normal Zombie数を正しく反映する。

Hidden Enemyの個体IDや非公開Targetは追加しない。

---

## 11. Balanced Agent更新

Balanced Agentはv1.4.3ルールへ追随し、少なくとも次を評価する。

1. National GuardのPublic Noise Class `large`をPolice `medium`より高い誘引リスクとして扱う。
2. Forest / Mountainで遮られたHexをVisibleと仮定しない。
3. Ground Vision CoverageとAerial Vision Coverageを区別する。
4. Forest / Mountain越しに重要Facility周辺がFogとなる場合、Civilian Drone Baseの価値を加点する。
5. Warning後は追加Normal Zombieを含む最終Compositionで方向別脅威を評価する。
6. 多人口Facilityの感染陥落が最大6 Normal Zombieを生成し得るため、感染率だけでなく陥落時Spawn Riskを防衛優先度へ加える。
7. Hidden Enemy位置、正確なNoise Radius、内部LOS判定履歴を推測・使用しない。

Balanced Agentの目的は新ルール下で最適化することではなく、Human Playerと同じ公開情報だけでゲームを完走し、変更点がAPIから理解可能であることを確認することである。

---

## 12. Save / Replay / Artifact / Version境界

本変更は少なくとも次へ影響する。

- Game Rules / Config
- Vision / Observation
- Noise Public Class
- Wave Spawn結果
- Initial Zombie配置数
- Facility陥落時Spawn結果
- Replay決定性
- Verification Artifact
- Balanced Agent評価

Version番号の具体的な更新値は要件確定時に決める。

ただしv1.4.2 Save / Replay / Artifact / Sessionをv1.4.3へ暗黙変換し、異なるRules / Configの状態として再開することは避ける。既存のVersion一致検証と明示拒否原則を維持する。

Replayは同一Seed / Config / Action列から、Wave追加数、初期Zombie配置、Noise反応、LOS、Facility陥落Spawn数を決定的に再現できること。

Production ArtifactはFair Play境界を維持し、Hidden Enemy、正確なNoise Radius、内部Noise Target等を含めない。

---

## 13. UI / Help要件

最低限、日英HelpとPlayer-facing UIへ次を反映する。

- Police Noise: Medium / 中
- National Guard Noise: Large / 大
- National Guardは広範囲のNormal Zombieを誘引し得る
- Forest / Mountainは地上視界を遮る
- 遮蔽Terrainそのものは見えるが、その奥は見えない
- ZombieはTerrain LOS遮蔽を受けない
- Civilian Drone Baseは空中偵察のためForest / Mountainを無視する
- Waveには追加Normal Zombieが混ざる
- 大人口Facilityの感染陥落では最大6 Normal Zombie Unitが発生し得る

Board上ではFoW表示、Unit Vision Overlay、Drone Vision Overlayが新しいCore Visibilityと一致すること。

可能であればVision OverlayではGround LOSで遮られた境界を視覚的に理解できる表示を検討する。ただしUI独自のVisibility計算は持たない。

---

## 14. Metrics追加・更新

バランス検証のため最低限次を記録または集計可能にする。

- 初期Normal Zombie数
- Wave別追加Normal Zombie数
- Wave別最終Normal / Horde数
- National Guard Combat Noise発生回数
- Noise Class別Combat回数
- Forest / Mountain LOSによるGround Vision欠損Hex数または同等のCoverage指標
- Civilian Drone Base建設数
- Civilian Drone Base最大Vision Radius
- Aerial Visionで新規発見したEnemy数（Verification / Aggregate用途。Active GameのHidden情報を漏らさない）
- Facility感染陥落回数
- Facility陥落時感染者数
- 陥落由来Normal Zombie生成数
- 最大6体Spawn発生回数
- Turn 5以前のFacility / Checkpoint損失
- Human Unit損失
- Civilian感染・死亡
- Game Over Turn / Win Rate

Hidden Enemy由来の詳細MetricsはVerification Artifact / Batch集計専用とし、Active Game ObservationやProduction Browser Bridgeへ漏らさない。

---

## 15. テスト要件

### 15.1 Noise

- Police Combat Noise Radiusが4のまま変わらない。
- National Guard Combat Noise Radiusが8となる。
- Public ClassがPolice `medium`、National Guard `large`となる。
- TerrainはNoiseを遮蔽しない。
- Horde ZombieはNoise Targetを持たない。
- Production Observationから正確なRadiusを取得できない。

### 15.2 Wave

- 全Waveで追加Normal Zombieが2～8体の範囲となる。
- 追加数は方向数倍されずWave全体の合計である。
- 複数方向へ規定どおり均等配分される。
- Warning前は未確定追加数を公開しない。
- Warning後は最終CompositionをHuman UIとObservationで一致して表示する。
- 同一Seed / Config / Action列で追加数と配分が一致する。

### 15.3 Initial Zombie

- 新規標準Gameで初期Normal Zombieが12体生成される。
- 初期ZombieはHorde帰属を持たない。
- 同一Seedで配置が再現される。

### 15.4 LOS

- `Unit -> Forest -> Plain`でForestはVisible、PlainはHidden。
- `Unit -> Forest -> Forest`で手前ForestだけVisible。
- `Unit -> Mountain -> Plain`でMountainはVisible、PlainはHidden。
- SourceがForest / Mountain上でもSource自身は遮蔽しない。
- Plain / Urban / RoadだけのLineは現行Vision RadiusまでVisible。
- Ground Unit、UI、Agent Observation、Replayで結果が一致する。
- Zombie / Horde ZombieのVisionはForest / Mountainで遮られない。
- NoiseはForest / Mountainで遮られない。

### 15.5 Drone

- Civilian Drone BaseはForest / Mountain越しをVisibleにできる。
- Radiusは`workers × 2`を維持する。
- 無給電ではVision 0。
- 別Ground SourceからHiddenでもDroneからVisibleならEnemyをObservationへ出す。

### 15.6 Facility陥落Spawn

境界値を最低限次で確認する。

```text
infected 1  -> spawn 2
infected 5  -> spawn 2
infected 10 -> spawn 2
infected 14 -> spawn 2
infected 15 -> spawn 3
infected 20 -> spawn 4
infected 25 -> spawn 5
infected 29 -> spawn 5, remaining infected 29
infected 30 -> spawn 6, remaining infected 0
infected 31 -> spawn 6, remaining infected 1
infected 60 -> spawn 6, remaining infected 30
```

- 30人未満では感染者Poolを減算しない。
- 30人以上では`spawnCount × 5`を減算する。
- 最大6 Unitを超えない。
- Wind Power Plant等の非感染Facilityへ適用しない。
- Spawn Unitの行動開始タイミングは既存Facility陥落Ruleを維持する。

---

## 16. バランス検証方針

v1.4.3は複数の変更が相互作用するため、単一Seedの勝敗だけで判断しない。

特に次を比較する。

1. seed 1をv1.4.2と同様の外部AI Fair Play条件で再プレイする。
2. 複数SeedでBalanced Agent完走率と序盤敗北率を比較する。
3. National Guard編成数がv1.4.2のように一方向に増え続けるか確認する。
4. Civilian Drone BaseがHuman / Balanced / 外部AIのいずれでも自発的な選択肢になるか確認する。
5. Simple Farmが引き続き完全に不要か、Zombie圧力とFacility損失増加によって冗長Food源として価値が出るか確認する。
6. 初期Zombie 12体によりTurn 5以前の敗北が突出しないか確認する。
7. Facility陥落が連鎖的アウトブレイクを生む一方、不可逆な即死連鎖になっていないか確認する。
8. Final Hordeが「州兵大量配置だけでHuman Unit損失0・短期掃討」となる頻度が下がるか確認する。

難易度上昇が過大だった場合は、まず初期配置Zombie数とWave追加数を独立に調整し、LOS / Drone / Facility陥落の構造的変更は可能な限り維持して評価する。

---

## 17. 本ドラフトで変更しないもの

本書に明記した項目を除き、次はv1.4.2を維持する。

- Police / National GuardのHP、Attack、Movement、Attack Range
- Normal Zombie / Horde ZombieのHP、Attack、Movement
- Urban / ForestのCombat Defense
- Supply Network
- Checkpoint Screening Capacity 20
- `passThrough / normal / strict`のPolicy率とTurn
- Fixed Wave Turn 5 / 10 / 20 / 35 / 50
- Warning Lead 2
- Horde ZombieのNoise無視
- Civilian Drone BaseのWorker Capacity、Required Power、`workers × 2` Vision Radius
- Simple FarmのFood出力とPower不要Rule
- Final Horde撃退後もSupply内Zombie 0とSupply内感染0を要求する3条件Victory
- AI Portable Session、Checkpoint、Decision Traceの基本原則
- Hidden Enemyを公開しないFair Play境界

---

## 18. 確定前チェックリスト

- [ ] National Guard Noise `large`のHuman UI文言とAgent公開形式を確定する。
- [ ] Wave追加2～8体のPRNG消費順と方向配分を実装仕様へ固定する。
- [ ] Hex LOSのLine / Tie-breakアルゴリズムを共通Core関数として固定する。
- [ ] Ground / Aerial Vision CapabilityのSchema表現を決める。
- [ ] Facility陥落Spawn Ruleを恒久Facility / Constructible Facilityの全対象へ統一適用できるか確認する。
- [ ] 30人未満は感染者Poolを減らさず、30人以上のみ`spawnCount × 5`を減算する境界仕様を再確認する。
- [ ] Game Rules / Save / Observation / Artifact / Agent Version境界を確定する。
- [ ] Human UI / Help / Agent API / Browser Bridge / ReplayのVisibility一致を確認する。
- [ ] seed 1外部AI E2Eと複数Seed Batchを実施する。
- [ ] v1.4.2との比較Metricsを保存する。
