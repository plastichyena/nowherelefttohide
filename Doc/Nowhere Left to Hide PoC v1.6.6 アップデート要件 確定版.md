# Nowhere Left to Hide PoC v1.6.6 アップデート要件 確定版

> Status: Requirements Final（実装・検証は未実施）  
> Base: v1.6.5  
> 作成・要件確定日: 2026-09-24  
> 追加改訂日: 2026-09-25（AIプレイ出力容量削減・案A／案Cを第15章へ追加）  
> 主な根拠: v1.6.5 Claude Opus playtest（seed 3 / build 1bd6c411196863683a98ba4b83a1a5264692dcfa）、現行 main 実装確認、ChatGPT Desktop Work / CodexでのWebMCP実機確認、2026-09-24時点のOpenAI Site tools説明およびWebMCP Community Group Draft

## 0. 文書の位置付けと目的

本書はドラフトと依頼者との19問の回答を統合した、v1.6.6の実装目標である。未変更部分は `Nowhere Left to Hide PoC 現行仕様.md` のv1.6.5に従う。実装・必須検証完了までは現行仕様をv1.6.5のまま維持する。確定版の作成はゲーム実装、テスト成功、画像の採用を意味しない。

2026-09-25の追加依頼に基づき、AIプレイ出力の容量削減案A・案Cを実装確認のうえ第15章へ追加した。移動予測の既定応答・保存の軽量化と、ArtifactのZIP単体出力を今回の実装範囲へ含める。

質問の回答対応表は第14章に置く。原ドラフトと回答記録はarchiveの履歴資料として保存し、実装時は本書を参照する。アセットは本書確定後に同じタスクで候補を生成・提示し、採用した原本を使用する（第8.5節）。

v1.6.6では、v1.6.5の長期プレイで顕在化した検問所移設のデッドロック、有刺鉄線の防御効果不足、Zombie Unit ID再利用を修正する。

同時に、Military Goods経済を再調整する。Player Unitを保有しているだけで発生する毎ターン固定Military Goods消費を廃止し、Military Factoryを少量高効率変換ではなく大量投入・大量生産型へ変更する。

さらに、余剰FoodをCivilian Goodsへ変換できる新しいConstructible Facility **Relief Supply Center / 救援物資センター** を追加し、Food生産基盤からCivilian Goods不足を部分的に補える経済経路を追加する。

WebMCPについては、GitHub Pages上のAI Play / Watch Session自体は開始できる一方、ChatGPT Desktop Work / Codex側で Site tools discovery が失敗する実機事例を確認した。v1.6.6ではNLTH側WebMCP adapterを現行WebMCP Draftへ合わせ、登録成功・Self Test・配信Buildを診断可能にする。ChatGPT host側でSite tools capabilityが提供されていない場合はゲーム側だけで代替せず、NLTH側失敗とhost側unsupportedを明確に切り分ける。

Game Core、Agent API、WebMCP、Normal UI、Replay、Live Viewer、Save / Artifactの間で同じルールと公開境界を維持する。

---

# 1. 改善の根拠（ドラフトに記録されたv1.6.5調査）

本章は元ドラフトのArtifact調査・実装確認の記録を継承する。本要件整理では当該Artifactの再実行は行っていない。v1.6.6の修正済み・再現確認済みとは扱わず、実装工程で第10章の検証を実施する。以下の「現行 main」はドラフト作成時のv1.6.5を指す。

## 1.1 Claude seed3 Artifact

対象Artifactは App v1.6.5 / Game Rules 15.0.0 / Fixed Map v9、build / git commit は 1bd6c411196863683a98ba4b83a1a5264692dcfa。

最終結果はTurn 54でCapital Lost。

このArtifactでは以下を確認できる。

- Barbed Wire built: 6
- Barbed Wire damage taken: 20
- Barbed Wire destroyed: 1
- Empty Barbed Wire attack charges: 4
- Occupied Barbed Wire attack charges: 0
- Barbed Wire absorbed damage: 0
- Military Goods shortageが複数Turn発生
- EndTurnごとに複数Player Unitへ reason = unit_fixed_upkeep のMilitary Goods消費Eventが発生
- 初期 zombie-8 はTurn 1に撃破された後、Turn 2に別位置で再び enemy_spotted され、その後Turn 9に再度撃破された

したがってZombie ID再利用は観測上も再現している。

Barbed Wireについては absorbed damage = 0 だけを根拠に「ダメージ吸収処理そのものが動いていない」とは判定しない。今回のArtifactでは空のBarbed Wireに対して実際に20 Damageと4 Attack Chargesが消費され、1枚が破壊されている。

## 1.2 現行実装確認

現行 main の checkpoint blocker判定は、candidate checkpoint位置を使って branch supplyを計算し、そのSupply内のZombieを blocker として扱う。この計算にはCapital中心の initialSupplyRadius が常に含まれる。

そのため、初期供給網内に可視Zombieが残ると、移設候補によって新たに拡張される範囲とは無関係に checkpoint_supply_zombie_blocked が成立し得る。

また、感染した ruined / abandoned checkpoint は前方移設を別条件で妨げる。

Barbed Wireは、空のWireをZombieが攻撃してHPを0にした場合、その処理直後に同じZombieがそのHexへ進入可能である。既存テストもこの挙動を正としている。

Unit IDは nextUnitNumber を動的Unit生成で共用する一方、初期Normal Zombieの zombie-N は別経路で割り当てられる。衝突回避は現在生存中の state.units だけを見る経路があり、死亡済みIDを再利用できる。

Military Goods固定消費は各Human Unit Configの fixedMilitaryGoodsUpkeepPerTurn と calculateMilitaryGoodsPlan() によりEndTurn時に差し引かれている。

Military Factoryは現在 Worker 1人あたり Civilian Goods 2 -> Military Goods 1。

---

# 2. Checkpoint relocation: Initial Supply Network内の脅威を移設blockerから除外

## 2.1 問題

CheckpointのBuild / Relocateでは、候補位置から計算した支線Supply内の可視Zombieをblockerとして扱う。v1.6.6では固定のInitial Supply Networkをこの判定から除外する。

しかしInitial Supply NetworkはCheckpointが存在しなくてもCapitalから常に成立する固定の安全・運用基盤である。

この固定領域内のZombieや感染Siteが candidate checkpointごとのSupply blockerに含まれると、Checkpoint喪失後にCapital近傍へ再配置する合法手まで消え、Branch復旧不能になり得る。

## 2.2 v1.6.6仕様

Initial Supply Networkは以下で固定定義する。

**hexDistance(Capital, Hex) <= checkpoint.initialSupplyRadius**

現在のActive Checkpointやcandidate checkpointによって拡張されたSupply RadiusはInitial Supply Networkには含めない。

Checkpoint Build / Relocateの「Supply内Zombie blocker」判定では、Initial Supply Network内にいるZombieを blocker として数えない。

判定集合は **candidate branch supply全体 − Initial Supply Network** とする。この集合内の可視Zombieは、移設前からSupply内だった場所も含めてblockerとする。「移設で新規に増えたHexだけ」へ限定しない。可視性はAction前の公開情報に従い、仮想移設後の新規視界でHidden Zombieを発見・公開しない。

感染した ruined / abandoned checkpoint による forward blockについても、そのCheckpointがInitial Supply Network内なら移設を妨げない。

感染したFacilityについて、現行v1.6.5に独立したCheckpoint移設blockerが存在しない場合、v1.6.6で新しいblockerを追加しない。将来共通Site blockerへ整理する場合でもInitial Supply Network内は除外する。

## 2.3 例外にしない条件

以下はInitial Supply Network内でも従来どおり拒否する。

- 移設先HexそのものをZombieが占有している
- 移設元Active Checkpoint自身にinfectedが残っている
- 移設先にFacility、別Checkpoint、Barbed Wire、Player Ground Unit等がある
- branch roadでない
- Visibility条件を満たさない
- Horde Spawn Reserve等の禁止Hex
- Branch action limit
- Civilian Goods不足
- Initial Supply Radius外の感染ruined / abandoned checkpointを越えて前進する
- Initial Supply Radius外のcandidate supply内に可視Zombieが存在する

「Initial Supply内ならZombieのいるHexへCheckpointを建てられる」という変更ではない。

## 2.4 実装方針

Initial Supply Network判定をSupply共通Helperとして定義し、checkpoint blocker判定で再利用する。

getBlockingZombiesForCheckpoint() でcandidate branch supplyを計算した後、Initial Supply Network内の敵を除外する。

checkpointForwardBlockers() も同じ固定Initial Supply判定を用いる。

Candidate Query、Preview、実Actionで同一Validationを使用し、reasonCode選択順を一致させる。

## 2.5 Acceptance

1. Initial Supply内に可視Zombieが存在しても、Zombieがdestinationそのものを占有していなければ合法な後退・再配置候補が残る。
2. Initial Supply内の感染ruined checkpointはBranchの再建を永久封鎖しない。
3. Initial Supply外でcandidate supplyへ含まれる可視Zombieは、旧Supplyとの重複範囲も含め checkpoint_supply_zombie_blocked を返す。
4. destination占有ZombieはInitial Supply内でも拒否する。
5. source checkpoint infected > 0 は従来どおり checkpoint_infection_blocked。
6. Candidate Queryと実Actionのlegal / reasonCodeが一致する。

---

# 3. Barbed Wireの防御効果修正

## 3.1 調査結果

v1.6.5 seed3ではBarbed Wireは6枚建設され、20 Damageを受け、1枚破壊され、空Wireへの4 Attack Chargesが記録された。

したがって「Barbed WireのDamage処理が全面的に発火していない」とは扱わない。

一方、現行仕様ではHP20のBarbed Wireを通常Hordeが4回攻撃して破壊した後、そのZombieは同じZombie Phase中にそのHexへ進入できる。

これでは正面突破にAttack Chargesは必要でも、移動遅延が保証されず、防御施設として期待される時間稼ぎ効果が弱い。

## 3.2 v1.6.6仕様

Zombieが移動先の空Barbed Wireを攻撃し、そのBarbed Wireをその場で破壊した場合、**そのZombieの当該Zombie Phaseの移動をそこで終了する。**

破壊したZombieはBarbed WireがあったHexへ同じPhase中には進入しない。終了するのはその個体の移動だけであり、残Attack Chargeがあれば現在位置から合法な対象への攻撃を行える。Chargeや攻撃機会を新規付与しない。

後続の別Zombieは、破壊済みHexへ同じPhase中でも通常の占有・通行条件に従って進入できる。Hex全体に一律の通行禁止を付けない。

次のZombie Phase以降、WireがなくHexが合法なら通常どおり進入可能。

Wireを破壊できなかった場合は従来どおり手前で停止する。

Player Unitと同じHexにあるBarbed Wireがincoming attack damageを先に吸収する既存仕様は維持する。

Gas ExplosionをBarbed Wireが吸収しない既存仕様も維持する。

## 3.3 Route evaluation

Zombie AIがBarbed Wireを迂回すること自体は不具合としない。

ただし経路評価上のwire costは「攻撃回数」だけでなく、「破壊に成功したPhaseでもそのHexへ進入できず次Phaseまで待つ」実時間を反映する。

同じ盤面・対象個体・残Chargeでは、経路評価が「その個体がWireを破壊したPhaseには当該Hexへ進入しない」遷移を使用する。Wireが既に破壊されていれば、そのHexへ一律の追加遅延を付けない。後続個体の行動で将来破壊されることは確定事項として予言しない。Route Previewが公開する遅延・到達見込みと実移動は同じ前提で検証する。

## 3.4 追加バグ調査

今回の変更とは別に、以下をRegressionで確認する。

- Occupied WireがHumanへの攻撃を正しく吸収する
- Empty Wireへの攻撃がAttack Chargeを正しく消費する
- Wire破壊Event / statisticsが重複しない
- 破壊した個体の同Phase侵入だけが禁止され、後続個体・次Phase以降は通常の通行が可能
- 破壊個体の残Chargeによる現在位置からの合法な攻撃が可能
- Reanimationのsame-Hex例外を壊さない
- Hidden Wire damageが公開統計・Eventへ漏れない

別の再現可能な吸収バグが見つかった場合は同じv1.6.6修正対象とする。

---

# 4. Unit IDをゲーム内で永久一意にする

## 4.1 問題

Unit IDはAgent API、Event、Replay、Decision log、Kill credit、Cargo link、Spawn chain等の外部参照キーとして使われる。

死亡したUnitのIDを別個体へ再利用すると、同一Artifact内でIDの意味が時間によって変わり、AIの追跡・Replay解析・デバッグを壊す。

v1.6.5 seed3では zombie-8 がTurn 1で死亡した後、別個体へ再利用された。

## 4.2 v1.6.6仕様

**1ゲーム中、一度発行したUnit IDは死亡後も再利用しない。**

Unit Typeが異なっていても、外部公開される完全なid文字列は同一ゲーム中に一意でなければならない。

既存のprefix表現は維持してよい。

例:

- zombie-51
- gas-zombie-52
- national-guard-53
- soldier-zombie-54

## 4.3 Counter initialization

新規Game State生成時の nextUnitNumber を固定値から開始しない。

初期配置した全Unitの既存IDと今後のdynamic ID namespaceを考慮し、最初のdynamic発行番号が初期Unit群と衝突しない値から開始する。

最低条件として、標準v1.6.6初期配置では初期Normal Zombie 40体を含む全初期Unit作成後のdynamic IDが既存初期IDと再利用関係にならないこと。

## 4.4 共通Allocator

以下の動的Unit生成経路は同じ単調増加Allocatorまたは同じ一意性保証を使用する。

- Site fall / noise respawn
- Horde Wave spawn
- Reanimation
- Nuclear / Air Base objective reward / failure spawn
- Produced Human Unit
- Army Base reward
- その他runtime Unit生成

「現在state.unitsに同じIDが存在するか」だけを一意性の根拠にしない。

Save / Load後もcounterを保存し、過去に発行済みのIDを巻き戻さない。

## 4.5 Acceptance

1. 初期 zombie-8 を死亡させた後、以後のspawnで zombie-8 を再発行しない。
2. 1000回以上のmixed spawn / death / reanimationで重複IDがない。
3. Save / Load後も新規IDが過去IDと衝突しない。
4. Replay / Artifact内の unitId は1個体だけを指す。
5. Seed再現性を維持する。ID修正によってGameplay RNG消費順を変更しない。

---

# 5. Military Goods経済再調整

## 5.1 全Player Unitの固定Military Goods upkeepを廃止

v1.6.6ではPlayer Unitを保有しているだけで発生する毎ターン固定Military Goods消費を廃止する。

Military Goodsを消費するのは、明示的にMilitary Goods Costを持つ行動・処理だけとする。

代表例:

- Attack
- Counterattack
- Interception
- Suppression
- Field Artillery fire
- Army / Air Base interception
- Unit production cost
- その他既存ルールで明示された消費

単なる時間経過によるHuman Unitの currentMilitaryGoods 減算を行わない。Supply外・航空中・搭乗中も含め全Player Unitが対象。EndTurn中に実際に発生する迎撃・反撃・自動鎮圧等の明示消費は別であり、これらによる減少は継続する。Food / Civilian Goods維持費、航空Fuel等も変更しない。

## 5.2 API互換

Public fieldは意味を保つ。fixedMilitaryGoodsUpkeepPerTurn、fixedConsumption等の固定消費量は0とする。afterFixed / projectedMilitaryGoodsAfterFixedConsumption等の消費後残量は消費前残量と同値であり、残量を0にしてはならない。既存Queryが提供するこれらの値は診断用に維持する。

Config overrideで再び固定upkeepを有効にできる状態にはしない。

Game Ruleとして完全廃止する。

resource_consumed Eventの reason = unit_fixed_upkeep はv1.6.6新規Gameでは発生しない。

補給処理は維持する。Supply内のHuman Unitは currentMilitaryGoods と maxMilitaryGoods の差をNational stockから従来の優先規則で補充する。

## 5.3 Military Factory

Worker 1人・1Turnあたり:

**Civilian Goods 10 -> Military Goods 4**

へ変更する。

v1.6.5:
Civilian Goods 2 -> Military Goods 1

v1.6.6:
Civilian Goods 10 -> Military Goods 4

効率は 0.5 MG / CG から 0.4 MG / CG へ低下するが、Worker当たりThroughputは4倍になる。

30 workers最大稼働:

- input Civilian Goods 300
- output Military Goods 120

Power Capacity 40、Worker Capacity 30等、指定されていないMilitary Factoryパラメータは変更しない。

## 5.4 input不足

inputはWorker単位で整数配分する。

例:

- CG 9 -> 0 workers -> MG 0
- CG 10 -> 1 worker -> MG 4
- CG 29 -> 2 workers -> MG 8
- CG 30 -> 3 workers -> MG 12
- CG 300 -> 30 workers -> MG 120

既存のCivilian maintenance reservationとMilitary Factory input priorityの考え方は維持する。

同一Turnに新たに生産したCivilian Goodsを、そのままMilitary Factory inputとして直接連鎖投入しない。

同Turnの実行可能Civilian Goods productionによってmaintenanceを賄える分だけ、生産前stockの一部をinputへ解放する既存挙動を維持する。予約式とSnapshotの定義は第6.8〜6.9節へ統一する。

---

# 6. Relief Supply Center / 救援物資センター

## 6.1 Facility Type

新しいConstructible Facility:

**reliefSupplyCenter**

表示名:

- JA: 救援物資センター
- EN: Relief Supply Center

## 6.2 基本値

| 項目 | 値 |
|---|---:|
| Build Cost | Civilian Goods 50 |
| Worker Capacity | 5 |
| Required Electricity | 5 |
| Food input / Worker / Turn | 20 |
| Civilian Goods output / Worker / Turn | 5 |
| 最大Food input | 100 |
| 最大Civilian Goods output | 25 |
| Vision | Ground Vision 1（建設完了後） |
| Zombie Target Value | 施設固有値0、健常workersによる人口Target判定は有効 |
| Decommission | 条件付き可、1 Action、Civilian Goods 25返還 |

Power Requirement 5はv1.6.5の「既存正電力を2倍」の履歴から再計算せず、v1.6.6新規施設の明示値として5を使用する。

## 6.3 Build rule

BuildConstructibleFacility共通ルールを使用する。

- 現在Supply内
- 現在visible
- Plain
- Roadでない
- Horde Entranceでない
- Horde Spawn Reserveでない
- Facilityと重複しない
- Checkpointと重複しない
- Barbed Wireと重複しない
- Player Ground Unitと重複しない
- visible Zombieと重複しない
- Civilian Goods 50
- 1 Action

Build Turnは building、次Player Turnから通常Constructible lifecycleで稼働可能。

## 6.4 建設上限

建設数は **unlimited** とする。

Simple Farm / Temporary Housingと同じく、土地・Civilian Goods・Food・Population・Electricityを実質制約とする。

専用の道路分岐数上限は設けない。

## 6.5 Decommission

DecommissionConstructibleFacility対象へ追加する。条件はPlayer-owned、workers = 0、infected = 0、建設完了済み、Zombie非占有。Supply接続や給電は要求しない。1 Player Actionを消費し、建設コストの半分を返還する（標準Civilian Goods 50に対し25）。Configで奇数の建設費を許す場合は半額を切り捨て、整数資源を維持する。

健常者・感染者を自動退避または消去しない。条件不成立時は資源・人口・施設・Action数・RNGを変更しない。撤去完了で施設の視界・予約・表示を除去し、同じ施設の返還は一度だけとする。通常の人口移動等で先に空にする必要がある。

Civilian Drone Base / Temporary Housingの既存返還値・条件は変更しない。Simple Farm / Windを新たな撤去対象にしない。

## 6.6 Production

Player所有・建設完了・Supply内・非感染で正常稼働し、healthy workersがいて、Power SupplyがONで、Food inputとElectricity 5を確保できる場合に生産する。建設完了時のworkersは0で、既存の人口移動Actionで配置する。センターは通常の生産施設として人口を扱い、Refugee自動受入施設やRecruitment Hubには追加しない。健常workersには通常のFood / Civilian Goods維持費を課す。

Workerごとに Food 20 -> Civilian Goods 5。

Food input不足では、20 Foodを確保できるWorkerだけが稼働する。

以下のFoodは全国総備蓄ではなく、人口維持費を保護し、先行施設の割当を差し引いた後にその施設へ投入可能なFoodを指す。workersが十分いる例:

- Food 19 -> 0 operating workers -> CG 0
- Food 20 -> 1 -> CG 5
- Food 59 -> 2 -> CG 10
- Food 99 -> 4 -> CG 20
- Food 100以上、workers 5 -> CG 25

1人以上のoperating workerがいる場合、Facility全体でElectricity 5を要求する。

働けるworkersはいるがFood不足で0 operating workersならinput shortageとしてPower allocation対象から外す。workers自体が0、Supply外、Power OFF、感染・停止・建設中等は、それぞれ対応する停止理由を返し、すべてをFood不足にまとめない。

PowerはWorker数に比例して増加しない。

## 6.7 Power toggle

Relief Supply CenterはMilitary Factory / Civilian Factory / Farm / Refinery等と同様にSetPowerSupply対象とする。

OFFならinputを予約せず、生産せず、Powerを要求しない。

## 6.8 同Turn input chain禁止

既存の「同Turn生産物を別の生産工程のinputへ直接連鎖投入しない」原則を維持する。

Relief Supply CenterのFood inputはTurn開始時Food stockを基礎に予約する。

同TurnにFarm / Simple Farmが生産したFoodを、そのままRelief Supply Centerへ直接投入しない。「Turn開始時stock」は当該EndTurnの経済処理開始Snapshotの生産前備蓄を指し、Player PhaseのActionで既に消費した資源を復活させない。

人口維持を変換入力より優先する。同Turnの実際に給電・稼働可能なFood productionで維持費を賄える分だけ、生産前備蓄をinputへ解放する。Military FactoryのCivilian Goods reservationと同じ原則に揃える。

FoodをF、Food維持需要をM、同Turnの実行可能Food生産をPとすると、入力上限は `max(0, F - max(0, M - P))`。人口維持需要には既存のUnit・Checkpoint人口・過密・住宅停電等の対象費用を含む。維持費不足の場合はFood変換0とする。

例: F=100、M=80、P=0なら入力上限20、1 workerでCG5。F=0、M=0、P=100なら入力上限0。F=100、M=80、P=80なら入力上限100、5 workersでCG25。Food100→CG25という最大例は、維持費控除後も100を投入可能な場合に限る。

Relief Supply Centerの同Turn CG生産はCivilian Goodsの人口維持費には利用でき、その分の既存CG備蓄をMilitary Factory入力へ解放できる。入力は常に生産前備蓄が上限であり、CG備蓄0から同Turn新規生産CGをMilitary Factoryへ入れることはできない。

Relief Supply Centerが同Turnに生産したCivilian GoodsをMilitary Factoryへ直接投入しない。

したがって次の1Turn即時chainは禁止する。

Simple Farm / Farm -> Relief Supply Center -> Military Factory

## 6.9 Economy allocator

v1.6.5のeconomy-queryはproduction input facilityを実質Military Factory専用として扱う箇所がある。

v1.6.6ではRelief Supply Center追加に合わせて、production input reservationを少なくとも以下へ共通化する。

- Food -> Relief Supply Center
- Civilian Goods -> Military Factory

一方のFacility Type名を特別扱いする分岐を増やすだけの設計は避ける。

Forecast、actual EndTurn、Public Projectionが同じ純粋なinput / power計画結果を使用する。読取計画はState / RNGを変更しない。

複数センターへのFood inputは建設順に集中配分する。各施設で稼働可能な人数 `min(healthy workers, floor(残入力Food / 20))`（最大5人）まで割り当て、残りを次施設へ回す。同Turn内の建設順も保存可能な安定順にし、Save / Load、Replayで変わらない。再稼働や人口移動で建設順をリセットしない。

Power OFF・供給外・感染・非稼働施設はinputを予約しない。Foodの暫定割当があっても電力5を確保できない施設はinput予約を解除し、給電可能な後続センターへ建設順に再配分する。実際に稼働するworker分だけFoodを消費し、未使用分は備蓄へ残す。未給電の施設に入力資源を拘束させない。

配分は上位配電段階の実給電・生産見込みを確定してからセンター、続いてMilitary Factoryへ進む。入力数を決めるための仮生産を実生産と混同しない。Military Factoryの人口維持予約には給電可能なセンターの確定CG出力だけを加える。停止施設の仮出力で維持費を過少予約しない。

## 6.10 Power allocation priority

Relief Supply CenterはCivilian maintenanceを支える補助生産施設として扱う。

配電順は次で固定する。

Capital / City → occupied Temporary Housing → Farm / Civilian Factory → Relief Supply Center → Military Factory → Refinery → Civilian Drone Base → Army Base予約 / Air Base → empty Temporary Housing。

センター内は第6.9節の建設順、それ以外の同段階内順序は現行仕様を維持する。Food input 0のセンターへPowerを予約しない。電力5未満の部分給電での稼働は不可。1人でも5人でも施設ごとに電力5。Preview / Forecast / actual EndTurnで同じ順序を使う。

## 6.11 視界・人口Target・Lifecycle

建設完了後はGround Vision 1を持ち、地形遮蔽を通常どおり受ける。Power OFF、停電、Supply外でも視界1を維持する。建設中・消滅後は独自視界を与えない。

施設固有のZombie Target Valueは0だが、健常workersがいる場合は既存のVisible Population Target判定に含める。人のいる施設を誘引対象から除外する例外を作らない。ゾンビが到達した場合の襲撃・感染・消滅は通常の生産系Constructible（Simple Farm等）と同じLifecycleを使い、Wind専用の無人口・停止復旧例外は適用しない。消滅時は任意撤去の返金を行わない。

## 6.12 組み込みAI

Balanced等の運用AIが、余剰Food、Civilian Goods不足、配置可能人口、建設費、電力順位・余力を公開Forecastから評価し、建設・人員配置・Power ON/OFFを判断する。人口維持を侵食するFood変換や、停止理由を無視した無効Actionの連発を避ける。

Random Agentも既存の共通合法Action経路で新施設の建設・撤去・電源操作を扱う。通常UIと外部AIにも同一のAction / Validationを提供する。決定的なシナリオで実際の利用判断を検証し、単に合法手一覧へ追加するだけで完了としない。新施設を利用して必ず勝利することや、確定数値の無断調整は受入条件としない。

---

# 7. WebMCP / ChatGPT Desktop Work・Codex互換性

## 7.1 実機で確認した症状

ChatGPT Desktop内蔵ブラウザでGitHub Pages版を開き、通常GameをTurn 1まで開始し、AI Play / WatchのStartを押した。

Game Session自体は開始し、AI Play / Watch panelは待機状態になった。

しかしWork / Codex側のtool discoveryは webmcp_list_tools unsupported で停止し、nlth_* Site toolsを列挙・実行できなかった。

この状態ではGame TurnもDecision Logも進まず、WebMCP経由AIプレイは成立しなかった。

また実機では「8つの nlth_* tools」と表示された一方、2026-09-24 current main の WEBMCP_TOOL_NAMES は nlth_preview_actions を含む9 toolsである。

したがってhost capability問題だけでなく、GitHub Pages deployment / cache / build差、または固定表示文言の不一致も診断対象とする。

## 7.2 OpenAI側の現在の前提

2026-09-24に取得したOpenAI公式Site tools資料に基づく。Site toolsはChatGPT Desktop appのbuilt-in browser上でWebMCPを利用する。確認時点の実機モデル案内はGPT-5.6 Sol / GPT-6 Solで、GPT-5.6 Lunaは無効、Enterprise / Eduは対象外とされる。ロールアウト・設定にも依存するため、実装時の実機条件を資料と照合し、記録する。ゲーム側でモデル名を固定した拒否判定は追加しない。

Built-in browserはWorkまたはCodexから開く。

Site toolsはaccountとselected modelが対応し、pageがtoolを提供している場合に自動discoverされる。

通常Chrome上のWebMCP対応状況と、ChatGPT内蔵ブラウザのSite tools対応は別に扱う。登録先はトップレベルページとし、iframe内登録や宣言的HTMLフォームをChatGPT接続の代替にしない。

したがってv1.6.6の実機対象は **ChatGPT Desktop built-in browser** とし、通常ChromeやCloud BrowserをWebMCP Acceptance環境にしない。

## 7.3 現行NLTH adapterとの差

current main の src/browser/webmcp.ts は registerTool() を同期的なregistration handleまたはvoidとして扱い、handle.unregister() / modelContext.unregisterTool() をcleanup経路として想定している。

2026-09-24に取得した2026-09-17 WebMCP Community Group DraftのModelContext契約は以下。これはW3C標準確定版ではない。

- registerTool() -> Promise<undefined>
- getTools() -> Promise<RegisteredTool[]>
- executeTool(RegisteredTool, inputObject?, options?) -> Promise<string>（JSON文字列化された結果）
- registerTool(tool, { signal }) のAbortSignalでunregister

したがってNLTH adapterを現行Draft contractへ更新する。

この差が今回の webmcp_list_tools unsupported の直接原因であると断定しない。host側の内部tool retrievalはin-page getTools()と別経路であるため、NLTH registration成功とChatGPT discovery成功を別判定にする。

## 7.4 Async registration

registerWebMcpToolsは非同期registration完了を追跡する。

9 toolすべての registerTool Promiseを待ち、1件でもrejectした場合はregistration_failedとする。

一部だけ登録された状態をreadyとして表示しない。失敗時は同じ登録世代で成功した登録もAbortSignalで解除する。途中成功数・失敗原因は診断に保持する。再登録・cleanup後に古いPromiseが完了しても新世代の状態を上書きしない。再登録で重複Toolを残さない。

ページ起動時のtry/catchだけでPromise rejectionを見逃さない。

AbortControllerをregistration lifecycleへ保持し、page / viewer cleanup時にabortしてtoolを解除できるようにする。旧同期handle.unregister()に成功を依存させず、非同期APIの同期throwもPromise rejectionも捕捉する。Sessionの終了とページの登録解除は区別し、登録を維持する画面ではget_contextがinactiveを返す。

## 7.5 Tool set

v1.6.6のexpected WebMCP tool setは最低限以下の9件。

1. nlth_get_context
2. nlth_observe
3. nlth_query
4. nlth_legal_actions
5. nlth_preview_action
6. nlth_preview_actions
7. nlth_act
8. nlth_get_request_result
9. nlth_get_result

UI文言へ「8」または「9」を直書きしない。

WEBMCP_TOOL_NAMES.lengthと実登録結果から表示する。

## 7.6 Self Test

document.modelContext.getTools が利用可能な場合、registration完了後にin-page Self Testを行う。

Self Testは以下を返す。

- expectedToolCount
- expectedToolNames
- registeredToolCount
- registeredToolNames
- missingToolNames
- unexpectedToolNames
- registrationErrors

getToolsの結果は自ページ由来のnlth_*を期待集合と照合する。他アプリのToolを欠落数・余剰数へ混ぜない。getToolsが未提供ならSelf Testはunavailableと表示し、登録失敗や成功へ置き換えない。

Session Start後は、getToolsで得たRegisteredToolの nlth_get_context または nlth_observe をexecuteToolで実行するread-only smoke testを用意する。executeTool未提供ならunavailable、rejectまたは返された業務エラーはfailed、正常なSession応答だけをpassedとする。PromiseがfulfilledしただけでSession成功としない。State / RNG / Session revision / decision sequenceを進めない。

このSelf TestはChatGPT browser agent自身のinternal discovery成功を証明するものではない。WebMCP Draft上、browser agentはgetTools()とは別のinternal mechanismでtoolを取得する。

## 7.7 AI Play / Watch diagnostic state

Panelに少なくとも以下を区別して表示する。

- unsupported: document.modelContext またはregisterToolがない
- registering
- registration_failed
- registered
- self_test_passed
- session_inactive
- ready
- host_discovery_unverified

これらを単一の排他的状態へ押し込めず、registration、Self Test、Session lifecycle、host discoveryの独立状態として表示する。Sessionはinactive / active / paused / endedを区別する。readyはゲーム側の全登録完了とactive Sessionを意味し、Self Testが実行可能なら成功を要求する。Self Test未提供はその旨を併記し、host discovery成功を意味させない。Webページから観測できないhost capabilityはunverifiedのままとする。

「Session started. Discover N tools」の固定成功風メッセージだけで待機しない。

registration失敗時は通常Gameを止めず、非機密なerror name / categoryを表示する。

## 7.8 Build診断

AI Play / Watch panelから最低限以下を取得できるようにする。

- App Version
- Build ID / git commit
- WebMCP adapter version
- expected tool count
- registered tool count
- registered tool names
- registerTool availability
- getTools availability
- executeTool availability
- Session generation
- Session revision
- Session active / paused / ended

これによりPagesの古いdeployment、Service Worker / browser cache、mainとの差を実機報告だけで確認できるようにする。

## 7.9 ChatGPT Desktop Acceptance

更新済みのChatGPT Desktop app、Site tools対応account / selected model / workspaceとEnable site tools設定で実施する。対応環境が確保できた場合の実機受入手順は以下。Self Test用APIが未提供ならその項目をunavailableと記録し、実際のhost Tool実行と混同しない。

1. WorkまたはCodexを開く。
2. ChatGPT built-in browserでGitHub Pages版を開く。
3. Address barのSite tools indicatorを確認する。
4. NLTH側で期待集合9件の登録結果を確認し、getTools対応時はSelf Testも9/9一致する。
5. Address bar側でもNLTH Site toolsを認識できる。
6. AI Play / WatchをStartする。
7. nlth_get_contextがactive Sessionを返す。
8. nlth_observeがTurn 1 Observationを返す。
9. nlth_preview_actionがState / RNG / Revisionを変更しない。
10. nlth_actを1回実行する。
11. Game表示、Revision、Decision Logが同じDecisionを反映する。
12. EndTurnを実行してTurn進行を確認する。

## 7.10 Host-side unsupportedの扱い

NLTH側で

- registerTool 9/9 fulfilled
- getTools Self Test 9/9
- read-only in-page execute smoke success

まで確認できているにもかかわらず、ChatGPT側が webmcp_list_tools unsupported 等でtool discoveryできない場合は、**NLTHページ内検証成功・host側discovery利用不可／未確認**として記録する。account・model・workspaceのどれが原因かを証拠なしに断定しない。Self Test用APIがなければ三条件の成功済みとは扱わない。

その場合、NLTH Core / Session contractを壊して代替しない。

GitHub Pagesしか提供しないというプロジェクト前提を維持し、v1.6.6のためだけに常設Backend MCP serverを要求しない。

通常Browser UI操作による疑似AIプレイをWebMCP成功扱いにしない。

NLTH側の必須検証が成功し、実機接続がhost機能未対応によって確認できない場合はv1.6.6をリリース可能とする。実機接続は未確認として理由・証拠を残す。ゲーム側のregistration不具合やSelf Test失敗はこの例外に含めない。対応環境を使える場合は第7.9節を実行する。

実機reportには次を残す。

- OS
- ChatGPT Desktop version
- Work / Codex
- selected model
- Site tools setting / indicator
- NLTH App Version
- Build ID
- expected / registered tool count
- Self Test結果
- ChatGPT側error text

---

# 8. Public API / UI / Helpの同期

## 8.1 Facility

FacilityType / ConstructibleFacilityTypeへ reliefSupplyCenter を追加する。

Normal UI、Public Board、Replay、Live Viewerで同じFacility identityと表示名を使う。

第8.5節の専用アートを使用する。読込失敗・低Zoom時には既存方針の個別Fallbackを維持し、type不明で表示不能にしない。

## 8.2 Agent API

apiInfo / public configで以下を明示する。

- Military Goods fixed upkeep: none / 0
- Military Factory input 10 / output 4 per worker
- Relief Supply Center build cost 50
- Worker Capacity 5
- Food input 20
- Civilian Goods output 5
- Power 5
- unlimited build count
- power toggle
- input shortage / power shortage reason
- 建設順によるinput / power配分
- 人口維持費優先・同Turn入力chain禁止
- 条件付き撤去・返還25・Ground Vision 1・workersによる人口Target

Constructible candidate queryはreliefSupplyCenterを扱う。

Facility production queryはFood input required / allocated / shortage、healthyWorkers / operatingWorkers、Civilian Goods output、power requested / supplied / reasonを返す。暫定予約と未給電による解除後の最終割当を混同しない。建設・撤去の合法性、費用・返還・理由、建設順を通常UI / Preview / Query / 実Actionで一致させる。

既存の生産量・消費量・建設数等の統計に新施設を反映し、Power停止時の仮生産を実績へ加算しない。Hiddenな被害・感染・Zombieを公開Event / metricsへ漏らさない。

## 8.3 Forecast

EndTurn Forecastとactual EndTurnを一致させる。

少なくとも以下を確認可能にする。

- Relief Supply Center Food input demand
- Food input allocation
- Food input shortage
- operatingWorkers
- Civilian Goods output
- Power requested / supplied / reason
- Military Factory CG input 10 / worker
- Military Goods output 4 / worker
- fixedConsumption = 0
- projectedMilitaryGoodsAfterFixedConsumption = beforeと同値

## 8.4 Documentation

以下を同時更新する。

- PLAY_WITH_AI.md
- README Help相当
- Rules explanation
- Agent apiInfo
- JA / EN i18n
- 現行仕様（実装・検証完了後に反映）
- WebMCP実機確認手順

旧説明の以下を残さない。

- Recon / Soldier / Helicopter等が1 MG / turn fixed upkeepを払う
- Military Factory 2 -> 1
- Constructible typesが4種類だけ
- WebMCP tool count固定値の古い表示

## 8.5 専用アセット制作

本書確定後、同じタスクで `facility_relief_supply_center` の候補1枚を生成・提示する。小型倉庫、物資箱、配給テントを組み合わせた救援物資の集積・配給拠点とする。既存施設の俯瞰視点・太めの輪郭・落ち着いた配色・小縮尺での可読性に揃える。破壊・感染表現は既存Overlayに任せ、原本は正常な施設とする。文字・実在ロゴ・旗を追加しない。

原本は透過PNGとし、`Art/reference/v1.6.6-concepts/`へ保存する。生成方式、実際のプロンプト、参照画像、原本パス、生成日、SHA-256、採用状態をREADME / prompts.jsonへ記録する。生成済み・候補提示済み・採用済み・組込済みを区別する。

採用原本を既存256×256 RGBA規約へ加工し、`public/assets/board/facilities/facility_relief_supply_center.png`へ配置するのは実装工程とする。Normal Game / Replay / Live Viewerは同じAsset Registry / Resolverで描画する。PC / モバイル、小縮尺、FoW、低Zoom Fallbackを確認する。画像候補が未採用でも要件確定を取り消さないが、採用素材の組込みは実装完了条件である。

制作記録（2026-09-24）: 本書確定後に `Art/reference/v1.6.6-concepts/facility_relief_supply_center_candidate_v1.png` を生成・提示した。1254×1254透過PNG原本、プロンプトと検査記録は同ディレクトリへ保存。画像の採用判断・Runtime加工・組込みは未実施。

---

# 9. Versioning / Compatibility

v1.6.6はFacility Type追加、Economy input contract変更、WebMCP adapter contract変更を含む。

第15章のObservation軽量化、Session公開文書・hash、Artifact Manifest / ZIP Reader、CLI出力契約の変更もVersion判断に含める。Observation API Versionは更新必須とする。

App Versionは1.6.6へ更新する。

Game Rules / State / Config、Save、Agent / Observation / Bridge、Artifact、Checkpoint / Session等のうち、schemaまたはsemantic compatibilityが壊れるものはVersion bumpする。

Version番号そのものは実装時に現在のversion registryから一括決定し、文書・runtime・fixtureで一致させる。

特にv1.6.5 GameStateはconfig snapshotに reliefSupplyCenter を持たないため、旧Saveをそのまま「互換」とみなしてcurrent config key存在を前提に読み込まない。

v1.6.5以前のSave / Replay / Session / Checkpoint / Artifactは互換変換しない。理由を表示して読み込みを安全に拒否し、新規v1.6.6ゲームを案内する。旧データは削除・上書きしない。自動保存領域も旧版を保全する。

新Facility Type / Config / input plan contract / Unit ID counterと建設順の保存・完全Validationを行う。初期IDとcounterが矛盾するデータを黙って受け入れない。外枠Versionを据え置く場合も、内包するルール・State Versionで旧データを拒否できることを示す。

黙って部分的に読み込み、v1.6.5のfixed upkeepやMilitary Factory rateがv1.6.6内へ混入する状態を禁止する。

---

# 10. 必須Regression / Acceptance Test

## Checkpoint

1. Initial Supply内Zombieがcandidate supply blockerにならない。
2. Initial Supply外Zombieは従来どおりblockする。
3. destination occupied ZombieはInitial Supply内でもblockする。
4. Initial Supply内の感染ruined / abandoned checkpointはforward relocationを永久blockしない。
5. source checkpoint infectedはrelocation不可。
6. candidate / preview / actual reasonCodeが一致する。

## Barbed Wire

7. HP20 Wireを通常Hordeが4回攻撃するとWireは破壊される。
8. そのHordeは同じZombie PhaseにWire Hexへ進入しない。
9. 次Zombie Phaseには合法なら進入可能。
10. Occupied WireはHumanへのDamageを先に吸収する。
11. Empty Wire Attack Charge統計が重複しない。
12. Hidden Wire damageがpublic情報を漏らさない。
13. Route evaluationが新しい1Phase delayを考慮する。

## Unit ID

14. 初期Zombie死亡後も同一IDを再発行しない。
15. mixed runtime spawnでID重複なし。
16. Save / Load後もID重複なし。
17. Replay / Artifactで1 id = 1 Unit lifetime。
18. RNG再現性を壊さない。

## Military Goods

19. 全Human Unit（Supply外・航空中・搭乗中含む）に固定軍需減算がない。EndTurn中の実際の迎撃等は別途消費する。
20. unit_fixed_upkeep Eventが発生しない。
21. Attack / Suppression等の既存明示消費は残る。
22. Supply内refillは従来どおり機能する。
23. Military Factory 1 worker: CG10 -> MG4。
24. 30 workers: CG300 -> MG120。
25. input不足は10 CG単位でoperating workerを制限する。

## Relief Supply Center

26. CG50と1 Actionで合法Hexへ建設できる。
27. Worker Capacity 5。
28. Power 5。
29. Food20 -> CG5 / worker。
30. 維持費を保護した入力可能Food100 / workers5 / PowerありでCG25。
31. 入力可能Food19では0 production。
32. 入力可能Food59では2 workers / CG10。
33. operating worker 0ならPowerを要求せず、workers0とinput shortageの理由を区別する。
34. SetPowerSupply OFFならinput予約・production・Power demandなし。
35. 同Turn Farm Foodを直接inputへ使わない。
36. 同Turn Relief CGを直接Military Factory inputへ使わない。
37. Forecastとactual EndTurnが一致する。
38. build countはunlimited。
39. Zombie occupation / infection / destructionがConstructible共通Lifecycleに従う。

## WebMCP

40. registerToolのPromise rejectionを捕捉する。
41. expected tool setは9件。
42. UI tool countは定数直書きではなく実値を使う。
43. AbortSignalでregistration cleanup可能。
44. getTools対応環境で9 / 9 Self Test。
45. Session inactiveとregistration failureを区別する。
46. Build ID / App Version / tool namesをpanelから確認できる。
47. Normal GameはWebMCP unsupportedでも起動可能。
48. 対応環境を利用可能ならChatGPT Desktop built-in browserでnlth_get_context / observe / preview / act / EndTurnを実機確認する。host機能未対応なら第7.10節に従い未確認と記録する。
49. NLTH Self Test成功・host discovery利用不可を区別し、未検証のhost原因を断定しない。

## Cross-surface

50. Normal UI / Replay / Live Viewer / Agent APIでRelief Supply Center identityが一致する。
51. Help / PLAY_WITH_AI / apiInfoのMilitary Factory値が10 -> 4で一致する。
52. fixed upkeepの説明が0 / noneで一致する。
53. v1.6.5 compatibility policyがVersion validationと一致する。


## 回答で具体化した追加受入条件

54. Wire破壊個体の移動停止、後続の同Phase通行、破壊個体の残Charge攻撃を個別に検証する。Hex全体の進入禁止やCharge増殖を起こさない。
55. Initial Supply外かつ移設前後のSupply重複範囲の可視Zombieでもblockする。不可視Zombieを候補差分・reasonから漏らさない。
56. Food維持費優先をF/M/Pの3境界例と不足例で検証し、生産前備蓄を超える入力を禁止する。センターworkers自身の通常維持費も計上する。
57. 2基以上のセンターへ建設順に集中配分する。workers不足、Food20未満の端数、Power OFF、停電、Supply外、Save / Load後でも順序・収支が一致する。
58. 未給電センターはFoodを消費せず予約解除する。給電可能な後続へ再配分する純粋計画経路と余剰備蓄を検証する。現在の全センター一律電力5の条件では、単純な総電力枯渇後に後続だけ動けるとは仮定しない。
59. 配電順位がFarm / Civilian Factory → センター → Military Factoryである。人数1 / 5とも要求5、部分給電不可、入力0で要求0、上位生活基盤優先を確認する。
60. 給電できるセンターのCG出力は維持費予約を軽減できるが、CG生産前備蓄0ではMilitary Factory入力0。停止センターの仮出力は利用しない。
61. 撤去で1 ActionとCG25返還。人口・感染・building・Zombie占有で拒否。Supply外・Power OFFでも空なら可。拒否時不変・返還一度・視界除去を確認する。
62. 建設完了後のGround Vision1、OFF / 停電 / Supply外維持、建設中効果なし、消滅時除去を確認する。健常workersありの場合のZombie人口Targetと、workers0の場合を分けて検証する。
63. 固定消費量0、afterFixed等の残量はbeforeと同値。Config overrideで固定消費を復活させない。攻撃・補給・基地専用stock・Fuel消費を維持する。
64. Balancedの実判断でセンター建設・人口配置・稼働および必要時の電源切替が成立し、公開情報だけで判断する。Randomの共通合法手・無効Actionループも確認する。
65. 登録の一部reject・同期throw・cleanupとの競合・再登録で、誤ready、古い状態の復活、重複Toolがない。getTools / executeTool未提供を成功と記録しない。
66. read-only smokeとpreviewはState / RNG / revision / decision sequence不変。ページ内検証がhost接続成功に化けない。
67. センターの建設・移動人口・電源切替・生産・撤去・返還、Wire遅延、ID発行をSave復帰 / Session / Replayで再現し、同Seed・Config・Action列でDigestが一致する。
68. PC / モバイル、日英で建設・撤去・返還値・停止理由・Food維持優先・Forecastを確認する。専用画像を3表示経路で共有し、FoWとFallbackを維持する。

## 検証の実施方針と完了判定

第15.8節の案A・案Cの受入条件も必須とする。第10章の回帰に統合し、同じ差分の全体回帰を別々に重複実行しない。

開発中は変更箇所の最小限のテストで進める。修正前からの不具合は再現入力で失敗→修正後成功を確認する。Wireの旧挙動など仕様変更は旧仕様の期待と新区別を明示し、正常だった処理を不具合再現済みと呼ばない。

仕上げには型検査、本番Build、Core・経済・Schema・UI・保存を横断する必要な全体回帰を1回、ローカルBrowser Bridge / WebMCP Live / Replay、組み込みAIの固定Seedプレイテスト、PC / モバイル確認を行う。成功済みの同一差分の全体回帰を根拠なく反復しない。自然プレイで出にくい条件はCoreシナリオで補う。

実行範囲・成功・失敗・skip・未実行と理由を記録する。第7.10節のhost未対応を除き、未完了の必須項目を成功扱いして実装完了としない。確定要件は「実施予定の受入条件」であり、この文書作成時点のテスト実績ではない。

---

# 11. 推奨実装順序

**Unit ID allocator修正**  
-> **Checkpoint Initial Supply blocker修正**  
-> **Barbed Wire movement stop修正**  
-> **fixed Military Goods upkeep廃止**  
-> **Military Factory 10 -> 4**  
-> **production input allocator共通化**  
-> **Relief Supply Center**  
-> **組み込みAI / Forecast / Public API / UI / 採用アセット**  
-> **WebMCP current Draft adapter対応**  
-> **WebMCP diagnostics / Self Test**  
-> **移動要約 / route・Preview共通化 / AI・UI・Metrics移行（案A）**  
-> **直接ZIP export / ZIP単体read・Core Replay / CLI移行（案C）**  
-> **Version bump / persistence**  
-> **Regression**  
-> **ChatGPT Desktop実機Acceptance**  
-> **再Playtestと結果記録**  
-> **現行仕様へ反映・確定要件archive移動**

先にUnit IDを修正することで、以後のRegression / Artifact解析でUnit追跡の曖昧さをなくす。

EconomyはRelief Supply Center追加前にinput allocatorを共通化し、Military Factory専用分岐をそのまま複製しない。

WebMCPはGame Coreと分離して進め、WebMCP host側問題が通常Game releaseを阻害しないようにする。

容量削減は公開Schemaと内部計算の分離を先に行い、保存・hash・読取・出力・呼出元を同一Versionで揃えてから測定する。案A／案Cの片側だけを変えて既存UI・Replayを壊した状態を完了としない。

---

# 12. 実装上の注意 / Non-goals

- Initial Supply例外は「Initial Supply内をZombie安全地帯にする」変更ではない。Checkpoint relocation blockerだけの例外。
- Zombieの通常移動、攻撃、Facility感染、Checkpoint攻撃、VisibilityにはInitial Supply例外を適用しない。
- Barbed Wireを絶対通行不能壁にはしない。正面突破可能だが最低1 Zombie Phaseの遅延を保証する。
- Barbed Wireの迂回AIは維持する。
- Military Goods自体は廃止しない。固定upkeepだけを廃止する。
- Military Goods shortage attack、攻撃cost、補給、軍事基地専用stock等の未指定ルールは維持する。
- Relief Supply CenterはCivilian Factoryの完全代替にしない。最大5 workers / CG25の補助施設。
- Relief Supply CenterからMilitary Factoryへの同Turn生産chainを許可しない。
- WebMCP障害の解決のためにGame CoreをDOM / ChatGPT clientへ依存させない。
- GitHub Pagesだけという配布前提を維持する。v1.6.6要件として常設Backendを追加しない。
- OpenAI Site toolsがaccount / selected model / workspace側で利用不可の場合、NLTHからそのcapabilityを生成できるとはみなさない。
- WebMCP Self Test成功はChatGPT internal discovery成功と同義ではない。
- 外部仕様であるWebMCPはDraftであるため、実装時は固定した参照日・API contractをテストへ残す。
- 容量削減は案A・案Cに限定する。legalActions本体削除、Session記録構造の再編、既存出力の削除、外部プレイヤーのtranscript運用変更は含めない。

---

# 13. 外部参照

WebMCP / ChatGPT Desktop部分の調査基準日は2026-09-24。

- [OpenAI公式 Site tools](https://learn.chatgpt.com/docs/webmcp) — 内蔵ブラウザ、対応環境、トップレベルJavaScript登録、非同期registerToolの確認に使用。
- [WebMCP Community Group Draft, 17 September 2026](https://webmachinelearning.github.io/webmcp/) — ModelContext、Promise、AbortSignal、RegisteredTool、ページ内APIとbrowser agentの内部discoveryの違いを確認。

WebMCPはDraftであり、将来APIが変わった場合は「v1.6.6実装時に固定したcontract」と「現在の最新Draft」を混同しない。

---

# 14. 要件確認の回答記録（2026-09-24、19問確定）

全19問の回答を本文と第10章の受入条件へ統合した。回答による変更は現行安定版の更新・実装完了を意味しない。

| 問 | 決定 |
| --- | --- |
| 1 | 空の有刺鉄線を破壊した個体だけが当該Zombie Phaseの移動を終了する。後続個体は通常の移動条件に従ってそのHexへ進入できる。 |
| 2 | v1.6.5以前のSave / Replay / Session / Artifact等は互換変換せず、理由付きで読み込みを拒否する。旧データを保持する。 |
| 3 | 救援物資センターのFood inputより人口維持費を優先する。当TurnのFood生産を含めて維持費を確保し、残る既存備蓄だけをinputへ使用する。同Turn生産Foodの直接投入は禁止。維持費不足時は変換しない。 |
| 4 | 複数センターへのFood配分は建設順。各施設の稼働可能人数（最大5人）まで集中配分し、残りを後続へ回す。 |
| 5 | 救援物資センターの建設数は上限なし。 |
| 6 | 救援物資センターを撤去対象へ追加する。返還資源は建設費の半分（標準値Civilian Goods 25）。 |
| 7 | 人がいるセンターは撤去不可。全員を移動させてから撤去する。 |
| 8 | 専用アセットは小型倉庫・物資箱・配給テントを組み合わせた救援物資の集積・配給拠点。既存施設と画風・視点を揃え、要件確定後に同じタスクで生成・確認し、採用した素材を使用する。第8.1 / 8.5節で専用アセットを必須化。 |
| 9 | 電力不足で稼働できないセンターのFood予約は解除し、食料を消費せず、給電可能な後続センターへ建設順に再配分する。余りは備蓄に残す。 |
| 10 | 配電順位はFarm / Civilian Factoryの後、Military Factoryの前。Capital / Cityおよび入居中Temporary Housingの既存優先順位を維持する。 |
| 11 | 組み込みAIの救援物資センター対応を含める。余剰Food、Civilian Goods不足、人員・電力を考慮し、建設・人員配置・電源切替を判断する。 |
| 12 | NLTH側検証が成功していれば、ChatGPT側の機能未対応で実機接続を確認できなくてもリリース可能。接続は未確認と記録し、WebMCP接続成功と扱わない。 |
| 13 | 救援物資センターの建設費Civilian Goods 50、定員5人、電力5、1人あたりFood 20からCivilian Goods 5への変換を確定する。 |
| 14 | 全Player Unitの固定Military Goods消費を廃止し、Military FactoryはWorker 1人あたりCivilian Goods 10からMilitary Goods 4へ変更。行動による明示消費および通常補給は維持する。 |
| 15 | Checkpoint移設のSupply内Zombie blockerは、移設後の候補Supply全体からInitial Supply Networkを除いた範囲の可視Zombieを対象とする。移設前からSupply内だった場所も判定に含む。destinationそのもののZombie占有はInitial Supply内でも拒否する。 |
| 16 | 救援物資センターは人口0・感染者0・建設完了済み・Zombie非占有を条件に、Supply外でも1 Actionで撤去可能。Civilian Goods 25を返還する。 |
| 17 | 救援物資センターは建設完了後にGround Vision 1を持ち、Power Supply OFF・停電・Supply外でも維持する。通常のGround LOSを適用する。 |
| 18 | 施設自体のZombie Target Valueは0とし、働く人がいる場合は既存の人口Target判定に含める。Zombie到達時の襲撃・感染は通常規則に従う。 |
| 19 | 空のBarbed Wireを破壊した個体は移動だけを終了する。残Attack Chargeがあり、現在位置から合法な対象を攻撃できる場合は攻撃可能。 |

## 14.1 文書管理

v1.6.5確定要件と、回答履歴を含むv1.6.6ドラフトは `Doc/archive/` へ移動済み。Doc直下には現行仕様と本確定版、および第15章の容量比較・実測に必要な検討メモを置く。検討メモは調査資料であり要件の正本ではない。比較不要になった時点でarchiveへ移す。

現行仕様は実装・検証完了までv1.6.5を維持する。完了後に本確定要件を現行仕様へ反映し、数値・例外・API・Help・保存・検証結果の整合を確認してから本確定版をarchiveへ移す。

---

# 15. AIプレイ出力の容量削減（2026-09-25追加確定）

## 15.1 採用範囲と根拠

[AIプレイ出力 容量削減の検討メモ](AIプレイ出力%20容量削減の検討メモ.md)の**案A（移動燃料予測の全件配列を既定応答・保存から分離）と案C（Artifactの既定出力をZIP単体へ変更）を採用する**。依頼者の「採用可能なら確定要件へ追加」に基づく追加であり、前章までの19問の決定を変更しない。

案B（保存用legalActionsの本体削除）、案D（Decision二重記録・lock履歴・小ファイルの整理）、案E（プレイヤー側ログ運用変更）は今回の追加実装範囲に含めない。既存出力を削除して容量を減らす作業も行わない。

現行実装の確認結果と必要な変更は次のとおり。

| 確認箇所 | 現行の依存・採用条件 |
| --- | --- |
| `src/core/public-entities.ts` / `src/agent/types.ts` | 各Unitへ全合法移動先の`fuelCostByLegalMove`を生成・格納する。公開DTOと内部計算結果を分離すれば既定転送・保存から除外可能 |
| `src/agent/route-query.ts` | 現在は同配列を検索して移動可能性・燃料値を返す。削除だけでは壊れるため、単一目的地を評価する共通の公開移動計算へ移行する |
| `src/agent/artillery-policy.ts` / `aviation-policy.ts` / `balancedAgent.ts` | 一覧を判断に使用する。公開情報だけの計算・読取Queryへ置き換え、Private StateをAIへ直接渡さない |
| `src/agent/metrics.ts` / `history.ts` | 配列の空／非空を利用する。履歴は既に先頭1件へ縮約するが、新Schemaでは件数等へ移行が必要 |
| `src/ui/controller.ts` | 移動確認と部隊詳細の燃料表示にも同配列への依存がある。選択目的地の共通Previewへ移行する |
| `src/session/service.ts` / `artifact-zip.ts` | 現行exportはディレクトリを作ってからZIP化し、両方を残す。readArtifact / replayArtifactもディレクトリ読取前提。WriterとReader双方の変更が必要 |
| `src/replay/package.ts` | ZIPのManifest・NDJSON・Payloadを使う観戦Readerがあり、外部SessionなしのZIP観戦は既存の前提 |
| `src/session/artifact-builder.ts` | ブラウザAI Sessionには既にZIP単体の別形式がある。案Cの主対象はPortable Sessionのartifact出力であり、両形式を不用意に統合しない |

本章はコードの読取確認に基づく実装要件であり、削減処理や性能測定を実施済みとはしない。メモの236 MBの自作transcriptはゲーム出力の削減実績に算入しない。「72 MB→20〜25 MB」「観戦ZIP約5 MB」は案B等を含む試算であり、案A＋Cの保証値・合格基準にしない。

## 15.2 案A: 既定応答と保存の軽量化

`fuelCostByLegalMove`の全件配列を、次から除外する。空配列を残して「合法移動先0」と誤解させず、新Schemaでは当該プロパティ自体を持たない。

- 通常AgentObservation、`units` Query、`full-snapshot`、Browser Bridge / AI Session / WebMCPのObservation・Action結果。
- 公開Session文書、Checkpointの公開Snapshot、保存用diff、historyのSnapshot、Agentの記録履歴、公開ArtifactのObservation / Payload。
- Compact要約への重複埋込みや、別名の全移動先配列による置換も行わない。

Unitの現在値、公開Action / Event / stateDelta、固定Map、施設・敵・資源の公開情報は維持する。新Observation Schemaの完全な公開Snapshotを保存・復元し、Live Observationそのものをdelta専用にはしない。

**legalActions本体は保存対象のまま維持する。** 案Aを理由に合法Action列をhash／件数だけへ置換しない。既存の`legal-actions` Query、Pagination、公開文書hash、Decision chain、lossless diff、CASとSnapshot間隔も維持する。Private State / RNG / 再開用データを削減対象にしない。

保存前・公開ハッシュ計算前の共通Projectionで軽量化する。export時だけ事後的にフィールドを除去して既存hashと不一致にしてはならない。全件一覧を毎回DTOへ生成してから捨てる構造を避け、必要な内部計算と外部シリアライズを分離する。件数計算等に探索が必要な場合も全件配列を出力へ戻さない。

## 15.3 Unitの移動・燃料要約

各Unitに固定個数の値を持つ`movementSummary`を追加する。現在燃料・最大燃料・Supply内外・補給見込み等の既存フィールドは維持し、同値を多数の場所へ重複保存しない。

| 値 | 意味 |
| --- | --- |
| `legalMoveCount` | 現在の公開合法Move候補数。目的地を列挙せず件数を返す。0と未計算を混同しない |
| `movementMode` / `availableMovementPoints` | 通常移動／燃料0時の既存Emergency Movementと、現在使える移動予算。行動済み・搭乗中・着陸ヘリ・Deployed砲の制限を反映 |
| `fuelCostBasis` / `fuelCostPerUnit` | 実移動Hex数基準か実効Movement Point基準かと、その単位消費。歩兵・野戦砲・ヘリを同じ「1MPあたり」と誤表記しない |
| `rangeUpperBound` / `rangeEstimateReason` | 現在のMPと燃料ルールから求める概算上限。到達保証・安全保証ではない。通常移動とEmergency Movementを区別し、算出不能はnullと理由で示す |
| `movementUnavailableReason` | 行動済み・輸送中・状態による移動不可等の理由。燃料0でも合法なEmergency Movementがある場合を「移動不可」としない |
| `detailQuery` | 当該Unitの`route` Query用のtarget / moverUnitIdと、destinationの指定方法。Move Previewへ進めることもAPI説明で案内 |

概算距離は地形・占有・有刺鉄線・迎撃・行動制限を無視した安全な到達を保証しない。ヘリの残Fuel 1〜4で1歩進んで緊急着陸する挙動を、燃料切れせず移動できる範囲へ含めない。`legalMoveCount`も「指定目的地まで必ず到達する候補数」ではない。合法なMoveが途中の燃料切れ等で中断し得ることを明示する。

説明文・reasonCode・Query例をapiInfo / PLAY_WITH_AI.mdへ掲載し、小さいモデルでも「目的地を決めたらrouteまたはMove Previewで確認する」手順へ到達できるようにする。モデル名・コンテキスト長に依存するゲームルールは追加しない。

## 15.4 目的地ごとの詳細取得と中断の意味

v1.6.6で外部AIへ提供する詳細取得経路は、**既存の`route` Query（moverUnitId + destination）とMove Preview**とする。全合法候補が必要なプログラムは既存`legal-actions`のページからMoveを選び、必要な目的地だけ詳細取得する。無制限な`includeMoveProjections`や既定の全件応答は追加しない。WebMCP Tool数を増やさず、既存query / previewを使う。

同じRevision・同じUnit・同じ目的地について、合法性・理由、通常／緊急移動、経路の実効コスト、燃料費、残Fuelを共通の公開計算から返す。経路全文は既存の明示指定・範囲指定のままとし、要約取得のたびに全経路を付けない。

「目的地まで進む場合の計画値」と「現在公開されている中断条件を反映したPreview値」を区別する。可視迎撃による停止、飛行Fuel枯渇位置、緊急着陸リスク、目的地への到達見込みを表示する。合法なヘリMoveを、最後までの燃料が足りないという理由だけで不正Actionへ変えない。実際の消費残量を負数にせず、到達しない目的地を到達確定と表示しない。

現行の全件配列は経路全長の計画値、Move Previewは途中停止を反映する場合がある。そのため「旧配列とPreviewの全項目を常に単純一致させる」ことを受入条件にしない。中断なしの同一条件では一致を確認し、中断ありでは計画値・公開Preview・実Actionをそれぞれの意味に沿って検証する。既存不一致が見つかった場合は現行ゲームルールを正として共通化し、差分の理由を記録する。

到達不可・MP不足・燃料不足の場合、routeは具体的reasonと、存在する場合に最大1件の代替目的地を返す。代替は現在の公開合法Moveから、要求先とのHex距離が最小、同距離は実効移動コスト、q、rの昇順で安定選択する。要求先へ近づかず、公開情報上で燃料枯渇・強制中断を起こす候補は提案しない。候補なしはnullと理由を返す。Action拒否からも当該Unit / 目的地のroute照会へ案内し、代替Actionを自動実行しない。

Query・要約・代替候補・Previewは公開情報だけを利用する。Hidden Enemy・迎撃・内部Target・未確定の緊急着陸先を検索結果から漏らさず、State / RNG / Session revision / decision sequenceを進めない。不可視接触等で実移動が公開Previewと異なり得る既存境界を維持する。

## 15.5 内部利用者と表示の移行

共通の読取専用移動計算／Query Providerで、必要なUnit・目的地の情報を遅延取得する。組み込みAIには公開情報から得られる同等の情報だけを渡す。Coreの関数を直接呼べることを理由に、AIへGameStateやHidden情報を渡してはならない。

- artillery-policy / aviation-policy / balancedAgentの評価に必要な移動候補・燃料情報を維持する。容量削減だけを理由に意思決定の探索範囲を黙って縮めない。
- metricsの「燃料のため移動不能」等は、件数・状態・明示理由へ移行する。省略された配列を空と解釈して全Unitを移動不能へ計上しない。
- historyの「配列先頭1件で空／非空を残す」処理は新要約へ置換する。履歴・Artifactから再集計したMetricsをLive集計と一致させる。
- 通常UIの移動確認・部隊詳細、Live Viewerでの燃料表示は選択目的地の共通Previewへ移行する。表示維持のために公開Observationへ全配列を戻さない。
- Replayは新Schemaの保存済み公開情報から盤面・Action・Event・コメント・結果を復元する。記録していない全目的地の詳細Query結果を「当時保存した情報」として表示しない。

## 15.6 案C: ZIP単体を既定にする

Portable Sessionの`artifact` CLIとSessionServiceの既定exportをZIP単体へ変更する。`--keep-directory`を指定した場合だけ、同内容のディレクトリ版も出力する。Serviceにも同じ意味の明示オプションを用意する。

| 操作 | 最終成果物 |
| --- | --- |
| `artifact --session=ID` | 既存の既定出力先を基にした `ID-dNNNNNNNNNNNN.nlth-artifact.zip` のみ |
| `artifact --session=ID --out=PATH.zip` | 指定したZIPパスをそのまま使用 |
| `artifact --session=ID --out=PATH`（末尾が.zipでない） | 既存の基底パス指定として `PATH.zip` を出力 |
| 上記に`--keep-directory` | ZIPに加え、その末尾.zipを除いたパスへディレクトリ版を出力 |

成功応答の`artifactPath`は主成果物の実在ZIPパス、`replayZipPath`も同じZIPパス、`artifactDirectoryPath`は既定null／明示保存時のみ実在ディレクトリとする。成果物Manifestとホスト上の出力先情報は分離し、存在しないディレクトリをManifestの必須参照先として残さない。相対エントリ・内容hashで自己完結させ、別端末へZIPを移動しても読取可能にする。

**既定経路ではディレクトリ版を作成しない。** Session Storeの必要な公開Payload、Decision列、Map、Manifest等を境界付きバッファでZIPへ直接書く。ディレクトリ版を作ってから削除／safe-deleteへ退避して容量が減った扱いにする方式は採用しない。Session Storeの元Payloadは再開用として維持する。

`--keep-directory`時も公開内容・hash・Decision順はZIPと一致させる。共通のエントリ生成処理をWriterへ流し、別々のゲーム再計算で内容を作り直さない。正常終了時の既定出力はZIP1個であり、全Artifactを一括メモリ化・一括展開して処理する方式にはしない。

ZIP内部の既存構造（Manifest / artifact.ndjson / gzip済み参照Payload）、NDJSON等の非圧縮格納と内部Payloadのgzipを維持する。案CだけでZIP内容自体が半分になるとは扱わない。削減対象はディレクトリとの二重保存である。ブラウザAI Play / Watchの既存ZIP単体出力は維持し、案Aによる公開Schema変更を反映する。

## 15.7 ZIP Reader・失敗時・互換性

SessionServiceのreadArtifact / replayArtifactをZIP単体でも実行できるようにする。既存ディレクトリ形式も`--keep-directory`による同版の明示出力として読めるよう維持する。ViewerとCLIの両方で、Session Store・元ディレクトリ・元絶対パスのない状態から読込・検証・Replayを行う。

「ZIPから記録を観戦できる」と「同Seed / Config / ActionをCoreで再実行して一致検証できる」は別の検証である。後者を前者に置換せず、CLI・Portable E2E・Release Validation・既存local acceptance scriptsの呼出元も移行する。

出力先衝突は上書きせず拒否する。`--keep-directory`時はZIPとディレクトリ双方の衝突を確認する。入力・出力パスの既存安全検証、symlink拒否、ZIPエントリのTraversal／重複／外部URL拒否、Version／hash検証、展開上限・中止機能を維持する。

書込失敗・中断時は成功応答を返さない。書込中ファイルは完成ZIPと区別し、検証・close完了後にのみ成果物として確定する。既存成果物やSessionを破壊しない。部分出力が残る場合はそのパスと未完了を報告し、再試行が黙って上書きしないようにする。ファイルを取り除く作業にはプロジェクトのsafe-delete手順を適用する。

案AでObservationの構造・意味と保存用公開hashが変わるため、Observation API Versionを更新し、Agent / Bridge / Session / Checkpoint / Artifactの影響Versionを第9章の一覧へ含める。案CのCLI結果・Manifest・package契約の変更も同時に反映する。外枠を維持するものは内包Versionで拒否できる根拠を示す。v1.6.5以前の非互換・旧データ保全方針は第9章どおりで、暗黙変換は行わない。

## 15.8 容量測定と受入条件

以下は実装後に行う必須検証。現在は静的な実装確認と要件追加のみで、容量削減率・Replay成功・軽量モデルのプレイ品質は未検証。

| ID | 必須条件 |
| --- | --- |
| A1 | units / Observation / full-snapshot / step応答 / 履歴 / 保存公開文書 / Artifactに全件fuelCostByLegalMoveを含めない。legalActions本体と公開記録の復元性を維持する |
| A2 | 全Human Type、通常／緊急移動、砲Packed／Deployed、ヘリLanded／Airborne、搭乗・行動済み・Supply内外の要約を検証する。候補0と情報省略を区別する |
| A3 | 固定シナリオの全合法Moveについて、詳細Queryで同等情報へ到達できることを検証する。中断なしは旧一覧の同義項目と一致、中断ありは計画値・Preview・実行の意味を分ける |
| A4 | ヘリ残Fuel 0 / 1 / 4 / 5 / 6、経路途中枯渇、可視迎撃、有刺鉄線、地形コスト、既知占有を検証する。Hidden情報だけ変えた対照状態で要約・route・代替候補が情報を漏らさず、読取でState / RNG等を変えない |
| A5 | 代替候補は合法・最大1件・安定順。候補なし、目的地へ近づけない、燃料枯渇を起こす候補の除外を検証し、拒否Actionは状態不変 |
| A6 | 組み込みAI、UIの燃料確認、Metrics / history、Replay / Live Viewerの全件配列依存を除去し、情報欠落による判断退化・誤集計・表示消失がない |
| C1 | 既定exportの完成成果物はZIP1個で、ディレクトリやその退避コピーを作らない。既存Sessionの入力データは維持する |
| C2 | --outのZIP／基底パス、既定名、--keep-directory、応答の実在パスとnullを検証する。明示ディレクトリとZIPの公開内容・hashが一致する |
| C3 | 元Sessionとディレクトリへアクセスできない別の場所から、ZIPのreadArtifact、Core再実行Replay、Viewer読込・前後seek・cancel・コメント対応を検証する。Rootと子分岐のlineageを含む |
| C4 | 出力先衝突・書込失敗・中断・部分ZIP・改ざんhash・旧Version・不正エントリを拒否し、既存データ不変・成功誤報なしを確認する |
| AC1 | 同一ゲーム状態・同一Action列・同一圧縮条件で、変更前／Aのみ／Cのみ／A＋Cを比較し、Query UTF-8 bytes、公開Payload展開bytesとgzip bytes、Session総量、Artifactディレクトリ量／ZIP量／合計、生成・読取時間を記録する |
| AC2 | 多目的ヘリを含む51×51固定シナリオで、旧既定units応答のサイズと、全移動配列を除いた残りのサイズを記録する。新応答は「旧応答から当該配列を除いたサイズ＋Unit数×2 KiB」以下を回帰予算とする。他の新規仕様のフィールド増加は別計上し、削減を水増ししない |
| AC3 | Session再開・Checkpoint・分岐・公開hash chain・lossless diff・不正Action記録・同版Replay／Metrics一致を確認する。容量減を理由に既存の1,000判断以上・物理512 MiB以上の必須耐久条件を引き下げない |
| AC4 | PLAY_WITH_AI.md、apiInfo、Query schema、CLI help / README、Portable配布と利用scripts、検証fixtureを新契約へ同期する。WebMCP Tool数9は維持する |

AC2はUnitごとの新要約による増分に2 KiBの余裕を設ける実装予算であり、すべてのゲーム状態の総応答が数十KB以下になる保証ではない。全件リストを消した代わりに別の無制限配列を加えて通過させない。サイズ計測はUTF-8実bytesで行い、概算トークンは使用tokenizerまたは推定方式を併記する。

元のv1.6.5 Artifactをv1.6.6へ読み込んで比較しない。元版は元版の環境で測定し、容量変更だけを切り替えた同一ルールの比較シナリオも用意して、v1.6.6の経済・戦闘変更による差を分離する。ディスク占有量はOS／Filesystem／クラスタ条件を併記し、論理bytesと混同しない。必要な大容量試験データは新形式の実データで基準を満たし、小規模検証で代用しない。

オープンウェイト軽量モデルによる比較プレイは利用可能な環境がある場合の追加検証とし、必須にしない。未実施なら理由を記録する。小型商用モデルの結果を同等の証明とせず、モデルなしの情報到達性・燃料境界・応答サイズの検証は省略しない。
