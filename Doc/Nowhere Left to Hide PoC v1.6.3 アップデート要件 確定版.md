# Nowhere Left to Hide PoC v1.6.3 アップデート要件 確定版

- ステータス: **実装・アセット組込み・ローカル検証・現行仕様への反映済み。配信対象CommitのPages/Portable検証をリリース完了条件とする。**
- 作成日・確定日: 2026-09-20
- 基準: v1.6.2 / main commit `821446dc508a1530f8d216fa9806dedcacd31ada`
- 根拠: v1.6.3ドラフト、現行仕様v1.6.2、依頼者との第1〜52問の回答。
- 本書はv1.6.3の変更部分の実装目標。安定版の唯一の正本は引き続き `Nowhere Left to Hide PoC 現行仕様.md` とする。実装差分を現行仕様18.13へ反映済み。検証範囲とリリース完了条件は同節に記録する。
- 未変更部分は現行仕様に従う。アーカイブしたドラフトや旧要件の競合値を実装根拠にしない。
- アセットは本要件確定後、同じタスクで制作し、その出力を使用する。アセット完成・組込みを本書作成だけで完了扱いにしない。

## 1. 目的・範囲

1. 自発的な人口操作で州都を空にせず、人口の戦略的価値と操作の影響を伝える。
2. 食料・民需品不足を即時の人口削除から段階的な衛生悪化へ変える。食料不足には深さと継続期間に応じた飢餓死亡を残し、微量の生産だけで死亡を永続回避できる仕組みにしない。
3. 検問所の審査を清潔な環境での感染確認・必要な医療として整理し、待機列への対応不足による感染と区別する。
4. 長時間AIプレイに、最新の公開状態から再構成する量に上限のあるContext Handoffを提供する。
5. 小規模な湾、水面・橋、原子力発電所、特殊部隊、Pack Zombieを追加する。

GameAction → GameEngine、CoreとPhaser/UIの分離、公開情報境界、Seed付き決定性、人口保存則、Replay / Artifactを維持する。Forecastと実処理は共通の計算を使う。非公開情報を警告や予測の原因として漏らさない。

対象外: Random Map本体、飛行Unit、独立した医療品Resource、治療Action、Zombie AI全体の再設計、橋へのプレイヤー干渉、外部AIの会話履歴そのものの強制削除・圧縮。タイトルは日本語UIでも **Nowhere Left to Hide** とする。

## 2. 要求一覧

| ID | 必須内容 |
| --- | --- |
| POP-CAP-01 | 自発的な人口操作ではCapitalの健康住民を最低1人残す |
| REF-01 | Normal / Strictの審査拒否を廃止し、残存審査対象者を全員受け入れる |
| REF-02 | Strictは5 Turn、審査由来潜伏感染0 |
| REF-03 | Normalは5%固定、Pass Throughは25%基礎＋補正の1人単位感染判定。実際の受入先で発症 |
| REF-04 | 待機列由来感染の対象・過密人数はwaitingのみ |
| HEALTH-01 | 食料不足蓄積0..7と段階的な飢餓死亡。民需品不足の直接死亡を廃止 |
| HEALTH-02 | 衛生ストレス・都市過密・Housing outageから内部感染確率を計算 |
| HEALTH-03 | Zombie接触・攻撃・Gas爆発による直接感染は既存処理を維持 |
| HEALTH-04 | 生活環境・待機列・審査由来の新規感染の感染拡大を次のTurn終了まで猶予 |
| HEALTH-05 | 発生可能性・原因・確率・猶予・危機の説明と警告をHuman / Agent双方へ提供 |
| OVER-01 | 過密の追加維持費を全国倍率から施設ごとの式へ変更 |
| REFINE-01 | Refinery Allowanceの枯渇前警告 |
| CTX-01 | 5 completed Turnsごと・128 Decisionsごと・手動のHandoff生成 |
| CTX-02 | 最新の公開状態、完全なcanonical history維持、サイズ上限と詳細Query |
| CTX-03 | preferredCommentLocale等のdurable constraintsを毎回再掲 |
| MAP-WATER-01 | WaterはGround進入不可 |
| MAP-BRIDGE-01 | Water＋Roadはcost1のBridge。建設・新設・撤去・破壊不可 |
| MAP-BAY-01 | 固定templateの小規模水域をSeedで4隅から選ぶ |
| FAC-NUC-01 | 水辺のLandへNeutral原発1基。距離と供給延伸負担を検証 |
| FAC-NUC-02 | Supply内必須、5 workers、500 electricity / worker、Fuel消費0 |
| FAC-NUC-03 | Turn20までの初回確保でRegular特殊部隊1隊、満載・即行動可能 |
| FAC-NUC-04 | Turn21開始時まで一度も確保していなければPack1隊 |
| UNIT-SF-01 | 生産不可、Regular3 / Veteran4の共通Attack Charges |
| UNIT-PACK-01 | Attack15×5、特殊部隊の死亡時に死因を問わず再アニメーション |
| UNIT-PACK-02 | 通常抽選には含めず、Final Hordeへ1隊追加。予告は示唆に留める |
| ASSET-01 | 水面・橋・原発・特殊部隊・Packの5種類を既存画風に合わせて制作 |
| COMPAT-01 | 旧Save / Replay / Session / Checkpoint / Artifactを変換せず新規開始を要求 |

## 3. Capital最低1名

- `TransferPopulation`、`AssignWorkers`等のSupply population withdrawal、`ProduceUnit`の人口予約・徴兵、その他Player起因の人口再配置でCapitalを0人にしてはならない。
- 共通withdraw可能数はCapitalについて `max(0, workers - 1)` とする。他の合法Supply Cityから必要人口を確保できる場合は成立させる。既存のwithdraw順序は、この保護分を除いて維持する。
- 保護すると必要人口が足りない場合は `capital_minimum_resident_required` で拒否し、資源・人口・RNG・予約を変化させない。
- 感染、飢餓、敵対Event等の非自発的損失では最後の1人も失われる。Capital健康人口0は合法なStateであり、陥落・敗北は既存条件で判定する。
- 説明: 「州都の行政・避難機能を維持するため、健康な住民を最低1人残す必要があります。」
- 人口操作Previewに `capitalResidents.before / after`、`capitalMinimum = 1`、`capitalResidentDelta`、拒否reason、食料・民需品・衛生リスクの変化を表示する。
- Capital=1はAdvisory、0は既存のCapital exposureと組み合わせCritical。保護が敵や飢餓への無敵化ではないことを明記する。

## 4. 審査・待機列・潜伏感染

### 4.1 審査方針

| Policy | Screening Turns | 審査による受入率 | 審査由来の1人あたり潜伏感染 |
| --- | ---: | ---: | --- |
| Pass Through | 0 | 100% | 基礎25%、4.2の補正あり |
| Normal | 2 | 100% | 5%固定 |
| Strict | 5 | 100% | 0%固定 |
| Deny | 0 | 0% | 審査を実施しない |

`workerRate`は順に1 / 1 / 1 / 0。審査定員は既定20人。方針は審査開始時に固定し、方針変更を進行中Batchへ遡及しない。

審査はある程度清潔な環境で感染を確認し、疑わしい人へ適切な医療を行い、受入可能な健康状態に整える工程。Normalは観察期間が短く一部が残り、Strictは5 Turnの観察・隔離・医療等によって審査由来潜伏感染を0にする。医療は時間と既存Civilian Goodsの抽象表現に含め、独立Resourceや治療Actionを追加しない。

100%受入は「審査不合格による人口除去なし」を意味する。飢餓・待機中感染・Zombie直接感染等の損失まで防ぐ保証ではない。Normal / Strictの審査拒否Counterは増加させず、明示的なTurn Away / Denyによる拒絶だけを既存の将来Horde加算へ渡す。Final roster freeze後のCounter規則は維持する。

### 4.2 Pass Throughの補正

Normalの5%、Strictの0%には混雑・衛生ストレスの補正をかけない。Pass Throughだけ、審査・医療を省略するため次を使う。

```text
Q = clamp(waiting / screeningCapacity - 1, 0, 1)
F = 更新後のpublicHealthStress.food
C = 更新後のpublicHealthStress.civilianGoods
p_pass = clamp(0.25 * (1 + 0.50*Q + 0.75*F + 1.00*C), 0, 0.60)
```

waitingは該当するrelease処理の直前の健康な待機者数。screening / approvedを過密人数へ含めない。未管理支線の素通りは架空のQueueを作らずQ=0とし、F/Cの補正は適用する。Player Turn Startで既に合格した人を配置するだけの場合、潜伏感染を再抽選しない。

### 4.3 発症先・人数

- 各受入先へ実際に配置した人数nについて `Binomial(n, p)` をSeed付きで1回判定し、その受入先の健康人口から同数を感染者へ変換する。
- 複数都市に分けて受け入れた場合は、各都市の実際の受入人数を使う。無関係な所有施設を発症先として抽選する既存方式は廃止する。
- 受入先がなくapprovedとなった分は、当該Checkpoint内で判定する。そのBatchのapproved人数の範囲だけを感染者へ変換し、別Batchやscreening / waitingへ不足分を波及させない。
- 一度判定済みのapprovedを後に都市配置しても再抽選しない。感染者自体を健康な合格者として都市へ送らない。
- 発症後は5.7の猶予を付ける。Strictから受け入れた人も、受入後の生活環境による内部感染は既存住民と同条件で受ける。

### 4.4 待機列の衛生悪化

感染対象・過密人数は **waitingのみ**。審査中・受入先待ちは清潔な管理環境にあり、この衛生悪化判定の対象外とする。Zombieの直接感染や感染者からの既存の感染拡大に対する免疫を与える規則ではない。

```text
rawQ = max(0, waiting / screeningCapacity - 1)
p_wait = clamp(0.01 * rawQ * (1 + 0.50*F + 1.00*C), 0, 0.12)
newWaitingInfected ~ Binomial(waiting, p_wait)
```

F/Cは当EndTurn更新後の値。各Checkpointについて通常の到着・審査・配置処理を終えて残ったwaitingを対象に1回判定する。移設等で残ったRemnantのwaitingも対象とし、同じ人口へ同Turnに二重適用しない。Deny時の既存Queue等は現行の人口保持規則に従う。

衛生ストレス0なら、waiting20人以下は0%、40人1%、60人2%、100人4% / Turn。補正後の上限は12%。既存の固定waitingRiskThreshold=100の段差・旧感染予約との二重判定を廃止する。

感染が判明した人はCheckpoint infectedへ移し、審査で健康人口へ戻さない。審査で対応できる潜伏感染とは区別する。新規感染には5.7の感染拡大猶予を付ける。

## 5. 衛生ストレス・食料不足・内部感染

### 5.1 感染の三層

- **直接Zombie由来**: 接触・攻撃・Gas爆発、既存Unitの再アニメーション、陥落時Spawn等は既存処理を維持する。新規Special Forcesの再アニメーションは第11〜12章。物資や衛生ストレスで直接感染量を減らさない。
- **検問所由来**: 第4章の待機列感染と審査由来潜伏感染。
- **生活環境由来**: Food / Civilian Goods不足、Permanent City過密、Temporary Housing停電による新規内部感染。Exposure meterは追加しない。

### 5.2 不足率

```text
foodDeficit = maintenanceRequiredFood > 0
  ? clamp(foodMaintenanceShortage / maintenanceRequiredFood, 0, 1) : 0
cgDeficit = maintenanceRequiredCG > 0
  ? clamp(civilianGoodsMaintenanceShortage / maintenanceRequiredCG, 0, 1) : 0
```

不足量はそのTurnの備蓄と実際に利用できる生産を維持需要へ充当した後の未充足分。過密・Housing outageの追加維持費を含む。Military Factory入力不足はcgDeficitへ含めない。維持予約と生産・入力配分は現行のForecast共通処理を利用する。

感染者は従来どおり食料・民需品の通常維持消費・飢餓死亡の対象外。Unit人口は飢餓対象外。過密の占有人数と追加費用は第6章の別計算であり、感染者に通常維持費を新設するものではない。

### 5.3 衛生ストレス

GameStateに `publicHealthStress.food / civilianGoods` を保持し、初期値0、範囲0..1とする。

```text
S_next = clamp(0.75 * S_current + 0.40 * deficitRatio, 0, 1)
```

不足計算後に同じEndTurn内で更新し、そのTurnの各確率へ反映する。生産0で即座に1へ跳ね上げる例外は設けない。供給が足りれば毎Turn25%ずつ減衰する。食料の飢餓用蓄積とは別の値である。

### 5.4 食料不足蓄積と飢餓

GameStateに食料不足蓄積Aを保持し、初期値0、下限0、上限7とする。

```text
A_next = foodDeficit > 0
  ? min(7, A_current + foodDeficit)
  : max(0, A_current - 0.5)

starvationRate = foodDeficit > 0
  ? min(0.10, foodDeficit * max(0, A_next - 2) * 0.02)
  : 0
```

- 更新後Aが2を超えた不足Turnから死亡率が正になる。A=0から不足率一定なら100%不足は3Turn目、50%は5Turn目、25%は9Turn目。端数繰越のため、実人数の最初の死亡は人口によって後になる。
- 全量供給できたTurnは直接死亡を止め、Aを0.5減らす。最大14Turnの十分な供給で0に戻る。一部でも不足なら回復させず不足率を加える。
- 生産が1以上あっても例外にしない。必要100・供給1なら不足率99%として蓄積する。
- Civilian Goods不足による直接死亡は廃止する。民需品不足は衛生悪化・感染を通じて被害を生む。
- 食料生産0でも直ちに従来の不足人数死亡へ戻さない。

### 5.5 飢餓死亡人数・配分

対象はPlayer所有施設の健康な住民・労働者、および維持対象のCheckpoint waiting / screening / approved。感染者、Unit、未受入の州外人口は含めない。その経済フェーズで維持対象になった人口にだけ適用し、後の避難民フェーズで到着する人へ過去の食料不足を遡及しない。

細部は次の決定的な共通規則で実装する。

1. 飢餓適用直前の対象健康人口合計をNとする。鎮圧等で既に失われた人口は含めない。
2. 国家単位の端数carryを初期0で保持する。死亡率が正なら `raw = N * starvationRate + carry`、`loss = min(N, floor(raw))`、`carry = raw - floor(raw)` とする。
3. lossを各対象Poolの健康人口比で配分する。比例配分の整数部分を先に割り当て、残数は剰余降順、同値は安定した対象ID・Pool順で割り当てる。実人口を超えず、合計lossと一致させる。
4. 死亡率0のTurnは死亡なし、carryを保持する。対象人口N=0ならcarry=0。carryは0以上1未満でSave / Replay対象。施設ごとの切り上げや人口分割・移住による全国端数消失を認めない。
5. 死亡は原因 `starvation` の死亡人口・既存不足損失統計へ一度だけ計上し、感染者やZombieへ変換しない。Capital最後の1人も免除しない。敗北は既存条件どおり判定する。

### 5.6 生活環境由来の新規感染

健康人口のあるPlayer所有Facilityごとに計算する。都市・生産施設・Army Base・原発・Housing等を含み、施設の生産停止中・Supply外という理由だけで感染を免除しない。

```text
O_i = Permanent Capital / CityのovercrowdingPressure (0..1)、他は0
H_i = 入居中Temporary Housingがoutageなら1、他は0
P_i = clamp(0.45*F + 0.65*C + 0.35*O_i + 0.25*H_i, 0, 1)
p_internal_i = 0.03 * P_i^2
newInternalInfected_i ~ Binomial(healthyWorkers_i, p_internal_i)
```

- F/Cは更新後の衛生ストレス。最大1人3% / Turn、P=0なら発生しない。
- 物資不足がなくても、過密だけ・Housing停電だけで発生する。
- 駐留部隊がいても新規感染判定を行う。駐留による既存の感染拡大封じ込めと、自動鎮圧は維持する。
- UnitとCheckpointの3健康Poolにはこの施設用抽選を重ねない。
- 同Turnに都市へ受け入れた健康人口も対象。審査由来感染に変換済みの人数を再抽選しない。
- 変換は健康人口から既存infectedへの移動とし、人口を生成しない。新規感染には5.7の猶予を付ける。

参考: ストレス0・都市人口が定員の2倍なら0.3675%、ストレス0・Housing停電なら0.1875%、CGストレス1のみなら1.2675%、Food/CGとも1なら3%。これは疫学値ではなく初期ゲーム係数である。

### 5.7 新規感染の猶予・既存感染との共存

対象は生活環境由来、待機列由来、Normal / Pass Through潜伏感染。Turn Tに発生した対象感染者は、Turn Tの感染拡大人数の算定から除外し、Turn T+1のEndTurnから含める。

- 健康人口から感染者への変換、感染による施設機能への影響、健康人口0による陥落・敗北判定は即時。生産済みの資源を遡って取り消す意味ではない。
- 陥落条件を満たした場合は、感染者由来Spawn・連鎖を含む既存の陥落処理を猶予で止めない。
- 対象感染者数と感染拡大可能になるTurnを保存し、既存infected合計の内数として管理する。既に感染拡大可能な感染者まで猶予を延長しない。
- 鎮圧・陥落Spawn等で感染者を減らした場合は合計と猶予内数を整合させる。内数の消費順は感染の古い順、同Turn内は安定順とし、感染拡大対象の復活や二重計上を起こさない。
- Zombie接触・攻撃・Gas爆発による直接感染は猶予を追加せず、既存の処理時点・感染量を維持する。
- 猶予終了時も駐留があれば、既存の感染拡大封じ込めを適用する。猶予は直接感染や新たな生活環境由来感染を防ぐ免疫ではない。

### 5.8 EndTurnへの統合順序

既存の大枠を維持し、次の順序をCore・Forecastで一致させる。

1. 経済開始時の維持需要・局所過密・Housing outageを確定。電力・生産・資源配分と不足量を計算する。
2. 衛生ストレスと食料不足蓄積を更新する。
3. 既存の携行軍需消費・補充・自動鎮圧を行い、残存健康人口へ飢餓損失を適用。既存の終局条件を確認する。
4. 避難民到着・審査・受入先への配置・潜伏感染、残waitingの待機列感染を更新後ストレスで処理する。
5. 施設ごとの生活環境由来感染を判定し、既存の内部感染拡大を猶予対象人数を除いて処理する。各感染変換で陥落・Fallback・敗北を既存どおり評価する。
6. 通常Zombie Phase、直接感染、Scheduled Wave / Pending Spawn、最終勝敗判定を既存順序で処理する。

同じフェーズ内はID等の安定順。終局確定時の打切りは現行規則に従う。PreviewはRNGを進めず、確定的な飢餓損失と確率による感染を区別する。先行する確率的変化で後続結果が変わる場合、条件付き予測として示し、確定結果と偽らない。

## 6. 過密の局所維持費

Permanent Capital / Cityごとに次を計算し、全国追加消費は施設ごとの合計とする。

```text
N = healthy workers + infected
C = workerCapacity (>0)
E = max(0, N - C)
R = E / C
extraFood_i = ceil(E * foodPerPerson * 0.50)
extraCivilianGoods_i = ceil(E * civilianGoodsPerPerson * (1 + R))
overcrowdingPressure_i = clamp(R, 0, 1)
```

全国の通常維持費へ都市の超過率合計を乗じる方式は廃止する。Food追加は比較的小さく、CG追加は超過率に応じて非線形に増える。感染者を含む占有による混雑負担と、健康人口だけの通常維持費は別項目で表示する。

Temporary Housingは健康人口＋感染者のHard Cap10を維持し、この過密式の対象外。停電追加維持費は既存の独立計算を維持する。生産施設もHard workerCapacityを維持し過密式の対象外。Forecastに施設別occupancy / capacity / excess / extraFood / extraCivilianGoods / healthPressureを返す。

## 7. Refinery Allowance事前警告

既存の `refinery_allowance_exhausted` を維持し、稼働・給電等を反映した次EndTurn Forecastから次を導出する。

```text
netBurn = max(0, projectedAllowanceUse - projectedAllowanceGain)
estimatedTurnsRemaining = netBurn > 0
  ? floor(currentRemainingAllowance / netBurn) : null
```

- 次EndTurnに正のnetBurnで残量0へ到達するならCritical。
- 上記以外でestimatedTurnsRemainingが3以下ならWarning、4以上ならなし。
- netBurn=0ならrunway警告なし。既に枯渇している停止理由は別のexhausted警告で伝える。
- `refinery_allowance_runway_risk` として残量、予測使用量、Oil Field増分、netBurn、残りTurn目安、稼働Refinery/Oil Field workersを公開する。
- 現在条件を維持した場合の目安であり、未来の稼働・確保・喪失を保証しない。Strategic Forecastも同じ値を使用する。

## 8. Agent Context Handoff

### 8.1 責任範囲・生成条件

ゲームは引継ぎ用の構造化公開データを生成・提供する。外部AIの会話履歴そのものを削除・強制圧縮しない。Callerには引継ぎ後に古いtool全文を再読せず、必要な詳細だけhistory等から取得するよう案内する。

- completed Turn数が5の倍数となった時点で自動生成する。
- 前回の永続化済みContext Checkpointからcanonical Decisionが128件増えた時点でも必ず自動生成する。Turn途中も対象。正式Decision番号が付く拒否は含み、Query / PreviewやrequestId再送は数えない。
- `query --target=context-handoff` で手動生成できる。
- `status` / 新しい`play-turn`開始時はその時点の最新Revisionの公開状態から再構成する。保存済みCheckpointの古い現在状態をそのまま返さない。
- 読取要求や手動生成は自動生成のDecision基点をリセットしない。5Turnと128件が同時なら1つの自動Checkpointに両理由を付ける。

### 8.2 構造

| 項目 | 内容 |
| --- | --- |
| durableConstraints | preferredCommentLocale、Fair Play、公開境界、Session ID / revision / branch lineage、Game / API versions |
| authoritativeState | 最新の公開Turn/phase、資源・人口、Capital、衛生・飢餓、施設・部隊・可視敵の概要、Horde予告、危機、Supply、Allowance |
| recentImportantChanges | 直近の自動Context Checkpoint以降の重要な公開変化。上限付き |
| agentIntent | 最新accepted EndTurnのdecisionSummaryと、重複を除く直近の非空accepted decisionSummary最大5件 |
| historyHint | Revision-pinnedな詳細Query / historyへの導線、省略数、続きの取得方法 |

現在状態は毎回Coreの公開Projectionから生成し、前回の要約を再要約しない。コメントは公開意図であり事実源ではない。private chain-of-thoughtを要求・保存しない。parent branchの分岐後historyを混入させない。

### 8.3 情報量と公開境界

- 施設・部隊・可視敵・重要変化の配列に明示的上限を設け、合計数・返却数・省略数と詳細Queryを返す。上限をschemaで公開し、履歴長に比例して増やさない。
- 差し迫った敗北条件、重大な警告の種類・重大度・対象件数は必須。対象が多い場合は原因別に集約し、危機の存在を省略しない。個別対象の続きはQueryから取得する。
- preferredCommentLocaleとFair Play等の制約は切り捨てない。Human向けコメントとdecisionSummaryをSession全体で指定言語に維持するようHelpへ明記する。
- Hidden Enemy、RNG state、非公開のFinal Pack割当等は含めない。公開Handoffを「Core truth」と呼ぶ場合も非公開State全体を返す意味ではない。

### 8.4 純粋性・保存

State / RNG / Session Revision / Decision番号 / canonical hash chain / Artifactは生成操作で変化させない。HandoffはSessionの派生public payloadとして保存・再生成可能とし、canonical Decision Log、Replay、全history、lineage、checkpoint hashesを削除・改変しない。read-only要求によるキャッシュはcanonical commitと分離する。

## 9. 水面・橋・湾

### 9.1 移動・建設

- `terrain.movementCost.water = null`。全Current UnitのmovementDomainはgroundとし、水面のみのHexへ進入不可。
- WaterにRoad overlayがあるHexはBridge、Ground移動cost1。道路判定をbase terrain nullより先に適用する。
- Player Move、Zombie pathfinding、route / reachable / AI path cost、spawn legality、Preview、Strategic Mapは共通passability helperを使用する。raw terrain nullを直接見てBridgeを拒否する残存コードをなくす。
- WaterもBridgeも施設・Checkpoint・有刺鉄線等の建設不可。移動可能判定をそのまま建設可能判定に流用しない。
- 橋はMap生成時に配置され、Playerによる新設・破壊・撤去等の干渉は対象外。Road overlayを水面の上へ描画する。
- 移動境界はUnit movement domainを受け取れる形にするが、air Unit本体や飛行ルールを追加しない。

### 9.2 水域と原発の距離条件

固定51×51 Mapのtop-left / top-right / bottom-left / bottom-rightから、独立したMap-layout RNGで均等に1方向を選ぶ。固定の不規則な連結水域template1種類を反転・回転して適用する。

- 水域はMap端につながる小規模な湾。マップの大部分を占めない。多少歪でも原発の距離・供給条件を優先する。「内側6〜10 Hex」を固定の制約にしない。
- 原発は初期Supply外とし、かなりのSupply延伸が必要だが、Map端の進入禁止ゾーン直前まで延ばす必要がない位置を選定する。
- 既存の確保・Checkpoint等の合法操作で原発をSupply内へ維持でき、4方向で到達距離とSupply維持負担が概ね等しくなる配置にする。
- Capital、中央幹線交差部、4方向中央Horde Entrance、既存恒久FacilityをWaterで上書きしない。Forest / MountainよりWaterをbaseとして優先する。
- 原発までのLand / Bridge経路を確保する。道路生成によって水域全体が通行可能になる配置にしない。
- Map IDを更新し、Water0という旧validationを廃止。template確定後の期待Water数・連結性・4方向の配置制約を検証する。

座標・水域Hex列は実装時のMap設計成果物として確定する。4方向ごとにCapitalからのHex距離・地上経路cost、必要Supply到達範囲、進入禁止ゾーンまでの余裕、Turn20以内の確保経路例、維持に必要な前線位置を記録する。既存施設やReserveを満たせない場合に黙って施設数を減らさない。

## 10. 原子力発電所

### 10.1 配置・発電

Typeは `nuclearPowerPlant`、1ゲーム1基、Neutralで開始する。選択された湾のWaterに隣接するLand Hexに置き、Spawn Reserveへ置かない。既存施設間・secondary road生成対象へ含め、専用直線道路を追加しない。

初期workers=0 / infected=0、Neutral survivor抽選対象外。workerCapacity=5、500 electricity / worker（最大2500）、Fuel / input Resource消費0、requiresPower=false。

発電はPlayer所有、感染なし、通常稼働、workers>0、**Supply内**の全条件を必要とする。感染・復旧・新規確保等の操作可能時点は既存施設規則に従う。Supply外では発電0とし、停止原因と失う発電量をForecast・警告へ反映する。

Fuel不要の発電Capacityとして既存Power allocationへ統合し、Fuelを消費するPower Plantは無料供給を差し引いた不足分だけを補う。送電経路や電線という新システムは追加しない。原発に新たなSupply源機能や特別な放射能・メルトダウン事故は追加しない。

### 10.2 期限内報酬

- Turn20のPlayer行動終了までに一度でも初回確保すると、Regular Special Forces1隊を獲得する。
- Supply外の確保でも報酬を得る。以後原発を失っても報酬権は維持し、再確保で重複付与しない。
- HP50、Fuel44、MG40、Regular attack charges3、通常の移動・行動権を満タンで付与。国家備蓄から支払わず、そのPlayer Turnから移動・攻撃可能。
- Population5は外部援軍として実際のUnit配置時にcumulativeReinforcementsへ一度だけ加算する。配置待ちは人口を二重に生成しない。
- 原発Hexが空きかつ合法なら優先し、それ以外は最寄りの合法Ground Hexへ配置。同距離は既存の決定的な配置順を使う。BridgeはGroundとして許容し、水面は不可。
- 候補がなければ報酬をpendingとして保持し、以後のPlayer Turn Startに再試行する。期限後でも期限内獲得のpendingを失効させない。配置待ち・獲得済み・失効を保存し、再送・Loadで重複生成しない。

### 10.3 未確保時

Turn21のPlayer Turn Startで一度も確保していなければ報酬をexpiredへ確定し、原発位置へPack Zombie1隊を生成する。占有されていれば最寄り合法Ground Hexへ決定的にfallbackする。全候補が塞がっている場合も生成権を1件保持し、次のPlayer Turn Startで再試行し、消失・重複させない。

Turn21開始時に生成された個体は、Playerの行動機会を挟み、Turn21終了のZombie Phaseから行動する。後日pending配置された場合も、そのPlayer Turn終了のZombie Phaseからとする。Turn21以降の確保では特殊部隊を付与しない。

期限内確保後の喪失ではこのペナルティを発生させない。Hiddenでの実出現は通知せず、Visibleになった時に通常の敵情報として公開する。内部pending状態からHidden位置を推測できる公開Fieldを作らない。

### 10.4 説明・警告

ゲーム開始時から期限と報酬・未達成結果を説明する。プレイヤー向け背景例:

> 原子力発電所は州の電力供給を支える重要施設だ。最後の通信では、精鋭部隊が守備に就いていた。現在、彼らの生死は不明。高い身体能力を持つ者が感染した場合、極めて危険な存在になるおそれがある。

背景に加えて「Turn20までの初回確保で特殊部隊合流」「未確保ならTurn21にPack Zombie出現」を明示する。期限情報は常時参照可能にし、残り5Turn以内はWarning、最終のTurn20はCriticalとして通知する。既に獲得権確定なら期限警告を解除する。期限切れ通知と、Hidden個体の実出現通知を区別する。

## 11. 特殊部隊

Typeは `specialForces`。生産不可、`recruitmentFacilityTypes = []`。Player入手経路は原発の期限内報酬のみ。既存Human Unit共通の移動・戦闘・補給・回復・熟練度を適用する。

| Stat | Value |
| --- | ---: |
| HP | 50 |
| Regular / Veteran Attack | 15 |
| Movement / Range / Vision | 10 / 2 / 5 |
| Population | 5 |
| Regular / Veteran Attack Charges | 3 / 4 |
| Max Fuel / Max MG | 44 / 40 |
| Fixed MG upkeep / Turn | 1 |
| Range1 / Range2 MG cost | 2 / 4 |
| Suppression MG cost | 1 |
| Emergency movement | 2 |
| MG shortage multiplier | 0.2 |
| Suppression civilian damage rate | 0.5 |
| Noise class / radius | medium / 4 |
| Movement domain | ground |
| Reanimation | packZombie |

- 既存式に合わせrecruitAttack=12、Regular倍率1.25で15とする。Recruitで生成する経路は設けない。
- 通常攻撃・反撃・迎撃・自動鎮圧で同じChargesを消費する。攻撃後移動禁止等も既存どおり。既存HumanのRegular1 / Veteran2は維持する。
- 直接Zombie kill5体でVeteran昇格待ちとし、次Player Turn Startで昇格・4Charges補充。同Turn中に追加Chargeを付けない。
- Range1はMG2未満でも残量を全消費し、`max(1, ceil(attack * 0.2))` で攻撃可。Attack15なら3。Range2はMG4未満なら不成立で消費なし。通常攻撃・反撃・迎撃で一致させる。
- 死因を問わずdestroyed時に第12章のPack1隊へ再アニメーション。死亡Unitの残燃料・軍需は返還せず、PackへHP・熟練度・装備残量を継承しない。
- 説明: 「過酷な訓練を耐え抜いた戦闘のエキスパート。敵に対して静かに苛烈な攻撃を加えることができる。」死亡時の脅威も明示する。

## 12. Pack Zombie

Typeは `packZombie`。HP50、Attack15、Movement10、Range1、Vision3、Attack Charges5、ground。既存Normal Zombieのpathfinding / target selectionを利用し、新Target AIは作らない。Wave由来の場合だけ既存wave anchor等を適用する。

### 12.1 戦闘

- 既存の複数回攻撃権と同じ扱いで同一部隊へも攻撃できる。攻撃・反撃・迎撃の既存の消費、死亡・中断条件に従う。Player Turn Startの共通補充でTypeごとの最大値5へ戻し、Zombie Phase開始時に二重補充しない。
- 防御軽減なしなら15×5で最大75 damage。平地でRiot Policeを1Turnで倒し得る脅威として説明する。反撃・迎撃・地形・既消費Charge等によって実際の結果は変わるため、常に75を与える保証とはしない。
- 説明: 「高い知能による連携と高い身体機能で人間を追い詰める。」Visible時のUnit詳細に最大5回攻撃を明示する。

### 12.2 発生経路・行動開始

| 発生経路 | 配置・最初の行動 |
| --- | --- |
| Special Forces死亡 | Unit削除後の死亡Hexに1隊。Player行動中なら次のZombie Phase、Zombie Phase中なら翌TurnのZombie Phaseから |
| 原発の未確保 | 第10.3節。Player Turn Start生成後、そのTurn終了のZombie Phaseから |
| Final Horde | 通常WaveのPending Spawn規則に統合し、出現したWave処理中は行動せず次Zombie Phaseから |

再アニメーション自体は同じAction内に発生させるが、新しい個体の移動・通常攻撃をそのAction中に追加しない。Gas連鎖等の既存の原子的処理と人口・死亡統計を維持し、1 Special Forces→1 Packを専用reasonで計上する。

Periodic weighted roster、specialZombieWeights、Noise / generic random spawn、Rejected refugee bonus slotには含めない。

### 12.3 Final Hordeと公開情報

- 既存Final base compositionの置換ではなく **Pack1隊を追加** する。独立Seeded RNGで4方向から1方向を選ぶ。
- Frozen roster / Pending / committedWaveUnitCount / statistics / Artifact / Final勝利判定へ追加1隊を含める。配置不能でも既存Waveと同様にPendingとして残す。
- Final警告はPackの参加・数・方向を明示しない。例: 「この地域で最後の砦となったと思われる州都へ、各地の感染者が集結している。あらゆる脅威が押し寄せる最後の襲撃に備えよ。」
- ほぼ全バリエーションが含まれることを示唆する表現であり、Pack以外の全Typeを確定で追加する変更ではない。
- AgentのHorde warning、Context Handoff、公開EventにもPack専用の確定予告Fieldを出さない。Type自体の一般説明や原発の明示的ルールは公開可。出現後も個別情報は通常のFoWに従う。

## 13. UI・警告・Forecast・Agent公開

### 13.1 感染の説明は必須

Humanのヘルプ・方針説明・施設/Checkpoint詳細、Agent Help/APIに次を日英で説明する。

- Food / CG不足、過密、Housing outage、waitingの人数、Pass Through / Normalから感染が発生し得ること。
- Normal5%固定、Strict0%、Pass Through補正あり。Strictの安全は審査由来に限り、受入後の生活環境・直接感染を防がないこと。
- waitingだけが待機列環境の感染対象。screening / approvedも飢餓対象であり、既存の直接感染・感染拡大の対象になり得ること。
- 新規の間接感染には翌Turn終了まで感染拡大猶予があるが、人口変換・機能停止・健康人口0の陥落/敗北は即時であること。
- 駐留は既存感染拡大を封じ込めるが、生活環境の新規感染を防がないこと。

### 13.2 現在値と次EndTurn

- 食料不足率、蓄積before/after、閾値2、上限7、死亡率、整数損失・端数、供給回復時の挙動を表示する。
- 衛生ストレスbefore/afterと原因、施設・waiting・審査ごとの対象人数、1人あたり確率、期待人数を示す。期待人数を確定損失や最大人数と混同しない。
- 施設別の過密・停電・物資由来内訳、猶予中感染者数・感染拡大開始Turn、既存感染拡大/鎮圧見込みを分ける。
- 予測時点のRevisionと条件を明示し、同じ表示原因から改善手段（供給回復、人口分散、復電、waiting削減、審査方針）へつなぐ。Hidden情報を原因として追加しない。
- 発生Eventに場所、人数、原因区分、確率と公開の原因内訳を残す。直接感染と衛生由来を同じ曖昧な通知へまとめない。

### 13.3 警告の既定条件

| 条件 | 必須表示 |
| --- | --- |
| 次EndTurnのFood/CG維持不足あり | Warning。不足率と衛生悪化、Foodは飢餓蓄積も表示 |
| 不足解消後もストレスまたは蓄積が残る | Advisoryとして残留リスクと回復を表示 |
| 飢餓死亡率>0 | Critical。端数で当Turn死亡0でも次回以降の危険を明記 |
| 生活環境またはwaiting感染確率>0 | 原因・確率をWarningとして表示。原因別集約可 |
| Normal / Pass Throughを使用 | 方針に潜伏感染確率を常設。基礎リスクを説明し、Pass補正による悪化はWarning |
| 新規感染発生 | 発生通知と猶予、施設停止・陥落等の結果を表示 |
| 少人口施設に感染リスクあり | 初回感染でも健康人口0・陥落/敗北になり得る注意を添える |
| 原発Supply切断・喪失で電力不足が予測される | 電力不足と失う原発出力、停止原因を警告 |

Criticalな既存敗北条件は維持する。確率的な危険だけで既存のEndTurn拒否条件を拡張しない。Toastを毎回連打せず、初回・悪化・解消を通知し、同じ状態中も詳細と警告一覧から参照可能にする。

reason codesは `capital_resident_minimum`、`public_health_food_stress`、`public_health_civilian_goods_stress`、`food_starvation_risk`、`internal_infection_risk`、`checkpoint_health_risk`、`refinery_allowance_runway_risk`、`nuclear_early_capture_window` 等としてschemaへ定義する。文言ではなく型付き事実・Severityでfinite-planの危機悪化判定を行う。

### 13.4 Compact・Preview

CompactではCapital、衛生ストレス・食料蓄積、次EndTurn不足/飢餓、内部感染高リスク施設最大5件と総数/省略数、Checkpoint方針・waiting risk、Allowance、原発報酬状態を優先する。Visible Packは完全statsを公開する。Water / Bridgeの意味はMap/APIから取得可能にする。

人口操作PreviewはCapital保護に加え、維持費・過密・衛生リスクの変化を返す。EndTurn Previewは飢餓と各感染源を別欄で示し、RNGは進めない。有限計画とHandoffも同じ公開危機を使う。

## 14. State・Schema・Version

追加対象はSave、Observation、Agent API、Bridge、Session、Checkpoint、Replay、Artifact、Viewer、Config validation。

- water / derived bridge、movementDomain、nuclearPowerPlant / specialForces / packZombie。
- Type別Attack Charges、原発初回確保/報酬pending/配置済み/失効・failure生成管理。
- publicHealthStress、食料不足蓄積、全国飢餓端数、原因別損失統計。
- 間接感染の猶予人数・感染拡大可能Turn。infected合計と二重計上しない。
- 新しい確率・不足・警告・Handoff Query targetとpayload。

```text
APP_VERSION               1.6.3
GAME_RULES_VERSION        13.0.0
SAVE_FORMAT               20
AGENT_API_VERSION         18.0.0
OBSERVATION_API_VERSION   18.0.0
BRIDGE_API_VERSION        18.0.0
ARTIFACT_SCHEMA_VERSION   17.0.0
CHECKPOINT_SCHEMA_VERSION 14.0.0
SESSION_SCHEMA_VERSION    14.0.0
PLAY_TURN_PROTOCOL_VERSION 1.2.0
AI_SESSION_CONTRACT_VERSION 1.1.0
MAP_ID                    fixed-51x51-v8
```

v1.6.2以前のSave / Replay / Session / Checkpoint / Artifactは互換変換しない。バージョン不一致を理由付きで拒否して新規v1.6.3開始を案内し、旧データを削除・上書きしない。Unknown enumと旧不変条件（Human最大2、非Horde最大1等）を全公開面で更新する。

## 15. 決定性・公開情報・人口保存

- Bay方向、原発failure fallbackのtie-breakが乱数を必要とする場合、Final Pack方向、審査潜伏感染、waiting感染、生活環境感染には独立domain separationを用いる。
- 新しいRNG呼出しだけで無関係な既存のHorde方向・survivor等の乱数列をずらさない。Map変更で候補集合が変わる配置まで旧版一致を保証するものではない。
- BinomialはSeed付きの決定的な実装と安定対象順で処理する。Preview・Query・Handoffは乱数を消費しない。
- 同Seed / Config / Action列でState / Replay / Artifactが一致する。Save復帰・Session branchでも蓄積、端数、猶予、pending報酬、発生済みフラグを完全に保存する。
- 健康→感染→死亡/Spawn変換、援軍5人、飢餓死亡は人口保存則へ一度だけ反映する。
- 非公開のPack割当・位置・RNGを公開予測、通知、Handoff、Production Artifactへ混入させない。内部検証用Replayと公開Artifactの既存境界を維持する。

## 16. アセット・ドキュメント

### 16.1 制作対象

| 対象 | 必須表現 |
| --- | --- |
| 水面 | 小規模湾の連続した水域として読める地形。既存Hex・FoW・地形縮尺と整合 |
| 橋 | 水面上のRoadとして連続し、通行可能と分かる。必要な道路接続方向に対応 |
| 原子力発電所 | 既存施設と同じ俯角・縮尺で識別可能。Water隣接Land上の施設として表示 |
| 特殊部隊 | 5人組、assault rifle、suppressor・optic等。既存Humanの陣営色・視認性 |
| Pack Zombie | ゾンビ化した特殊部隊5人組。装備・silhouetteに対応を持たせ、腐敗・姿勢・敵性を明確化 |

本要件確定後に同じタスクで画像を制作し、その出力を採用する。既存Asset Registry、透明余白、アンカー、LOD、Fallback、FoW上の描画規則に合わせて組み込む。実在部隊の徽章・商標は使わない。生成直後の画像を未検証のまま組込み完了とせず、通常/低Zoomとスマートフォン表示で確認する。

2026-09-20制作原本: [output/imagegen/v1.6.3/README.md](../output/imagegen/v1.6.3/README.md)。5種類の透過PNG、使用プロンプト、画像形式・hash確認記録を保存済み。制作原本は`Art/reference/v1.6.3-concepts/`に保存し、256px runtime PNGへの調整・Asset Registry・橋接続・水面・盤面/Viewerへの組込みを実施した。

### 16.2 更新対象

README、PLAY_WITH_AI、日英ヘルプ・localization、Session --help、query api schema、Replay / Artifact viewer legendを更新する。現行仕様への反映は実装・検証完了後とする。

開始時の原発説明は没入感ある背景と期限ルールを併記する。Final Hordeはあらゆる感染者の集結を示唆し、Pack確定参加を明言しない。各感染源・飢餓・猶予を区別する説明を必須とし、警告をドキュメントだけで代用しない。

## 17. 必須検証

### 17.1 人口・飢餓・過密

- Capital1からのTransfer / Assign / Produce拒否、他City利用成功、非自発的1→0許容。PreviewとCore一致。
- 蓄積0から100% / 50% / 25%の不足で死亡率開始が3 / 5 / 9Turn目。A=2ちょうどは0、上限7、全量供給で死亡率0・Aが0.5減少、7から14Turnで0。
- 食料供給1/需要100も継続で死亡。生産0でも初回即時死亡なし。CG不足だけでは直接死亡なし。
- 施設・waiting / screening / approvedに適用し、感染者・Unitは対象外。飢餓死亡がZombieを生成しない。
- 端数繰越、小人口、人口移送・Pool分割、供給回復、Save復帰で総損失とcarryが整合。配分総数一致・負人口なし。
- 局所過密式、別都市への全国倍率廃止、Housing Hard Cap10、停電追加維持費の独立性。

### 17.2 審査・衛生・猶予

- Normal2 / Strict5、審査拒否なし。Strict0%、Normal5%が混雑・ストレスで変わらず、Passのみ補正・上限60%。
- 実際の受入先別の人数で発症し、無関係な施設・他のQueue Poolから感染者を作らない。approved再配置で再抽選なし。
- waiting20以下0、40/60/100で基礎1/2/4%、上限12%。screening / approved人数を増やしてもwaiting riskが変わらない。
- 更新後ストレスを同EndTurnの感染に使用。継続不足で増加、回復で減衰、生産0強制1なし。
- 過密のみ・Housing停電のみ・駐留ありでも生活環境感染が起こり得る。単調性、上限3%、P0なら発生なし。
- 間接新規感染は同Turnに感染拡大せず翌EndTurnから。既存感染者だけは従来どおり拡大し、鎮圧・Save・fallback・陥落で猶予内数が壊れない。
- 直接感染に猶予を追加しない。健康人口0時の既存陥落・連鎖・敗北を即時評価する。
- 全確率判定のSeed決定性、Preview無副作用。統計的試験は決定的なSeed集合と許容範囲を用い、偶然の単発結果を固定期待にしない。

### 17.3 警告・情報

- 各感染源の原因・対象・確率、Strictの限界、駐留の限界、猶予、少人口陥落リスクがHuman/Agentへ表示される。
- 飢餓予測と確率感染の区別、実発生履歴、Warning/Critical/解消、日英、モバイル表示を確認する。
- Allowanceは4Turn以上警告なし、3以下Warning、次EndTurn枯渇Critical、netBurn0なら解除。既枯渇停止を取り落とさない。
- Hidden Enemyの変更で非公開位置・原発Pack実出現・Final Pack方向が公開予測へ漏れない。

### 17.4 Map・原発

- 全Groundの水面進入不可、Bridge cost1、Player/Zombie/route/Preview/Spawn一致。WaterとBridge上の建設拒否。
- 4方向のSeed決定性、template期待数、既存施設・Capital・中央交差・Entrance/Reserve保護、地上到達性。
- 第9.2節の距離・供給維持の証跡を4方向で作成する。原発をSupplyに入れるため進入禁止ゾーン直前の前進を要求しない。
- 原発0/0開始、Neutral survivor対象外、Supply内の1..5workersで500..2500、Supply外0、Fuel消費0、感染/復旧停止、他発電とFuel配分一致。
- Turn20確保は満載・即行動のRegular報酬、供給外でも獲得、喪失/再確保/再送で重複なし。
- 占有時のfallback、全候補閉塞時のpending、期限後の報酬保持、配置時だけ援軍5計上。
- Turn21未確保でPack1、Player行動を挟んで同Turn末から行動。期限内確保後の喪失では発生しない。視界外通知なし。

### 17.5 Unit・Final Horde

- Special Forces生産拒否、Regular3 / Veteran4共通Charge、kill5後の次Turn昇格、同Turn追加なし。
- Range1 MG0/1/2、Range2 MG3/4、攻撃/反撃/迎撃、残Charge鎮圧、Noise4、Fuel/回復を確認。
- 死因を問わず死亡HexへPack1、Player中/敵Phase中の初回行動差、死亡Unit残資源非返還・人口保存。
- Pack15×5、同一対象への連撃、途中死亡・防御軽減、Charge補充。Riotを平地で倒せる実戦条件を検証する。
- 通常抽選へのPack混入なし、Final1隊追加・方向決定性、pending・count・勝利条件一致。Final予告にPack確定情報なし。

### 17.6 Session・互換・回帰

- 5completed Turns、128正式Decisions、同時trigger、手動、Query/拒否/再送のカウント境界を確認。
- status / play-turnが最新Revisionを返し、生成によるState/RNG/Decision/Revision/hash chain変更なし。
- locale/Fair Play維持、履歴完全取得、分岐後親history非混入、配列上限・省略件数・詳細Query・重大警告維持。
- 70+Turnの長時間SessionでHandoffサイズが履歴長に比例しない。canonical Artifactの情報欠落なし。
- 旧データの非破壊拒否、新形式Save/Replay/Checkpoint/Artifact一致、schemaとenum不変条件の更新。
- 変更が人口・経済・Turn・Map・Unit・Sessionを横断するため、仕上げは型検査・本番Build・フル回帰テストを1巡行う。成功済み同一差分の無根拠な反復はしない。
- FoW、Supply、Gas連鎖、Checkpoint Fallback、Horde警告、Action validation、finite-plan停止条件を維持。Linux / Windows Portable双方のSession smoke test、Human UI / AI Viewerで表示確認。

実装前の要件整理ではこれらのゲーム検証を完了扱いにしない。実行範囲、成功・失敗・skip・未実行と理由を分けて記録する。

## 18. バランス検証・調整

固定Seed複数本でBuilt-in Agentと外部LLMのplaytestを行い、健康人口増加、審査拒否減によるHorde軽減、衛生感染・飢餓被害、人口分散、供給回復の価値、原発遠征の負担、Packの脅威を比較する。

特に微量供給による永久回避、回復Turnを挟む戦略のコスト、CG不足の感染リスク、原発による電力解消と防衛負担、Riotも倒されるPackに対する事前説明が機能するかを確認する。v1.6.2の難度帯を参考にし、外部AIが勝つことだけを成功条件にしない。

本書の数値を初期値として実装する。playtestによる数値調整は差分・根拠・再検証結果を記録し、要件と実装を一致させる。100%審査受入、待機者だけの過密、食料だけの直接死亡、感染猶予の対象、Capital保護、原発Supply必須、Pack発生条件等の意味論を数値調整に紛れて変えない。

## 19. 実装順序・文書管理

1. 共通State / Config / enum / versionと不変条件。
2. Capital withdrawal guard、局所過密、食料不足蓄積・衛生・審査・感染猶予と処理順。
3. Preview / Forecast / Crisis / 日英説明 / Agent公開。
4. Allowance警告、Water / Bridge共通passabilityと建設制限。
5. 湾・原発の距離設計、Supply発電条件、報酬・失敗イベント。
6. 特殊部隊・Pack・Final統合。
7. Context HandoffとSession保存・公開契約。
8. 本タスクで制作する5種アセットの組込み、UI・ドキュメント。
9. 決定性・フル回帰・Portable・長時間・バランス検証。
10. 完了後に現行仕様へ反映し、本要件との整合を確認。比較不要となった確定要件をarchiveへ移す。

v1.6.2確定要件は現行仕様への反映済み資料としてarchiveへ移動済み。本v1.6.3確定版作成後は元ドラフトもarchiveへ保存し、Doc直下には現行仕様と本確定版を置く。物理削除しない。

## 20. 回答対応と未完了作業

| 回答 | 統合先 |
| --- | --- |
| 第1〜9問 | 5.2〜5.5: 不足率・蓄積・回復・死亡率・対象・感染者除外・非ゾンビ化 |
| 第10〜16問 | 4章・5.8: 更新時点、Strict受入後、waiting限定、Normal固定、Pass補正、感染者治療なし、過密式 |
| 第17〜23問 | 5.3・5.6〜5.7・13章: ストレス・係数・警告・猶予・直接感染維持 |
| 第24〜31問 | 3章・5.7・10〜12章: 陥落判定、Capital、原発期限/背景/報酬、再アニメーション時点 |
| 第32〜40問 | 9〜12章: Pack脅威、Final示唆、特殊部隊戦闘、湾規模/距離、Supply発電と報酬分離 |
| 第41〜47問 | 8〜9章・16章: 橋干渉禁止、Handoff責任/trigger/最新性/上限、5種アセット |
| 第48〜52問 | 4.3・5.4・5.6・10章: 蓄積上限7、原発Pack行動、報酬pending、駐留中感染、実受入先発症 |

実装・ローカル検証・現行仕様18.13への反映を実施した。数式・Map座標・Schema・Unit・Session・UIと5種Assetの根拠は現行仕様へ移した。ローカル全体回帰と追加検証の成功/失敗/skip、修正前後の再現、Built-in/外部LLM Seed1/7の終局、Windows最小Portable、4方向の距離・供給検証は現行仕様18.13.17に記録する。

GitHub Pages配信後の実ブラウザ動作と、同一配信対象CommitのLinux/Windows AI Portableの完遂をリリースの完了条件とする。その他の長時間workflowは依頼者指定に従って起動のみ確認し、結果を監視しない。本依頼ではDoc/archiveを変更しないため、本確定版はDoc直下に保持する。
