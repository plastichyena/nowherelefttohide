# Nowhere Left to Hide PoC v1.6.3 アップデート要件 ドラフト

- ステータス: **履歴資料。2026-09-20の第1〜52問の回答を確定版へ統合済み。現行判断には使用しない。**
- 作成日: 2026-09-20
- 基準: v1.6.2 / main commit `821446dc508a1530f8d216fa9806dedcacd31ada`
- 根拠: 2026-09-19 Claude Opus 5によるv1.6.2長時間プレイテスト、同プレイログ、依頼者との人口・感染・資源・AI Context管理に関する検討
- 本書はv1.6.2のプレイ感と既存Core境界をできるだけ維持しながら、人口維持の意味を分かりやすくし、長時間AIプレイのContext driftを抑え、水辺・原子力発電所・特殊部隊・Pack Zombiesを追加するv1.6.3要件を定義する。
- Random Map本体、飛行Unit本体、医療品という独立Resource、治療Action、Zombie AI全体の再設計はv1.6.3では導入しない。

---

## 1. 目的

v1.6.3の主目的は次の5点とする。

1. v1.6.2プレイテストで露呈した「豊富なResourceを保持したまま健康人口、とくにCapital住民を使い切る」判断を、Coreルールと公開Forecastで自然に防ぎ、人口を戦略資産として認識しやすくする。
2. Food / Civilian Goods不足、過密、CheckpointのNormal / Pass Through運用が「即時人口削除」ではなく、公衆衛生悪化と内部感染リスクにつながる形へ整理する。ただしZombieによる直接感染・Unit死亡時再アニメーション等の既存直接感染ルールは変えない。
3. v1.6.2で有効だったCompact / query / importantChangesを維持しつつ、CodexのContext checkpoint / handoff型compactionを参考に、長時間AI Sessionで古いtool出力を読み続ける必要を減らす。
4. Waterを実地形として有効化し、Bridge semanticsを定義する。
5. Nuclear Power Plant / Special Forces / Pack Zombiesを、既存のCapture、Proficiency、Horde、Fog of War、Replay / Artifact原則に統合する。

### 1.1 設計原則

- 「LLMに勝たせる」ために攻略判断をCoreが代行しない。
- Rule、現在状態、Actionの結果、危険の因果は十分に公開し、情報不足や過去ルール忘却による敗北を減らす。
- Resource不足やCheckpoint policyのリスクは、Player / Agentが事前にForecastできる。
- Infection RNGはSeed付き決定性を維持する。
- 公開Context圧縮はcanonical Decision Log / Replay / Artifactを削除・改変しない。
- 直接Zombie接触に由来する感染と、公衆衛生悪化・審査に由来する潜伏感染を別レイヤーとして扱う。
- 新しい「医療品」Resourceや「Exposure meter」は追加しない。Civilian Goodsが医薬品・衛生用品・衣類・寝具・消毒・一般生活物資等を抽象化している現行思想を利用する。

---

## 2. 要求一覧

| ID | 内容 | 扱い |
| --- | --- | --- |
| POP-CAP-01 | 自発的な人口操作でCapital健康住民を0人にできない。最低1人を残す | 必須 |
| REF-01 | Normal / Strict screeningは最終的に100%受入 | 必須 |
| REF-02 | Strict screeningを5 Turnへ戻す。潜伏感染0を維持 | 必須 |
| REF-03 | Pass Through / Normalの潜伏感染を1人単位確率へ変更 | 必須 |
| HEALTH-01 | Food / Civilian Goods部分不足では即時市民死亡を行わず、公衆衛生stressを蓄積 | 必須 |
| HEALTH-02 | 公衆衛生stress、過密、Housing outageから内部感染確率を算出 | 必須 |
| HEALTH-03 | Zombie直接感染・Unit死亡時再アニメーション等の直接感染ルールは据え置き | 必須 |
| OVER-01 | 過密Resource増加を全国一括倍率から施設単位式へ変更 | 必須 |
| REFINE-01 | Refinery Allowance枯渇前のrunway warningを追加 | 必須 |
| CTX-01 | 5 TurnごとのAgent Context Checkpoint / Compactionを追加 | 必須 |
| CTX-02 | CompactionはCore current truthを毎回再生成し、canonical historyを削除しない | 必須 |
| CTX-03 | preferredCommentLocale等のdurable constraintsを毎回再掲 | 必須 |
| MAP-WATER-01 | Waterを実地形として有効化しGround Unit進入不可 | 必須 |
| MAP-BRIDGE-01 | Water + Road overlayをBridgeとしてGround Unit進入可 | 必須 |
| MAP-BAY-01 | 4隅のうちSeedで1方向を選び湾状Waterを生成 | 必須 |
| FAC-NUC-01 | Water隣接Neutral Nuclear Power Plantを1施設配置 | 必須 |
| FAC-NUC-02 | Nuclear Power Plantは5 workers、500 electricity / worker、Fuel消費なし | 必須 |
| FAC-NUC-03 | Turn 20までの初回確保でRegular Special Forces 1 Unitを報酬 | 必須 |
| FAC-NUC-04 | Turn 21開始時に未確保ならNuclear Power PlantでPack Zombie 1 Unit発生 | 必須 |
| UNIT-SF-01 | Special Forces追加。生産不可、Regular 3 attacks、Veteran 4 attacks | 必須 |
| UNIT-PACK-01 | Pack Zombie追加。Special Forces死亡時に同Hexへ再アニメーション | 必須 |
| UNIT-PACK-02 | Pack Zombieは通常Wave/random spawn対象外、Final Waveに1 Unit確定 | 必須 |
| ASSET-01 | Water / Nuclear / Special Forces / Packの表示・説明・Asset対応 | 必須 |
| COMPAT-01 | v1.6.2以前のSave / Session / Checkpoint / Artifact互換は提供しない | 必須 |

---

## 3. Capital最低1名 — POP-CAP-01

### 3.1 ルール

Playerが自発的に行う人口操作によって、`capital.workers`を0へ減らすことを禁止する。

対象:
- `TransferPopulation`でCapitalから出す。
- `AssignWorkers`等、Supply population poolから自動的に人口を引き抜くAction。
- `ProduceUnit`の人口予約・徴兵。
- 将来追加されるPlayer起因の人口再配置でCapitalをwithdraw sourceにする処理。

非対象:
- Zombieによる感染・施設陥落。
- Resource完全崩壊による非自発的損失。
- その他敵対Event・事故による人口減少。

Capital健康住民が0になること自体はGame Stateとして合法であり、敵の結果として発生し得る。既存のCapital陥落条件は維持する。

### 3.2 Withdrawal順序

Supply populationを自動withdrawする共通処理では、Capitalの`workers - 1`だけをwithdraw可能人口として扱う。他の合法Supply cityに人口がある場合はそちらを利用してActionを成立させてよい。

合法Actionを成立させるために必要な人口が、Capitalの最低1人を保護すると不足する場合はActionを拒否する。

推奨reason code:

```text
capital_minimum_resident_required
```

Player向け理由:

> 州都の行政・避難機能を維持するため、健康な住民を最低1人残す必要があります。

### 3.3 Preview / Agent API

人口を消費・移動するPreviewには最低限次を追加する。

- `capitalResidents.before`
- `capitalResidents.after`
- `capitalMinimum = 1`
- `capitalResidentDelta`
- 拒否時reason code

これにより「健康人口 -10」だけでなく、そのActionがCapitalを空にするかを直接読めるようにする。

---

## 4. Checkpoint screening再設計 — REF-01..03

### 4.1 Policy既定値

| Policy | Screening Turn | Healthy acceptance | Screening由来潜伏感染 |
| --- | ---: | ---: | --- |
| Pass Through | 0 | 100% | 高 |
| Normal | 2 | 100% | 低〜中 |
| Strict | 5 | 100% | 0 |
| Deny | 0 | 0% | 0 |

Config既定値:

```text
passThrough.workerRate = 1.0
normal.workerRate      = 1.0
strict.workerRate      = 1.0
deny.workerRate        = 0.0

passThrough.turns = 0
normal.turns      = 2
strict.turns      = 5
deny.turns        = 0
```

Normal / Strictは「審査に落ちたため人口そのものを失う」仕組みを廃止する。Normal / Strictの`refugeesRejectedByDirectionAndPolicy`は既定ルールでは増加しない。Playerが明示的にTurn Away / Denyした人口だけが離脱・将来Horde加算の対象となる。

### 4.2 潜伏感染の基本確率

v1.6.2の期待感染人数を大きく変えず、all-or-nothingな集団発症を1人単位のSeeded binomialへ置き換える。

基礎確率:

```text
p0(passThrough) = 0.25
p0(normal)      = 0.05
p0(strict)      = 0
```

理由:
- v1.6.2 Normal: 20人screening時、15人受入 × 25% event × 25%感染 ≒ 0.94人期待値。
- v1.6.3 Normal: 20人受入 × 5% ≒ 1.0人期待値。
- Pass Throughは従来期待値20 × 50% event × 50%感染 = 5人を、20 × 25% = 5人として概ね維持する。

これは実在感染症の疫学値を主張する数値ではなく、既存ゲーム難易度を保ちながら「1人ごとの潜伏感染」に解釈し直すゲーム係数である。

### 4.3 Checkpoint衛生補正

CheckpointでreleaseされるPass Through / Normalの各人について、次を使用する。

```text
queuePopulation = waiting + screening + approved
Q = clamp((queuePopulation / screeningCapacity) - 1, 0, 1)

F = current publicHealthStress.food
C = current publicHealthStress.civilianGoods

p = clamp(
      p0 * (1 + 0.50*Q + 0.75*F + 1.00*C),
      0,
      policyCap
    )

policyCap(passThrough) = 0.60
policyCap(normal)      = 0.20
policyCap(strict)      = 0
```

`latentInfected ~ Binomial(acceptedPeople, p)`をSession Seed / RNG streamで決定する。

Strictはどの補正下でもscreening由来のlatent infectionを0とする。Strictの5 Turnは、十分な観察、隔離、衛生管理、休養、一般的な対症・支持療法等をCivilian Goodsと時間で抽象化しているものとする。独立した薬品Resourceや治療Actionは導入しない。

### 4.4 待機Queue感染

v1.6.2の固定`waitingRiskThreshold = 100`型の急な境界は廃止し、Queue過密に応じた連続的riskへ置換する。

Waiting populationに対する1人あたりTurn risk:

```text
rawQ = max(0, (queuePopulation / screeningCapacity) - 1)

p_wait = clamp(
           0.01 * rawQ * (1 + 0.50*F + 1.00*C),
           0,
           0.12
         )
```

各EndTurnで`Binomial(waiting, p_wait)`をSeeded RNGで評価する。発生した感染者は既存のCheckpoint infected poolへ移す。これは「Strictが潜伏感染を見逃す」こととは別であり、長い待機列そのものの衛生悪化を表す。

### 4.5 UI / Agentへの提示

Policy説明には「受入率」ではなく次を表示する。

- 処理Turn
- 全員受入か
- screening由来latent infectionの基礎risk
- Strictはrelease時latent infection 0
- 現在Queueの衛生risk
- Food / Civilian Goods公衆衛生stressがriskを上げている場合、その原因

---

## 5. 公衆衛生・Resource不足 — HEALTH-01..03

### 5.1 三層モデル

#### Layer A: 直接Zombie由来 — **既存仕様を変更しない**

次はv1.6.2の既存処理を維持する。

- Human UnitがZombieに倒された場合の対応Zombieへのreanimation。
- ZombieがFacility / Checkpointへ到達・感染Actionを行った場合の既存感染人数処理。
- Gas Zombie explosion等の直接感染。
- Site fall / infected population / Zombie spawnの既存関係。

Food / Civilian Goods状態はこれらの直接感染量を軽減しない。

#### Layer B: Checkpoint由来latent infection

第4章のPolicy / Queue計算を使用する。

#### Layer C: 生活環境由来internal infection

Food / Civilian Goods不足、Permanent Cityの過密、Temporary Housing outageによって住民の健康・衛生状態が悪化し、低レベルの潜伏感染を免疫・支持療法で抑えきれなくなることを抽象化する。

新しいExposure gaugeやMedical Resourceは作らない。

### 5.2 Resource deficit ratio

各EndTurn Forecastについて:

```text
foodDeficit =
  maintenanceRequiredFood > 0
    ? foodShortage / maintenanceRequiredFood
    : 0

civilianGoodsDeficit =
  maintenanceRequiredCG > 0
    ? civilianGoodsMaintenanceShortage / maintenanceRequiredCG
    : 0
```

0..1へclampする。Military production input shortageはCivilian Goodsの住民健康deficitには含めず、住民maintenance不足だけを使う。

### 5.3 Public Health Stress

GameStateに次の公開可能な0..1値を保持する。

```text
publicHealthStress.food
publicHealthStress.civilianGoods
```

EndTurnごとの更新:

```text
S_next = clamp(0.75 * S_current + 0.40 * deficitRatio, 0, 1)
```

供給が復旧して`deficitRatio = 0`ならStressはTurnごとに25%ずつ減衰する。短期不足より継続不足が危険になる。

### 5.4 部分不足と完全供給崩壊

Resource stockが尽き、maintenance shortageが発生していても、当該ResourceのそのTurnのprojected productionが**1以上**なら、v1.6.2の`shortage amount = 即人口死亡`を適用しない。

代わりにPublic Health Stressを上げ、第5.6節のinternal infection riskへ反映する。

ただし:

```text
projectedProduction == 0 && maintenanceShortage > 0
```

の完全供給崩壊では、v1.6.2のResource shortage人口損失をfallbackとして維持する。これは「最低限の供給すら存在しない」状態を従来どおり致命的に扱うためである。

完全供給崩壊時は対応する`publicHealthStress`も1へ引き上げる。

### 5.5 Facility public-health pressure

各Player所有staffed Facilityについて:

```text
O_i = overcrowdingPressure of the Facility (0..1)
H_i = 1 if occupied Temporary Housing is in outage, otherwise 0

P_i = clamp(
        0.45 * publicHealthStress.food
      + 0.65 * publicHealthStress.civilianGoods
      + 0.35 * O_i
      + 0.25 * H_i,
      0,
      1
    )
```

Civilian GoodsをFoodより強くするのは、衛生用品・医療・消毒・衣類・寝具・一般生活物資を同Resourceで抽象化しているため。

### 5.6 Internal infection

各Player所有staffed Facilityの健康住民`workers_i`に対し:

```text
p_internal_i = 0.03 * P_i^2
newInternalInfected_i ~ Binomial(workers_i, p_internal_i)
```

- `P_i = 0`なら自然発生しない。
- 最大でも各人3% / Turn。
- 小さな不足・短期不足ではriskは低く、継続・複合悪化で非線形に上がる。
- Unit populationには適用しない。
- Checkpoint waiting / screening populationには第4章を使用し、二重計算しない。
- 発生した人数は既存Facility infectedへ移し、その後の抑圧・Facility infection処理は既存ルールを使う。

Event例:

```text
internal_infection_detected
reason = public_health_failure
publicFacts = {
  facilityId,
  newlyInfected,
  foodStress,
  civilianGoodsStress,
  overcrowdingPressure,
  housingOutage,
  perPersonRisk
}
```

隠れたZombieや未公開情報を原因として付加しない。

---

## 6. 過密Resource式 — OVER-01

v1.6.2の「各City超過率を合計し、全国の通常Food / Civilian Goods消費へ掛ける」方式を廃止する。

Permanent Capital / Cityごとに局所計算する。

```text
N = healthy workers + infected
C = workerCapacity
E = max(0, N - C)
R = E / C

extraFood_i =
  ceil(E * foodPerPerson * 0.50)

extraCivilianGoods_i =
  ceil(E * civilianGoodsPerPerson * (1 + R))

overcrowdingPressure_i =
  clamp(R, 0, 1)
```

全国追加消費は各Facilityの`extraFood_i` / `extraCivilianGoods_i`の合計とする。

意図:
- OvercrowdingのFood penaltyは比較的小さくする。
- Civilian Goodsは衛生・医療・生活用品の追加需要として強く、超過率に応じて非線形に増やす。
- 局所過密が全国Population全員の消費を倍増させる現行挙動をなくす。
- Temporary Housingはv1.6.2のHard Cap 10を維持し、Overcrowdingしない。
- Production FacilityはworkerCapacityがHard上限のためOvercrowding式の対象外。

Forecast / CrisisはFacility別の`occupancy / capacity / excess / extraFood / extraCivilianGoods / healthPressure`を公開する。

---

## 7. Refinery Allowance事前警告 — REFINE-01

v1.6.2の`refinery_allowance_exhausted`は維持し、枯渇前warningを追加する。

```text
projectedAllowanceUse = next EndTurnでRefineryが消費するAllowance
projectedAllowanceGain = Oil Field workerから同Turnに得るAllowance credit
netBurn = max(0, projectedAllowanceUse - projectedAllowanceGain)

estimatedTurnsRemaining =
  netBurn > 0
    ? floor(currentRemainingAllowance / netBurn)
    : null
```

Crisis:

- 次EndTurnでAllowanceが0以下になる: `critical`
- estimatedTurnsRemaining <= 3: `warning`
- netBurn <= 0: warningなし

reason code候補:

```text
refinery_allowance_runway_risk
```

publicFacts:

- currentRemainingAllowance
- projectedAllowanceUse
- projectedAllowanceGain
- netBurn
- estimatedTurnsRemaining
- activeRefineryWorkers
- activeOilFieldWorkers

Strategic Forecastにも同じrunwayを追加する。

---

## 8. Agent Context Compaction — CTX-01..03

### 8.1 目的

2026-09-19 Claude playtestでは、Game Decision自体の`decisionSummary`は日本語を維持した一方、長時間にわたり英語中心のCLI / 自作tool出力を読み続け、外側の会話文体が英語へdriftした。またtranscript自体も非常に大きくなった。

v1.6.3ではCodexのContext Checkpoint Compaction / handoff思想を参考にする。ただしCodex実装をそのままコピーせず、Game固有の構造化Stateを利用する。

### 8.2 Compaction対象

**圧縮してはいけないもの**

- Coreのcurrent authoritative state
- Seed / RNG state
- canonical Decision Log
- Replay / Artifact
- history queryで参照するDecision records
- Session lineage / checkpoint hashes
- `preferredCommentLocale`
- Fair Play制約
- public/private information境界
- Game / API version
- Session ID / Revision

**圧縮対象**

- Agentが直近で読んだ大量のtool出力
- 過去Turnの繰り返しCompact snapshot
- 解決済みCrisisの詳細
- 既に現在Stateへ反映済みの中間Forecast
- 古いAction結果の冗長な全文

### 8.3 Context Checkpoint生成

次でAgent Context Checkpointを生成する。

- 5 completed Turnsごと。既存automatic Session Checkpoint cadenceと揃える。
- 前回Context Checkpoint以降のDecision数が128以上になった場合はTurn途中でも生成可能。
- `query --target=context-handoff`で手動生成可能。

生成物は**前回の圧縮文を再要約して作らない**。毎回canonical public Decision recordsと現在Core Stateから再構成する。

### 8.4 Context Handoff構造

最低限:

```text
durableConstraints
  preferredCommentLocale
  fairPlayRules
  sessionId / revision / branch lineage
  current versions

authoritativeState
  turn / phase
  resources + runway
  publicHealthStress
  healthy population / Capital residents
  owned facilities / critical production
  player units
  visible enemies
  horde warning
  unresolved crisis
  supply summary
  refinery allowance runway

recentImportantChanges
  previous Context Checkpoint以降の重要変化（bounded）

agentIntent
  最新accepted EndTurn decisionSummary
  最新の有意なdecisionSummaryを最大5件
  private chain-of-thoughtは禁止

historyHint
  それ以前はquery historyでRevision-pinned取得可能
```

`authoritativeState`は必ずCoreから再生成する。Agentの過去summaryを事実源にしない。

### 8.5 Default Session応答

`status` / 新しい`play-turn`開始時は最新Context Handoffを返し、古いTurnの全文を再掲しない。

`preferredCommentLocale`はContext HandoffのdurableConstraintsに毎回含める。AI向けHelpには:

> Player-facing commentary and decisionSummary should remain in preferredCommentLocale across the entire Session, including after context compaction.

を明記する。

Caller / Agentには、新しいContext Handoff取得後は過去の生tool transcriptを作業Contextとして読み直さず、必要な詳細だけ`query history`から取得するよう案内する。

### 8.6 Integrity

Context Compaction自体は:

- Stateを変更しない
- RNGを進めない
- Decision番号を消費しない
- Replay hash chainを変えない
- canonical Artifactを削除しない

Session側の派生public payloadとして保存・再生成可能とする。

---

## 9. Water / Bridge — MAP-WATER-01, MAP-BRIDGE-01, MAP-BAY-01

### 9.1 Water

現行型には`water`が存在するが、v1.6.2固定MapはWater 0 Hexを要求している。v1.6.3でWaterを実地形として有効化する。

既定:

```text
terrain.movementCost.water = null
```

全Current UnitはGround movement domainとし、Waterへ進入不可。

将来のFlying Unitに備え、passability判定は「全Unit一律terrain.movementCost」へ固定せず、Unit movement domainを受け取れる境界に整理する。v1.6.3では`ground`のみ実装し、`air` Unit本体は追加しない。

### 9.2 Bridge

Base terrainがWaterでもRoad overlayが存在するHexはBridgeとする。

Ground movement:

```text
Water without Road -> impassable
Water with Road    -> movement cost 1
```

現在の`effectiveMovementCost` / `createMovementCostResolver`はBase terrain null判定をRoadより先に行うため、v1.6.3では判定順を変更する。

全経路で同じbridge semanticsを使うこと:

- Player Move
- Zombie pathfinding
- Route query
- reachable path
- spawn legality
- AI path cost
- Preview
- Strategic Map

Raw `config.terrain.movementCost[tile.terrain] === null`を直接見てBridgeを拒否する残存コードをなくし、共通passability helperを使用する。

### 9.3 Bay生成

固定51x51 Mapの4隅:

- top-left
- top-right
- bottom-left
- bottom-right

のうち1方向をSeed由来の独立したMap-layout RNG streamで均等選択する。

Canonical湾templateを1つ定義し、mirror / rotateして4方向へ適用する。湾はMap端から内側へ6〜10 Hex程度食い込む連結Water領域とし、見た目が矩形にならない固定不規則境界を持つ。

要件:

- 同Seed / Configで同じ湾位置・形状。
- Capitalと中央幹線交差部へ到達しない。
- North / East / South / Westの中央Horde Entrance自体をWater化しない。
- 既存恒久FacilityをWaterで上書きしない。
- Road overlayはWaterより上位レイヤーで描画しBridge表示する。
- Forest / MountainよりWaterをbase terrainとして優先する。
- Map validationの`Water 0`固定値を廃止し、bay templateの期待Water数を検証する。
- Map IDを更新する。

---

## 10. Nuclear Power Plant — FAC-NUC-01..04

### 10.1 配置

Facility type:

```text
nuclearPowerPlant
```

1ゲーム1施設。

- Neutral / unownedで開始。
- 選択された湾のWater Hexに隣接する**Land Hex**へ必ず配置。
- Horde Spawn Reserve上には置かない。
- Capitalから十分遠い湾側へ配置し、4候補方向で概ね同程度の距離になるようtemplateを対称化する。
- 既存の施設間 / secondary road生成対象へ含める。専用の直線道路を新設するのではなく、既存道路生成ロジックを再利用する。
- Facility自体はWater上に置かない。
- Neutral survivor random assignment対象外。
- 開始workers = 0、infected = 0固定。

### 10.2 Production

```text
workerCapacity = 5
powerGeneration = 500 / worker
maxGeneration = 2500
fuelConsumption = 0
requiresPower = false
```

- 1 workerで500 electricity。
- 5 workersで2500 electricity。
- 自身の運転にFuel / input Resourceを消費しない。
- Player所有・非感染・通常稼働・worker > 0の場合に発電。
- 既存Power allocationへ通常のgeneration sourceとして統合。
- 実質的に電力問題を解消し得る代わりに、Map端の遠隔重要施設として防衛・Supply維持が難しいことを主要デメリットとする。

### 10.3 Early Capture Reward

初回Player captureが:

```text
turn <= 20
```

ならSpecial Forces 1 Unitを即時報酬として付与する。

- Proficiency = `regular`
- Population 5は外部reinforcementとして`cumulativeReinforcements`へ加算。
- Spawnは既存Army Base rewardと同様、Facility近傍の最寄り合法Ground Hex。
- Rewardは1回のみ。
- Facilityに初期survivorがいないこととRewardは独立する。

### 10.4 Early Capture Failure

Turn 21のPlayer Turn開始処理時点で、Nuclear Power Plantが一度もPlayerに確保されていなければ:

- Early rewardを`expired`へ確定。
- Nuclear Power Plant位置にPack Zombie 1 Unitを発生させる。
- 既にそのHexが占有されている場合のみ、最寄りの合法Ground Hexへdeterministic fallback spawn。
- Fog of Warを破って存在を通知しない。Visibleになった時点で通常の敵として公開。
- 一度発生したら再発しない。

Turn 20中のcaptureは成功扱い。Turn 21以降のcaptureではSpecial Forces rewardなし。

---

## 11. Special Forces — UNIT-SF-01

Unit type:

```text
specialForces
```

### 11.1 Stats

| Stat | Value |
| --- | ---: |
| HP | 50 |
| Attack at Regular | 15 |
| Movement | 10 |
| Range | 2 |
| Vision | 5 |
| Population | 5 |
| Regular attack charges | 3 |
| Veteran attack charges | 4 |
| Max Fuel | 44 |
| Max Military Goods | 40 |
| Fixed MG upkeep / Turn | 1 |
| Attack MG cost Range 1 | 2 |
| Attack MG cost Range 2 | 4 |
| Suppression MG cost | 1 |
| Emergency movement | 2 |
| MG shortage attack multiplier | 0.2 |
| Suppression civilian damage rate | 0.5 |
| Noise class | medium |
| Noise radius | 4 |
| Movement domain | ground |
| Reanimation | packZombie |

「州兵相当の補給・燃料・抑圧特性、Policeと同じNoise radius」を基準とする。

現行Proficiency式を最小変更で再利用する場合、`recruitAttack = 12`としてRegular multiplier 1.25により15とする。ただしSpecial ForcesはRecruitとして生成しない。

### 11.2 Attack chargesの一般化

現行の「Regular=1 / Veteran=global 2」固定をUnit type別へ一般化する。

既定:
- 既存Human Unit: Regular 1 / Veteran 2
- Special Forces: Regular 3 / Veteran 4

Special Forcesも既存のZombie kill 5体でVeteran化する。

### 11.3 Production

Special Forcesは全Facilityで生産不可。

- `recruitmentFacilityTypes = []`
- `ProduceUnit`候補へ出さない。
- Nuclear Power Plant early capture rewardのみPlayer入手経路とする。

### 11.4 Description / Asset

説明文候補:

> 過酷な訓練を耐え抜いた戦闘のエキスパート。敵に対して静かに苛烈な攻撃を加えることができる。

Asset:
- 5人組。
- Assault rifle装備。
- Suppressor、optic等、特殊部隊らしいattachment。
- 既存Unitの視認性・縮尺・陣営色ルールへ合わせる。
- 実在部隊の徽章や商標は使わない。

---

## 12. Pack Zombies — UNIT-PACK-01..02

Unit type:

```text
packZombie
```

### 12.1 Stats

| Stat | Value |
| --- | ---: |
| HP | 50 |
| Attack | 15 |
| Movement | 10 |
| Range | 1 |
| Vision | 3 |
| Attack charges | 5 |
| Movement domain | ground |
| Horde weighted slot | none |
| Random spawn | none |

v1.6.3では専用の新Target AIを作らず、既存Normal Zombieのpathfinding / target selectionを再利用する。高い知能・連携は高Movement / Attack / 5 attack chargesによってゲーム上表現する。

説明文候補:

> 高い知能による連携と高い身体機能で人間を追い詰める。

Asset:
- Zombie化した特殊部隊5人組。
- 元Special Forces Assetとの対応が視覚的に分かる装備・silhouette。
- 生存者側と混同しない明確な腐敗・敵性表現。

### 12.2 Special Forces死亡時

Special Forces Unitが原因を問わずdestroyedになった場合:

- Unit削除後、その死亡HexへPack Zombie 1 Unitを生成。
- 同Action中に即行動させない。
- 次の通常Zombie action timingから行動可能。
- 既存Population conservation / reanimation statisticsへ専用reasonを追加。
- 1 Special Forces Unit -> 1 Pack Zombie Unit。

### 12.3 Nuclear early capture失敗

第10.4節どおり。

### 12.4 Final Horde

Pack Zombieは:

- Periodic Hordeのweighted rosterに入れない。
- `specialZombieWeights`に入れない。
- Noise respawn / generic random spawnに入れない。
- Rejected refugee bonus slotに入れない。

Final Hordeのみ、4方向のうちSeeded RNGで1方向を1つ選び、**Pack Zombie 1 Unitを追加確定**する。

- 既存Final Wave base compositionの置換ではなく+1 Unit。
- Final warningでは「Final HordeにPack Zombie 1体が含まれる」ことまでは公開してよいが、方向はspawn前に公開しない。
- `committedWaveUnitCount` / statistics / Artifactには+1を正しく含める。
- 同一Seedで選択方向は決定的。

---

## 13. UI / Agent API / Forecast

### 13.1 Compactで優先表示する新情報

- Capital residents / minimum 1
- publicHealthStress Food / Civilian Goods
- 次EndTurnのpartial shortageとcomplete collapseの区別
- internal infection riskの高いFacility最大5件
- Checkpoint policyのaccepted 100% / latent risk / current queue risk
- Refinery Allowance runway
- Nuclear Plant early reward status
- Pack ZombieがVisibleなら通常のVisible Enemyとして完全stats公開
- Water / Bridgeのterrain semantics

### 13.2 Crisis reason候補

追加:

```text
capital_resident_minimum
public_health_food_stress
public_health_civilian_goods_stress
internal_infection_risk
checkpoint_health_risk
refinery_allowance_runway_risk
nuclear_early_capture_window
```

`capital_resident_minimum`はCapital=1のときAdvisoryとし、0は既存Capital exposureと合わせCritical表示する。Action拒否だけに頼らない。

### 13.3 Preview

EndTurn Preview:
- resource maintenance shortage
- partial shortageなら`populationLoss = 0`であること
- publicHealthStress before / after
- Facility別internal infection probability
- complete collapseなら既存population loss projection

AssignWorkers / ProduceUnit / TransferPopulation:
- Capital residents before / after
- minimum guard
- population delta
- changed Food / CG forecast
- changed public-health risk

---

## 14. Map / Facility / Unit公開schema

Agent API、Observation、Strategic Map、Replay、Artifactへ以下を追加する。

- `terrain = water`
- `bridge: boolean`または同等のderived field
- `movementDomain`
- `nuclearPowerPlant`
- `specialForces`
- `packZombie`
- Unit type別Regular / Veteran attack charges
- Nuclear reward state
- publicHealthStress
- Facility internal infection risk
- Checkpoint per-person risk / queue risk
- Context Handoff query target

Unknown enumとして落ちる既存schemaを全て更新する。

---

## 15. Version / Compatibility

State shape、Map、Unit / Facility enum、Infection / Economy rule、Session Context payloadが変わるためv1.6.2との互換は提供しない。

v1.6.3既定:

```text
APP_VERSION              1.6.3
GAME_RULES_VERSION       13.0.0
SAVE_FORMAT              20
AGENT_API_VERSION        18.0.0
OBSERVATION_API_VERSION  18.0.0
BRIDGE_API_VERSION       18.0.0
ARTIFACT_SCHEMA_VERSION  17.0.0
CHECKPOINT_SCHEMA_VERSION 14.0.0
SESSION_SCHEMA_VERSION    14.0.0
PLAY_TURN_PROTOCOL_VERSION 1.2.0
MAP_ID                    fixed-51x51-v8
```

AI Session contractはContext Handoff field追加に合わせ`1.1.0`へ上げる。

v1.6.2以前のSave / Replay / Session / Checkpoint / Artifactは変換しない。旧データを削除・上書きせず、新規v1.6.3 Session開始を要求する。

---

## 16. Determinism / RNG

新しいRNG用途は既存streamへの不用意な影響を避ける。

独立domain separationを使用すること:

- Bay corner selection
- Nuclear failure Pack spawn fallback tie-break
- Final Horde Pack direction
- Screening per-person/binomial latent infection
- Waiting queue infection
- Internal infection

既存Zombie placement、Horde directions、neutral survivor等の結果を、無関係な新RNG call挿入だけで変えないようにする。

同Seed / Config / Action sequenceでState / Replay / Artifactが一致すること。

---

## 17. Test / Release Gate

### 17.1 Population

- Capital=1からTransfer outを拒否。
- Capital=1を唯一のSupply人口としてProduceUnit / AssignWorkersを拒否。
- 他City人口があればCapital=1を保持したままAction成功。
- Zombie感染等によるCapital 1 -> 0は許容。
- Preview reasonとCore reasonが一致。

### 17.2 Refugee / Health

- Normal / Strictでscreened全員がrejectionなしでapproved / acceptedへ進む。
- Strict 5 Turn。
- Strict screening-derived latent = 0。
- Normal基礎riskはSeed付き決定性。
- Pass Through基礎riskはSeed付き決定性。
- Queue riskがcapacity以下で0、overload増加で単調増加。
- Partial Food / CG shortage + production>0では即時civilian loss 0。
- production=0 complete collapseでは既存direct lossが発生。
- Stressは継続不足で上昇、供給復旧で減衰。
- Internal riskはStress / overcrowding / Housing outageで単調増加。
- Zombie直接感染damageはHealth Stressに左右されない。

### 17.3 Overcrowding

- 1 Cityだけの超過が別City resident全体へ全国倍率を掛けない。
- 数式どおりFood / CG追加消費。
- Temporary Housing 10 Hard Cap維持。

### 17.4 Refinery

- 4 Turn以上runwayではwarningなし。
- 3 Turn以下でwarning。
- next EndTurn枯渇でcritical。
- Oil Field creditsでnetBurn<=0ならwarning解除。

### 17.5 Context Compaction

- 5 TurnごとにContext Handoff生成。
- 128 Decisions trigger。
- Handoff生成でState / RNG / Decision number / hash chainが変化しない。
- preferredCommentLocaleが全Handoffで保持。
- authoritativeStateが現在Coreと一致。
- history queryでcompaction以前の全Decision取得可能。
- branch / checkpoint後もparent later historyを混ぜない。

### 17.6 Water / Bridge

- 全Ground UnitはWaterのみHexへ進入不可。
- Player / ZombieともBridgeへ進入可能、cost 1。
- route query / preview / actual Moveが一致。
- Spawn helperがBridgeをWater扱いで誤拒否しない。
- Waterへconstructible facilityを建てられない。
- 4方向BayがSeed決定的。
- Horde EntranceをWater化しない。

### 17.7 Nuclear

- 0 workers / no neutral survivorsで開始。
- Water隣接Land Hex。
- 1..5 workersで500..2500発電。
- Fuel消費0。
- Turn20 captureでRegular Special Forces reward。
- Turn21 start uncapturedでPack 1発生。
- Turn21以降captureでSpecial Forcesなし。
- reward / failure spawnは各1回のみ。

### 17.8 Special Forces / Pack

- Special ForcesをProduceUnitできない。
- Regular attack charges=3。
- 5 Zombie kills後Veteran化しcharges=4。
- Police同等noise radius=4。
- 死亡時同HexへPack 1。
- Pack charges=5。
- Packはgeneric random spawn / periodic weighted Hordeへ出ない。
- Final Hordeだけ確定1 Unit追加。

### 17.9 Regression

- v1.6.2のFog of War、Replay determinism、Checkpoint fallback、Supply、Gas explosion、Horde warning、Action validation、finite-plan stop conditionsを壊さない。
- Linux / Windows Portable package双方でSession smoke test。
- 70+ Turn相当のlong Session testでContext Handoff sizeがboundedであること。
- Full Artifactはcanonical historyを保持し、Context compactionによる情報欠落がないこと。

---

## 18. Balance validation

実装後は固定Seed複数本でBuilt-in Agentと外部LLM playtestを行い、特に次を比較する。

1. Normal / Strict 100%受入による健康人口増加量。
2. Normal / Strict rejectionがFinal Horde bonusから消えることでFinal Hordeがどの程度弱くなるか。
3. 新internal infectionによりその人口増加がどの程度相殺されるか。
4. Food / CGを大量備蓄するだけでなく、十分な供給を維持する価値が行動に現れるか。
5. Partial shortageを意図的に許容する戦略が「即死回避の抜け道」にならないか。
6. Nuclear Plant + Special Forces rewardがTurn 20までの遠征を強制しすぎないか。
7. Pack Zombieが特殊脅威として強いが、理不尽な即死要因になっていないか。
8. Final Hordeの+1 Packを含めても、v1.6.2の「理解していても苦戦する」難度帯を維持できるか。

初期係数は本書を正本とし、playtestで数値だけ調整する場合も、三層モデル・100%受入・Capital最低1・Bridge semantics・Pack spawn条件等の意味論は変更しない。

---

## 19. Documentation / Asset

更新対象:

- `README.md`
- `PLAY_WITH_AI.md`
- `Doc/Nowhere Left to Hide PoC 現行仕様.md`
- UI help / localization
- Session `--help`
- `query api` schema
- Replay / Artifact viewer legend

説明上は次を明確化する。

- Food / Civilian Goodsは「人口を維持するために貯めるだけでなく使うResource」である。
- Partial shortageは即時死亡ではなく、公衆衛生悪化と内部感染riskを高める。
- Normalは全員受入だがlatent infection riskあり。
- Strictは5 Turnかかる代わりにscreening由来latent infection 0。
- Pass Throughは最速だが高risk。
- Direct Zombie infectionはResource状態で無効化できない。
- Capital住民はPlayer操作で最低1人必要。
- Nuclear Power Plantは巨大発電源だが遠隔防衛目標。
- Special Forcesは限定Rewardで生産不可。
- Pack ZombieはSpecial Forcesの再アニメーション、Nuclear early capture失敗、Final Hordeに限定される。
- WaterはGround Unit進入不可、Road overlayはBridge。

---

## 20. 実装時の優先順位

1. Version / enum / Save schema更新。
2. Capital最低1人共通withdraw guard。
3. Refugee acceptance / health stress / shortage / overcrowding計算とForecast。
4. Crisis / Preview / Agent API公開。
5. Refinery runway warning。
6. Water / Bridge共通passability。
7. Bay / Nuclear placement。
8. Special Forces / Pack / Final Horde統合。
9. Context Handoff / Compaction。
10. UI / Asset / docs。
11. deterministic regression / long Session / balance playtest。

各段階で既存Coreの共通helperを優先し、同じruleをUI / Agent / Preview / actual Stepに重複実装しない。

---

## 21. 要件レビュー回答記録（2026-09-20、確定版へ統合済み）

本節は依頼者との1問1答の履歴。全回答は `../Nowhere Left to Hide PoC v1.6.3 アップデート要件 確定版.md` へ統合済み。本文には比較用の旧案が残るため、実装目標には確定版を使う。安定版の現行仕様・ゲーム実装はまだ変更しない。

### 21.1 食料不足・民需品不足（第1〜9問）

- 意図は突然の人口死亡に猶予を設けることであり、少量の生産で直接死亡を永続回避する抜け道は作らない。
- 生産量0か1以上かによる即時死亡の分岐を廃止し、不足の深さと継続期間を組み合わせる。
- 食料不足は衛生悪化に加え、蓄積が深刻化すると直接死亡を発生させる。民需品不足による直接死亡は廃止し、感染リスクを通じた被害とする。
- 食料不足率は、備蓄と生産で賄えなかった維持需要の割合（0..1）。不足ターンはこの値を食料不足蓄積へ加算する。
- 食料不足蓄積の初期値・下限は0。更新後の蓄積が2を超えた不足ターンから直接死亡を開始する。一定不足が続く場合、100%不足は3ターン目、50%不足は5ターン目、25%不足は9ターン目から。
- 食料維持需要を全て賄えたターンは直接死亡を止め、蓄積を0.5減らす（下限0）。一部でも不足すれば回復せず不足率を加算する。
- 不足ターンの死亡率は `min(0.10, foodDeficitRatio * max(0, updatedFoodDeficitAccumulation - 2) * 0.02)` とする。
- 対象は施設の健康な住民・労働者、および検問所のwaiting / screening / approvedの健康人口。Unit populationは対象外。
- 死亡人数計算の小数端数は翌ターンへ繰り越す。具体的な集計単位・配分順序は引き続き仕様整合を確認する。
- 感染者は従来どおり食料・民需品の維持消費および飢餓死亡の対象外。
- 飢餓で死亡した住民・避難民はゾンビ化せず死亡人口へ計上する。

### 21.2 衛生・審査・待機列（第10〜16問）

- 同じEndTurn内で不足を計算し、衛生ストレスを更新した後、更新後の値を感染判定へ反映する。Previewもこの順序に合わせる。
- Strictは受入時のscreening由来潜伏感染を0にするが、都市への受入後は既存住民と同じ生活環境由来の感染リスクを受ける。
- 待機列の衛生悪化による感染対象はwaitingだけ。過密度もwaitingだけで計算し、screening / approvedを人数に含めない。
- 審査はある程度清潔な環境で感染を確認し、疑わしい場合に適切な医療を行って、受入可能な健康状態に整える工程とする。screening / approvedには待機列由来の感染判定を適用しない。
- Normalの審査完了時の潜伏感染確率は1人あたり5%固定、Strictは0%固定。待機列の混雑・全国の衛生ストレスによる補正は適用しない。
- Pass Throughは審査・医療を省略するため、基礎確率25%に待機者だけの過密度と食料・民需品の衛生ストレスの補正を適用する。
- 待機中に感染が判明した人は既存Checkpoint infected poolへ移す。審査で健康人口には戻さず、既存の感染・鎮圧ルールに従う。審査で対応する潜伏感染とは区別する。
- 待機列の過密基準はscreeningCapacity（既定20人）。`rawQ = max(0, waiting / screeningCapacity - 1)`、`p_wait = clamp(0.01 * rawQ * (1 + 0.50*F + 1.00*C), 0, 0.12)` とする。衛生ストレス0なら20人以下0%、40人1%、60人2%、100人4% / Turn。

### 21.3 衛生ストレス・内部感染・猶予と警告（第17〜23問）

- 食料・民需品の衛生ストレスは `S_next = clamp(0.75 * S_current + 0.40 * deficitRatio, 0, 1)` を採用する。生産0時に即座に1へ引き上げる例外は廃止する。食料不足蓄積（飢餓判定用）とは別に保持する。
- 物資不足がなくてもPermanent Cityの過密、入居中Temporary Housingの停電だけで内部感染リスクが発生する。
- 内部感染は本文5.5・5.6の係数を初期値にする。`P_i = clamp(0.45*F + 0.65*C + 0.35*O_i + 0.25*H_i, 0, 1)`、`p_internal_i = 0.03 * P_i^2`。プレイテストで数値調整する。
- 感染可能性の説明と各種警告を必須要件にする。ヘルプ・方針説明に原因、対象、確率、Strictが防ぐ範囲を明記し、施設・検問所に現在確率と原因を表示する。EndTurn前に更新後のストレス・感染リスクを予告し、確率による発生を確定人数として表示しない。発生時は場所・人数・原因を履歴へ残し、AI向け情報にも同じ説明・警告を提供する。
- 生活環境由来の内部感染、Checkpoint waitingの衛生悪化による感染、Normal / Pass Through由来の潜伏感染には、感染者として発生したターン中の二次的な感染拡大を行わず、次のターン終了から対象にする猶予を一律に設ける。
- 感染自体および既存ルール上の施設機能への影響は即時とし、翌ターンまで延期するのは新規感染者からの感染拡大である。
- Zombie接触・攻撃、Gas Zombie爆発等の直接感染は既存処理を維持し、上記猶予の対象には加えない（第23問で明示確認）。
- 健康人口0での陥落・敗北などと猶予の関係は引き続き確認する。

### 21.4 人口保護・原発・特殊部隊（第24〜31問）

- 猶予対象の感染でも、最初の感染によって健康人口が0になった場合は既存条件どおり陥落・敗北を判定する。感染拡大の猶予は健康人口の減少や既存の陥落・敗北判定を延期しない。少人口施設への警告にも明記する。
- Capital最低1人の保護は自発的な人口移動・労働者配置・部隊編成等に限る。感染・飢餓・戦闘等による非自発的損失は防がず、他都市の人口で成立できる操作はCapitalの1人を残して許可する。
- Nuclear Power PlantはTurn20までに一度でも初回確保すれば報酬を確定する。その後喪失しても未確保ペナルティは発生せず、再確保時の報酬重複も認めない。
- 原発の期限、特殊部隊報酬、未確保ならTurn21にPack Zombieが出現するルールは開始時から公開し、期限前にも警告する。実際の敵の位置・状態は視認するまで公開しない。
- プレイヤー向けには「原子力発電所は重要施設であり、最後の通信では精鋭部隊が守備に就いていた。生死は不明だが、高い身体能力を持つ者が感染した際の危険は大きい」という趣旨の没入感ある背景説明を添える。期限と具体的なゲーム上の結果も併記する。
- 報酬のRegular Special Forcesは確保したそのターンから移動・攻撃可能。HP・燃料・携行軍需品・攻撃回数を満タンにし、国家備蓄から支払わず合流する。以後は通常の補給・消費ルールに従う。
- Special Forcesは死因を問わず死亡地点でPack Zombieへ再アニメーションする。
- このPack Zombieは次に開始するZombie action phaseから行動する。Player action中に発生した場合はそのEndTurnのZombie phase、Zombie phase中に発生した場合は次ターンのZombie phaseから。進行中のZombie phaseで即時連続行動させない。

### 21.5 戦闘・Final Horde・湾と原発供給（第32〜40問）

- Pack Zombieの5回攻撃は既存の複数回攻撃権と同じ扱い。同一部隊への複数回攻撃を認め、途中で倒されれば残りは行わない。Attack15×5で平地では最大75 damageとし、Riot Policeも1ターンで倒され得る危険性を意図する。説明・警告でこの脅威を伝える。
- Final Hordeの予告ではPackの参加・数・方向を明示しない。「この地域で最後の砦となったと思われる州都へあらゆるゾンビが押し寄せる」という趣旨の説明で、ほぼ全バリエーションが含まれることを示唆する。公開API等の予告もこの方針に整合させる。
- 内部ルールでは既存Final Horde編成へPack Zombie1隊を追加し、4方向からSeedで出現方向を選ぶ。全バリエーションの確定出現を新たに保証する変更ではない。
- Special ForcesのRegular3 / Veteran4 chargesは通常攻撃・反撃・迎撃・自動鎮圧で共通消費する。
- Special Forcesは距離1でMG2を要求し、2未満なら残量を消費して通常攻撃力の20%（Attack15なら3）で攻撃する。距離2ではMG4未満なら攻撃不可。通常攻撃・反撃・迎撃で共通に適用する。
- 湾は固定の不規則template1種類を反転・回転してSeed選択の4隅へ配置する。マップの大部分を占める規模にはしない。水域の形は多少歪でもよく、原発の適切な距離・供給条件を優先する。本文の内側6〜10 Hexは固定条件にしない。
- 原発は供給網をかなり延伸しなければ継続して圏内に置けないが、マップ端の進入禁止ゾーン直前まで延ばす必要はない距離を選定する。4方向で到達距離と供給維持負担が概ね揃うよう検証する。具体座標はこの条件に基づき選定する。
- 原発の発電には供給網内であることを必須条件に追加する。供給網外へ出た場合の発電停止を施設説明・電力予測・警告へ反映する。
- 特殊部隊の早期確保報酬は供給網外でも獲得できる。守備隊合流の条件と発電条件を分離する。

### 21.6 最終確認（第41〜52問）

- Bridge上は施設・Checkpoint・有刺鉄線等の建設不可。Map生成時の橋だけを使用し、Playerによる新設・破壊・撤去は対象外。
- Context圧縮はゲームが引継ぎデータを提供する範囲。外部AIの会話履歴そのものを削除・圧縮せず、canonical historyは全て保持する。
- 5 completed Turnsごと、前回生成から128 Decisions到達時（Turn途中を含む）に必ず生成し、手動生成も可能。
- status / 新play-turn開始時は最新公開情報から再構成する。配列は重要対象を優先して上限を設け、省略数・詳細Queryを示す。差し迫った敗北条件・重大警告は落とさない。
- 水面・橋・原子力発電所・特殊部隊・Pack Zombieの5種アセットを既存画風・縮尺に合わせる。特殊部隊とPackは対応する5人組にする。
- 食料不足蓄積の上限は7。全量供給を14Turn続ければ解消する。
- 原発未確保のPackはTurn21のPlayer行動を挟み、そのEndTurnのZombie Phaseから行動する。Hidden出現は通知しない。
- 特殊部隊報酬は原発Hex優先、占有時は最寄り合法Ground Hex。配置候補がなければpendingで保持する。
- 駐留部隊がいても生活環境の新規感染は発生し、既存感染拡大の封じ込め・鎮圧とは区別する。
- Normal / Pass Throughの潜伏感染は実際の受入先の受入人数で判定する。複数都市なら各都市で判定し、配置待ちなら当該Checkpointで発症する。無関係な所有施設をランダム発症先にする方式は廃止する。

### 21.7 文書・アセットの進め方

- 過去のv1.6.2確定要件は依頼に基づき `Doc/archive/` へ移動済み。
- 全質問の回答を反映してv1.6.3要件定義を作成する。
- アセットは要件確定後にこのタスクで作成し、その出力を使用する。
