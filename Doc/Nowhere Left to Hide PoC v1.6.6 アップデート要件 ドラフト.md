# Nowhere Left to Hide PoC v1.6.6 アップデート要件 ドラフト

> Status: Draft  
> Base: v1.6.5  
> 作成日: 2026-09-24  
> 主な根拠: v1.6.5 Claude Opus playtest（seed 3 / build 1bd6c411196863683a98ba4b83a1a5264692dcfa）、現行 main 実装確認、ChatGPT Desktop Work / CodexでのWebMCP実機確認、2026-09-24時点のOpenAI Site tools説明およびWebMCP Community Group Draft

## 0. 目的

v1.6.6では、v1.6.5の長期プレイで顕在化した検問所移設のデッドロック、有刺鉄線の防御効果不足、Zombie Unit ID再利用を修正する。

同時に、Military Goods経済を再調整する。Player Unitを保有しているだけで発生する毎ターン固定Military Goods消費を廃止し、Military Factoryを少量高効率変換ではなく大量投入・大量生産型へ変更する。

さらに、余剰FoodをCivilian Goodsへ変換できる新しいConstructible Facility **Relief Supply Center / 救援物資センター** を追加し、Food生産基盤からCivilian Goods不足を部分的に補える経済経路を追加する。

WebMCPについては、GitHub Pages上のAI Play / Watch Session自体は開始できる一方、ChatGPT Desktop Work / Codex側で Site tools discovery が失敗する実機事例を確認した。v1.6.6ではNLTH側WebMCP adapterを現行WebMCP Draftへ合わせ、登録成功・Self Test・配信Buildを診断可能にする。ChatGPT host側でSite tools capabilityが提供されていない場合はゲーム側だけで代替せず、NLTH側失敗とhost側unsupportedを明確に切り分ける。

Game Core、Agent API、WebMCP、Normal UI、Replay、Live Viewer、Save / Artifactの間で同じルールと公開境界を維持する。

---

# 1. v1.6.5 playtestで確認した事実

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

Checkpointの移設は、本来「新たにSupplyを伸ばそうとする先がZombie支配下なら前進できない」という制約として機能する。

しかしInitial Supply NetworkはCheckpointが存在しなくてもCapitalから常に成立する固定の安全・運用基盤である。

この固定領域内のZombieや感染Siteが candidate checkpointごとのSupply blockerに含まれると、Checkpoint喪失後にCapital近傍へ再配置する合法手まで消え、Branch復旧不能になり得る。

## 2.2 v1.6.6仕様

Initial Supply Networkは以下で固定定義する。

**hexDistance(Capital, Hex) <= checkpoint.initialSupplyRadius**

現在のActive Checkpointやcandidate checkpointによって拡張されたSupply RadiusはInitial Supply Networkには含めない。

Checkpoint Build / Relocateの「Supply内Zombie blocker」判定では、Initial Supply Network内にいるZombieを blocker として数えない。

CandidateによってInitial Supply Radiusより外側へ新たにSupplyへ含まれる可視Zombieは従来どおり blocker とする。

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
3. Initial Supply外でcandidate supplyへ含まれる可視Zombieは checkpoint_supply_zombie_blocked を返す。
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

ZombieはBarbed WireがあったHexへ同じPhase中には進入しない。

次のZombie Phase以降、WireがなくHexが合法なら通常どおり進入可能。

Wireを破壊できなかった場合は従来どおり手前で停止する。

Player Unitと同じHexにあるBarbed Wireがincoming attack damageを先に吸収する既存仕様は維持する。

Gas ExplosionをBarbed Wireが吸収しない既存仕様も維持する。

## 3.3 Route evaluation

Zombie AIがBarbed Wireを迂回すること自体は不具合としない。

ただし経路評価上のwire costは「攻撃回数」だけでなく、「破壊に成功したPhaseでもそのHexへ進入できず次Phaseまで待つ」実時間を反映する。

Route Previewと実移動で、Wire突破に必要なturn / phase感覚が極端に乖離しないようにする。

## 3.4 追加バグ調査

今回の変更とは別に、以下をRegressionで確認する。

- Occupied WireがHumanへの攻撃を正しく吸収する
- Empty Wireへの攻撃がAttack Chargeを正しく消費する
- Wire破壊Event / statisticsが重複しない
- 破壊後の同Phase侵入だけが禁止され、次Phase以降は通行可能
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

EndTurn経過だけではHuman Unitの currentMilitaryGoods を減少させない。

## 5.2 API互換

fixedMilitaryGoodsUpkeepPerTurn、fixedConsumption、afterFixed 等のPublic fieldをv1.6.6でも残す場合、互換・診断用として値を0にする。

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

同TurnのCivilian Goods productionによってmaintenanceを賄えるため、Turn開始時stockの一部をinputへ解放する既存挙動は維持してよい。

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
| Vision | 既存Constructible Facility共通の最低限値 |
| Zombie Target Value | 0 |

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

ドラフト既定値は **unlimited** とする。

Simple Farm / Temporary Housingと同じく、土地・Civilian Goods・Food・Population・Electricityを実質制約とする。

専用の道路分岐数上限は設けない。

## 6.5 Decommission

v1.6.6ではDecommissionConstructibleFacility対象へ追加しない。

既存のCivilian Drone Base / Temporary Housingだけをdecommission可能とする現行仕様を維持する。

将来decommission共通化を行う場合は別要件とする。

## 6.6 Production

正常稼働し、healthy workersがいて、Power Supplyが有効で、Food inputとElectricity 5を確保できる場合に生産する。

Workerごとに Food 20 -> Civilian Goods 5。

Food input不足では、20 Foodを確保できるWorkerだけが稼働する。

例:

- Food 19 -> 0 operating workers -> CG 0
- Food 20 -> 1 -> CG 5
- Food 59 -> 2 -> CG 10
- Food 99 -> 4 -> CG 20
- Food 100以上、workers 5 -> CG 25

1人以上のoperating workerがいる場合、Facility全体でElectricity 5を要求する。

0 operating workersならFood input shortageとしてPower allocation対象から外す。

PowerはWorker数に比例して増加しない。

## 6.7 Power toggle

Relief Supply CenterはMilitary Factory / Civilian Factory / Farm / Refinery等と同様にSetPowerSupply対象とする。

OFFならinputを予約せず、生産せず、Powerを要求しない。

## 6.8 同Turn input chain禁止

既存の「同Turn生産物を別の生産工程のinputへ直接連鎖投入しない」原則を維持する。

Relief Supply CenterのFood inputはTurn開始時Food stockを基礎に予約する。

同TurnにFarm / Simple Farmが生産したFoodを、そのままRelief Supply Centerへ直接投入しない。

ただし同Turn Food productionによってpopulation maintenanceを賄えるため、Turn開始時Food stockからRelief Supply Center inputへ解放できる量を計算することは許容する。Military FactoryのCivilian Goods reservationと同じ原則に揃える。

Relief Supply Centerが同Turnに生産したCivilian GoodsをMilitary Factoryへ直接投入しない。

したがって次の1Turn即時chainは禁止する。

Simple Farm / Farm -> Relief Supply Center -> Military Factory

## 6.9 Economy allocator

v1.6.5のeconomy-queryはproduction input facilityを実質Military Factory専用として扱う箇所がある。

v1.6.6ではRelief Supply Center追加に合わせて、production input reservationを少なくとも以下へ共通化する。

- Food -> Relief Supply Center
- Civilian Goods -> Military Factory

一方のFacility Type名を特別扱いする分岐を増やすだけの設計は避ける。

Forecast、actual EndTurn、Public Projectionが同じinput allocation結果を使用する。

## 6.10 Power allocation priority

Relief Supply CenterはCivilian maintenanceを支える補助生産施設として扱う。

Power allocationは既存の基礎生活・Civilian productionを優先し、Military Factoryより前にRelief Supply Centerを配置する。

具体的な既存tierを共通処理へ整理する場合でも、少なくとも次を満たす。

- Capital / City等の既存最優先生活基盤を追い越さない
- occupied Temporary Housing等の既存生命維持優先を壊さない
- Food input 0のRelief Supply CenterへPowerを予約しない
- Military FactoryよりRelief Supply Centerを先に配電する
- Preview / Forecast / actual EndTurnで同じ順序

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

2026-09-24時点のOpenAI Helpでは、Site toolsはChatGPT Desktop appのbuilt-in browserで使用し、WebMCPを利用すると説明されている。

Built-in browserはWorkまたはCodexから開く。

Site toolsはaccountとselected modelが対応し、pageがtoolを提供している場合に自動discoverされる。

ChromeではSite toolsは利用できない。

したがってv1.6.6の実機対象は **ChatGPT Desktop built-in browser** とし、通常ChromeやCloud BrowserをWebMCP Acceptance環境にしない。

## 7.3 現行NLTH adapterとの差

current main の src/browser/webmcp.ts は registerTool() を同期的なregistration handleまたはvoidとして扱い、handle.unregister() / modelContext.unregisterTool() をcleanup経路として想定している。

2026-09-17のWebMCP Community Group DraftではModelContextは概ね以下の契約を持つ。

- registerTool() -> Promise<undefined>
- getTools() -> Promise<RegisteredTool[]>
- executeTool() -> Promise<string>
- registerTool(tool, { signal }) のAbortSignalでunregister

したがってNLTH adapterを現行Draft contractへ更新する。

この差が今回の webmcp_list_tools unsupported の直接原因であると断定しない。host側の内部tool retrievalはin-page getTools()と別経路であるため、NLTH registration成功とChatGPT discovery成功を別判定にする。

## 7.4 Async registration

registerWebMcpToolsは非同期registration完了を追跡する。

9 toolすべての registerTool Promiseを待ち、1件でもrejectした場合はregistration_failedとする。

一部だけ登録された状態をreadyとして表示しない。

ページ起動時のtry/catchだけでPromise rejectionを見逃さない。

AbortControllerをregistration lifecycleへ保持し、page / viewer cleanup時にabortしてtoolを解除できるようにする。

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

Session Start後は可能ならgetToolsで得たread-only toolの nlth_get_context または nlth_observe を executeTool() で実行するin-page smoke testを用意する。

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

最新のChatGPT Desktop app、Site toolsが利用可能なaccount / selected modelで実施する。

1. WorkまたはCodexを開く。
2. ChatGPT built-in browserでGitHub Pages版を開く。
3. Address barのSite tools indicatorを確認する。
4. NLTH側Self Testがexpected 9 / registered 9を示す。
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

まで確認できているにもかかわらず、ChatGPT側が webmcp_list_tools unsupported 等でtool discoveryできない場合は、**ChatGPT host / account / selected model / workspace capability側の問題**として分類する。

その場合、NLTH Core / Session contractを壊して代替しない。

GitHub Pagesしか提供しないというプロジェクト前提を維持し、v1.6.6のためだけに常設Backend MCP serverを要求しない。

通常Browser UI操作による疑似AIプレイをWebMCP成功扱いにしない。

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

専用アートをv1.6.6必須にするかは実装時に既存Facility placeholder品質を確認して決める。少なくともtype不明で表示不能にはしない。

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

Constructible candidate queryはreliefSupplyCenterを扱う。

Facility production queryはFood input required / allocated、operatingWorkers、Civilian Goods output、power reasonを返す。

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
- 現行仕様
- WebMCP実機確認手順

旧説明の以下を残さない。

- Recon / Soldier / Helicopter等が1 MG / turn fixed upkeepを払う
- Military Factory 2 -> 1
- Constructible typesが4種類だけ
- WebMCP tool count固定値の古い表示

---

# 9. Versioning / Compatibility

v1.6.6はFacility Type追加、Economy input contract変更、WebMCP adapter contract変更を含む。

App Versionは1.6.6へ更新する。

Game Rules / State / Config、Save、Agent / Observation / Bridge、Artifact、Checkpoint / Session等のうち、schemaまたはsemantic compatibilityが壊れるものはVersion bumpする。

Version番号そのものは実装時に現在のversion registryから一括決定し、文書・runtime・fixtureで一致させる。

特にv1.6.5 GameStateはconfig snapshotに reliefSupplyCenter を持たないため、旧Saveをそのまま「互換」とみなしてcurrent config key存在を前提に読み込まない。

v1.6.5 Save / Replay / Session / Artifactを互換維持する場合は、明示的migrationとRegression Testを実装すること。

migrationを実装しない場合は、従来どおりversion mismatchとして安全に拒否し、旧データを破壊しない。

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

19. EndTurnだけでは全Human UnitのMilitary Goodsが減らない。
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
30. Food100 / workers5 / PowerありでCG25。
31. Food19では0 production。
32. Food59では2 workers / CG10。
33. operating worker 0ならPowerを要求しない。
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
48. ChatGPT Desktop built-in browserのSite tools対応環境でnlth_get_context / observe / preview / actを実機確認する。
49. NLTH Self Test成功・ChatGPT discovery失敗をhost-side failureとして区別できる。

## Cross-surface

50. Normal UI / Replay / Live Viewer / Agent APIでRelief Supply Center identityが一致する。
51. Help / PLAY_WITH_AI / apiInfoのMilitary Factory値が10 -> 4で一致する。
52. fixed upkeepの説明が0 / noneで一致する。
53. v1.6.5 compatibility policyがVersion validationと一致する。

---

# 11. 推奨実装順序

**Unit ID allocator修正**  
-> **Checkpoint Initial Supply blocker修正**  
-> **Barbed Wire movement stop修正**  
-> **fixed Military Goods upkeep廃止**  
-> **Military Factory 10 -> 4**  
-> **production input allocator共通化**  
-> **Relief Supply Center**  
-> **Forecast / Public API / UI**  
-> **WebMCP current Draft adapter対応**  
-> **WebMCP diagnostics / Self Test**  
-> **Version bump / persistence**  
-> **Regression**  
-> **ChatGPT Desktop実機Acceptance**  
-> **Claude等による再Playtest**

先にUnit IDを修正することで、以後のRegression / Artifact解析でUnit追跡の曖昧さをなくす。

EconomyはRelief Supply Center追加前にinput allocatorを共通化し、Military Factory専用分岐をそのまま複製しない。

WebMCPはGame Coreと分離して進め、WebMCP host側問題が通常Game releaseを阻害しないようにする。

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

---

# 13. 外部参照

WebMCP / ChatGPT Desktop部分の調査基準日は2026-09-24。

- OpenAI Help: Using site tools in the ChatGPT desktop app  
  https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app
- OpenAI Help: Using the built-in browser in the ChatGPT desktop app  
  https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app
- WebMCP Community Group Draft, 17 September 2026  
  https://webmachinelearning.github.io/webmcp/

WebMCPはDraftであり、将来APIが変わった場合は「v1.6.6実装時に固定したcontract」と「現在の最新Draft」を混同しない。
