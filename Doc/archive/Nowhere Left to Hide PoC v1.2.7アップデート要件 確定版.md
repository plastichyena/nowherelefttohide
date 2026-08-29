# Nowhere Left to Hide PoC v1.2.7アップデート要件 確定版
## Power Grid / Fuel Role / Production Timing Rework

- ステータス: 確定要件
- 対象App / Release Version: `1.2.7`
- 確定日: 2026-08-29
- 安定版の正本: `Nowhere Left to Hide PoC 現行仕様.md`
- 主題: Power Grid / Fuel Role / Production Timing Rework

本書はv1.2.7で変更する部分の実装目標である。実装・テスト・動作確認が完了するまでは、`Nowhere Left to Hide PoC 現行仕様.md`をv1.2.6安定版の唯一の正本として維持する。v1.2.7の完了後に本書を現行仕様へ反映し、実装、テスト、Human UI、AI向け資料、Version、保存形式との整合を確認する。

---

# 1. 目的

v1.2.6では、食料・民需品・軍需品を生産する主要産業が労働者数に比例して燃料を直接消費し、さらに電力不足時には対象施設そのものが停止する。

また、資源消費と生産入力をターン開始時備蓄だけから先に処理し、その後で当ターンの生産物を備蓄へ加えるため、

> EndTurn時点で十分な生産能力を追加しても、そのターンに表示されている食料・民需品・軍需品不足を解消できない

という、プレイヤーの直感と一致しにくい挙動が存在する。

v1.2.7では以下を目的とする。

1. 燃料を各工場の直接入力から、発電と将来の車両・航空機を支える上流戦略資源へ変更する。
2. 電力を「産業を動かす必須条件」から、「都市機能の維持と主要産業の高効率化を担うインフラ」へ変更する。
3. プレイヤーターン中の労働者再配置によって、同ターンの生活物資不足へ緊急対応できるようにする。
4. 同一ターン内の多段生産チェーンは禁止し、備蓄管理と事前計画の価値を残す。
5. 今後、敵味方ユニット・車両・航空機等を増やせる経済的余地を確保する。

---

# 2. 基本設計

v1.2.7では資源・電力関係を概念的に以下へ変更する。

```text
Refinery
   ↓
 Fuel
   ↓
Power Plant
   ↓
Electricity
   ├─→ City infrastructure
   └─→ Industrial production boost
```

主要産業は停電しても最低限稼働する。

一方、都市は電力がなければ人口由来の民需品生産を停止する。

目指す状態は、

> 電気がなくても農場や工場は最低限動く。  
> しかし都市社会を正常に維持し、産業を高効率で動かすには電力網が必要である。

とする。

---

# 3. 本アップデートで変更する要素

- Farmの燃料入力
- Civilian Factoryの燃料入力
- Military Factoryの燃料入力
- Power Plantの燃料消費
- Power Plantの発電能力
- 電力供給対象
- 都市の停電時生産
- 主要産業の電力ブースト
- 電力供給ON/OFF
- `SetPowerSupply` GameAction
- 電力不足時の割当
- 経済フェーズの生産・消費順
- EndTurn Forecast
- Facility Observation
- Agent API / PLAY_WITH_AI
- Balanced Agentの経済評価
- UIの電力・収支表示
- v1.2.5／v1.2.6 Save Format 2からの決定的移行

---

# 4. 原則変更しない要素

- 生産施設の労働者上限30
- 州都SoftCap 100
- 地方都市SoftCap 50
- 食料の人口消費量
- 民需品の人口消費量
- 軍需品のユニット人口消費量
- 過密追加消費
- Farmの基本生産5 / worker
- Civilian Factoryの基本生産5 / worker
- Military Factoryの基本生産2 / worker
- Refineryの燃料生産5 / worker
- Military Factoryの民需品1 / worker入力
- 感染・陥落・復旧
- 補給網
- 検問所
- Horde
- 自然回復

---

# 5. 生産施設

## 5.1 Farm

現行:

```text
Fuel 1 → Food 5
```

v1.2.7:

```text
No Input → Food 5
```

給電時:

```text
No Input → Food 10
```

---

## 5.2 Civilian Factory

現行:

```text
Fuel 1 → Civilian Goods 5
```

v1.2.7:

```text
No Input → Civilian Goods 5
```

給電時:

```text
No Input → Civilian Goods 10
```

---

## 5.3 Military Factory

現行:

```text
Fuel 1 + Civilian Goods 1 → Military Goods 2
```

v1.2.7:

```text
Civilian Goods 1 → Military Goods 2
```

給電時:

```text
Civilian Goods 1 → Military Goods 4
```

Fuel入力だけを削除する。

Civilian Goods入力は維持する。

---

## 5.4 Refinery

変更なし。

```text
No Input → Fuel 5
```

電力ブースト対象外とする。

---

# 6. 電力利用区分

施設ごとの電力との関係を、単純な`requiresPower: boolean`ではなく、概念上以下の3区分として扱う。

```text
required
boost
none
```

電力需要が発生するのは、次をすべて満たす施設だけとする。

- プレイヤー所有
- 非陥落
- 都市は健全民間人口1人以上、産業施設は労働者1人以上

人口0の都市、労働者0の産業施設、未確保施設、陥落中の施設は電力を要求せず、発電用Fuelも消費しない。感染中でも非陥落かつ健全民間人口または労働者が1人以上なら、現行の生産可否に従って電力需要を持つ。

## required

対象:

- Capital
- City

電力供給がない場合、その施設の人口由来Civilian Goods生産は0になる。

## boost

対象:

- Farm
- Civilian Factory
- Military Factory

無電力でも基本生産を行う。

給電されると生産量2倍。

## none

対象:

- Refinery
- Power Plant
- Checkpoint

電力供給の影響を受けない。

---

# 7. 都市と電力

## 7.1 基本ルール

CapitalおよびCityは、人口由来Civilian Goods生産のために施設単位で電力5を要求する。

要求量5は施設単位で固定し、人口には比例しない。5未満の部分給電は行わない。

給電あり:

```text
Civilian Goods = min(population, SoftCap)
```

給電なし:

```text
Civilian Goods = 0
```

都市は電力による2倍生産の対象外とする。

---

## 7.2 停電都市の行政機能

停電によって停止するのは、

**人口由来Civilian Goods生産だけ**

とする。

停電していても以下は維持する。

- 所有
- 人口保持
- Refugee受入
- TransferPopulation
- Unit編成
- 補給網上の役割
- 感染処理
- 防衛
- 都市としての存在

停電だけを理由として`ruined`や感染状態にはしない。

また、将来`operationalStatus = stopped`へ別の意味が追加された場合の副作用を避けるため、

**電力状態と所有・感染・行政機能状態を可能な限り分離して保持する。**

---

# 8. 主要産業の電力ブースト

Farm / Civilian Factory / Military Factoryは電力5を供給されると、

```text
Production Multiplier = ×2
```

となる。

給電されない場合:

```text
Production Multiplier = ×1
```

電力不足によって生産量0にはならない。

要求量5は施設単位で固定し、労働者数には比例しない。5未満の部分給電ではブーストしない。

Military FactoryがCivilian Goods不足で部分稼働する場合、入力を確保できた労働者分だけ生産する。施設へ電力5が供給されていれば、その稼働分すべてを`4 Military Goods / worker`へ倍増する。入力を1人分も確保できないMilitary Factoryは、Power SupplyがONでも電力割当候補にせず、Fuelを消費しない。

---

# 9. 発電所

## 9.1 発電能力

Power Plantの発電能力を、

```text
5 → 10 electricity / worker
```

へ変更する。

```text
Maximum Electricity Capacity
= Power Plant workers × 10
```

---

## 9.2 燃料消費

Power Plantは発電にFuelを使用する。

```text
Fuel 1 → Electricity 5
```

実際に利用可能な電力量は、

```text
min(
  physical generation capacity,
  turn-start Fuel × 5
)
```

を上限とする。

---

## 9.3 給電単位とFuel消費

電力需要と割当は5単位で統一する。施設1か所へ電力5を割り当てるごとにFuel 1を消費する。

```text
Fuel Used = Allocated Electricity / 5
```

部分給電を行わないため、Fuel消費に端数は発生しない。Turn-start Fuelが0なら割当0、Fuelが1なら物理発電Capacityの範囲で1施設へ5を割り当てられる。

---

## 9.4 実使用分だけ燃料を消費

最大発電可能量ではなく、

**実際に施設へ割り当てた電力量**

だけを基準に燃料を消費する。

余剰発電能力のためにFuelを消費しない。

---

# 10. 電力割当順位

電力は以下の3段階で割り当てる。各段階で施設単位の需要5を全量満たせる場合だけ割り当てる。

## 第1段階: Required Power

Capital / Cityへ優先して電力を割り当てる。

全都市へ供給できない場合:

1. 確保時期が古い施設
2. 同順位なら`facilityId`

の順とする。

プレイヤーはv1.2.7では都市のRequired Powerを任意OFFにできない。

---

## 第2段階: Maintenance Production Boost Power

Required Power割当後の余剰電力を、Power SupplyがONのFarm / Civilian Factoryへ割り当てる。

全対象へ供給できない場合:

1. 確保時期が古い施設
2. 同順位なら`facilityId`

の順とする。FarmとCivilian Factoryは同じ順位集合として扱う。

この段階の実割当を反映してFood / Civilian Goods生産見込みを確定し、Civilian Goodsの市民維持用予約量を計算する。

## 第3段階: Military Production Boost Power

市民維持用予約後のTurn-start Civilian Goodsを、Military Factoryへ次の順で労働者1人分ずつ割り当てる。

1. 確保時期が古いMilitary Factory
2. 同順位なら`facilityId`

入力を1人分以上確保でき、Power SupplyがONのMilitary Factoryだけを電力割当候補とする。第2段階後の余剰電力を、同じ確保時期・`facilityId`順で割り当てる。

給電されなかったON施設は×1で生産する。入力を確保できないMilitary Factoryは生産0とし、電力もFuelも消費しない。この3段階化は、Civilian Goods生産見込み、維持用予約、Military Factory入力、Military Factory給電の循環を避ける正式な処理順とする。

## 割当不能理由

UI、Observation、Event、Forecastでは、未給電理由を最低限次から区別する。

- 物理発電Capacity不足
- Turn-start Fuel不足
- 同段階内の割当順位負け
- Power Supply OFF
- 人口／労働者0または非対象状態
- Military Factoryの生産入力なし

---

# 11. Industrial Power Supply ON/OFF

Farm / Civilian Factory / Military Factoryは、

```text
Power Supply: ON / OFF
```

を持つ。

開始時所有施設、新規確保・復旧施設、v1.2.5／v1.2.6 Saveから移行した施設の初期値はすべて`ON`とする。

## ON

- 各段階の需要・入力条件を満たす場合、余剰電力の割当候補になる。
- 給電成功時は×2。
- 電力不足で給電されなければ×1。

## OFF

- 電力割当候補から外れる。
- 常に×1。

v1.2.7では細かな数値優先度は導入しない。

必要になった場合、後続VersionでON/OFFからPriority方式へ拡張する。

ON/OFF変更は`SetPowerSupply` GameActionとしてGameEngine経由でのみ行う。

- Player Phase中だけ実行できる。
- 所有中・安全・操作解禁済みの対象産業施設だけ変更できる。
- 新規確保・復旧した施設は次のプレイヤーターンまで変更できない。
- 感染中・陥落中・未確保施設では変更できない。
- 資源、人口、Unit行動権を消費しない。
- 同一Player Phase中に何度でも変更でき、受理直後にForecastを再計算する。
- 不正ActionはStateとRNGを変更せず、理由付きで拒否する。
- Balanced AgentはAction Family単位で同じ施設の反復切替を抑止する。

---

# 12. 複数発電所

複数Power Plantの発電能力は州全体で合算する。

```text
Total Physical Capacity
= Σ(Power Plant workers × 10)
```

v1.2.7では、

- 送電線
- 発電所ごとの給電先
- 発電所ごとのFuel在庫
- 地域別停電

は扱わない。

電力は州全体共有Capacityとする。

---

# 13. 生産・消費タイミング変更

## 13.1 基本原則

v1.2.6以前の、

```text
Turn-start stock
→ maintenance / production input
→ production
```

から変更する。

v1.2.7では、

**当ターンに生産したFood / Civilian Goods / Military Goodsを、同ターンの維持消費へ使用できる。**

これにより、プレイヤーターン中に労働者配置を変更し、生産能力を増やすことで、そのEndTurnの資源不足を防ぐことができる。

Food / Civilian Goods / Military Goodsの維持必要量と過密追加消費は、EndTurn開始時の人口・Unit人口・過密状態から先に確定する。Food不足による同ターンの死亡で、確定済みのCivilian Goods維持必要量を減らさない。

---

# 14. 同一ターン生産物の利用制限

当ターンに生産した資源は、

**維持消費には使用可能**

だが、

**別の生産工程の入力には使用不可**

とする。

---

## 14.1 使用可能

当ターン生産Food:

```text
→ 同ターン人口食料消費: OK
```

当ターン生産Civilian Goods:

```text
→ 同ターン人口民需品消費: OK
```

当ターン生産Military Goods:

```text
→ 同ターンUnit軍需品消費: OK
```

---

## 14.2 使用不可

当ターンRefinery生産Fuel:

```text
→ 同ターンPower Plant発電: NG
```

当ターンCivilian Factory / City生産Civilian Goods:

```text
→ 同ターンMilitary Factory入力: NG
```

これにより同一ターン内の、

```text
Refinery
→ Fuel
→ Electricity
→ Factory Boost
```

や、

```text
Civilian Factory
→ Civilian Goods
→ Military Factory
→ Military Goods
```

という多段生産チェーンを禁止する。

---

# 15. 新しい経済処理順

概念上、EndTurnの経済処理を以下とする。

```text
1. Player Phase終了時の人口・労働者配置、Power Supply ON/OFFを確定

2. Turn-start Resource Stockを確定

3. EndTurn開始時人口から維持必要量と過密追加消費を確定

4. Power Plant workersとTurn-start Fuelから発電可能量を計算

5. Required Powerを都市へ割当

6. 余剰電力をPower Supply ONのFarm / Civilian Factoryへ割当

7. Powered / Unpoweredを反映したCivilian Goods生産見込みを計算

8. 市民維持に必要なTurn-start Civilian Goodsを予約

9. 残余Turn-start Civilian GoodsをMilitary Factoryへ確保順で労働者単位に割当

10. 入力を1人分以上確保したPower Supply ONのMilitary Factoryへ残余電力を割当

11. 実際の電力割当量に応じたFuelを消費

12. 各施設の当ターン生産を計算
    - 当ターン生産物は別工程の入力に使用不可
    - Military Factoryは入力確保済み労働者分だけ生産
    - 給電済み産業はその稼働分を×2

13. 生産物を利用可能資源へ追加

14. Food人口維持消費

15. Civilian Goods人口維持消費

16. Military Goods Unit維持消費

17. 不足被害・軍需不足効果
    - Food不足を先、Civilian Goods不足を後に処理
    - 健全民間人口0で即時敗北し、残り処理を停止

18. 残余資源を次ターン備蓄として保存
```

---

# 16. Civilian Goodsの優先順位

Civilian Goodsは、

1. 民間人口の維持
2. Military Factoryの生産入力

の順に重要とする現行設計思想を維持する。

ただしMilitary Factory入力は当ターン生産Civilian Goodsを使用できないため、入力可能なのはTurn-start Stockのみである。

そのためMilitary Factoryへ割り当て可能なCivilian Goodsは、

```text
Turn-start Civilian Goods
- 当ターン生産後でも不足することが予測される民間維持用予約量
```

を上限とする。

概念的には、

```text
Projected civilian maintenance
- projected same-turn civilian production
= starting stock needed for civilian survival
```

を先に保護する。

その残余Turn-start StockだけをMilitary Factory入力として使用できる。

正式な予約式は次とする。

```text
maintenanceReservation
= max(0, maintenanceRequired - projectedSameTurnCivilianProduction)

productionInputAvailable
= max(0, startingStock - maintenanceReservation)
```

`projectedSameTurnCivilianProduction`は、Required Power割当後の都市生産と、第2段階の実給電を反映したCivilian Factory生産を含む。Military Factory入力の希望量と実割当量は分離し、入力不足そのものでは市民死亡を発生させない。

これにより、

**軍需工場を動かしたために、本来避けられた民需品不足で市民が死亡する**

という逆転を防ぐ。

---

# 17. 緊急増産

本変更により、以下の判断を可能にする。

例:

```text
Projected Food shortage: 5
```

Player Phase中にFarmへ追加労働者を配置し、

```text
additional production >= 5
```

となった場合、そのターンの食料不足を解消できる。

これは意図した仕様とする。

---

# 18. 事前備蓄が必要な資源

一方、上流生産入力は事前備蓄を要求する。

例:

```text
Fuel shortage for generation
```

が発生している場合、そのターンにRefineryへ労働者を追加してFuelを生産しても、

**そのFuelは次ターンからしか発電に使用できない。**

同様に、そのターンにCivilian Factory / Cityが生産したCivilian GoodsそのものをMilitary Factory入力には使用できない。ただし同ターンCivilian Goods生産を増やすことで、市民維持用に予約していたTurn-start Stockが余る場合は、その余ったTurn-start StockをMilitary Factory入力へ回せる。Turn-start Civilian Goodsが0なら、同ターン増産だけでMilitary Factoryを稼働させることはできない。

したがって、

> 生活物資は緊急増産で即応可能。  
> 産業入力・インフラ資源は事前備蓄が必要。

という二層構造とする。

---

# 19. EndTurn Forecast

Forecastは新しい処理順を正確に反映する。

Food / Military Goodsについて最低限、

```text
startingStock
projectedProduction
maintenanceRequired
endingStock
shortage
```

を表示・公開する。

Civilian Goodsは、市民維持とMilitary Factory入力を混同しないよう最低限次を分離する。

```text
startingStock
projectedProduction
maintenanceRequired
productionInputDemand
productionInputAllocated
productionInputShortage
endingStock
maintenanceShortage
```

`productionInputShortage`はMilitary Factoryの減産理由であり、市民死亡へ直接変換しない。`maintenanceShortage`だけをCivilian Goods不足被害へ使う。

Fuelは最低限次を分離する。

```text
startingStock
generationFuelDemand
projectedFuelUsed
generationFuelShortage
projectedProduction
endingStock
```

- `generationFuelDemand`: 全給電希望を満たすFuel量
- `projectedFuelUsed`: 実際の電力割当に使用するFuel量
- `generationFuelShortage`: `max(0, generationFuelDemand - startingStock)`
- `endingStock`: `startingStock - projectedFuelUsed + projectedProduction`

当ターンRefinery生産は`endingStock`へ入るが、`projectedFuelUsed`と当ターンの給電可能量には入れない。

`generationFuelDemand`の全給電希望は、Required Power対象、Power Supply ONかつ労働者1人以上のFarm / Civilian Factory、および入力を1人分以上確保したPower Supply ONのMilitary Factoryを指す。OFF、人口／労働者0、未確保、陥落、入力0の施設は需要へ含めない。

電力は最低限次を分離する。

```text
physicalGenerationCapacity
fuelLimitedGenerationCapacity
requiredPowerDemand
industrialBoostDemand
requiredPowerAllocated
industrialBoostAllocated
unpoweredFacilities
```

`unpoweredFacilities`は施設IDと、物理発電Capacity不足、Turn-start Fuel不足、割当順位負け、Power Supply OFF、人口／労働者0、Military Factory入力なし等の理由を持つ。

```text
fuelLimitedGenerationCapacity = startingStock Fuel × 5
availableGenerationCapacity
= min(physicalGenerationCapacity, fuelLimitedGenerationCapacity)
```

実割当は`availableGenerationCapacity`の範囲で5単位ずつ行う。

重要なのは、

**Food / Civilian Goods / Military Goodsのshortageは、現在の労働者配置による当ターン生産を含んだ最終不足量**

とすること。

全資源の`endingStock`は`max(0, ...)`で0以上にクランプし、不足分は対応する`shortage`へ分離する。ForecastはGameStateの`Resources >= 0`不変条件と一致させる。

---

# 20. Forecastの意味

v1.2.6以前のように、

> この不足は現在から労働者を配置しても防げない

という意味にはしない。

v1.2.7ではPlayer Phase中のActionごとにForecastを再計算し、

労働者を増やして不足が解消された場合は、

```text
shortage = 0
```

へ更新する。

一方Fuelなど、そのターンの追加生産では入力不足を救えない資源については、そのことをUIとAgent Observationで明示する。

---

# 21. UI

## 21.1 都市

表示例:

```text
Power: Required
Projected Power Supplied: Yes / No
Civilian Goods Output: 41 / 0
```

停電時には、

```text
Power outage: civilian-goods production unavailable
```

相当の説明を表示する。

人口・編成等が利用不能になったようには表示しない。

---

## 21.2 産業施設

表示例:

```text
Power Supply: ON
Projected Power Supplied: Yes
Production Multiplier: ×2
Base Output: 50
Projected Output: 100
```

Player Phase中の給電表示は、現在の配置・備蓄・Power Supply設定で次のEndTurnに給電される見込みを示す。直前EndTurnの実績は別の`Last Power Supplied`として分離し、予測と混同しない。

---

## 21.3 資源Forecast

例:

```text
Food
Stock           40
Production     +80
Consumption   -115
End Stock        5
Shortage         0
```

とし、

**現在の配置を変更すればForecastも即座に更新される**

ことが分かるUIとする。

---

# 22. Observation API

AIが内部処理順を推測せず判断できるようにする。

施設Observationでは最低限、

```text
powerMode
powerDemand
powerSupplyEnabled
projectedPowerRequested
projectedPowerSupplied
projectedPowerReason
lastPowerSupplied
projectedProductionMultiplier
baseProduction
projectedProduction
```

相当を確認可能にする。

Forecastでは、

```text
startingStock
projectedProduction
maintenanceRequired
productionInputDemand
productionInputAllocated
productionInputShortage
endingStock
shortage
```

相当を確認可能にする。Civilian Goods、Fuel、電力は第19章の追加内訳を返す。

さらに、

```text
sameTurnProductionCanCoverMaintenance: true
sameTurnProductionCanCoverProductionInputs: false
```

に相当する静的ルールを`getApiInfo()`等から明示する。

加えて、同ターンCivilian Goods生産物そのものは入力に使えないが、増産によって市民維持用予約が減れば既存のTurn-start StockをMilitary Factory入力へ回せることを、機械可読な説明と日英資料の両方で明示する。

---

# 23. PLAY_WITH_AI / Agent Context

AI向け説明をv1.2.7へ更新する。

最低限以下を明示する。

- Farm / Civilian Factory / Military Factoryは無電力でも基本生産する。
- 電力5を供給すると生産量が2倍になる。
- Capital / Cityは電力がない場合、人口由来Civilian Goodsを生産しない。
- 停電都市でも人口保持・移住・編成等の行政機能は利用可能。
- RefineryとPower Plantは電力ブースト対象外。
- 発電にはTurn-start Fuelだけを使用できる。
- 発電は`Fuel 1 → Electricity 5`で、施設単位の需要5を部分給電しない。
- Required都市、Farm / Civilian Factory、入力確保済みMilitary Factoryの順に給電する。
- 当ターン生産Food / Civilian Goods / Military Goodsは同ターン維持消費に使える。
- 当ターン生産資源を別施設の生産入力として連鎖利用することはできない。
- 労働者配置変更によって、Food / Civilian Goods / Military Goods不足をそのターン中に解消できる場合がある。

---

# 24. Balanced Agent

Balanced Agentは従来の固定備蓄判定だけでなく、

**当ターン生産後の最終収支**

を基本判断材料にする。

特に、

- Food projected ending stock
- Civilian Goods projected ending stock
- Military Goods projected ending stock
- Fuelの翌ターン用備蓄
- Required city power
- Industrial power boost
- 発電用Fuel
- Military Factory用Turn-start Civilian Goods
- 物理発電Capacity不足とFuel不足
- Civilian Goodsの市民維持不足とMilitary Factory入力不足

を区別する。

Forecast不足が労働者再配置で解消可能なら、EndTurn前にそのActionを評価する。

---

# 25. 燃料の暫定バランス

v1.2.7ではFuelが従来より大幅に余る可能性を意図した状態として許容する。

将来的用途:

- 車両移動
- 車両戦闘
- 装甲車
- トラック
- 航空機
- 発電
- 有限油田
- 有限製油設備
- シナリオ別Fuel供給量

v1.2.7ではFuel黒字そのものをバランス異常としない。

---

# 26. テスト項目

## 生産

- FarmはFuel不要
- Civilian FactoryはFuel不要
- Military FactoryはFuel不要
- Military FactoryのCivilian Goods入力は維持
- RefineryはFuel 5 / worker
- Powered industrial facilityは×2
- Unpowered industrial facilityは×1

## 都市

- Powered Capital / Cityは通常Civilian Goods生産
- Unpowered Capital / CityはCivilian Goods 0
- Unpowered Cityでも人口保持可能
- Unpowered CityでもTransferPopulation可能
- Unpowered CityでもUnit編成可能
- Unpowered Cityでも所有・補給・感染処理が維持される

## 電力

- Required都市を産業より先に給電
- 都市間は確保時期順
- Farm / Civilian FactoryをMilitary Factoryより先に給電
- Farm / Civilian Factory間は確保時期順
- 入力を1人分以上確保したMilitary Factoryだけを給電候補にする
- Military Factory間は確保時期順
- OFF産業は割当対象外
- 人口／労働者0、未確保、陥落施設は割当対象外
- 電力5未満の部分給電を行わない
- 電力不足産業は停止せず×1
- 発電Fuelは実割当分だけ消費
- 電力5の実割当ごとにFuel 1を消費
- Power Supplyの初期値とSave移行値はON
- `SetPowerSupply`の合法条件、不正時State／RNG不変、即時Forecast更新

## 生産・消費タイミング

- 当ターンFarm生産Foodで当ターン食料消費を支払える
- 当ターンCivilian Goods生産で当ターン市民消費を支払える
- 当ターンMilitary Goods生産で当ターンUnit維持費を支払える
- 当ターンRefinery生産Fuelを同ターン発電へ使用できない
- 当ターンCivilian Goods生産を同ターンMilitary Factory入力へ使用できない
- 同ターンCivilian Goods増産で維持予約が減った場合、余ったTurn-start StockをMilitary Factory入力へ使用できる
- Food不足死が同ターンの確定済みCivilian Goods維持必要量を減らさない
- Food不足、Civilian Goods不足の順に現行被害を適用する
- 労働者再配置後にForecastが更新される
- Power Supply切替後にForecastが更新される
- ForecastのendingStockは0以上で、不足をshortageへ分離する
- Civilian Goodsの維持不足と生産入力不足を分離する
- Fuelの希望量、実使用量、入力不足を分離する
- 物理発電Capacity不足とFuel不足を分離する
- Forecastと実EndTurn結果が完全一致する

---

# 27. バランス検証

v1.2.7では、

- Fuel入力削除
- Industrial Production ×2
- 当ターン生産物による当ターン維持
- 都市停電によるCivilian Goods停止

が同時に入る。

単一変更より影響が大きいため、勝率だけでなく以下を見る。

- resourceShortageLosses
- Food surplus
- Civilian Goods surplus
- Military Goods surplus
- Fuel surplus
- 各施設確保率
- 各施設平均worker数
- powered industrial facilities
- unpowered city turns
- Power Plant loss後の生存率
- Refinery追加確保率
- Power Plant追加確保率
- Unit数
- maxPopulation
- win rate

特に、

**経済が余裕を持ったことで将来Unit追加の余地ができたか**

と、

**生産能力が高すぎて追加施設確保の価値が消えていないか**

の両方を確認する。

標準ConfigのBalanced Agentを固定Seed 1～300で技術的失敗なく完遂し、v1.2.6基準と主要Metricsを比較する。特定の勝率、余剰資源量、施設確保率は自動合否条件にしない。自動合否は技術的失敗がないこと、決定性、ForecastとEndTurn実結果の一致までとし、Fuel余剰や勝率等はレビューと後続Config調整の判断材料にする。

---

# 28. 今回扱わない事項

- 車両
- 航空機
- 車両Fuel消費
- 有限油田
- 送電線
- 地域別電力網
- 蓄電
- 都市の計画停電をプレイヤーが選択する機能
- 詳細なPower Priority
- 労働者数比例の電力需要
- 発電所ごとの個別Fuel備蓄
- 施設Upgrade

---

# 29. v1.2.7の設計意図

v1.2.7では、資源管理の難しさを単なる処理順の暗記から切り離す。

プレイヤーは、

> 食料が足りないなら農場へ緊急動員する。  
> 民需が足りないなら工場を増産する。  
> 軍需が足りないなら軍需工場を動かす。

ことで、そのターンの危機へ対応できる。

一方で、

> 明日の発電用Fuelを備蓄する。  
> 軍需生産用Civilian Goodsを事前に確保する。  
> 都市へRequired Powerを維持する。

といった上流インフラについては事前計画を要求する。

つまり、

**即応できる生活危機と、備蓄が必要な構造的危機を分離する。**

これにより、資源管理を理解しやすくしながら、危機管理ゲームとしての計画性は維持する。

---

# 30. Version境界

| 対象 | v1.2.7 Version |
|---|---|
| App / Release | `1.2.7` |
| Game Rules / GameState / Config | `1.3.0` |
| Save Format | `2` |
| Agent API | `1.3.0` |
| Observation API | `1.3.0` |
| Browser Bridge API | `1.3.0` |
| Artifact Schema | `1.3.0` |
| Balanced Agent | `2.3.0` |
| Random Agent | `1.1.0` |

- 経済ルールと公開Observationの追加は各APIのminor更新とする。
- Save Formatの外側の容器と検証方式は維持するためFormat `2`を継続する。
- Random Agentの選択アルゴリズムは変更しないためVersionを維持する。
- Build IDの扱いは現行仕様を維持し、乱数とゲーム結果へ影響させない。
- 日本語UIでもタイトルは`Nowhere Left to Hide`に統一する。

---

# 31. Save移行とReplay互換性

## 31.1 移行対象

- v1.2.6 Game Rules / GameState / Config `1.2.1`、Save Format `2`
- v1.2.5 Game Rules / GameState / Config `1.2.0`、Save Format `2`

v1.2.5は現行の決定的なv1.2.6移行を適用した後、v1.2.7へ二段階移行する。v1.2以前のSaveは理由付きで拒否する。

## 31.2 v1.2.7移行

- 共有しないコピー上で旧Format、Checksum、Version、Config、State、不変条件を検証してから移行する。
- Farm / Civilian Factory / Military Factoryへ`powerSupplyEnabled: true`相当を追加する。
- `lastPowerSupplied`相当の旧実績が存在しない場合は`null`または「実績なし」を表すSchema既定値とする。
- 人口、労働者、資源、施設状態、Turn、RNG状態、道路、検問所、Action履歴は変更しない。
- 読み込んだ次のEndTurnからv1.2.7経済ルールを適用する。
- 移行元を自動削除、変換保存、上書きしない。次の受理ActionまたはEndTurn後に初めて現行形式で自動保存する。
- 検証または移行失敗時は現在StateとRNGを変更せず、理由を日本語・英語で表示する。

## 31.3 Replay / Artifact

v1.2.6以前のReplay / Artifactは移行しない。旧経済ルールのAction列からv1.2.7結果を再現できないため、Version不一致として状態変更なしで理由付き拒否する。

---

# 32. 実装順序

## Phase 1: Version・Config・State・Save移行

- Version定数とConfig
- 電力利用区分、Power Supply状態、給電実績
- `SetPowerSupply` Action
- v1.2.5／v1.2.6 Save Format 2移行

## Phase 2: Economy Core

- 共通の純粋Forecast／経済計算関数
- 3段階電力割当
- `Fuel 1 → Electricity 5`
- Fuel直接入力削除と産業ブースト
- Civilian Goods維持予約とMilitary Factory部分入力
- 生産後維持消費と不足被害

## Phase 3: Observation・API・Event

- 施設の予測／実績給電と理由
- 資源、Fuel、電力Forecast内訳
- Event、Metrics、Artifact Schema
- AgentGame / Browser Bridge自己説明

## Phase 4: Human UI・Documents

- ON/OFF操作と無効理由
- 都市、産業、資源Forecast表示
- 日英ヘルプ、Tips、`PLAY_WITH_AI.md`、API説明、README

## Phase 5: Agent・統合検証

- Balanced Agent `2.3.0`
- Unit／Integration／Save Migration／Bridge Smoke Test
- Random／Balanced固定Seed 1～100
- Balanced固定Seed 1～300比較
- Portable Package Smokeと外部AI E2E

CoreのForecastとEndTurn実処理は同じ純粋計算経路を使い、Human UI、Headless、Agent、Browser Bridgeへ別ルールを作らない。

---

# 33. 成果物と完了条件

## 33.1 成果物

- v1.2.7 Economy / Power Grid Game Core
- `SetPowerSupply`を含むGameAction / GameState / Config
- 共通EndTurn Forecast
- Human UIの日英表示・ヘルプ
- Agent API / Observation / Browser Bridge `1.3.0`
- Balanced Agent `2.3.0`
- Artifact Schema `1.3.0`と追加Metrics
- v1.2.5／v1.2.6 Save移行
- 更新済み`PLAY_WITH_AI.md`、`public/agent-api.html`、README、Portable AI Package
- Unit／Integration／Migration／Simulation／外部AI E2E結果

## 33.2 完了条件

次をすべて満たした時点でv1.2.7を完了とする。

1. Farm / Civilian Factory / Military FactoryからFuel直接入力が除去され、Military FactoryのCivilian Goods入力だけが維持される。
2. Power Plantが`10 Electricity / worker`、`Fuel 1 → Electricity 5`で、実割当分だけFuelを消費する。
3. 電力需要5を施設単位で全量割当し、人口／労働者0、未確保、陥落施設は需要を持たない。
4. Required都市、Farm / Civilian Factory、入力確保済みMilitary Factoryの3段階で決定的に給電する。
5. 都市は停電時に人口由来Civilian Goodsだけを停止し、行政・所有・補給・感染・防衛機能を維持する。
6. 主要産業は無給電×1、給電×2で、Military Factory部分稼働へ正しく倍率を適用する。
7. Power Supplyは既定ONで、合法な`SetPowerSupply`直後にForecastが更新される。
8. 当ターン生産Food / Civilian Goods / Military Goodsを同ターン維持へ使い、別工程入力へは使わない。
9. Civilian Goodsの市民維持用予約とMilitary Factory入力が、確定した処理順と式に一致する。
10. 維持必要量をEndTurn開始時に固定し、現行の不足被害順と即時敗北を維持する。
11. Resource、Fuel、Electricity Forecastが希望、実割当、予測生産、維持、入力、不足、終了備蓄を区別し、実EndTurn結果と完全一致する。
12. Human UIとObservationが予測給電、直前実績、未給電理由を混同せず公開する。
13. Balanced Agentが公開Observationだけから緊急増産、Fuel備蓄、発電能力、Required Power、産業ブースト、Military Factory入力を区別して判断する。
14. v1.2.5／v1.2.6 Save Format 2を安全かつ決定的に移行し、旧Replay／Artifactを拒否する。
15. 固定Seed 1～100のRandom／Balancedが技術的失敗なく完遂し、決定性と不変条件を満たす。
16. Balanced固定Seed 1～300結果をv1.2.6基準と比較し、主要Metricsをレビューする。特定勝率は合否条件にしない。
17. Production Build、Portable Package Smoke、外部AIによるGame Over・Artifact・Replay E2Eが成功する。
18. 実装、テスト、動作確認後、本書を現行仕様へ反映し、Version、Save、Human UI、AI資料を整合させる。
