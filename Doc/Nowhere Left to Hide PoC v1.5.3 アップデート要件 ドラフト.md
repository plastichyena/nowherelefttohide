# Nowhere Left to Hide PoC v1.5.3 アップデート要件 ドラフト

- 作成日: 2026-09-06
- 状態: **ドラフト。未確定事項あり。実装開始用の確定仕様ではない。**
- 対象Release候補: `1.5.3`
- 基準: v1.5.2 現行仕様
- 正本: `Nowhere Left to Hide PoC 現行仕様.md`
- 関連: `Nowhere Left to Hide PoC v1.5.2 アップデート要件 確定版.md`

本書は、v1.5.2のパフォーマンス改善がSOG05実機で十分な効果を確認できた後の次期更新候補を整理するためのドラフトである。v1.5.2で用意したQuery／Combat／Movement／Unit lifecycle／Unit catalog／Map参照の境界を再利用し、UIだけの別ルールや別状態変更経路を作らない。

このドラフトでは、ユーザーから明示された数値・挙動は要件候補として記載する。一方、死亡時範囲damageの適用順、陸軍基地の配置方式・軍需補充・迎撃回数の回復時点、旧Save互換等、明示されていない事項は勝手に補完せず「未確定事項」として残す。

---

# 1. v1.5.3の目的

1. Human UIのUnit編成表示を整理し、Police／National Guard／Riot Policeの性能と編成Costを同じ形式で確認できるようにする。
2. Zombie移動時のPlayer Unitによる物理的な足止めを明確化し、Attack Chargeを失ったPlayer Unitでも経路上の防壁として機能できるようにする。
3. Hunter Zombieのゲーム性能は変更せず、Assetの服装だけを更新して「元陸上選手がオフの日に感染・変異した」視覚的コンセプトを強める。
4. 死亡時に周辺へdamageを発生させるGas Zombieを追加し、v1.5.2で準備したUnit lifecycleと戦闘対象列挙の境界を実際の範囲効果へ拡張する。
5. 新しい恒久施設候補としてArmy Baseを追加し、National Guard編成、早期確保報酬、施設自身の迎撃能力、独立Military Goods Poolを導入する。
6. Power PlantのFuel効率を低下させ、発電とUnit燃料補給の競合を強める。

最低射程、距離別Attack、その他の将来Unitは本ドラフトの実装対象には含めない。ただしv1.5.2の`forecastUnitCombatAtDistance`等、将来機能の受け皿を壊さない。

---

# 2. Human UI: Unit編成表示の整理

## 2.1 現状と目的

現行Human UIではRiot Policeの編成ButtonだけにCostが目立つ形で併記され、Police／National Guardと情報量が揃っていない。v1.5.3ではUnit編成Sectionを他の情報Sectionと同様のAccordion／折りたたみ式に整理し、どのUnitを何のCostで編成できるかを同じ書式で確認可能にする。

## 2.2 表示要件

- Unit編成Sectionは対象Facility内の独立した折りたたみSectionとする。
- Section見出しは日本語・英語Label、Chevron、`aria-expanded`を持ち、スマートフォンで他の情報Accordionと同じ操作感にする。
- 各編成可能Unitを同じ形式のRow／Cardとして表示する。
- 少なくともUnit名と編成Costを常時同じ形式で表示する。
- Unit性能を同時表示する場合はConfig由来の値を使い、固定文字列で第二のUnit定義を作らない。
- 編成不可の場合はButton無効化と既存Core Reasonを表示し、見た目だけで合法性を判断しない。
- ButtonごとにCost表記方式を変えない。Riot Policeだけ特殊表示する現行差を解消する。

現行標準Configの編成Costは以下であり、v1.5.3で別途Balance変更を決定しない限り維持する。

| Unit | Population | Civilian Goods | Military Goods |
| --- | ---: | ---: | ---: |
| Police | 5 | 10 | 10 |
| National Guard | 10 | 20 | 25 |
| Riot Police | 10 | 25 | 25 |

Fuelは編成Costではなく、現行どおり完成後にState Fuelから補給される別処理として表示上も混同しない。

Army Base追加後のNational Guard編成入口も同じ共通UIを使用し、Army Base専用の別表示ルールを作らない。

---

# 3. Zombie移動: Player Unitによる経路上の足止め

## 3.1 目的

現行はZombieが移動中にHuman Unitの迎撃射程へ入った場合、迎撃可能なHuman UnitがあればそこでCombatを解決して移動停止する。一方、Player UnitにAttack Chargeが残っていない場合、ZombieがそのUnitの近傍を通過して遠方Targetへ直行できるケースがある。

v1.5.3では、Player UnitがAttack Chargeを使い切っていても「盤面上に存在する防壁」としてZombieの移動を足止めできるようにする。特に高MovementのHunter Zombieが、経路上の大人数Player Unitを無視して遠方のPopulation Target／Capitalへ直行する挙動を抑える。

## 3.2 移動停止要件

- Zombie Unitが経路に沿って移動するとき、**経路上で初めてPlayer Unitに隣接するHexへ到達した時点で移動を終了する**。
- この停止判定は、隣接Player UnitのAttack Charge、`canAttack`、携行Military Goods、反撃／迎撃成立可否に依存しない。
- Player UnitがAttack Charge 0でも足止めは成立する。
- 足止めそのものはHuman UnitのAttack Chargeを消費しない。
- 迎撃可能なPlayer Unitが存在する場合のCombatは既存の迎撃規則と共通Combat処理を利用し、足止め判定のためだけに別damage規則を作らない。
- Zombieの実移動Hex数、Noise、Target記憶、移動Event、同コスト経路の決定性を維持する。
- `movement.ts`の1 Hex進入処理を基準にし、Zombie AIごとに別の「近傍Unit検出」を実装しない。

## 3.3 適用対象候補

ユーザー指定は「ゾンビユニット」であるため、原則としてNormal AI系Zombie、Horde Zombie、および新規Gas Zombieを含む全Zombie Typeへ適用する候補とする。

ただし、Horde Zombieにも同じ足止めを適用するか、Hunterを含むNormal AI系だけに限定するかはゲームバランスへの影響が大きいため、確定前に明示確認する。

## 3.4 未確定事項

- 足止め位置に隣接するPlayer Unitが複数いる場合の、その後のZombie Attack Target優先順位。
- 足止めしたZombieがAttack Chargeを持つ場合、既存Targetを維持するか、隣接Player Unitを即時攻撃候補として優先するか。
- Horde Zombieにも同じ足止めを適用するか。
- Spawn直後、Noise Target移動、Horde継承Target移動でも完全に同じ停止規則を使うか。

---

# 4. Hunter Zombie Asset更新

## 4.1 ゲーム性能

Hunter Zombieの性能・AI・Targeting・Wave Slot・初期配置条件はv1.5.2から変更しない。

標準値は以下を維持する。

- HP 20
- Attack 15
- Movement 15
- Range 1
- Vision 5
- 最大Attack Charge 1
- Normal AI系
- Human Unit死亡からのReanimation対象外

## 4.2 新しい視覚コンセプト

現在のHunter Zombieの長い爪、変異した身体的特徴、単体描画の識別性は維持し、**服装だけを変更する**。

新しい服装:

- 薄い長袖シャツ
- 短いショーツ
- クルーソックス
- ランニングシューズ
- スポーツウォッチ

狙いは「元陸上選手がオフの日に襲われ、その服装のままZombie化し、Hunterへ変異した」印象を強めることである。

## 4.3 Asset要件

- Runtime Pathは既存`units/unit_hunter_zombie.png`を維持する候補とし、Core Type、Save、ObservationへAsset変更を波及させない。
- 既存の画風、透過PNG、256×256 px、低Zoom LODでの識別性を維持する。
- 長い爪等、Hunter識別に使っている既存特徴を弱めない。
- Art reference、生成Prompt、後加工記録、Asset Manifestを更新する。
- Asset変更だけでUnit性能・Hit判定・Targetingを変えない。

---

# 5. Gas Zombie追加

## 5.1 基本性能

新しいZombie Unit Typeとして`Gas Zombie`を追加する。

ユーザー指定の基本値:

| 項目 | 値 |
| --- | ---: |
| HP | 30 |
| Attack | 5 |
| Movement | 3 |
| Vision | 3 |
| 最大Attack Charge | 1 |
| 死亡時隣接damage | 30 |

Rangeはユーザー指定に含まれていないためドラフトでは未確定とする。現行の近接Zombieと同じRange 1を候補にできるが、確定仕様では明示する。

## 5.2 死亡時Gas Explosion

- Gas Zombieが死亡した時点で死亡位置をCenterとして範囲効果を解決する。
- Centerに隣接する全Hexを対象候補とし、Hex列挙には共通`hexNeighbors`／`hexRing(center, 1)`相当を使用する。
- 隣接Hexにいる対象へ30 damageを発生させる。
- 敵味方を区別せず作用する。
- 同一対象へ同じGas Zombieの爆発damageを重複適用しない。
- damage、死亡、Kill Credit、Reanimation、占有・感染等はv1.5.2で分離したCombat／Unit lifecycle境界を通し、UIやZombie AIからHPを直接変更しない。
- 爆発EventとPlayer-facing公開情報はFoWを破らない。

## 5.3 未確定事項

以下はユーザー指定だけでは一意に決められないため、確定前に決める。

- 「隣接する全Hexへの30 damage」の対象がUnitだけか、Facility／Checkpoint／民間人口にも及ぶか。
- Gas Zombie自身の死亡原因を問わず爆発するか（通常攻撃、反撃、迎撃、他Gas Explosion、将来の範囲攻撃等）。
- Gas Explosionで別Gas Zombieが死亡した場合に連鎖爆発するか。
- 爆発の処理順がCounterattack／Interception／移動停止／Facility占有より前か後か。
- 爆発damageのTerrain軽減有無。
- Player UnitのKill Credit、熟練度用Zombie Killを直接撃破したGas Zombieだけに与えるか、連鎖撃破も含めるか。
- Gas ZombieのNormal AI Targeting、初期配置、Scheduled Horde特殊SlotのWeight／Cap、通常Reanimationの有無。
- Asset、日英名称、Help／Legendでの警告表現。

---

# 6. Army Base追加

## 6.1 施設概要

新しい恒久Facility Typeとして`Army Base`を追加する。

ユーザー指定:

- ゲーム開始時は中立状態。
- Map内に最大1施設。
- Player Unitを派遣して確保できる。
- ゲーム開始からTurn 20以内に確保した場合、Regular熟練度のNational Guardを1 Unit無料で獲得する。
- 現時点でArmy Baseから編成可能なUnitはNational Guardだけ。
- Worker Capacityは10。
- Army Base自体がRange 2、Attack 10の迎撃能力を持つ。
- 迎撃可能回数は配置Worker数と同値。
- Army Base迎撃が発生した場合、Noise Radius 8のNoise判定を発生させる。
- Army Base固有Military Goods Poolを40持つ。
- Army Base迎撃1回につき固有Military Goodsを2消費する。

## 6.2 早期確保報酬

- Turn 20以内のPlayer確保を早期確保条件とする。
- 条件成立時、Regular National Guard 1 Unitを無料獲得する。
- 「無料」は少なくとも通常の編成Population／Civilian Goods／Military Goods Costを支払わないことを意味する。

次の点は確定前に明示する。

- Turn 20「以内」を`turn <= 20`の確保成立時として扱うか。
- 報酬は1ゲーム1回だけか。再陥落・再確保で再取得できないことを明文化するか。
- 無料National Guardの初期Fuelと携行Military Goodsを、通常完成Unit、初期Unit、または専用値のどれに合わせるか。
- 確保HexがUnit配置済みの場合の無料Unit配置位置。

## 6.3 National Guard編成

- Army BaseではNational Guardだけを編成可能にする。
- Army Baseへ配置したWorkerは施設迎撃能力に使い、National GuardのPopulation Costそのものとして消費しない。
- National Guard編成時に必要なPopulationは、必要人口を持つPlayer所有Cityから差し引く。
- 通常のNational Guard編成Cost、完成Timing、Fuel補給、熟練度規則を再利用し、Army Baseだけ別Unit生成処理を作らない。

Population供給元Cityの決め方は未確定とする。候補として、PlayerがCityを選択する、既存の人口供給順位を使う、最寄りの適格Cityを使う等があるが、本ドラフトでは採用しない。

## 6.4 Army Base迎撃

Army BaseはPlayer所有かつ迎撃可能状態のとき、施設自身を攻撃SourceとしてZombieへ迎撃を行う。

基本値:

- Range: 2 Hex
- Attack: 10
- 迎撃回数上限: 配置Worker数
- Military Goods Cost: 1迎撃につきArmy Base Poolから2
- Army Base Military Goods Pool上限候補: 40
- Noise Radius: 8

既存Human UnitのInterceptionと同じ距離判定・damage・Terrain処理を可能な限り共通Combat Queryへ寄せる。ただしFacilityはUnitではないため、Attack Charge、熟練度、Fuel、自然回復を無理にUnit型へ擬態させない。

## 6.5 Army Base固有Military Goods Pool

- Army Baseは国家備蓄とは別にMilitary Goods Poolを持つ。
- 初期／最大値として40が指定されている。
- 迎撃1回ごとに2減少する。
- Pool不足時の迎撃成立条件をCore Queryと実処理で共通化する。
- Facility固有状態としてSave／Load／Replay／Observation／Agent APIへの公開範囲を検討する。

Poolをどう補充するかは未指定であり、以下を確定前に決める。

- 自動補充なしの有限40とするか。
- Supply内ならState Military Goodsから補充するか。
- Player Actionで補充するか。
- 補充量・Timing・優先順位。

## 6.6 Workerと迎撃回数

Worker Capacityは10とする。

「迎撃可能回数は中に配置したWorker数と同値」との指定について、迎撃回数の回復単位が未指定である。少なくとも次を確定する。

- 1 Zombie PhaseごとにWorker数までか。
- 1 Turn全体でWorker数までか。
- Counterattack等、別Combatは回数へ含めるか。
- Workerが途中で死亡／感染／再配置された場合の残回数計算。

Facility Workerの配置・撤収は既存`AssignWorkers`、人口所在地、感染、操作可能Turnの規則を再利用する候補とする。

## 6.7 Army Base Noise

- Army Baseによる実際の迎撃Combat 1回につきNoise Radius 8判定を発生させる。
- 既存Human Combat Noiseと同じ`pendingNoisePulses`／次Zombie Phase評価の仕組みを再利用する候補とする。
- Player-facing UIでは既存Noise公開方針に合わせ、Hidden Zombie Target等を漏らさない。

Army Base NoiseをHuman Combatと同じNoise Class表現にするか、施設固有Source Typeとして公開するかは未確定。

## 6.8 配置方式: 要確定

現行v1.5.2は`fixed-51x51-v1`の51×51固定Mapで、29恒久FacilityのID・Type・座標を固定定義している。したがって「Army Baseの配置は他施設同様ランダム」という要望は、現行実装の他恒久施設配置方式とは一致しない。

v1.5.3確定前に、次のいずれかを明示的に選ぶ必要がある。

1. **固定配置**: 30番目の恒久FacilityとしてArmy Base座標を1か所固定する。
2. **Seed選択配置**: 検証済み候補Hex群から新規ゲームSeedで1か所を選び、他のTerrain／Facilityは固定のままにする。
3. **Map全体のランダム化**: 将来予定のRandom Mapをv1.5.3へ前倒しする。

本ドラフトでは3を自動採用しない。2を採用する場合もMap ID、Save validation、Agent metadata、Session replay、候補Hexの安全性・到達性・施設非重複・PRNG順を仕様化する。

## 6.9 その他未確定事項

- Army BaseのVision Radius。
- Neutral／感染／disabled／recovering／陥落状態で迎撃できるか。
- ZombieがArmy BaseをPopulation Targetとして扱うか、施設Target Valueを持つか。
- Army Base自体にCivilian Populationを保持するか、Workerだけを保持するか。
- Supply外でのNational Guard編成、Worker配置、迎撃、Military Goods補充の可否。
- Facility陥落時の固有Military Goods残量の扱い。
- Army Base占有時の感染／復旧／overrun Spawn規則。
- Board Asset、Legend、Help、Facility Sheetでの迎撃残回数・Military Goods表示。

---

# 7. Power Plant Fuel消費変更

現行v1.5.2では、Wind Power Plant供給で不足する実割当5 ElectricityごとにTurn-start State Fuel 1を消費する。

v1.5.3ではこのFuel Costを**1から2へ増加**する。

候補となる明文化:

- Wind供給で足りない実割当5 ElectricityごとにTurn-start State Fuel 2を消費する。
- 利用可能なPower Plant由来電力は、Fuel 2単位につき5 Electricityとして算定する。
- 余剰発電CapacityにはFuelを消費しない。
- Wind Power Plantは引き続きFuel不要。
- 当TurnのRefinery生産Fuelは引き続き同Turnの発電へ使わない。
- 発電後に残ったFuelをHuman Unit補給へ回す既存順序を維持する。
- Forecast、Strategic Forecast、EndTurn実処理、Human HUD、Agent Queryは同じEconomy Planから新Costを取得する。

端数処理、Fuel 1だけ残っている場合に2.5 Electricity等の部分発電を認めるかは現行の5 Electricity単位処理との整合上、**部分発電なし**を第一候補とするが、確定前に明示する。

---

# 8. Core設計方針

v1.5.3ではv1.5.2で準備した境界を利用する。

```text
UI / Headless / Agent / Session
          ↓ 公開Query / GameAction
GameEngine: 検証 → 作業状態 → 処理順制御 → 不変条件 → commit
          ↓
Combat / Movement / Unit lifecycle / Economy / Zombie AI
          ↓
Unit catalog / Map reference / Terrain / Hex / RNG / JSON型
```

- Zombie足止めはMovementの1 Hex進入処理へ置き、Hunter専用分岐にしない。
- Gas Zombieの死亡爆発はUnit lifecycleから共通damage適用へ接続し、個別ActionからHPを直接減らさない。
- Army Base迎撃はCombat Query／適用を再利用するが、FacilityをHuman Unitとして偽装しない。
- Power Plant Cost変更はEconomy Planを正本にし、Forecast専用計算を作らない。
- Unit／Facilityの新Typeはcatalog／Config／型／validation／Agent公開／Asset Registryを一貫して追加する。
- 新しい範囲効果のためにPhaser Boardをルール判定源にしない。範囲Hex・対象・damageはCoreが決め、UIはProjectionを描画する。

---

# 9. Human UI・Help・Agent公開

## 9.1 Human UI

- Unit編成Sectionの整理を日本語・英語の双方へ反映する。
- Gas Zombieは可視時にType、HP、Attack、Movement、Range、Visionと死亡時危険性を確認できるようにする。
- Army Base Sheetは所有状態、Worker、迎撃能力、迎撃残回数、固有Military Goods、National Guard編成入口、早期確保報酬の状態を表示する候補とする。
- Power Plant SheetとPower ForecastはFuel 2 Costを反映する。
- Hunter Zombie Assetだけの変更は数値UIを変えない。

## 9.2 Help／Board Legend

- Gas Zombieの死亡爆発を日英で説明する。
- Army Baseの確保報酬、National Guard編成、Worker迎撃、固有Military Goods、Noiseを説明する。
- Power Plantの発電Fuel CostをConfig／Forecast由来で表示する。
- Hunter Zombieの説明数値は据え置き、Assetの服装変更をゲームルールとして説明しない。

## 9.3 Agent／Browser Bridge

新Unit／Facilityの追加によりAgentが合法手と公開危険性を判断できるようにする。ただしHidden情報を追加公開しない。

- Visible Gas Zombieの公開基本性能と、死亡時爆発の公開可能な範囲・damageを返す。
- Army BaseのPlayer-visible状態、編成可能Unit、固有Military Goods、迎撃可能性を必要範囲で公開する。
- Zombie足止め規則を合法Move／Threat Projectionと一致させる。
- Power Forecastは新Fuel CostをHuman／Agentで共有する。

Observation／Agent／Artifact／Session schema Versionを上げる必要があるかは、最終的な公開field追加内容を確定後に決める。

---

# 10. Save・互換性・Version

v1.5.3ではGas Zombie Type、Army Base Facility Type、Army Base固有Military Goods／迎撃状態等がGameStateまたはConfigへ追加される可能性が高い。

したがって以下を確定前に決める。

- v1.5.2通常Saveをv1.5.3へ移行して継続可能にするか。
- Army Baseを持たないv1.5.2固定Map Saveへ、Load時にArmy Baseを追加するか、旧Mapのまま継続させるか、新規ゲームのみv1.5.3 Mapを使うか。
- Gas Zombie追加に伴うUnit Type validationの旧Save扱い。
- Game Rules／GameState／Config Version、Fixed Map ID、Save Format、Observation、Artifact、Session／Checkpoint Versionのうち、実際に契約が変わるものだけを更新する。
- 旧AI Session／Replay／Artifactの互換方針。

互換性のために新fieldを黙って推測補完したり、旧Saveを無断で削除・上書きしたりしない。

---

# 11. 主要受入テスト候補

## 11.1 UI

- Police／National Guard／Riot Policeの編成表示が同一形式でCostを表示する。
- Riot PoliceだけButton内表示が特殊にならない。
- 編成Accordionの開閉、44 CSS px以上の操作域、`aria-expanded`、日英表示。
- 各Facilityで合法なUnitだけを表示／有効化し、Core Reasonと一致する。
- Army BaseのNational Guard編成も同じUI Componentを利用する。

## 11.2 Zombie足止め

- Attack ChargeありHuman Unit隣接経路で従来迎撃＋停止が成立する。
- Attack Charge 0でもZombieが最初の隣接Hexで停止する。
- Hunter Zombieが高Movementでも経路上のPlayer Unit近傍を通過して遠方Targetへ直行しない。
- 複数Player Unit、複数同Cost経路でも決定性を維持する。
- 足止めだけでHuman UnitのCharge／Military Goods／Fuelを消費しない。
- Noise、Target memory、Eventの順序が確定仕様と一致する。

## 11.3 Gas Zombie

- HP 30、Attack 5、Movement 3、Vision 3、Charge 1。
- 死亡位置の隣接6 Hexだけへ範囲効果を発生し、Distance 2へ漏れない。
- 敵味方共通damage 30。
- 盤端で存在しないHexを安全に除外する。
- 複数対象・同Hex占有規則・死亡順・連鎖を確定仕様どおり処理する。
- FoW外の爆発結果からHidden Unit位置を漏らさない。
- Save／Load／ReplayでGas Zombieと爆発結果を再現する。

## 11.4 Army Base

- 初期中立、最大1施設。
- Turn 20以内の確保報酬と期限後の非報酬。
- Regular National Guard無料取得のCost／Fuel／Military Goodsが確定仕様と一致する。
- Army BaseからNational Guardだけ編成できる。
- Population供給元Cityが確定仕様どおり選ばれ、最後の健全民間人口等の既存不変条件を破らない。
- Worker 0～10と迎撃回数上限が一致する。
- Range 2境界、Attack 10、Military Goods 2消費、Pool 40境界。
- Pool不足、Worker不足、感染／停止／Supply等の不成立理由。
- Army Base迎撃Noise Radius 8と次Zombie Phase反応。
- Save／Load／ReplayでPool、Worker、報酬取得済み状態、迎撃状態を再現する。

## 11.5 Power

- Wind不足分5 ElectricityあたりFuel 2を消費する。
- Fuel不足時の利用可能発電量、未給電Facility、Unit補給残Fuelを正しく計算する。
- Forecast／EndTurn実績一致。
- Refineryの当Turn生産Fuelを同Turn発電へ使わない。

## 11.6 Asset

- Hunter ZombieのRuntime Path、PNG Decode、256×256、透過、LOD、Manifest。
- 既存の長い爪等のHunter特徴を維持し、服装だけ指定内容へ更新する。
- Gas Zombie、Army Baseへ新規Assetを追加する場合、Registry／Legend／Fallbackを同期する。

---

# 12. 確定前に回答が必要な事項

1. Zombie足止めはHorde Zombieにも適用するか。それともNormal AI系だけか。
2. 足止めしたZombieが攻撃可能な場合、隣接Player Unitを攻撃対象へ切り替えるか。
3. Gas ZombieのRangeはいくつか。
4. Gas ExplosionはUnitだけに30 damageか。Facility／Checkpoint／民間人口も対象か。
5. Gas ExplosionによるGas Zombie死亡は連鎖爆発するか。
6. Gas ExplosionへTerrain防御を適用するか。
7. Gas ZombieはNormal AI系か。初期Spawn、Scheduled Horde Slot、Weight／Capをどうするか。
8. Army Baseの配置は固定1か所、Seed候補選択、Random Map前倒しのどれか。
9. Army Base早期確保報酬はTurn 20を含むか、1ゲーム1回だけか。
10. 無料National GuardのFuel／Military Goods初期状態。
11. Army Base編成PopulationをどのCityから差し引くか、その選択方法。
12. Army Baseの迎撃回数はZombie Phaseごと、Turnごと、その他のどの単位で回復するか。
13. Army Base Military Goods Pool 40の補充方法。
14. Army BaseのVision、Supply外・感染・disabled・recovering時の迎撃／編成可否。
15. Power Plant Fuelが1だけ残る場合、部分発電なしで0 Electricityとするか。
16. v1.5.2通常Saveをv1.5.3へ移行するか。

---

# 13. 作業順候補

1. 本ドラフトの未確定16項目を一問一答で確定する。
2. v1.5.3のSave／Map互換方針とVersion境界を確定する。
3. Unit編成UI整理とHunter Asset更新を、ルール変更から独立して先に実施可能にする。
4. Zombie足止めをMovement共通処理へ実装し、既存Zombie AI／Horde／Noise回帰を確認する。
5. Gas ZombieをUnit catalog、Config、Combat／lifecycle、AI、公開Projectionへ追加する。
6. Army BaseのMap／Facility State／Combat／Economy／UI／Saveを追加する。
7. Power Plant Fuel Costを共通Economy Planで変更する。
8. Headless、Human UI、Agent、Save、Replay、Session、Browser Bridge、Asset、固定Seed回帰をまとめて検証する。
9. 実装・検証完了後に現行仕様へ反映し、本ドラフトを確定版へ更新する。

性能面ではv1.5.2の改善を維持し、新しいGas Explosion、Army Base迎撃、Zombie足止めによってHuman UIの主要操作やZombie Phaseが明らかに退行しないことを固定fixtureで確認する。新機能実装を理由に盤面全再構築、毎Action autosave、全Agent Observation依存等のv1.5.1以前の重い構造へ戻さない。
