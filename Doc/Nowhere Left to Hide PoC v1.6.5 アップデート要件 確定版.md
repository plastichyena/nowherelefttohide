# Nowhere Left to Hide PoC v1.6.5 アップデート要件 確定版

- ステータス: 要件確定・実装未着手
- 基準Version: v1.6.4
- 策定日: 2026-09-23
- 根拠: v1.6.5ドラフト、依頼者との1問1答（問1～39）、`Nowhere Left to Hide PoC 現行仕様.md` のv1.6.4安定版
- アセット: 本書確定後に同じタスクで3画像を生成済み。依頼者の見た目確認・採用待ち。原本とプロンプトは `Art/reference/v1.6.5-concepts/` に保存。生成と承認を区別する。

本書は次期実装の変更要件であり、実装・検証済みの宣言ではない。未変更部分は現行仕様を継承する。現行仕様は実装・必要な検証・動作確認の完了後に更新する。履歴ドラフトや過去の確定要件より本書の変更内容を優先する。

## 1. 目的・対象範囲

AI向けQuery / Previewの往復量を減らすとともに、経済・電力・Hordeを調整し、空軍基地、多目的ヘリコプター、軍用ドローン偵察、歩兵輸送を追加する。日本語UIでもゲームタイトルは **Nowhere Left to Hide** に統一する。

状態変更はGameAction → GameEngine経由に限定し、Game CoreをPhaser/UIから分離する。航空の移動領域、占有、攻撃可能性、輸送、搭乗時燃料移送、一時視界、期限付き施設Objectiveを共通機構として設計する。Normal UI、組み込みAI、外部Agent API、WebMCP、Save、Replay、Live Viewerで同じルール・公開境界を使う。

今回の作業段階は要件定義とアセット制作。ゲーム実装、プッシュ、配布はこの文書作成だけでは実施済みとしない。

## 2. AI向けQuery / Preview

### 2.1 共通原則

`legal-actions` は引き続き合法Actionだけを返す。新しい候補Queryは合法・違法候補と理由を返す。未公開施設や不可視敵を列挙せず、通常Observationと同じ公開Projectionを使う。外部入力Schema不正、Revision不一致、Coreのゲーム上の不成立を区別する。

実際のActionが不成立なら、Session層で一律 `action_not_legal` に置き換えず、公開可能な具体的Core reasonCodeを返す。秘匿情報を理由文・候補数・ID・順序から漏らさない。複数の不成立理由があっても、主要reasonCodeの選択順は単独Preview・候補Query・実Actionで一致させる。

### 2.2 production-candidates

施設とUnit種別ごとに生産可否・費用・配置見込み・生涯枠を取得できるQueryを追加する。対象施設・Unit種別を指定する場合、不適切な組合せも `unit_not_producible_here` 等で説明する。既知の未所有施設を照会しても内部の非公開人口を公開しない。

必須情報: `facilityId`, `unitType`, `legal`, `reasonCode`, `reason`, `populationCost`, `civilianGoodsCost`, `militaryGoodsCost`, `fuelCost`, `productionTurns`, `productionSlotOccupied`, `readyTurn`, `projectedPlacementHex`, `placementReasonCode`, `lifetimeProducedCount`, `lifetimeProductionLimit`。予約数・配置待ち・残枠も区別する。

代表的reasonCodeは `production_slot_occupied`, `production_destination_blocked`, `insufficient_population`, `insufficient_civilian_goods`, `insufficient_military_goods`, `insufficient_fuel`, `facility_not_owned`, `facility_not_operational`, `unit_not_producible_here`, `lifetime_production_limit_reached`。

生産予約そのものの合法性と完成時の配置見込みは分ける。現時点の配置候補は将来の空きを保証しない。既存規則で配置待ち可能な予約を、Queryだけが独自に違法としない。将来の敵移動・乱数を予測した確定配置を返さない。

### 2.3 住民移動Preview

AssignWorkers等の減員に伴う全移動先を `populationMovements: { fromFacilityId, toFacilityId, people, reason }[]` と `facilityResidentDeltas: { facilityId, before, after, delta }[]` で返す。CapitalだけでなくCity・Temporary Housing等をすべて含める。Capitalの既存集計を維持してもよい。同一Revisionで乱数を伴わない再配置のPreviewと実適用を完全一致させる。

### 2.4 enemiesと検問所Blocker

`units` はPlayer Unit用のまま維持し、現在可視のEnemy専用 `enemies` Queryを追加する。`id`, `type`, `position`, `hp`, `attack`, `range`, `movement`, `vision`, `attackChargesRemaining`, `maxAttackCharges`, `canMove`, `canAttack`, `isScheduledWaveMember`, `isFinalWaveMember`, `canTargetAir` を返す。

`checkpoint_supply_zombie_blocked` の候補には `blockingEnemyIds` を追加する。実際に当該候補を妨害する現在可視の敵IDだけを全件返す。空配列は不可視の妨害者がいないことを保証しない。不可視IDや不可視の人数は返さない。

### 2.5 Batch Preview

Session API / WebMCPで複数Actionを1回の要求でPreviewする。全件を同じ `baseRevision` の現在Stateから**独立に**評価し、入力順と各結果の対応を維持する。前の結果を次へ適用するSequence Simulationではない。個別Actionのゲーム上の不成立もその項目の結果として返す。

State、Live RNG、Action/Event Sequence、Revisionを一切変更しない。処理中に異なるRevisionを混ぜない。要求全体のRevision不一致は既存の競合処理に従って拒否する。サイズ制限やページングを設ける場合は公開Schema/API説明へ明記し、黙って候補を切り捨てない。

### 2.6 attack-candidates

`unitId` 指定時は当該Player Unit、省略時は全Player Unitを対象に、攻撃候補をまとめて返す。候補の合法性は同じCore Validationを使用する。行動不能・搭乗中・着陸中のヘリについても、攻撃できない理由を取得可能にする。

必須情報: `attackerId`, `targetId` または `targetHex`, `distance`, `legal`, `reasonCode`, `projectedAttack`, `militaryGoodsCost`, `projectedMilitaryGoodsRemaining`, `attackChargesRemaining`, `counterattackPossible`, `interceptionRelevant`, `friendlyFirePossible`、該当する砲撃Preview情報。

敵Unit候補は現在可視の敵のみ。野戦砲の現在可視Hexへの照準も扱い、空地・施設・検問所を敵Unitの不在だけで候補から失わない。候補取得範囲・フィルタ・全件取得方法を公開契約で定義する。Previewと同様に予測範囲と非公開情報による限界を示す。

## 3. 経済・電力

### 3.1 Temporary Housing

仮設住宅は人口収容・過密回避・避難民の受け皿とし、民需品生産は人数・状態を問わず常に0。固定生産、resident/worker比例生産、ForecastのResident Rated Output、Production Capacityへの寄与も0に統一する。

現行仕様にも資源非生産の記述があるため、既に0の経路は回帰保証とし、残存するCity系共通ロジックや表示だけに生産があれば修正する。人口維持費、収容上限、停電・補給切断の追加維持費を廃止しない。

### 3.2 要求電力

既存の正の要求電力を2倍とし、発電量は変更しない。給電対象になる条件や優先順位は未変更部分を継承する。

| 施設 | v1.6.5要求電力 |
| --- | ---: |
| 州都 / 都市 | 各20 |
| 農場 / 仮設住宅 | 各10 |
| 民需工場 | 30 |
| 軍需工場 | 40 |
| 製油所 | 20 |
| 民間ドローン基地 / 陸軍基地 / 空軍基地 | 各10 |
| 簡易農場 / 発電所 / 風力発電所 / 原発 / 油田 | 各0 |

軍事基地の予約生産に対する給電条件も共通処理へ反映する。空軍基地は軍用ドローン発進時にも給電状態を確認できること。生産予約がないためドローンへ給電不能になる設計にしない。Config Validation、Forecast、Public Config、Helpを一致させる。

### 3.3 軍需工場

稼働worker1人・1ターンあたり **民需品2消費 → 軍需品1生産**。既存の民需品1→軍需品4から変更する。入力不足・電力不足の配分順は既存経済規則を使う。兵士、偵察隊、特殊部隊、野戦砲、ヘリ、両軍事基地の専用軍需、攻撃・補給・固定維持費を含めて固定Seedで収支を確認する。勝利のために確定数値を無断調整しない。

## 4. Horde・Zombie AI

### 4.1 抽選と方向別総数

| 抽選Type | Weight |
| --- | ---: |
| Normal Zombie | 40 |
| Police Zombie | 10 |
| Soldier Zombie | 10 |
| Riot Zombie | 5 |
| Hunter Zombie | 15 |
| Gas Zombie | 15 |
| Screamer Zombie | 5 |
| 合計 | 100 |

Gasは第1Waveから対象で方向別上限なし。**Hunterの方向別個体数上限も撤廃**し、同方向に複数出現可能にする。Riot等の未変更の上限は維持し、上限到達後は残候補で再正規化する。よって15というWeightは、全Slotで常に15%となる保証ではない。

| Turn | 方向数（現行維持） | 1方向の基本総数 | 固定Horde | Variant抽選枠 |
| --- | ---: | ---: | ---: | ---: |
| 10 | 1 | 9 | 5 | 4 |
| 20 | 2 | 9 | 3 | 6 |
| 35 | 1 | 17 | 8 | 9 |
| 50 | 3 | 14 | 5 | 9 |
| 70 | 4 | 18 | 8 | 10 |

旧基本数×1.1を切り上げ、増加分をVariant枠へ追加する。難民拒否追加枠は別枠で既存どおり加算し、同じWeightと上限規則を使う。Wave内のNormal抽選結果はHordeへ正規化する。非Wave生成、FinalのPack参加条件・予告境界・勝利条件は変更しない。

### 4.2 航空への対応

Hunter / Packだけを `canTargetAir = true` とし、他Zombieはfalse。攻撃、反撃、迎撃、可視人口Target、移動先Targetで共通Capabilityを使用する。対空可能なRange1 Unitは飛行中の敵とのHex距離0～1を攻撃距離とする。

対空不可のZombieは飛行中のヘリ本体や搭乗歩兵を追跡・攻撃対象にしない。一方、**飛行騒音の発生地点には向かう**。音源地点への移動と、航空Unit本体への追跡を区別する。上空にヘリがいても地上Hexへの移動は可能。

着陸中のヘリはすべてのZombieの通常対象。既存の可視人口優先、Horde継承、Noise Target、Capital Anchor、混雑時Fallbackの優先関係は維持する。

## 5. 原発・空軍基地の期限付きObjective

### 5.1 原発

報酬期限をTurn20から**Turn10のPlayer行動終了まで**へ短縮する。期限内の初回確保でRegular Special Forces1隊。生存者は追加せず、生存者数を報酬条件にしない。Supply外の確保も有効。期限以外の報酬条件は現行規則を維持する。

未確保ならTurn11 Player Turn Startに報酬失効・Pack1隊の生成権を確定する。期限内確保後の喪失ではペナルティを発生させない。ドラフトにあった原発への新たな期限前陥落ペナルティは導入しない。

### 5.2 空軍基地の基本仕様

内部Facility Typeは `airBase`。固定Mapに中立施設として1基のみ。通常建設では追加できない。陸軍基地と同じworkerCapacity10、感染・陥落・復旧・確保・生存者の共通規則を使う。要求電力10。

専用軍需最大40、迎撃ATK10・Range2・1射軍需2・Noise8など、未変更の防衛値と迎撃回数・補充条件は陸軍基地に準拠する。中立時も健康な生存者・施設状態・専用軍需に応じて既存と同じ防衛を行う。生産・ドローン・迎撃・補給の利用可否は別々に表示する。

生産可能なUnitは **Soldier（内部ID `nationalGuard`）と多目的ヘリコプターのみ**。Field Artillery、Police、Riot Police、Recon Team、Special Forces等は生産不可。兵士の既存生産費・人口・所要時間等は維持する。

初回確保時は食料100・軍需品100を一度だけ付与する。生存者数・早期報酬とは別の台帳で管理し、再確保やLoadで重複しない。陸軍基地の無償兵士報酬は追加しない。

### 5.3 空軍基地の早期確保報酬・失敗

Turn10のPlayer行動終了までに初回確保し、健康な生存者1人以上、未確保中の陥落歴なしを満たせばRegular Special Forces1隊。報酬部隊の能力・初期物資・人口5の外部援軍計上・即時行動可能・配置規則は現行原発報酬と共通にする。

未確保ならTurn11 Player Turn StartにPack1隊の生成権を確定する。期限前でも未確保中の陥落でPack1隊の生成権が発生する。期限前陥落と期限切れを重複計上しない。

期限内に初回確保すれば、健康な生存者不足で特殊部隊を獲得できなくても期限切れPackは回避する。ただし確保前の陥落による生成済みPack・出現予約は消さない。期限内確保後の陥落で新たなペナルティPackは発生しない。通常の陥落由来Zombie生成とは別に、このObjective由来を1件として管理する。

### 5.4 共通の配置・通知・保存

報酬・失敗は施設ごとに一度だけ。原発と空軍基地を両方達成すれば特殊部隊は合計2隊を得られる。空軍基地の生存者条件を原発へ誤適用しない。

施設Hexが合法で空きなら優先し、塞がっていれば最寄り合法Ground Hexへ既存の安定順で配置する。全候補が塞がっていればpendingを保存して以後のPlayer Turn Startに再試行する。期限内に獲得済みの報酬権は期限後も失効しない。外部援軍人口は実配置時に一度だけ計上する。

Packの行動開始は現行Lifecycleを継承し、敵フェーズ中に生成した個体をそのフェーズの新たな行動対象へ追加しない。Player Turn Start配置ならそのターン終了の敵フェーズから行動する。

期限・報酬・未達成結果を常時参照可能にし、残り5ターン以内はWarning、Turn10はCritical。期限切れの通知と不可視位置での実生成通知を分ける。HiddenのPack位置やpending候補は公開しない。

`rewardDeadlineTurn`, `rewardState`, `failureSpawnState`, `rewardUnitType`, `failureUnitType` と施設ごとの条件をConfig/Stateへ集約する。

## 6. 空軍基地のMap配置

複数の明示的候補からSeeded RNGで1地点を選ぶ。陸軍基地・他施設・Horde Spawn Reserveと重複不可、Groundから到達可能、Road Access生成可能、Initial Zombieの視界外であること。

全候補について、初期の地上部隊が地形・経路上はTurn10 Player行動終了までに到達可能とする。検証では通常の移動MP・地形コスト・初期燃料とその移動制約を使い、初期部隊からの到達経路を確認する。後から生産したヘリを到達保証に使用しない。敵の妨害や確保戦闘の成功、原発との同時確保は保証しない。

両軍事基地の位置を先に確定してから初期Zombie候補を作る。各Zombieの実Visionを用いて両基地の視認を除外し、州都安全距離・初期Human/施設占有・地形制約も維持する。配置・道路・ZombieのRNG順を固定し、Seed検証関数へAir Baseを追加する。Fixed Map ID、Schema、Validationを更新する。

## 7. 軍用ドローン

Actionは `LaunchMilitaryDrone`。発進元の空軍基地をPlayerが所有し、通常稼働・感染等による機能停止なし、給電あり、Supply接続あり、Activeな軍用Drone Visionなし、必要な国家燃料を支払えることを必要とする。

Targetはマップ内の任意Hexで、距離・既探索条件を設けない。燃料費は **hexDistance(空軍基地, Target)×5** を国家備蓄から即時消費する。基地と同Hexなら0。基地専用プールやヘリの燃料から引かない。

Target中心のHex距離10以内にTemporary Visionを設け、地形遮蔽を無視して通常Player Visibilityへ統合する。範囲内のTile・施設・敵は通常の可視情報として公開するが、未公開Wave編成や可視化だけでは開示されない内部情報は公開しない。Droneは盤面上の戦闘Unitではなく、占有・攻撃・迎撃の対象にしない。

発進ターンを含む5 Player Turn。T20発進ならT20～T24と対応する敵フェーズ中に有効、T25 Player Turn Startで失効し再発進可能になる。有効中の重ね掛け・位置変更は不可。発進後は基地が陥落しても期限まで維持する。給電・Supplyの発進条件は発進時の条件であり、飛行中の毎ターン維持条件ではない。

Previewは `target`, `distance`, `fuelCost`, `currentFuel`, `resultingFuel`, `visionRadius`, `activeThroughTurn`, `legal`, `reasonCode`。公開状態は `active`, `sourceFacilityId`, `center`, `radius`, `startedTurn`, `expiresBeforeTurn`, `relaunchAvailable` を含める。

## 8. 多目的ヘリコプターの生産・能力

内部Unit Typeは `multipurposeHelicopter`。空軍基地でのみ生産する。

| 項目 | 値 |
| --- | ---: |
| 生産人口 | 2 |
| 生産民需品 | 100 |
| 生産軍需品 | 140（初期搭載40を含む） |
| 生産燃料 | 500（初期搭載500を含む） |
| 生産時間 | 1ターン |
| 生涯生産上限 | 1機 |
| 初期状態 / 熟練度 | landed / Recruit |
| HP | 100 |
| Recruit ATK | 13 |
| Regular / Veteran ATK | 17 / 17（共通1.25倍・切上げ） |
| Recruit / Regular / Veteran攻撃権 | 1 / 1 / 2（共通規則） |
| 射程 | 2 |
| 視界 | 10 |
| 軍需品プール / 燃料プール | 40 / 500 |
| 飛行中MP / 着陸中MP | 50 / 0 |
| 飛行移動費 | 1MP/Hex、燃料5/MP |
| 飛行状態でのTurn終了燃料 | 1 |
| 固定軍需品維持費 | 1/ターン、両状態共通 |
| 攻撃軍需品・距離0～1 / 距離2 | 2 / 4 |
| 攻撃騒音 / 飛行Turn終了騒音 | 半径8 / 半径15 |
| 歩兵搭載量 | 最大1 Unit（人数制限ではない） |

発注時に費用を支払い、完成時に燃料500・軍需品40を再徴収せず搭載する。人口供出・生産予約・電力・配置待ちは既存の軍事基地生産規則を使う。地上の合法配置先が塞がれば支払い・人口・枠を保持して配置待ち。実際に配備されたときに生涯生産数へ一度だけ加算する。

予約・配置待ちも生涯枠を占め、配備後の死亡では戻らない。配備前の基地陥落等による没収は既存共通機構どおり予約枠を解除し、完成済み数へ加えない。独自の返金は追加しない。二重計上を防ぎ、上限reasonCodeは `lifetime_production_limit_reached`。

通常Humanの昇格条件・反映時点・攻撃権共有へ参加する。施設確保・施設復旧・検問所復旧・感染鎮圧・自動鎮圧・封じ込めは両状態とも不可。費用を巨大化して疑似禁止するのではなくCapabilityで表す。

## 9. 飛行・占有・戦闘・補給

### 9.1 状態と行動順

`flightState = landed | airborne` を砲のpacked/deployedと分離し、`TakeOff`, `Land` を追加する。

| 状況 | 許可 / 制限 |
| --- | --- |
| 着陸状態から開始 | 搭乗→離陸→移動→攻撃を許可。順序ごとの通常条件は必要 |
| 同Turnに離陸した | 通常着陸不可。緊急着陸だけ例外 |
| 飛行状態から開始 | 移動→着陸→降機を許可（そのTurnに搭乗した歩兵は降機不可） |
| 飛行中に攻撃 | その後の移動不可。その場での着陸は、同Turn離陸でなければ可能 |
| 同Turnに着陸した | 通常・緊急を問わず再離陸不可 |
| 燃料0で着陸中 | 離陸不可。搭乗時燃料移送等で正の燃料を得れば他条件に従う |

離着陸自体の追加燃料費や攻撃権消費は設けない。離陸で攻撃済み制限・移動消費・攻撃権がリセットされない。`tookOffTurn` に加え、そのTurnの着陸履歴等を保存し、Save/LoadやActionの順序で制約を迂回できないようにする。通常のWait等の既存行動制限も維持する。

### 9.2 地上・空中占有

`MovementDomain = ground | air`。搭乗中Unitを占有から除外し、Ground Layerは原則1 Unit、飛行中のヘリはGround Unit・Zombieと同Hexに存在可能。着陸ヘリはGround Layerを占有し、味方・敵Ground UnitのいるHexへ着陸不可。

飛行移動は地形を問わず1Hex=1MP。Forest/Mountain/Water・地上占有を越え、施設上空に滞在できる。Map外への移動不可。着陸先は既存Player Groundの地形・占有制約に従い、水面不可、橋はGroundとして判定する。

`isAirborne`, `isInfantry`, `canTargetAir`, `occupiesGroundLayer`, `canOccupyGroundHex`, `canOccupyAirHex` 等を共通化する。単一Unit取得を全Layerへ流用しない。航空機複数同時存在のルール拡張は今回の対象外だが、地上Unitとの選択・描画・Target IDを取り違えない。

### 9.3 攻撃・防御・視界

飛行中は距離0～2へ自発的攻撃・反撃・迎撃が可能。着陸中は自発的攻撃不可、反撃・迎撃のみ可能。必要軍需品未満なら、どの攻撃形態も不成立・消費なし。近距離不足時の低威力攻撃はヘリに適用しない。

対空不可Zombieは飛行ヘリへ反撃・迎撃できない。Hunter / Packは同Hexを含め通常の攻撃権等の条件で対空攻撃できる。

飛行中は地形防御補正なし、野戦砲の直撃・隣接爆風とGas死亡爆発のUnit被害対象外。着陸中は通常の地上補正・両範囲被害を受ける。搭乗歩兵を独立した範囲被害対象へ数えない。ヘリ破壊時の搭乗歩兵死亡は第11章で処理する。

飛行中の視界10は地形遮蔽を無視し、着陸中は視界10の通常Ground視界規則に従う。離着陸後はVisibilityを即時再計算する。地上施設の内部状態公開等のFoW境界は変えない。

### 9.4 補給・回復・騒音

ヘリの燃料・軍需補給は **着陸中かつSupply内**で、既存補給処理のタイミング・国家在庫・配分規則に従う。着陸Actionだけで即時満タンにはしない。飛行中はSupply上空でも補給不可。

自然回復は着陸中だけ可能とし、その他の補給条件・通常回復と無行動回復の区別等は現行規則を使う。離着陸を行動として記録し、無行動を偽装しない。固定軍需維持費1は既存と同様に自Unitプールから可能量を消費し、0のとき負数にしない。

攻撃・反撃・迎撃は既存の戦闘騒音発生規則で半径8。Player Turn終了時、飛行中なら移動・攻撃の有無を問わず現在Hex中心の半径15の騒音を出す。着陸中にはこの終了時騒音を出さない。通常Zombieの騒音反応とFallen Site Noise Respawnに接続し、不可視の反応を公開しない。

## 10. 燃料枯渇・緊急着陸

### 10.1 発生契機

飛行移動の各Hexで燃料を消費し、0になったHexで残りの経路を中断して直ちに緊急着陸を解決する。残燃料1～4でも1Hexの移動を許可し、全残燃料を消費して移動先で解決する。燃料0からの追加移動・離陸は不可。

Player Turn終了時は **飛行騒音→燃料1消費→0なら緊急着陸**。通常の敵行動を始める前に解決する。移動で既に着陸・死亡した機体へ終了時燃料を二重消費しない。強制着陸は同Turn離陸後でも許可するが、そのTurnの再離陸は禁止。

### 10.2 着陸先の決定

1. 現在Hexが合法な空きGround着陸先なら、その場へ強制着陸する。
2. 現在Hexが味方・敵で占有済み、水面、その他Ground着陸不能なら、隣接6Hexのマップ内・Ground着陸可能・Ground占有なしの候補を列挙する。
3. 候補があれば安定座標順の集合からGameplay Seeded RNGで一様に1Hexを選び、そこへ強制着陸する。これは0燃料で通常移動するActionではなく、緊急着陸の配置解決であり追加燃料を要求しない。
4. 候補がなければヘリを破壊し、搭乗歩兵も死亡する。元Hexにいる地上の味方は無傷。
5. 候補なしで元HexにZombieがいる場合は、そのZombieも撃破する。生存HPに応じた通常射撃ではなくドラフトの衝突結果を維持する。

安全な強制着陸だけでは追加HP損失を設けない。衝突で死亡するZombieのGas爆発等は既存死亡Lifecycleへ接続し、ヘリ・搭乗歩兵・敵の死亡統計を各1回だけ計上する。非攻撃Actionの衝突死を通常射撃の撃破として経験値へ重複加算しない。

Previewは緊急着陸リスク、`possibleEmergencyLandingHexes`, `noSafeLandingPossible` 等を公開範囲で示す。不可視Ground占有による結果は確定安全と断言せず、未知の可能性を示す。RNGの実選択先や不可視敵の存在を漏らさない。実行乱数の候補選択・結果は内部Replayで再現する。

## 11. 歩兵輸送・燃料移送・死亡

### 11.1 共通輸送状態

`infantry` CapabilityをPolice / Riot Police / nationalGuard / Recon Team / Special Forcesへ付与する。野戦砲・ヘリは対象外。ヘリは人数によらず最大1 Unitを搭載する。

Unit Identity・熟練度・HP・物資・統計上の所属は維持し、搭乗歩兵を独立したMap Occupancyから除外する。独立Vision、独立Supply判定、Target化、Move/Attack/Suppress等の行動、反撃・迎撃・封じ込めを停止する。人口・通常維持費・固定軍需維持費は継続し、補給・自然回復は停止する。ヘリ自身の死亡人口2と搭乗歩兵人口を二重計上しない。

### 11.2 BoardAircraft

Playerの着陸中ヘリ、空きCargo Slot、隣接1HexのPlayer歩兵を指定する。歩兵は未行動または移動のみを行った状態で搭乗可能。攻撃・鎮圧等の後、降機後など既存の行動済み状態では不可。移動力を使い切って隣接した場合も「移動後の搭乗」として扱う。

歩兵の残りの行動を消費し、独立操作不能にする。ヘリの移動力や攻撃権は搭乗だけでは消費しない。ヘリ自身が通常の離陸条件を満たせば **Board→TakeOff→Move** が可能。

### 11.3 搭乗時の燃料移送

歩兵搭載可能な輸送Unitすべてへ共通の処理とし、今回のヘリに適用する。**搭乗直前の輸送先燃料が0の場合のみ**、歩兵の燃料を輸送先容量まで移す。

移送量 = `min(歩兵の現在燃料, 輸送先の最大燃料)`。歩兵から同量を減らし、輸送先へ加える。余りは歩兵が保持する。輸送先燃料が正なら移送0。燃料0の歩兵も、他条件を満たせば搭乗可能で移送量は0。

国家備蓄・Supplyを使う通常補給とは別の、搭乗Action内の燃料保存的な移送とする。Supply外でも成立する。既に搭乗中の歩兵から自動・任意に再移送するActionは追加しない。降機時の自動返却も設けない。

燃料を得たヘリは通常の離陸条件を満たせば同Turnに離陸可能。ただし同Turnに通常着陸・緊急着陸したヘリは次Turnまで不可。失敗した搭乗Actionで燃料だけが動くことを禁止する。

### 11.4 DisembarkAircraft

着陸中でCargoを持つヘリから、隣接1Hexの合法なGround配置先を指定する。**搭乗したTurn中は降機不可**。降機先がなければ状態を変えず拒否する。

reasonCodeは少なくとも `aircraft_not_landed`, `aircraft_has_no_cargo`, `disembark_destination_out_of_bounds`, `disembark_destination_occupied`, `disembark_destination_enemy_occupied`, `disembark_destination_impassable`, `disembark_destination_player_occupancy_forbidden`。同Turn搭乗、非隣接等の不成立も具体的に区別する。

降機歩兵はそのTurnの移動・自発的攻撃・鎮圧等不可、次Player Turn Startから通常行動へ戻る。ただし**直後の敵フェーズの反撃・迎撃は可能**。残軍需・共有攻撃権など通常条件は必要で、乗降によって攻撃権を新規付与・増殖させない。搭乗中も既存のターン更新における残量補充規則と整合し、独立した攻撃は許可しない。

### 11.5 ヘリ破壊と再アニメーション

ヘリ本体は死因を問わず再アニメーションしない。乗員人口2の死亡は計上するが、ヘリ由来のSoldier Zombie等を追加しない。

Cargoがあれば同時に死亡し、Unit Catalogの既存対応を使う。

| 搭乗歩兵 | 再アニメーション先 |
| --- | --- |
| Police | Police Zombie |
| Riot Police | Riot Zombie |
| Soldier / Recon Team | Soldier Zombie |
| Special Forces | Pack Zombie |

**橋ではない水面での破壊は、搭乗歩兵が死亡してもZombieを出現させない。** 水上での撃墜・安全な緊急着陸先がなく墜落した場合を同じ扱いにする。水上から隣接Groundへ緊急着陸して生存した場合は死亡処理を行わない。

地上の死亡Hexが合法で空きならそこで生成し、占有されていれば最寄り合法Ground Hexへ既存の安定順で配置する。空きがなければ再アニメーションの出現権をpendingで保持し、後続Player Turn Startに再試行する。pending時点で元歩兵の死亡を計上済みとし、実出現で再計上しない。Save/Load・Replayでも出現権を失わず、重複生成しない。不可視のpendingを公開しない。

生じる個体の行動開始・施設感染・Gas連鎖等は既存Lifecycleを使う。死亡中の搭乗参照を確実に解除し、死体・pending・新Zombieが同じ人口を同時所有しない。

## 12. 組み込みAI

Balanced等の運用AIに、空軍基地確保、Drone偵察、ヘリ生産・離着陸・戦闘・補給・歩兵輸送・燃料救援の判断を追加する。単に合法Action一覧へ追加するだけでは完了としない。Random Agentも追加Actionを共通合法手として扱う。

公開情報だけで、燃料と着陸先、Hunter/Pack、歩兵の役割、施設確保期限、軍需経済、搭乗・降機の行動制限を評価する。航空機自体を確保・鎮圧役として評価せず、必要な歩兵を運ぶ。見えていない安全着陸先・敵・未来のRNGを既知として扱わない。

Droneは偵察範囲・燃料費・有効期間・既存視界の重複を評価し、Active中に再発進を試みない。組み込みAIで実際の輸送と偵察が成立する再現可能なシナリオを設ける。生涯1機や補給不能で技術的ループ・無効Action連発を起こさない。確定バランス下の勝利だけを合格条件にはしない。

## 13. 公開状態・Preview・UI

ヘリObservationには `flightState`, `movementDomain`, `currentFuel`, `maxFuel`, `currentMilitaryGoods`, `maxMilitaryGoods`, `cargoUnitId`, `cargoUnitType`, `canTakeOff`, `canLand`, `canBoard`, `canDisembark`, `canRefuel`, `canResupplyMilitaryGoods` と不成立理由・生涯枠を公開する。Cargo側は `transportedByUnitId` と残物資を公開する。搭乗歩兵を別の地上座標に残っているように表示しない。

| Action / Query | 追加Preview・表示 |
| --- | --- |
| TakeOff | legal/reasonCode、結果Flight State/MP、同Turn通常着陸不可、燃料 |
| Land | 合法性、地上占有、結果状態、補給・回復資格、同Turn再離陸不可 |
| Move | 地形非依存コスト、燃料、経路途中の燃料枯渇位置と強制中断リスク |
| BoardAircraft | 搭乗者、結果Cargo、行動消費、燃料移送量と両者の前後残量、同Turn降機不可 |
| DisembarkAircraft | 隣接先と不成立理由、降機者の行動禁止と反撃・迎撃可能の区別 |
| LaunchMilitaryDrone | 第7章の費用・期間・視界・給電/供給条件 |
| ProduceUnit | 第2章の費用・予約・配置見込み・生涯枠 |
| EndTurn | 飛行燃料1、終了時騒音、緊急着陸リスク、Cargo維持、次TurnのDrone失効 |

着陸先・砲撃着弾等の未確定乱数は確定値で出さず、読取処理はLive RNGを進めない。Flying/Ground同Hexの双方を選択でき、Unit IDで操作対象を明確にする。モバイル縦画面でも搭乗者選択・降機先・Drone照準・騒音/視界・燃料不足を確認できる。通常画面と外部AIだけの機能差を作らない。

Helpは勝敗、経済と人口、電力、施設、人間Unit、Zombie、補給、視界と騒音、Horde、建設、AI/Fair Playへ整理する。ルール説明はHelp、盤面の見た目はBoard Legendに置く。野戦砲Packed/Deployed、空軍基地、ヘリLanded/Airborne、Drone視界をLegendで説明する。同じ長文を両方へ重複掲載しない。日本語/英語を整合させる。

## 14. アセット制作

本書確定後、同じタスクで次の**3枚**を生成し、依頼者が見た目を確認・採用した原本をゲーム用素材へ加工する。生成済みと承認済みを混同しない。

| Asset ID | 要件 |
| --- | --- |
| `facility_air_base` | 陸軍基地と識別可能。滑走路を必ず視認でき、小さい盤面表示でも航空基地と分かる |
| `unit_multipurpose_helicopter_landed` | ブラックホークをモチーフにした独自の中型軍用ヘリ。地面へ接地し、脚と地上姿勢が明瞭。主ローター完全停止・静止した羽根 |
| `unit_multipurpose_helicopter_airborne` | 同じ機体の飛行姿勢。主ローター回転・適度なブラーで飛行中と一目で区別 |

既存Assetの画風・視点・方向・盤面表示サイズ・透過PNG規約を確認して合わせる。実在機の厳密な複製や不要な文字・ロゴを追加しない。原本・実際のプロンプト・採用状態を `Art/reference/v1.6.5-concepts/` に記録する。画像未承認でも要件自体は確定として扱うが、最終採用アセットの組込み完了とはしない。

描画用Registry/ResolverをNormal Game、Replay、WebMCP Live Viewerで共有し、Flight Stateから対応画像を選ぶ。Cargo表示やDrone Vision範囲は共通Rendererで扱う。小縮尺・FoW・低ZoomのFallbackを維持する。

生成候補は `facility_air_base_candidate_v1.png`、`unit_multipurpose_helicopter_landed_candidate_v1.png`、`unit_multipurpose_helicopter_airborne_candidate_v2.png`。いずれも上記保存ディレクトリ内にあり、現時点では見た目確認待ち。制作記録は同ディレクトリの `README.md` / `prompts.json` を参照する。

## 15. Config・State・Version・Replay

少なくともFacility airBase、期限付きObjective、Human multipurposeHelicopter、Movement Domain、対空・歩兵・輸送Capability、Flight State、同Turn離着陸/搭乗履歴、双方向Cargo参照、生涯生産/予約数、Temporary Vision、再アニメーションpendingを保存・検証する。Unitを別ObjectにコピーしてIDを失わず、輸送中と地上配置の両方に数えない。

Configへ生産費・生涯上限・飛行移動/燃料・終了燃料・状態別攻撃制限・輸送・騒音・Objective期限・Drone費用/半径/期間を置く。将来の輸送Unitでも搭乗時燃料移送を共有できるようにする。

Map生成、Wave抽選、緊急着陸選択、既存Zombie AI tie-break等のGameplay RNGはCoreだけが消費する。安定列挙順を定め、同Seed/Config/Action列、Save復帰、Checkpoint分岐、Replayで状態Digestが一致すること。

内部ReplayはObjective、Drone発進/失効、離着陸、移動/燃料、緊急着陸、搭乗/降機、燃料移送、Cargo死亡/再アニメーションpending、終了時騒音を再現する。公開Artifact/Event/Viewerは既存の秘匿Projectionを通し、Hiddenの反応・死亡・出現待ち先を漏らさない。

APP_VERSIONは1.6.5。Rules / Fixed Map / Save / Action / Agent / Observation / Bridge / Artifact / Checkpoint / Session等の変更Versionを実装時に一覧化し、生産側と利用側を合わせる。変更しないProtocolは理由を確認する。

v1.6.4以前のSave / Replay / Session / Checkpoint / Artifactは互換変換しない。理由付きで拒否し、新規v1.6.5ゲームを案内する。旧データは削除・上書きしない。`nationalGuard`の内部ID維持とは別の互換方針である。

## 16. 必須検証・受入条件

本書は実装テストの要件であり、以下を実行済みと記載するものではない。開発中は変更範囲へ絞り、仕上げは今回のCore・Schema・UI・保存を横断する変更に必要な全体回帰を1回行う。同じ差分で成功した全体回帰を根拠なく繰り返さない。

| 領域 | 必須の受入条件 |
| --- | --- |
| 生産Query | 費用/人口/枠/施設/配置理由を実Actionと一致させ、全候補から隠し情報を漏らさない。生涯上限の専用reasonCode |
| 人口Preview | 複数City/Capital/Housingへの減員先・人数・前後差分と実適用の一致 |
| Enemy Query | 可視Enemyのみ、攻撃権残量再取得、視界失効後の除外、可視の実Blockerだけを全件公開 |
| Batch Preview | 同一Revisionで独立結果、入力対応、違法項目、競合拒否、State/RNG/Sequence/Revision不変 |
| 攻撃候補 | 全Unit/単体指定、可視敵/砲撃Hex、搭乗/着陸制限、個別Validation一致 |
| 仮設住宅 | 0人/10人、停電/供給状態でも民需生産0。Forecast/Capacity/Help/APIの寄与0、維持費は継続 |
| 電力・経済 | 表の全要求電力、0の維持、発電不変、軍需工場2:1、入力不足、基地生産/Drone給電、全軍需消費系統 |
| Wave | 方向数維持、9/9/17/14/18、固定枠維持、Weight合計100、Hunter/Gas同方向複数可、Riot上限維持、拒否枠・Normal正規化・Final Pack維持 |
| Map | 空軍基地1基、重複/Reserve回避、両基地の初期Zombie視界除外、各候補の期限内地上到達、Seed決定性 |
| 原発 | T10行動中の確保可/T11失効、生存者なしの現行報酬、確保後喪失でPackなし |
| 空軍基地 | 防衛・資源報酬、健康生存者/陥落歴による特殊部隊報酬、全滅後期限内確保で期限Pack回避、陥落予約は維持、二重Packなし |
| Objective保存 | 両報酬独立、Supply外確保、占有Fallback、全候補閉塞pending、期限後再試行、援軍人口一度、Save/Load、Hidden境界 |
| Drone | 任意Hex/同Hex燃料0/距離×5、国家備蓄消費、給電/供給/施設条件、遮蔽無視半径10、T20～24有効/T25失効、Active拒否、基地陥落後維持 |
| ヘリ生産 | 人口2/民需100/軍需140/燃料500/1Turn、初期40/500と二重徴収なし、着陸Recruit、予約/没収/配置待ち/死亡/Loadを含む生涯1 |
| ヘリ能力 | HP100、ATK13/17、射程2、視界10、MP50/0、攻撃権1/1/2、全確保/復旧/鎮圧/封じ込め不可 |
| 状態順序 | 離陸→移動→攻撃、同Turn通常着陸拒否、飛行開始→攻撃→その場着陸可、攻撃後移動不可、着陸後再離陸不可、Loadで制約維持 |
| 占有・移動 | Ground同居可/Airborneのみ、地上友軍/敵/水面への着陸拒否、橋許可、地形1MP、Map外拒否、Layer別選択 |
| 対空 | Hunter/Pack距離0～1の攻撃/反撃/迎撃、他Zombieは飛行本体非対象、騒音地点へ移動、着陸ヘリは全Zombie対象 |
| ヘリ戦闘 | 飛行距離0～2、MG2/4必要、不足時は全攻撃形態不可、着陸自発攻撃不可/反撃迎撃可、昇格と共有Charge |
| 被害・視界 | 飛行地形補正なし/砲撃直撃爆風Gas免疫、着陸通常被害、飛行遮蔽無視/着陸通常視界、Cargoの重複被害なし |
| 補給・回復 | 着陸+Supply時のみ、Action即時補充なし、飛行中不可、自然回復資格、離着陸行動記録、MG固定維持1 |
| 燃料境界 | 残燃料1/4/5/6、5/MP、1～4で1歩後緊急着陸、経路途中停止、燃料0離陸不可、終了燃料1 |
| 終了騒音 | 飛行のみ半径15、無移動でも発生、攻撃半径8、Noise Respawn/通常Zombie反応、騒音→消費→緊急着陸が敵前に完了 |
| 緊急着陸 | 同Turn離陸例外、空き現在地/味方占有/敵占有/水面/隣接0・1・複数候補、Seed選択、味方無傷、候補なし衝突相打ち |
| 緊急着陸公開 | Live RNG不変、実選択先非予言、不可視占有の非漏洩、リスクと確定結果を区別 |
| 搭乗 | 全5歩兵Type可/砲ヘリ不可、隣接/着陸/空きCargo、移動後可・攻撃鎮圧後不可、移動力使切り後可、ヘリMP不消費 |
| 燃料移送 | 輸送先0時のみ、正なら0移送、歩兵0も搭乗可、容量上限/余り保持/燃料保存、供給網外可、失敗時不変、搭乗済みからの再移送なし |
| 救援離陸 | 前Turnから着陸なら搭乗燃料で即離陸可、同Turn通常/緊急着陸後は不可 |
| Cargo | Unit ID/人口/維持費保持、独立占有/視界/供給/行動/補給/回復なし、双方向参照、Save/Load |
| 降機 | 同Turn搭乗後拒否、隣接合法配置、具体的理由、当Turn自発行動不可/敵Turn反撃迎撃可、共有Charge増殖なし |
| 死亡 | ヘリ単体Zombieなし、Cargoも死亡、Type別既存再アニメーション、水面なし/橋はGround、占有Fallback/全閉塞pending、統計一度 |
| Lifecycle | Gas衝突死亡・連鎖・施設感染・死亡中参照解除、新規Zombieの同フェーズ行動禁止、pending復帰重複なし |
| 組み込みAI | 実際の生産/空中戦/着陸補給/輸送/Drone/燃料救援、期限と生涯枠、Hidden非使用、無効Action連発なし |
| UI・アセット | PC/モバイル、日英、Ground/Air重なり選択、滑走路、静止/回転ローター、Cargo/Drone表示、Help/Legend分離、3Viewer共通描画 |
| 保存・互換 | 新State/Config完全検証、同Seed/Action/Save復帰/Replay Digest一致、旧Version理由付き拒否、旧データ保全 |

型検査・本番Build・必要な回帰テスト、ローカルのBrowser Bridge/WebMCP Live・Replay動作、組み込みAIプレイテストを行う。自然プレイで出にくい輸送・緊急着陸・閉塞・失効は、公開Actionで構築したシナリオまたはCoreの仕様テストで補う。実行範囲・成功・失敗・skip・未実行を分けて記録する。

既存不具合の修正は、該当入力で修正前失敗→修正後成功を確認する。もともと正常な経路は回帰保証と記載し、失敗を確認できなかったものを再現済みとしない。期待値だけの変更、恒真assert、対象のモック化、検証削除/skipで成功扱いにしない。

## 17. 実装順序・文書管理

推奨順序: APIの理由伝播と候補/Batch Preview → 経済/電力/Horde → Movement Domain/占有/Capability → Objective/Map/空軍基地 → Drone → ヘリ生産/飛行/燃料/戦闘/緊急着陸 → 輸送/燃料移送/死亡 → 組み込みAI → 公開状態/UI/採用アセット/Help → 保存/Replay/回帰/ローカル動作確認 → 現行仕様反映。

v1.6.4確定要件は現行仕様へ反映済みのため `Doc/archive/` へ移動する。v1.6.5ドラフトは本書への統合後、回答記録とともにarchiveへ移し、履歴資料とする。Doc直下には現行仕様と本確定要件を残す。現行仕様は実装・検証完了までv1.6.4を維持する。

### 付記: 回答の反映先

| 回答 | 主な反映箇所 |
| --- | --- |
| 1～6 | 第9章 状態別戦闘・離着陸、第10章 緊急着陸例外 |
| 7～13 | 第10章 燃料境界/緊急着陸、第11.3章 搭乗燃料移送 |
| 14～19 | 第8～9章 Capability、距離0攻撃、範囲被害、地形、視界、回復 |
| 20～23 | 第11章 Cargo維持、降機反撃、同Turn降機禁止、水上再アニメーションなし |
| 24～29 | 第4章 騒音、第5章 空軍基地報酬、第7章 Drone維持/発進条件 |
| 30～34 | 第4章 Weight/Hunter上限撤廃、第8～9章 生産/軍需、第12章 組み込みAI |
| 35～39 | 第5章 原発/空軍基地条件、第8章 維持費、第6章 到達性、第11.5章 配置待ち |
