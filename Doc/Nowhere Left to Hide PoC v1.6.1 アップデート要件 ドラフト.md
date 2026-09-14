# Nowhere Left to Hide PoC v1.6.1 アップデート要件 ドラフト

- ステータス: **ドラフト／要レビュー。ゲーム実装・リリースではない。**
- 作成日: 2026-09-14
- 基準: v1.6.0 / commit `6364ea196629bd5aa71d89066c0051d35911a98d`
- 根拠: 依頼者のv1.6.1要望と現行 `Doc/Nowhere Left to Hide PoC 現行仕様.md`
- この変更は文書のみ。既存の確定版・現行仕様・アプリのバージョン番号は変更しない。

本書の「必須」は依頼事項または、それを既存Coreへ矛盾なく接続するために必要な受入要件を示す。「提案」は依頼文に数値・順序が明記されていない箇所について、本ドラフトが実装上の既定案を示すもの。「要調整」は依頼だけでは値を一意に決められない事項であり、確定版にする前に決定する。提案・要調整を承認済み仕様として扱わない。

---

## 1. 目的

v1.6.1は、v1.6.0で追加・整理されたAI観戦、Human UI、固定Wave、特殊Zombie、補給・感染・検問所の仕組みを全面的に作り直すものではない。主目的は次の4点とする。

1. スマートフォンHuman UIの操作阻害を解消し、内政UIの情報提示を既存Unit編成UIと揃える。
2. 中立施設の初期生存者、検問所の拒絶・過密リスクを追加し、避難民・民間人口・Zombie AIの相互作用を増やす。
3. Screamer ZombieとRecon Teamを追加し、偵察・Noise・Zombie誘引の戦術幅を増やす。
4. 初期Zombie、Horde Wave、自然回復、感染陥落施設のNoise再Spawnを調整し、序盤から終盤までの圧力を高める。

既存のCoreを唯一のGame Truthとする方針、Seed付き決定性、Fog of War、Replay／Artifactの再現性、Save／Session／Agent／Browser Bridge間の同一ルール共有は維持する。

### 1.1 非対象

- Live AI Viewerそのものの再設計、別端末同期、クラウド観戦基盤の追加
- ランダムマップ本体の実装
- Zombie AI全体の優先順位変更
- Checkpointの既存pass / normal / strictの確率・審査Turn変更
- Police / National Guard / Riot Policeの基礎戦闘性能変更
- Hunter / Gas / Police / Soldier / Riot / Horde Zombieの既存基礎性能変更
- 初期Hunter / Gas数の変更（別途指定がない限り現行値を維持）
- Rejected Refugee Bonusそのものの算式変更
- Final Wave後の勝利条件変更

---

## 2. 要求一覧

| ID | 内容 | 扱い |
| --- | --- | --- |
| UI-01 | Human UIの`AI Play Watch`入口をメインメニュー限定にする | 必須 |
| UI-02 | Constructible Facility候補をUnit編成と同系統のAccordion表示へ変更 | 必須 |
| SURV-01 | 中立施設へ初期生存者を配置し、早期確保で健康な市民として救出可能にする | 必須。人数・配置量は要調整 |
| SURV-02 | 未確保生存者をZombie AIのPopulation Target対象にする | 必須 |
| SURV-03 | 未確保生存者を10 Turn後に感染者へ変換する | 必須 |
| CP-01 | Checkpoint Policyへ`deny`を追加する | 必須 |
| CP-02 | deny時にwaitingのみをEndTurnで全員追い返す | 必須 |
| CP-03 | waiting > 100で翌Turn感染リスクを発生させる | 必須 |
| Z-01 | Screamer Zombieを追加する | 必須 |
| Z-02 | ScreamerがPopulation / inherited Horde Target取得時に初回だけRadius 30 Noiseを発生 | 必須 |
| Z-03 | Horde Wave由来Screamerは配置直後にNoiseを発生 | 必須 |
| Z-04 | Screamer専用Assetを追加する | 必須 |
| UNIT-01 | Recon Teamを追加する | 必須 |
| UNIT-02 | Reconの生産条件・燃料・携行軍需をNational Guard系へ接続する | 必須。Range 3..6の軍需消費は要調整 |
| UNIT-03 | Recon死亡時にSoldier Zombieを生成する | 必須 |
| UNIT-04 | Recon専用Assetを追加する | 必須 |
| INIT-01 | 初期Normal Zombieを25体から50体へ増加 | 必須 |
| INIT-02 | 初期Normal Zombieを州都から8 Hex以上、幹線道路から外れ気味に配置 | 必須。道路距離の厳密値は提案で固定 |
| WAVE-01 | Wave Turnを10 / 20 / 35 / 50 / 70へ変更 | 必須 |
| WAVE-02 | 各方向の基礎Zombie数を現行の1.5倍へ増加 | 必須。整数配分は要調整 |
| HEAL-01 | Human Unitの自然回復率を半減 | 必須 |
| FALL-01 | Noiseを受けた感染陥落施設の再SpawnをNormal固定から重み付き抽選へ変更 | 必須 |
| SAVE-01 | 新Unit / Zombie / Survivor / Queue Risk状態をSave・Replay・Agent等へ一貫して反映 | 必須 |

---

## 3. Human UI

## 3.1 `AI Play Watch`入口をメインメニュー限定化 — UI-01

現状、スマートフォンChromeのHuman UIで`AI Play Watch`への入口が画面遷移後も右下へ固定表示され、右下のゲーム操作と競合し得る。v1.6.1ではこの常時Floating表示を廃止する。

必須要件:

- `AI Play Watch` / Live AI Viewerへの通常入口は**メインメニュー／タイトル画面だけ**に置く。
- Human Game開始後は、盤面、内政、軍事、施設・Unit Bottom Sheet、Checkpoint操作、EndTurn確認などの画面へ`AI Play Watch`固定ボタンを重ねない。
- PCとmobileで入口の意味を分けない。mobileだけ別の常駐入口を追加しない。
- Live AI Viewer本体、Replay Viewer、Artifact読込の既存機能は削除しない。
- 戻る操作でタイトルへ戻った後は通常どおり入口を利用できる。
- 390×844相当で右下のHuman UI Actionを隠さず、横overflowを新規発生させない。

## 3.2 Constructible Facility候補Accordion — UI-02

内政画面で建設候補を提示する部分を、現行のUnit編成Accordionと同じ情報設計へ寄せる。

必須要件:

- Build可能なConstructible Facilityを1つの折り畳みセクション、または同等のAccordion群として表示する。
- 初期状態は閉じた状態を許可し、Chevron等で展開状態を示す。
- 各候補は少なくとも次を表示する。
  - 日英名称
  - Civilian Goods / Military Goods / Population等の即時コスト。該当しない値は0または「不要」として曖昧にしない。
  - 建設所要Turn
  - Worker上限
  - Power要求／発電量
  - 主要な入出力資源
  - Vision、Housing Capacity等、その施設固有の主要性能
  - 建設上限と現在数
- 数値はUIへ複製せず、現在ConfigとCore Queryを参照する。
- 選択Hexが不合法な場合は、既存方針どおりCore Reason Codeを表示し、UI独自判定で合法化しない。
- disabled状態でも「なぜ建てられないか」と「建てられた場合のコスト／性能」を確認できる。
- Touch target 44 CSS px以上、キーボード操作、`aria-expanded`等の既存Accordionアクセシビリティを踏襲する。

---

## 4. 中立施設の初期生存者 — SURV-01..03

## 4.1 基本モデル

中立恒久施設の一部へ、ゲーム開始時に健康なSurvivor Populationを配置する。これはPlayer所有人口ではないが、実在する健康な民間人口としてGame Stateへ保持する。

- 生存者配置はGame Seedに対して決定的であること。
- どの中立施設へ配置するか、各施設の人数はConfigから取得すること。
- 同Seed、同Configなら配置施設・人数・10 Turn期限が一致すること。
- Oil Fieldのように現行仕様上Population Target Valueを持たない特殊施設を候補に含めるかはConfigで明示し、暗黙に全施設へ配置しない。

**要調整 SURV-Q1:** 初期生存者を持つ施設数、施設種別ごとの人数または範囲は依頼文だけでは決められない。確定版でConfig値を決定する。本ドラフトでは恣意的な人数を追加しない。

## 4.2 早期確保

- Survivor Populationを持つ中立施設をPlayerが確保した時点で、残っている健康なSurvivorをその施設のPlayer健康人口へ移す。
- この移行は追加Actionを要求しない。
- 確保済みSurvivorは「未確保生存者の10 Turn感染タイマー」の対象から外れ、通常のPlayer人口・感染・維持費ルールへ移行する。
- 既存の初回確保資源報酬とは別であり、両方の条件を満たす施設では累積する。
- 再確保で同じSurvivorを再生成しない。

## 4.3 10 Turn感染期限

- 各初期Survivor groupはゲーム開始時に10 Turnの期限を持つ。
- Playerが確保しないまま10回のEndTurnを完了した時点で、そのgroupに残る健康人口を同施設の感染人口へ変換する。
- 人口を新規生成せず、`healthy -> infected`の移動として扱い総人口を保存する。
- 期限到達直前のSave / Load / Session Resumeで期限が延長・短縮されない。
- 期限到達と同じEndTurnに確保処理が存在し得る場合は、既存Phase順をGame Truthとし、Replayで同一順序を再現する。

## 4.4 Zombie AIのPopulation Target

未確保SurvivorもPopulation Target候補へ含める。

- Player所有か否かではなく、可視範囲内に健康Survivor Populationが存在することを候補条件とする。
- 現行の`Visible Population > wave_capital / inherited Horde > Noise > Idle`というNormal AI優先順位は変更しない。
- Zombieから不可視のSurvivorはTargetへしない。
- Zombieが施設Hexへ到達した場合は、既存Facility接触・感染処理へ接続し、専用の別Combat Systemを作らない。
- 接触・時間経過により健康Survivorが0になった施設は以後Population Target値0として扱う。
- Agent / Human UIへはFog of Warに従った公開情報だけを出し、未発見施設のSurvivor数を漏らさない。

---

## 5. Checkpoint `deny` Policy — CP-01, CP-02

現行`pass / normal / strict`へ4つ目のPolicyとして`deny`を追加する。

## 5.1 denyの意味

`deny`は「これ以上waitingから新規Screeningを開始せず、waitingにいる避難民をそのTurn終了時に全員追い返す」Policyとする。

- `waiting`だけが自動拒絶対象。
- 既に`screening`中の人員はそのBatch開始時のPolicyと残りTurnを維持し、denyへの変更だけで追い返さない。
- 既に審査済みで`approved`配置待ちの人員も追い返さない。
- deny中に新たに到着してwaitingへ入った避難民も、そのEndTurnの拒絶処理対象に含む。
- deny中はwaitingから新しいScreening Batchを作らない。
- 自動拒絶は1人ごとにPlayer Actionを消費しない。
- Policy変更Action自体のAction消費・合法性は既存`SetCheckpointPolicy`と同一規則を使う。
- 自動拒絶人数は、既存の`TurnAwayCheckpointRefugees`と同じRejected Refugee Counter意味論へ加算する。Final roster freeze後は既存どおりBonusを増やさない。
- 不足死亡・感染死亡を「拒絶」と誤計上しない。

UI / Agentでは`deny`を4方針目として表示し、少なくとも「waitingはTurn終了時に全員拒絶」「screening / approvedは対象外」「新規Screening停止」を明示する。

---

## 6. Checkpoint waiting過密感染Risk — CP-03

## 6.1 算式

Checkpointごとの健康な`waiting`人数を`W`とする。

```text
excess = max(0, W - 100)
riskPercent = min(100, excess)
```

例:

- W=100 -> 0%
- W=101 -> 1%
- W=125 -> 25%
- W=150 -> 50%
- W>=200 -> 100%

`riskPercent > 0`なら、その値を**次Turnに解決する感染発生確率**として保存する。

## 6.2 発生時

- Seed付きGame RNGを1回使って発生有無を判定する。
- 発生した場合、1..5人をSeed付きで等確率抽選する。
- 実変換人数は`min(currentWaiting, rolledCount)`とする。
- 該当人数を健康な`waiting`からCheckpoint感染人口へ移す。人口を追加生成しない。
- `screening` / `approved`からは変換しない。
- waitingが0なら実変換0とし、感染者を空から生成しない。

## 6.3 Turn順序の提案

**提案:** 1 Turn遅延を曖昧にしないため、各Refugee処理で次の順を使う。

1. 前Turn末に記録したwaiting Riskを解決する。
2. 既存Screening進行・判定を処理する。
3. 当該Turnの新規Arrivalを処理する。
4. denyならwaitingを全員自動拒絶する。
5. 残ったwaitingから翌Turn用Riskを計算・保存する。

この順序ではdenyでwaitingを0にしたCheckpointは次Turn Riskを新規予約しない。一方、既に前Turnに予約済みのRiskは、当該TurnにPolicyをdenyへ切り替えるだけでは過去の過密事実を取り消さない。ただし解決時点でwaitingが既に0なら変換0となる。

## 6.4 公開情報

- Human UI / Agentは現在waiting人数と、既に予約された次回Risk %を確認できる。
- 乱数判定前に「次Turnに何人感染するか」は公開しない。
- 発生後は感染発生人数を通常Eventへ記録する。
- Save / Replay / Checkpoint分岐でRisk予約値とRNGが一致する。

---

## 7. Screamer Zombie — Z-01..04

## 7.1 基礎性能

| 項目 | 値 |
| --- | ---: |
| HP | 15 |
| Attack | 10 |
| Move / MP | 3 |
| Vision | 2 |
| Range | 1 |
| Max Attack Charge | 1 |
| AI系統 | Normal AI |

RangeとChargeは、別指定がないため既存Normal AI型の共通値1を踏襲する。ScreamerはHorde Zombieそのものではなく、Hunter / Gas等と同じNormal AI系Zombie Typeとして追加する。

- 日英名: `スクリーマーゾンビ` / `Screamer Zombie`
- Human Unit死亡Reanimationの生成先にはしない。
- Initial spawn数は別指定がないため0とし、Horde Waveまたは感染陥落施設のNoise再Spawn等、明示された生成源から出現する。

## 7.2 一度だけのScream

Screamerごとに`hasScreamed`相当の永続状態を持つ。

通常出現したScreamerは、初めて次のいずれかのTargetを獲得した時点で、Screamer自身のHexをCenterとする**Radius 30 Noise Pulse**を1回だけ発生する。

- Visible Population Targetを獲得した。
- Hordeから継承したTarget（inherited Horde Target）を獲得した。

Noise Target、Idle、単なる移動、通常攻撃だけではScream条件を満たさない。既に`hasScreamed=true`ならTargetを失って再取得しても再発生しない。

Screamは既存Noise Systemへ接続し、Screamer専用の別Targeting経路を作らない。Noiseを受けたNormal AIの反応、FoW、fallen-site再Spawn、Event公開範囲は既存Noise規則を用いる。

## 7.3 Horde Wave由来

Horde Wave rosterの一部として生成されたScreamerは、Mapへ実際に配置された直後にRadius 30 Noiseを発生し、`hasScreamed=true`にする。

- Pending中はまだNoiseを出さない。
- Spawn先不足でMapへ配置されなかった段階でもNoiseを出さない。
- Map配置直後のScreamで一度消費するため、その後Population / inherited Horde Targetを得ても2回目は出さない。
- 同じSpawn batchに複数Screamerが含まれれば各個体が1 Pulseずつ発生し得る。Pulse統合で存在を隠蔽・消失させない。

**要調整 Z-Q1:** 現行Horde特殊SlotへScreamerをどのWeight / Direction Capで加えるかは依頼文に値がない。Horde Wave由来Screamerを実際に発生させるため、確定版で既存Hunter / Gas等とのWeight・Capを決める。

## 7.4 Asset

専用Unit Assetを追加する。

- 1体の痩せこけたZombie。
- 顔・口・両手の姿勢等でムンク『叫び』を彷彿させる不安・絶叫のシルエットを持たせる。
- 既存Zombie Asset群と同じ盤面縮尺で識別可能にする。
- 絵画そのものの構図・背景を盤面Assetへ複製する必要はなく、「細身の単体Screamer」であることを優先する。
- Asset Registry、Board Legend、Help、Replay、Live AI Viewerで同一Typeへ解決する。

---

## 8. Recon Team — UNIT-01..04

## 8.1 基礎性能

| 項目 | 値 |
| --- | ---: |
| Population / 編成人口 | 5 |
| HP | 25 |
| Recruit Attack | 9 |
| Move / MP | 10 |
| Vision | 10 |
| Range | 6 |
| Combat Noise Radius | 6 |
| Max Fuel | 22 |
| Max carried Military Goods | 20 |

Regular / Veteran Attackは既存Human Unit共通式`ceil(Recruit Attack × 1.25)`を使うため、別指定がなければAttack表示はRecruit 9 / Regular 12 / Veteran 12となる。熟練度、Attack Charge、Supply、Emergency Movement、Fuel補給、自然回復等は既存Human Unit共通ルールへ従う。

## 8.2 生産

Recon TeamはNational Guardと同じ軍系生産ルートを使う。

- 生産可能: Capital、およびPlayer所有で通常編成可能なArmy Baseのみ。
- City単独では生産不可。
- Civilian Goodsコスト: 20（現行National Guardと同値）
- Military Goodsコスト: 25（現行National Guardと同値）
- Populationコスト: **5**。依頼でReconのPop 5が明示されているため、National GuardのPop 10をコピーしない。
- 完成熟練度: Recruit。
- 最大Fuel 22、完成時Fuel／有償補給の扱いはNational Guardと同じ。
- 携行Military Goods最大20、完成時搭載量・補充順・国家備蓄との関係はNational Guardと同じ。
- Army Base予約中のPower要求、陥落時予約没収等は既存National Guard予約と同じ共通Production Queueへ乗せる。

## 8.3 Range 6とMilitary Goods

距離1..6のCombatはCoreが同じRange判定、遮蔽／地形、防御、Attack Charge処理を行う。UI / Agentは距離別Military Goods Costを事前表示する。

**要調整 UNIT-Q1:** 現行National Guardは距離1でMilitary Goods 1、距離2で2を要求するが、Reconの距離3..6の消費量は依頼文にない。「弾薬は州兵と同じ」だけではRange 3..6の値を一意に決められないため、確定版で距離別Costを決める。実装側で勝手に距離=Cost、全距離2固定等へ決めない。

## 8.4 Noise

Reconが通常攻撃・反撃・迎撃等、既存Human Combat Noise対象行為を行った場合はRadius 6のNoiseを発生する。Counterattack等で既存ルール上二重Pulseを禁止している箇所はその規則を維持する。

## 8.5 死亡とReanimation

Recon Teamが死亡した場合、既存National Guardと同様にSoldier Zombieを生成する。人数5だからPolice Zombieへ変える、あるいは5体のZombieを生成する、といった別解釈は行わない。既存Human Unit Reanimationと同じ「部隊死亡に対応するZombie Unit生成」とする。

## 8.6 Asset

Recon Team専用Assetは5人組とする。

- scoped sniper rifleを持つ兵士2名。
- spotter / escort役の随伴歩兵3名。
- 5人チームとしてまとまりを持たせつつ、盤面縮尺でNational Guard等と識別できる構図にする。
- Asset Registry、Unit Production Accordion、Board Legend、Help、Replay、Live AI Viewerへ同一Typeを登録する。

---

## 9. 初期Zombie増加と配置 — INIT-01, INIT-02

現行初期Normal Zombie 25体を**50体**へ変更する。

- 変更対象は初期Normal Zombie。
- 初期Hunter 1..4、初期Gas 1..2は別指定がないため現行値を維持する。
- 初期Screamerは0。
- 既存の非重複、Zombie進入可能Terrain、Reserve除外、Facility / Human Unitとの競合禁止、Seed付き決定性を維持する。
- Normal ZombieのCapital最小距離を**8 Hex以上**とする。
- Hunterの既存20 Hex以上、Gasの既存9 Hex以上のように、より厳しいType固有制約は弱めない。

### 9.1 幹線道路から「やや外れた」配置

**提案:** 数値指定がないため、道路からの厳密な最小距離を新しいHard Error条件にはせず、候補順位へRoad Avoidanceを導入する。

1. 幹線道路Hexそのものではない候補を優先する。
2. その中で幹線道路に隣接しない候補を優先する。
3. 50体を満たせない場合だけ、Capital 8以上等のHard Constraintを満たす残り候補へ決定的にフォールバックする。

これにより「幹線道路からやや外れた」を表現しつつ、固定51×51 Mapで候補不足を起こしにくくする。選択はSeed付きであり、同Seedで再現する。

---

## 10. Horde Wave調整 — WAVE-01, WAVE-02

## 10.1 Wave Turn

標準固定Wave Scheduleを次へ変更する。

| Wave | Turn |
| --- | ---: |
| 1 | 10 |
| 2 | 20 |
| 3 | 35 |
| 4 | 50 |
| Final | 70 |

- `final: true`はTurn 70のWaveへ移す。
- Final Horde Turnはハードコードせず、引き続きConfigの最後の`final: true`から導出する。
- Warning Leadは別指定がないため現行2を維持する。
- 「最後の2 Wave」で特殊Weightを切り替える処理はTurn番号をハードコードせず、Schedule上の末尾2件としてTurn 50 / 70へ追従する。
- Final freeze後の自然Arrival停止、Rejected Counter凍結、Victory判定は既存意味論を維持する。

## 10.2 各方向1.5倍

各Waveの**各方向ごとの基礎Zombie総数**を、現行Scheduleの同方向総数に対して1.5倍にする。Rejected Refugee Bonusはこの拡大後Base Rosterへ既存どおり別加算する。

**要調整 WAVE-Q1:** 現行WaveはHorde固定枠と非Horde特殊抽選Slotの2部分からなるため、1.5倍後に端数が出る場合の整数化と、追加分をHorde / Slotへどう配分するかを確定版で固定する必要がある。

確定時の必須条件:

- 各方向の最終Base Totalが「現行の約1.5倍」であること。
- Direction間で同じ基礎Compositionなら同じ整数化を使うこと。
- Seedで端数処理をランダム化しないこと。
- 特殊SlotのWeight / Capは、Screamer追加以外について勝手に変更しないこと。
- Help、Warning、Frozen Roster、Metrics、Balanced Agentが新Scheduleと新Base Totalを同じConfigから読むこと。

---

## 11. Human Unit自然回復半減 — HEAL-01

現行のSupply内自然回復を次へ変更する。

| 前Turnの行動区分 | v1.6.0 | v1.6.1 |
| --- | ---: | ---: |
| Combat実行あり | max HPの10% | **5%** |
| 移動のみ／待機／未行動等 | max HPの20% | **10%** |
| Supply外 | 0% | **0%** |

- Unit個別切り上げ、HP上限、回復時点Supply再評価等の既存処理は維持する。
- Police / National Guard / Riot Police / Recon Teamへ同じ率を適用する。
- Zombieは引き続き自然回復しない。
- UI / Help / Agentの10% / 20%表記を5% / 10%へ更新する。

---

## 12. 感染陥落施設のNoise再Spawn抽選 — FALL-01

対象は、**感染して陥落したFacilityがNoise Pulseを受け、既存ルールにより感染人口からZombieを再Spawnする場面**とする。施設が最初に陥落した瞬間の既存Spawn規則やHuman Unit Reanimationを、この要求だけで変更しない。

Noise再SpawnでZombieを1体生成するごとに、Seed付きRNGで次の重み付き抽選を行う。

| Type | Weight |
| --- | ---: |
| Normal Zombie | 70 |
| Gas Zombie | 10 |
| Hunter Zombie | 10 |
| Screamer Zombie | 10 |

合計100。

明示的に対象外:

- Police Zombie
- Riot Zombie
- Soldier Zombie
- Horde Zombie

必須要件:

- 既存の「感染者5人につき1 Zombie」「1 Pulseあたりの生成上限」「空きHex不足時の未生成感染者保持」等、Spawn数を決める既存規則は維持する。
- Type抽選は**実際に1体生成できる単位ごと**に行う。配置不能な架空Unitのために余分なRNGを進めない。
- SpawnしたHunter / Gas / Screamerはそれぞれの通常Type性能を持つ。
- Noise再Spawnで生まれたScreamerは、Horde Wave由来ではないため**配置されたことだけ**ではScreamしない。後にPopulation / inherited Horde Targetを初取得した場合だけScreamする。
- 生成Unitは既存どおり同Phaseに追加行動しない。
- Hidden SpawnのType / 座標はFoWで公開可能になるまでHuman UI / Agentへ漏らさない。

---

## 13. Core / State / Save / Agent / Replayの共通反映 — SAVE-01

今回の変更はUIだけで完結しない。少なくとも次をCoreの明示状態・Config・公開Queryへ反映する。

### 13.1 新しい型・状態候補

- Human Unit Type: `reconTeam`相当
- Zombie Type: `screamerZombie`相当
- Screamerの一度限りScream済み状態
- Neutral Facility survivor healthy / infected / expiry情報
- Checkpoint Policy: `deny`
- Checkpoint waiting Risk予約値／対象Turn
- ReconのFuel / carried Military Goods / proficiency / reanimation provenance
- ScreamerのWave provenance / Noise provenance

命名は既存TypeScript schemaの規約に合わせ、UI都合の別名Stateを増やさない。

### 13.2 Save / Replay / Session

- 新状態はSave Round Tripで失われない。
- Screamerの`hasScreamed`、Survivor期限、Checkpoint予約RiskはLoadでリセットしない。
- 同一SeedのReplayでSurvivor配置、Risk抽選、Noise再Spawn Type抽選、Horde Screamer配置Noiseが一致する。
- Checkpoint / Session分岐後も分岐時点のRNG Stateと予約状態を正確に継承する。
- schema変更が必要なため、v1.6.0 Save / Replay / Artifact / Sessionをv1.6.1として黙って読まない。Migrationを作らない場合はVersion mismatchとして状態不変で拒否する。
- 正確なSave / Agent API / Artifact / Session / Rules version番号は確定版または実装時に一括決定し、部分的に旧version番号を残さない。

### 13.3 Agent / Browser Bridge

AIがHumanと同じGame Truthで判断できるよう、公開範囲内で次をQuery可能にする。

- Reconの生産可否、性能、距離別弾薬費、Fuel、Noise Class / 公開仕様
- 可視Screamerの公開基礎性能
- 可視Neutral FacilityのSurvivor Populationと残り猶予（公開設計でTurn数を見せる場合）
- Checkpoint deny、waiting、screening、approved、次回Risk %
- 新Wave Scheduleと公開済みBase / Frozen人数

Screamer内部Target、Hidden Survivor、Hidden ZombieのScream誘因、未解決RNG結果は公開しない。

---

## 14. UI / Help / Asset / Metrics更新

## 14.1 Human UI

- Unit Production AccordionへRecon Teamを追加する。
- Unit Bottom SheetへReconのRange 6、Vision 10、Noise 6、Fuel、Military Goods、距離別Costを表示する。
- Visible Screamer選択時はType、HP、Attack、Move、Range等の既存公開Zombie情報を表示する。
- Checkpoint Panelを4方針へ更新し、denyとwaiting Riskを表示する。
- Neutral FacilityのSurvivorは可視施設のみ表示し、確保可能な健康人口として区別する。
- Helpの自然回復率、Wave Turn、初期Normal数を更新する。

## 14.2 Live AI Viewer / Replay

Live Viewer自体の操作体系を作り直さず、既存盤面描画が新Type / Eventを読めるようにする。

- Screamer / Recon Assetを表示できる。
- Scream Noise Event、Checkpoint Risk感染、deny自動拒絶、Survivor救出／感染、Noise再Spawn Typeを既存Event timelineへ表示可能にする。
- Human Game中へ`AI Play Watch`Floating入口を戻さない。

## 14.3 Metrics / Validation

少なくとも次を検証・計測可能にする。

- 初期Survivor配置人数、救出人数、時間切れ感染人数、Zombie接触による感染人数
- denyによるTurn Away人数
- waiting Risk判定回数、発生回数、感染人数
- Screamer生成源別数、Scream回数、Wave配置直後Scream、Target取得Scream、二重Scream防止
- Recon生産数、移動、Attack距離、弾薬消費、Noise、死亡、Soldier Zombie化
- 初期Normal 50体の配置制約とSeed再現性
- 各Wave / Directionの新Base数、Rejected Bonus、Pending / spawned / killed
- Human Unit自然回復量
- fallen-site Noise respawnのNormal / Gas / Hunter / Screamer内訳

---

## 15. 受入試験

以下を最低限のv1.6.1受入条件とする。

1. 390×844相当のChromeでHuman Game中に`AI Play Watch`固定ボタンが盤面・Bottom Sheet・右下Actionへ重ならず、タイトル画面からはViewerへ入れる。
2. Constructible Facility候補を折り畳み、各候補のコスト・主要性能・上限・合法性理由を確認でき、表示値がConfig / Coreと一致する。
3. 同SeedでNeutral Survivorの配置が一致し、10 Turn前に確保すれば健康人口として得られ、未確保なら期限どおり感染する。
4. 可視SurvivorがNormal AI Population Targetになり、不可視SurvivorがTarget情報として漏洩しない。
5. Checkpointをdenyへ切り替えるとwaitingだけがEndTurnで全員拒絶され、screening / approvedは保持され、新しいScreeningを開始しない。
6. waiting 100でRisk 0%、101で1%、150で50%、200以上で100%となり、発生時1..5人だけがwaitingから感染へ移る。Save / Replayで同じ結果になる。
7. ScreamerがHP15 / ATK10 / MP3 / Vision2 / Range1で動作し、Populationまたはinherited Horde Target初取得でRadius 30 Noiseを1回だけ出す。
8. Horde Wave由来Screamerが実配置直後に1回Screamし、その後Target取得で二重Screamしない。
9. Recon TeamがPop5 / HP25 / Recruit ATK9 / MP10 / Vision10 / Range6 / Noise6で、Capital / Army Baseだけから生産でき、Civilian Goods20 / Military Goods25、Fuel22、carried Military Goods20を基準に動作する。
10. Recon死亡時にSoldier Zombieが1 Unit生成される。
11. 初期Normal Zombieが50体、Capitalから8 Hex以上、既存占有禁止条件を満たし、Road Avoidanceを含め同Seedで同配置になる。Hunter / Gasの既存数と固有最小距離を壊さない。
12. WaveがTurn 10 / 20 / 35 / 50 / 70に発生し、Finalが70、Warning Lead 2、最後の2 Wave判定が50 / 70へ追従する。
13. 各DirectionのBase人数が確定した1.5倍規則に一致し、Rejected Bonusは別加算、Frozen Roster / Help / Agent / Metricsが一致する。
14. Supply内Human Unit自然回復がCombat 5%、Rest 10%、Supply外0%、個別切り上げとなる。Reconにも同じ規則を適用する。
15. fallen infected FacilityがNoiseを受けた再SpawnでNormal / Gas / Hunter / Screamerだけを70 / 10 / 10 / 10から抽選し、Police / Riot / Soldier / Hordeを生成しない。
16. 新Type / Stateを含むSave Round Trip、Session Resume、Replay、Artifact検証、Browser Bridge / Agent QueryでGame TruthとRNGが一致する。
17. Fog of War下でHidden Survivor、Hidden Screamer、内部Target、Noise Target、未来のRisk抽選結果を漏らさない。
18. 既存のTypeScript型検査、通常Unit/Checkpoint/Noise/Wave/Replay回帰、production build、mobile smokeを壊さない。

---

## 16. 確定版前に決める項目

本ドラフトで依頼値を勝手に補わず残している論点は次の4件だけとする。

| ID | 未確定内容 | 確定時に必要な決定 |
| --- | --- | --- |
| SURV-Q1 | 中立施設の初期Survivor数 | 対象施設種、配置施設数、各施設人数またはSeed付き範囲 |
| Z-Q1 | Horde Wave内Screamer出現率 | 特殊Slot Weight、Direction Cap、通常Wave／最後2 Waveで差を付けるか |
| UNIT-Q1 | Recon Range 3..6の弾薬消費 | 距離別Military Goods Cost |
| WAVE-Q1 | 各方向1.5倍の整数化 | Totalの丸め方、Horde固定数と非Horde Slotへの配分 |

上記以外は、本ドラフトに記載した値・順序をv1.6.1の既定要求として扱える粒度まで固定する。

---

## 17. 実装順序案

1. Config / schemaへRecon、Screamer、Wave、回復率を追加し、既存Core testを更新。
2. Neutral SurvivorとCheckpoint deny / RiskのState遷移を追加。
3. Screamer Screamとfallen-site weighted respawnを既存Noise pipelineへ接続。
4. ReconをProduction / Combat / Fuel / Military Goods / Reanimationへ接続。
5. 初期50体配置とWave 10 / 20 / 35 / 50 / 70を適用。
6. Human UIのAI Watch入口修正、Constructible Accordion、Checkpoint / Unit UI更新。
7. Asset / Legend / Help / Live Viewer / Replayを更新。
8. Save / Agent / Browser Bridge / Artifact version boundaryを更新し、回帰・Seed決定性・mobileを検証。

この順序は実装の依存関係を減らすための提案であり、ゲームルールではない。
