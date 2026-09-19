# Nowhere Left to Hide PoC v1.6.1 アップデート要件 確定版

- ステータス: **確定要件。ゲーム実装・リリースは未完了。**
- 作成日: 2026-09-14
- 確定日: 2026-09-15
- 基準: v1.6.0 / commit `6364ea196629bd5aa71d89066c0051d35911a98d`
- 根拠: 依頼者のv1.6.1要望、2026-09-15の1問1答による確定回答、現行 `Doc/Nowhere Left to Hide PoC 現行仕様.md`
- 本書は実装・テスト・Help・Agent・アセット更新の目標である。実装と検証が完了するまでは現行仕様とアプリの安定版をv1.6.0のまま維持し、完了後に本書を現行仕様へ反映する。

本書の「必須」は依頼事項または、それを既存Coreへ矛盾なく接続するために必要な受入要件を示す。Oil Field、Survivor、Checkpoint、Screamer、Recon、Army Base、保存互換を含む実装分岐は本書で確定し、同じ要件に複数の許容方式を残さない。

---

## 1. 目的

v1.6.1はv1.6.0の基盤を全面的に作り直さず、Human UIの操作性、避難民・Survivor・感染圧、偵察とNoise、資源制約、Horde圧力を強める調整版とする。

主目的:

1. スマートフォンHuman UIの操作阻害を解消し、内政・施設情報を発見しやすくする。
2. 中立施設Survivor、Checkpoint deny、waiting過密感染を導入する。
3. Screamer ZombieとRecon Teamを導入する。
4. 初期Zombie、Horde、自然回復、Fuel、Military Goodsを再調整する。
5. Oil Fieldを希少資源化し、Refinery Allowanceを2000へ下げ、Wind建設費を引き上げる。
6. Human UI、Agent、Save、Replay、Session、Artifactで同じGame Truthを使う。

既存のGameAction → GameEngine境界、Seed付き決定性、Fog of War、公開情報境界、Replay／Artifact再現性を維持する。

### 1.1 非対象

- Live AI Viewerそのものの再設計、別端末同期、クラウド観戦基盤
- ランダムマップ本体
- Zombie AI全体の優先順位変更
- Checkpointの既存pass / normal / strictの審査Turn・合格率・感染率変更
- Police / National Guard / Riot PoliceのHP・Attack・MP・Range等の基礎戦闘性能変更
- Hunter / Gas / Police / Soldier / Riot Zombieの既存基礎性能変更
- 初期Hunter / Gas数の変更
- Rejected Refugee Bonusの`ceil(rejected / 5)`算式変更
- Final Wave後の勝利条件変更
- Emergency MovementのFuel 0特例の廃止

---

## 2. 要求一覧

| ID | 内容 | 扱い |
| --- | --- | --- |
| UI-01 | Human UIの`AI Play Watch`入口をタイトル／メインメニュー限定にする | 必須 |
| UI-02 | Constructible Facility候補をUnit編成と同系統のAccordionへ変更 | 必須 |
| UI-03 | Refinery選択時に全国共有Refinery Allowanceを表示する | 必須 |
| SURV-01 | ゲーム開始時に全中立恒久施設へSurvivorを配置 | 必須 |
| SURV-02 | Survivor人数は施設ID別の独立Seed付き1..10抽選後、施設収容上限でclamp | 必須 |
| SURV-03 | 未確保SurvivorをZombieのPopulation Target対象にする | 必須 |
| SURV-04 | 未確保Survivorを10 Turn後に感染者へ変換 | 必須 |
| CP-01 | Checkpoint Policyへ`deny`を追加 | 必須 |
| CP-02 | deny切替後の新規Arrivalだけを同Refugeeフェーズで追い返し、既存Queueは旧Policyで処理 | 必須 |
| CP-03 | waiting > 100で翌Turn感染リスクを予約 | 必須 |
| Z-01 | Screamer Zombieを追加 | 必須 |
| Z-02 | Population / inherited Horde Target取得時に初回だけ非公開Radius 30のextraLarge Noise | 必須 |
| Z-03 | Horde由来Screamerは実配置直後にScream | 必須 |
| Z-04 | Wave WeightはNormalから5を移してScreamer 5、Capなし | 必須 |
| UNIT-01 | Recon Teamを追加 | 必須 |
| UNIT-02 | Recon攻撃時Military Goods Costは距離1..6すべて6 | 必須 |
| UNIT-03 | Recon死亡時Soldier Zombie 1 Unitを生成 | 必須 |
| UNIT-04 | Recon専用Assetを追加 | 必須 |
| INIT-01 | 初期Normal Zombieを25から50へ | 必須 |
| INIT-02 | Capitalから8 Hex以上、幹線から外れ気味に配置 | 必須 |
| INIT-03 | 初期Normal / Hunter / GasをArmy Baseから各個体のVisionより遠くへ配置 | 必須 |
| WAVE-01 | Wave Turnを10 / 20 / 35 / 50 / 70へ | 必須 |
| WAVE-02 | 固定Horde Zombie数のみ1.5倍、端数切り上げ | 必須 |
| HEAL-01 | Human Unit自然回復率を半減 | 必須 |
| FUEL-01 | Human Unitの通常移動Fuel Costを2倍 | 必須 |
| FUEL-02 | Human UnitのMax Fuelを2倍 | 必須 |
| AMMO-01 | 既存Human Unitの攻撃時Military Goods Costを2倍 | 必須 |
| AMMO-02 | Human UnitのMax carried Military Goodsを2倍 | 必須 |
| FALL-01 | Noiseを受けた感染陥落Facilityの再Spawnを70/10/10/10抽選へ | 必須 |
| MAP-01 | Oil Fieldを4基から1基へ減らす | 必須 |
| ECO-01 | Player-built Wind Power Plant建設費を1.5倍、端数切り上げ | 必須 |
| ECO-02 | 初期Refinery Allowanceを5000から2000へ | 必須 |
| BASE-01 | 未確保Army Baseも健康なSurvivor数に応じ、Player所有時と同性能でZombieを迎撃 | 必須 |
| BASE-02 | Army Baseの無償National Guard期限をPlayer Turn 10までとし、陥落またはSurvivor全滅で失効 | 必須 |
| ASSET-01 | Recon Team / Screamer Zombie専用の透過256×256盤面Assetを採用 | 必須 |
| SAVE-01 | 新Type／State／Map／資源ルールをSave等へ一貫反映 | 必須 |

---

## 3. Human UI

### 3.1 `AI Play Watch`入口 — UI-01

Human Game中の常時Floating入口を廃止し、通常入口はタイトル／メインメニューだけに置く。

- 盤面、内政、軍事、Facility / Unit / Checkpoint Bottom Sheet、EndTurn確認へ固定ボタンを重ねない。
- PCとmobileで入口の意味を分けない。
- Live AI Viewer、Replay Viewer、Artifact読込自体は削除しない。
- 390×844相当で右下Action、Bottom Sheet、Safe Areaを妨げない。

### 3.2 Constructible Facility候補Accordion — UI-02

内政画面の建設候補をUnit Production Accordionと同系統のUIへ寄せる。

各候補に最低限表示する:

- 日英名称
- Civilian Goods / Military Goods / Population等の建設費
- 建設所要Turn
- Worker上限
- Power Demand / Generation
- 主要入出力
- Vision / Housing Capacity等の固有性能
- 建設上限、現在数、残枠
- 選択Hexでの合法性とCore Reason Code

表示値はConfig / Core Queryを正本とし、UIへルール値を独自複製しない。Accordionは44 CSS px以上、Chevron、`aria-expanded`を持つ。

### 3.3 Refinery Allowance表示 — UI-03

v1.6.0実装を確認した限り、Refinery AllowanceはCoreのCrisis reasonとしては存在するが、HumanのRefinery Facility詳細に現在値を直接表示していない。したがってv1.6.1では追加要件とする。

PlayerがRefineryを選択したFacility情報一覧へ、全国共有値として最低限次を表示する。

- `Initial Refinery Allowance`: 標準2000
- `Oil Credits Earned`: Oil Fieldから累積加算された量
- `Fuel Refined`: Refineryが累積消費したAllowance
- `Remaining Refinery Allowance`

関係は既存意味論を維持する。

```text
remainingAllowance
= initialAllowance + oilCreditsEarned - fuelRefined
```

Refineryが複数存在するConfigでも全国共有値であることを明示し、施設固有在庫に見せない。0なら既存の`refinery_allowance_exhausted`警告と整合させる。Human UI、Agent、Forecastで別々の算式を作らない。

---

## 4. 中立施設Survivor — SURV-01..04

### 4.1 対象施設

ゲーム開始時点で**中立である全ての恒久Facility**へ健康なSurvivorを配置する。初期Player所有Facilityには配置しない。Player-built Constructible、Checkpointは開始時対象外である。

Oil Fieldを1基へ減らした後は、そのゲームで実際に配置された1基だけが中立Facilityとして対象になる。存在しない3候補へSurvivorを作らない。

### 4.2 人数

各対象Facilityごとに`Game Seed + Map ID + Facility ID`から独立した決定値を作り、1..10の整数を等確率抽選してからFacilityが保持可能な健康人口上限でclampする。既存のGame RNGは消費せず、Oil Field方角、Army Base、初期Zombie、Refugee、Waveの抽選順を変えない。施設一覧の並びや別Facilityの追加によって、同じIDの抽選値を変えない。

```text
rolled = randomIntInclusive(1, 10)
survivors = min(rolled, facilityHealthyPopulationCapacity)
```

例:

- 上限30 → 1..10
- 上限10 → 1..10
- 上限5 → 1..4が各10%、5が60%

開始時中立Facilityに人口上限0のTypeが将来追加された場合はConfig validationで明示的に扱い、架空の収容枠を作らない。現行対象Typeは少なくとも1人を収容可能であることをリリース検証する。

同Seed / Map / Config / Facility IDなら人数が一致する。Save / Loadで再抽選しない。

### 4.3 早期確保

Survivorが残る中立FacilityをPlayerが確保した瞬間、残存健康SurvivorをそのFacilityのPlayer健康人口として引き継ぐ。

- 追加Action不要。
- 既存の初回確保資源報酬と累積する。
- 再確保でSurvivorを再生成しない。
- 確保後は通常の維持費、感染、敗北判定、人口操作ルールへ入る。
- 未確保中の人数、期限、残りTurn、抽選範囲はHuman UI / Agent / 公開Replay / 公開Artifactへ出さない。確保結果Eventで実際に救出した人数を初めて公開する。
- Helpと可視中立FacilityのBottom Sheetは「早期確保でSurvivorを救出できる可能性」だけを定性的に示す。Agentも`earlyCaptureSurvivorRewardPossible`相当のBooleanだけを受け取る。
- 救出機会を失った後は、人数や期限値を示さず「早期確保によるSurvivor救出機会は失われた」とHuman UI / Agentへ示す。

### 4.4 10 Turn期限

ゲーム開始から10回のEndTurnを完了するまで未確保だったFacilityでは、10回目のEndTurnのRefugee処理後・通常の感染フェーズ直前に、残る健康Survivorを同Facilityの感染者へ全員変換する。

- 人口新規生成ではなく`healthy -> infected`。
- Save / Resumeで期限をリセットしない。
- Zombie接触で先に感染・死亡した人数は二重変換しない。
- 変換直後から同じEndTurnの既存感染処理を適用する。健康人口0・感染者ありになった施設は同じEndTurn中に陥落し、既存規則でZombieを生成する。

### 4.5 Zombie AI Target

未確保Survivorは実在する健康人口として、ZombieのVisible Population Target対象に含める。

- Normal AI優先度`Visible Population > wave_capital / inherited Horde > Noise > Idle`を維持。
- Zombieから見えないSurvivorをTargetにしない。
- Facility到達時は既存のFacility接触・感染処理へ接続する。
- Hidden Survivor数をHuman / Agentへ漏らさない。

### 4.6 未確保Army BaseのSurvivor迎撃と早期確保報酬 — BASE-01, BASE-02

未確保Army BaseもSURV-01..04の対象とし、健康なSurvivorが残り、未感染かつ`disabled / ruined`でない間はZombieだけを自動迎撃する。

- 各Zombie Phase開始時の迎撃回数を、その時点の健康なSurvivor人数と同数へ更新する。
- Attack 10、Range 2、1射ごとの専用Military Goods 2、Noise Radius 8、距離0での連射、対象選択、停止条件はPlayer所有Army Baseと同じ。
- 未確保でも電力とSupplyは不要。
- 専用Military Goods 40で開始し、迎撃ごとに2消費する。未確保中は補充せず、確保後だけ既存の国家備蓄からの補充対象へ入る。
- 感染者が1人以上いる間はPlayer所有時と同様に迎撃しない。健康なSurvivor数が0なら迎撃回数0。
- Playerの視界外で起きた未確保Army Base迎撃は公開しない。視界内なら発生時Toastと重要イベント履歴へ次を表示する。人数、専用Military Goods残量、残迎撃回数、Hidden Zombie情報は公開しない。
  - 日本語: `陸軍基地から迎撃射撃が聞こえた。まだ生存者がいるかもしれない。`
  - English: `Interception fire was heard from the Army Base. Survivors may still be inside.`
- Agentには視界内の場合だけ`unsecured_army_base_interception`相当の公開Eventを返し、Facility IDとSurvivor残存可能性だけを含める。

Army Baseの無償National Guard 1 Unit報酬はPlayer Turn 10中の確保まで有効とし、10回目のEndTurn開始後は失効する。加えて、確保時に健康なSurvivorが1人以上残り、未確保中に一度も`disabled / ruined`へ移行していないことを必要条件とする。一度陥落・無力化したArmy Baseの報酬は不可逆に失効し、Turn 10以前に復旧・確保しても復活しない。感染中でも陥落しておらず健康なSurvivorが残る場合は、Turn 10中まで報酬対象とする。成立後に配置先がない場合のPending処理は既存規則を維持する。

---

## 5. Checkpoint `deny` — CP-01, CP-02

現行`pass / normal / strict`に`deny`を加える。

`deny`の意味:

- `deny`へ切り替えた時点で既に`waiting`にいる難民はgrandfathered Queueとし、切替直前の旧Policyを固定して通常どおり新しいScreeningへ進める。Active / Remnantのどちらに残るQueueも同じ。
- 既存`waiting`が複数のCheckpointにある場合も、支線の切替直前Policyを各対象Queueへ保存する。Save / Resumeで失わない。
- 既存`screening`はBatch開始時Policyと残りTurnを維持する。
- `approved`は自動配置待ちを継続し、denyで追い返さない。
- `deny`切替後の新規ArrivalはActive Checkpointへ到達した同じRefugeeフェーズ内で全員Turn Awayし、Screeningへ入れない。
- 自動Turn Away人数は既存Rejected Counterへ加える。Final roster freeze後は既存どおりCounter加算しない。
- 自動拒絶は追加Player Actionを消費しない。
- `deny`へ切り替える`SetCheckpointPolicy`自体は既存どおりPlayer Actionを1消費する。grandfathered Queueへの手動Turn Awayは既存Actionとして残す。

UI / Agentは「切替後Arrivalだけを自動拒絶」「切替前waitingは旧PolicyでScreening継続」「既存screening / approvedは維持」を明示する。grandfathered Queueの人数と適用Policyは、通常のPlayer所有Checkpoint公開情報として表示する。

---

## 6. Checkpoint waiting過密感染Risk — CP-03

Checkpointごとの健康なwaiting人数を`W`とする。

```text
excess = max(0, W - 100)
riskPercent = min(100, excess)
```

- W<=100 → 0%
- W=101 → 1%
- W=150 → 50%
- W>=200 → 100%

Turn末に求めたRiskを次TurnのRefugee処理で解決する。予約はCheckpoint IDへ紐づけ、次のPlayer Turn中の移設、Role変更、Policy変更では取り消さない。解決時にCheckpointが消滅済み、または現在の`waiting`が0なら感染者0人として予約を消費し、再抽選や別Checkpointへの移し替えは行わない。

必須の固定順序:

1. 前Turn末に予約したRiskを解決。
2. 既存Screening進行・判定。
3. 非deny支線のwaitingは現Policy、grandfathered waitingは保存済み旧Policyで新規Screeningを開始。
4. 新規Arrival。
5. denyなら切替後Arrivalだけを全員Turn Away。
6. 残った通常waitingとgrandfathered waitingを含む健康なwaitingから翌Turn用Riskを計算・保存。

Risk発生時:

- Seed付きRNGで発生有無を1回判定。
- 成立時に1..5人を等確率抽選。
- 実感染人数=`min(currentWaiting, rolledCount)`。
- waitingからinfectedへ変換し、screening / approvedは対象外。
- waiting 0なら0人。
- 生成された感染者は通常のCheckpoint感染者とし、同じEndTurnの後続感染フェーズで感染拡大、駐留Human Unitの自動鎮圧、陥落判定を既存どおり適用する。

Human / Agentは予約済みRisk %を確認できるが、成立前の感染人数抽選結果は公開しない。

---

## 7. Screamer Zombie — Z-01..04

### 7.1 基礎性能

| 項目 | 値 |
| --- | ---: |
| HP | 15 |
| Attack | 10 |
| Move / MP | 3 |
| Vision | 2 |
| Range | 1 |
| Max Attack Charge | 1 |
| AI系統 | Normal AI |

日英名: `スクリーマーゾンビ` / `Screamer Zombie`。

初期配置は0。Human Reanimationでは生成しない。Horde Waveとfallen infected FacilityのNoise再Spawnを明示的な生成源とする。

### 7.2 Scream

Screamerごとに`hasScreamed`を保持する。通常出現個体は初めて以下のいずれかをTargetとして獲得した時点で、自身のHexを中心に内部Radius 30、Noise Class `extraLarge`のNoise Pulseを1回発生する。

- Visible Population Target
- inherited Horde Target / wave_capital系のHorde inherited target

Noise Target、Idle、単なる移動だけではScreamしない。一度Screamした個体はTargetを失って再取得しても再発生しない。

既存Noise Systemへ接続し、Screamer専用の第二Targeting Systemを作らない。Scream発生時にRadius内のfallen-site再Spawnは即時解決するが、周囲ZombieのNoise Target取得と移動反応は次回Zombie Phaseの開始時Snapshotから行う。同じPhase途中の後続個体だけを再判定しない。発生元Screamer自身は自分のPulseをNoise Targetとして取得せず、他のNormal AI系Zombieと別Screamerは通常どおり反応できる。

### 7.3 Horde由来Screamer

Horde roster由来Screamerは、PendingからMapへ実配置された直後にRadius 30 Noiseを1回発生し、`hasScreamed=true`にする。

- Pending中はScreamしない。
- Spawn space不足で未配置ならScreamしない。
- 配置後のPopulation / inherited Target取得では二重Screamしない。
- 複数Screamerが同batchに出れば各個体が1 Pulseずつ出す。
- Base rosterの特殊SlotとRejected Refugee Bonus drawのどちらから抽選されたScreamerもHorde由来に含む。
- Horde Phase配置直後のPulseもfallen-site再Spawnを即時解決し、Zombieの反応は次回Zombie Phaseからにする。

### 7.4 Horde特殊Slot Weight

ScreamerはHordeの非Horde特殊Slot抽選へ追加する。**Normal ZombieのWeightを5減らし、その5をScreamerへ移す。ScreamerにDirection Capを設けない。**

最後の2 Waveより前:

| Type | Weight |
| --- | ---: |
| Normal Zombie | 65 |
| Police Zombie | 10 |
| Soldier Zombie | 10 |
| Riot Zombie | 5 |
| Hunter Zombie | 5 |
| Screamer Zombie | 5 |

最後の2 Wave:

| Type | Weight |
| --- | ---: |
| Normal Zombie | 60 |
| Police Zombie | 10 |
| Soldier Zombie | 10 |
| Riot Zombie | 5 |
| Hunter Zombie | 5 |
| Gas Zombie | 5 |
| Screamer Zombie | 5 |

既存Riot / Hunter / GasのDirection Capは維持する。Screamerは0..全Slotまで出現可能である。Rejected BonusのType drawも現行どおりBaseと同じ当該Wave表を使うためScreamerを含み、ScreamerだけCapなしとする。

### 7.5 Asset

専用Assetは1体の痩せこけたZombie。ムンク『叫び』を想起させる絶叫・不安のシルエットを持たせるが、絵画そのものの構図や背景を複製しない。透過256×256 PNG `public/assets/board/units/unit_screamer_zombie.png`を正規Assetとし、Asset Registry、Legend、Help、Replay、Live Viewerで同じTypeへ解決する。

### 7.6 Scream Warning

Screamが実際に発生した時点で、発生元がFog of War外でも位置非公開の公開Eventを生成する。発生源Type、位置、方向、正確なRadius、反応数、対象IDは公開しない。同じPhase内の複数ScreamはHuman UIのToast / 重要イベント履歴では1件へ集約するが、Core Event、AI Event、Metricsでは各Pulseを個別記録する。Load直後に過去Toastを再表示しない。

- Player日本語: `悍ましい叫び声が響き渡った`
- Player English: `A horrifying scream echoed across the area.`
- AI日本語: `悍ましい叫び声(特大ノイズ)`
- AI English: `Horrifying scream (extra-large noise)`

これは発生時Toastと重要イベント履歴に残すEvent通知であり、常駐Crisis Summaryではない。正確なRadius 30はProduction Human UI、Help、Agent API、公開Replay / Artifactから除外し、Core Config、決定性テスト、開発用読取専用診断だけで確認できる。

---

## 8. Recon Team — UNIT-01..04

### 8.1 基礎性能

日英名は`偵察チーム` / `Recon Team`。

| 項目 | 値 |
| --- | ---: |
| Population | 5 |
| HP | 25 |
| Recruit Attack | 9 |
| Move / MP | 10 |
| Vision | 10 |
| Range | 6 |
| Combat Noise Radius | 6 |
| Max Fuel | 44 |
| Max carried Military Goods | 40 |

Regular / Veteran Attackは既存式`ceil(recruitAttack * 1.25)`を用い、標準では12 / 12。熟練度、Attack Charge、Supply等は既存Human Unit共通規則へ接続する。

### 8.2 生産

Recon TeamはNational Guardと同じ軍系生産ルートを使う。

- 生産可能: Capital、Player所有で通常編成可能なArmy Base。
- City単独では不可。
- Population 5。
- Civilian Goods / Military Goodsの**生産コストはNational Guardと同値**: Civilian Goods 20 + Military Goods 25。
- 完成熟練度Recruit。
- Army Base予約時のPower、保留、陥落没収等はNational Guardと共通。
- 通常EndTurn固定Military Goods消費はNational Guardと同じ1 / Turn。国家備蓄からの補充後に自動感染鎮圧を処理する。

### 8.3 Fuel

ReconのFuel能力はv1.6.1 National Guardと同値にする。

- Max Fuel 44。
- 通常移動Fuel CostはNational Guardの「v1.6.0計算結果×2」。
- 完成時の有償Fuel補給、Round Robin、Supply内補給もNational Guardと同じ。
- Fuel 0時Emergency Movementは既存National Guardと同じ2 MP、Fuel消費0のまま維持。

### 8.4 Military Goods

ReconのMax carried Military GoodsはNational Guardと同じ40。ただし**攻撃時Costは距離に関係なく固定6**とし、National Guardの距離1 / 2 Cost式は流用しない。

Attack / Counterattack / InterceptionのいずれもRange 1..6で6消費する。6未満の場合はそのCombatを不成立とし、距離1だけ最低攻撃へ落とす等のNational Guard不足特例をReconへ暗黙適用しない。

自動感染鎮圧はNational Guardと同じく1回につきMilitary Goods 1を消費し、熟練度込みAttack相当の感染者を減らす一方、`ceil(Attack * 0.5)`の民間人被害を出す。携行0なら封じ込めだけを行い、感染者減少とAttack Charge消費は行わない。今回の2倍化対象はAttack / Counterattack / InterceptionのCombat Costであり、固定消費と自動鎮圧Costは2倍にしない。

### 8.5 Noise / Reanimation / Asset

- Human Combat Noiseは内部Radius 6、公開Noise Class `medium`。正確なRadiusはProduction Human UI / Agent / Help / 公開Artifactへ出さず、Core Config、テスト、開発用診断だけで扱う。
- 死亡時はSoldier Zombieを1 Unit生成する。Pop5だから5 Zombieを作る等の解釈はしない。
- Assetはscoped sniper rifleを持つ兵士2人＋spotter / escort歩兵3人の5人組とする。透過256×256 PNG `public/assets/board/units/unit_recon_team.png`を正規Assetとして使用する。

---

## 9. Human Unit Fuel / Military Goods全体調整 — FUEL-01..02, AMMO-01..02

### 9.1 Max Fuel

v1.6.0標準値を2倍にする。

| Unit | v1.6.0 | v1.6.1 |
| --- | ---: | ---: |
| Police | 12 | 24 |
| National Guard | 22 | 44 |
| Riot Police | 12 | 24 |
| Recon Team | — | 44 |

初期Unitの満載値も新Maxへ合わせる。完成Unitの有償補給は新Maxまで行うため、必要State Fuelも増える。

### 9.2 通常移動Fuel Cost

既存の「実移動Hex数からUnit Type別Fuel Costを求める」式の結果を2倍する。MPやTerrain Costそのものは変更しない。

Police / Riot Police:

```text
baseCost = distance <= 5 ? 1 : 1 + (distance - 5)
fuelCost = 2 * baseCost
```

National Guard / Recon:

```text
baseCost = distance <= 5 ? 1 : 1 + 2 * (distance - 5)
fuelCost = 2 * baseCost
```

距離0は0。Hidden Enemyによる途中停止時も実進入Hex数から新式で再計算する。Fuel 0 Emergency Movementは既存どおりFuelを消費しないため2倍対象外。

### 9.3 Max carried Military Goods

| Unit | v1.6.0 | v1.6.1 |
| --- | ---: | ---: |
| Police | 5 | 10 |
| National Guard | 20 | 40 |
| Riot Police | 5 | 10 |
| Recon Team | — | 40 |

初期Unitと完成Unitの満載量も新Maxへ合わせる。

### 9.4 攻撃時Military Goods Cost

既存UnitのAttack / Counterattack / Interception Costを2倍する。

- Police Range1: 1 → 2
- Riot Police Range1: 1 → 2
- National Guard Range1: 1 → 2
- National Guard Range2: 2 → 4
- Recon Range1..6: 固定6（Recon固有規則を優先）

National Guard Range2は4未満なら不成立。Reconは全距離で6未満なら不成立。Police / Riot / National Guard Range1は携行Military Goods 0または1でもCombatを許可し、現在量を全て消費してAttackを`max(1, ceil(unit.attack * militaryGoodsShortageAttackMultiplier))`へ弱体化する。標準不足倍率は20%。必要量2を満たす場合だけ通常火力とする。Attack / Counterattack / Interceptionで同じ規則を使い、UIとAgentは実行可否、消費量、実効Attackを同じCore Queryから表示する。

通常のEndTurn固定Military Goods消費、自動鎮圧Cost、Army Base専用迎撃Costは、依頼が「攻撃時消費」を対象としているため本項では変更しない。

---

## 10. 初期Zombie — INIT-01, INIT-02

初期Normal Zombieを25から50へ変更する。

- 初期Hunter 1..4、Gas 1..2は維持。
- 初期Screamer 0。
- Normal ZombieのCapital最小Hex Distanceは8以上。
- Hunterの20以上、Gasの9以上というより厳しい固有条件は維持。
- Normal / Hunter / Gasの全初期個体は、地形LOS遮蔽の有無にかかわらずArmy BaseとのHex Distanceを各個体のConfig Visionより大きくする。標準ではNormal / Gasが4以上、Hunterが6以上。将来Vision値が変われば配置制約も追従する。
- Reserve、Facility、初期Human Unit、既存Zombieとの非重複を維持。

「幹線道路からやや外れた」はHardな候補不足を避けるため、次の決定的優先順位とする。

1. 州都へ伸びる4本の主要Road Branch本線Hexでない候補を優先。
2. さらに主要Road Branch本線に隣接しない候補を優先。
3. 候補不足時だけ次の優先層へ緩和。
4. 各層内はSeed付きの既存決定配置を用いる。

Oil Field、Army Base等へのaccess spurはこの道路回避対象に含めない。道路を絶対禁止にはせず、意図として幹線から外す。Army BaseのVision離隔、Capital距離、Reserve等のHard制約は道路優先層より常に優先する。

---

## 11. Horde Wave — WAVE-01, WAVE-02

### 11.1 Schedule

Wave Turnを次へ変更する。

| Wave | Turn | Directions | 現行non-Horde Slots / direction | v1.6.1 Horde / direction |
| --- | ---: | ---: | ---: | ---: |
| 1 | 10 | 1 | 3 | 5 |
| 2 | 20 | 2 | 5 | 3 |
| 3 | 35 | 1 | 7 | 8 |
| 4 | 50 | 3 | 7 | 5 |
| 5 Final | 70 | 4 | 8 | 8 |

Warning Leadは2を維持。FinalはSchedule最後の`final: true`から導出し70となる。「最後の2 Wave」判定はindex基準でWave 4 / 5、すなわちTurn 50 / 70へ追従する。

### 11.2 1.5倍の意味

1.5倍するのは**固定でスポーンするHorde Zombie数だけ**とし、非Horde Slot数は変更しない。

```text
newHordeCount = ceil(oldHordeCount * 1.5)
```

したがって:

- 3 → 5
- 2 → 3
- 5 → 8

Rejected Refugee Bonusは拡大後Base rosterへ既存どおり別加算する。

標準Schedule全体ではBase Horde数は41 → 66、non-Horde Slotsは73のまま、Base総数は114 → 139となる。Final Waveは4方向合計でHorde 32 + Slot 32 = Base 64となる。

Horde batch分散、Pending、roster freeze、Final affiliation、Victory条件は既存意味論を維持する。

---

## 12. Human Unit自然回復 — HEAL-01

Supply内自然回復を半分にする。

| 前Turn行動 | v1.6.0 | v1.6.1 |
| --- | ---: | ---: |
| 通常攻撃・反撃・迎撃・自動鎮圧あり | 最大HP 10% | 最大HP 5% |
| 移動のみ・Wait・移動後Wait・未行動 | 最大HP 20% | 最大HP 10% |
| Supply外 | 0% | 0% |

端数は既存どおりUnit個別切り上げ。Reconも同じ規則。Zombieは回復しない。

---

## 13. Oil Field / Refinery / Wind — MAP-01, ECO-01..02

### 13.1 Oil Fieldを1基へ

v1.6.0の4 Oil Field候補:

- North `(26,13)` / trunk `(25,13)`
- East `(37,24)` / trunk `(37,25)`
- South `(24,37)` / trunk `(25,37)`
- West `(13,26)` / trunk `(13,25)`

v1.6.1では、この4候補のうち**実際にMapへ配置するOil Fieldを1基だけ**とする。

4候補から等確率で1つをSeed付き決定抽選する。Oil Field選択専用の独立したLayout RNG / deterministic hashを使い、Army Base、初期Zombie、Refugee、Wave等の既存Game RNG消費順をずらさない。同Seed / Map / Configで同じ方角を選ぶ。固定方角方式、runtime非決定抽選、Load時再抽選、複数候補の残存は許可しない。

この方式では:

- 選ばれた1候補だけFacilityと1-Hex access spurを生成。
- 未選択3候補はOil Field Facilityとして存在せず、専用access spurも生成しない。
- 未選択地点にSurvivor、Worker、報酬、Vision、Oil creditを作らない。
- Map / Save / Artifactは実際に選択されたOil Field位置を保持し、Load時に再抽選しない。
- Map IDまたはMap schemaは4基版と取り違えないようv1.6.1で更新する。

Oil Field性能自体は既存どおり最大Worker 5、healthy worker 1人につきeconomy phaseでAllowance +100、電力／Fuel不要を維持する。

### 13.2 Refinery Allowance 2000

全国共有の`initialAllowance`を5000から**2000 Fuel**へ下げる。

これは既存Allowanceモデルの初期値変更であり、Oil Field creditによる累積追加は維持する。つまり2000はOil Field確保前の初期Lifetime Refining Capacityであり、Oil Field稼働によって総利用可能Allowanceが2000を超えることは許可する。Hard ceiling 2000へ変更するものではない。

- Refineryが実際に精製したFuel 1につきAllowance 1消費。
- 初期Stock、確保報酬、他手段Fuel、Fuel消費はAllowanceを減らさない。
- Oil creditは同economy phaseのRefineryが利用可能。
- 過去の発電不足へ遡及しない。
- remainingAllowance 0ならRefineryは精製用電力を要求しない。

### 13.3 Wind建設費1.5倍

Player-built Wind Power Plantの建設費を各コスト成分ごとに次で計算する。

```text
newCost = ceil(v1.6.0Cost * 1.5)
```

現行標準はCivilian Goods 100のためv1.6.1では**Civilian Goods 150**。現行0のMilitary Goods等を新たに追加しない。

初期配置Windは建設費を支払わないため影響なし。建設上限`2 * roadBranches.length`、初期Windを上限外とする規則、Generation 15、Noise、Worker 0等は別指定がないため維持する。

---

## 14. 感染陥落FacilityのNoise再Spawn — FALL-01

対象は**感染して陥落したFacilityがNoise Pulseを受け、感染人口からZombieを再Spawnする処理**。初回陥落時Spawn、Human Unit Reanimation、Scheduled Horde rosterはこの表へ置換しない。

1 Unit生成ごとにSeed付きRNGで:

| Type | Weight |
| --- | ---: |
| Normal Zombie | 70 |
| Gas Zombie | 10 |
| Hunter Zombie | 10 |
| Screamer Zombie | 10 |

Police / Riot / Soldier / Horde Zombieは除外する。

- 抽選順は既存Facility ID / Pulseの安定順を維持。
- 同一Noiseで複数体なら1体ずつ抽選。
- Screamerはこの生成時点では`hasScreamed=false`。後にPopulation / inherited targetを初取得した時にScreamする。
- Spawn直後の同Phase追加行動禁止、即時占有、FIFO連鎖等は既存規則を維持。
- Hidden Spawn Type / 位置をFoW外へ漏らさない。

---

## 15. Core / Save / Agent / Replay — SAVE-01

最低限追加・変更する正データ:

- `reconTeam` Human Unit Type
- `screamerZombie` Zombie Type
- Screamer `hasScreamed`
- Neutral Facility Survivor healthy / infected / expiry / early-capture availability
- 未確保Army Baseの迎撃弾薬、迎撃回数、不可逆な報酬失効状態
- Checkpoint waiting risk予約とdeny切替前Queueの固定Policy
- Oil Field selected candidate / Map identity
- Refinery Allowance initial 2000と既存ledger
- 新Max Fuel / Military Goodsと新Combat Cost
- 新Wave Schedule / Horde count / Screamer Weight

Save / Session / Artifact:

- LoadでSurvivor、Risk、hasScreamed、Oil Field方角、Allowanceを再抽選／リセットしない。
- 同一Seed / Config / Map / Action列でScreamer draw、Survivor人数、Risk、fallen-site drawが一致する。
- v1.6.0以前のSave / Session / Checkpoint / Replay / Artifactは移行しない。Version mismatchで状態不変拒否し、旧データを変換、削除、上書きしない。
- Version境界は次に固定し、旧番号の部分残しをしない。
  - App `1.6.1`
  - Rules / State / Config `11.0.0`
  - Map `fixed-51x51-v6`
  - Save `18`
  - Agent / Observation / Bridge `16.0.0`
  - Artifact `15.0.0`
  - Session / Checkpoint `12.0.0`
  - Balanced Agent `10.0.0`
  - Random Agent `6.0.0`、Play Turn Protocol `1.0.0`、Session Artifact Package `1.0.0`は維持

Agent / Browser Bridgeは公開範囲内で:

- Recon性能、Fuel / Military Goods、固定攻撃Cost 6、公開Noise Class `medium`
- Screamer公開性能とWave混成可能性
- Scream発生Eventと`extraLarge`分類（位置、Radius、発生元は非公開）
- 可視Neutral Facilityの早期確保Survivor報酬が可能か失効済みかという定性情報
- Checkpoint deny / grandfathered Queue / waiting risk
- 視界内の未確保Army Base迎撃Event
- 新Wave schedule / count
- Refinery Allowance
- Oil Field位置

を取得できる。内部Target、未確保Survivor人数・期限・抽選範囲、未確保Army Baseの人数・残弾・残迎撃回数、Hidden Zombie、未解決RNG、正確なScream / Recon Noise Radiusを漏らさない。公開人口集計、Forecast、Metricsの差分からも未確保Survivor人数を逆算できないようにする。

---

## 16. UI / Help / Asset / Metrics更新

Human UI:

- ReconをUnit Production Accordionへ追加。
- Recon Bottom SheetにRange 6、Vision 10、Noise Class `medium`、Fuel 44、Military Goods 40、Attack Cost 6、固定維持1、自動鎮圧Cost 1と民間被害50%を表示。正確なNoise Radius 6は表示しない。
- Visible ScreamerのType / HP / Attack / MP / Vision / Rangeを表示。
- Scream発生時は位置非公開の定型WarningをToastと重要イベント履歴へ表示し、同一Phase内は集約する。
- Checkpointを4Policyへ更新し、deny、grandfathered Queueの旧Policy、waiting riskを表示。
- 可視Neutral FacilityはSurvivor早期確保報酬の可能性／失効だけを表示し、未確保人数と期限を表示しない。
- 視界内の未確保Army Base迎撃時は、生存者が残る可能性を示す定型通知を表示する。
- Refinery Facility詳細へAllowance ledgerを表示。
- Wind候補にCivilian Goods 150を表示。
- Helpの自然回復、Fuel、Military Goods、Wave Turn、Horde数、Screamer Weight、Oil Field 1基、Allowance 2000、定性的なSurvivor早期確保報酬、Army Base報酬期限10を更新。未確保Survivor人数・期限と正確なScream Radiusは説明しない。

Live Viewer / Replay:

- Recon / Screamer Assetを表示。
- Scream、Survivor救出／感染、Risk感染、deny、未確保Army Base迎撃、fallen-site Type等の公開Eventを既存timelineで扱う。各EventのFog of Warと非公開Fieldを維持する。

Metrics:

- Survivor初期／救出／時間切れ感染／接触感染。未確保人数を含む内部集計はactive game中の公開Metricsへ出さない
- deny Turn Away
- waiting risk予約／成立／感染人数
- Screamer生成源、Scream数、Noise Pulse数
- Recon完成／損失／Kill／Fuel／Military Goods／鎮圧民間被害
- Unit Type別Fuel消費、新Maxまでの補給需要
- Unit Type別Combat Military Goods消費／不足
- Wave別Horde base count、Slot、Screamer draw
- Oil Field選択方角、Oil credit
- Refinery initial / earned / refined / remaining allowance
- 未確保Army Baseの迎撃射数、弾薬消費、Survivor防衛Turn、報酬の取得／期限失効／陥落失効
- Wind建設費支出
- fallen-site respawn Type内訳

---

## 17. 受入試験

最低限:

1. 390×844相当ChromeでHuman Game中にAI Play Watch固定入口がなく、タイトルからViewerへ入れる。
2. Constructible Accordionでコスト、性能、上限、選択HexのCore Reasonを確認できる。
3. Refinery選択時にInitial 2000、Oil Credits、Fuel Refined、Remaining Allowanceを確認できる。
4. 新規ゲームの全中立恒久Facilityに1..10抽選後capacity clampしたSurvivorが施設ID別に再現し、別Facilityや既存Game RNGの順序へ影響しない。上限5では1..4が各10%、5が60%になる。
5. 未確保Survivorの人数、期限、抽選範囲がHuman / Agent / 公開Replay / 公開Artifact / 人口集計差分へ漏れず、可視Facilityでは報酬可能／失効の定性情報だけを確認できる。
6. SurvivorをPlayer Turn 10中までに確保すると結果Eventで救出数を初めて公開し、健康人口として取得する。未確保なら10回目EndTurnのRefugee後に全員感染し、同じEndTurnの感染・陥落処理へ入る。
7. Zombie自身からVisibleな未確保SurvivorがPopulation Targetになり、Playerに非公開の人数をTarget選択や公開情報から漏らさない。
8. `deny`切替前のwaitingは切替直前Policyを固定してActive / RemnantでScreeningを継続し、切替後Arrivalだけを同Refugee Phaseで全自動拒絶する。既存screening / approvedは維持する。
9. waiting 100 / 101 / 150 / 200で0 / 1 / 50 / 100%を予約し、成立時1..5人だけwaitingから感染する。予約はCheckpoint IDへ残り、移設・Role・Policy変更では消えず、対象消滅またはwaiting 0なら0人で消費する。
10. 過密感染後の同一EndTurn感染拡大、自動鎮圧、陥落が既存Checkpoint感染規則と一致する。
11. ScreamerがHP15 / ATK10 / MP3 / Vision2で、Population / inherited Horde Target初取得Screamを一度だけ出す。
12. Screamのfallen-site効果は即時、Zombie反応は次回Zombie Phaseで、発生元自身は自分のPulseを取得しない。
13. Base / Rejected Bonus由来Screamerは実配置直後にScreamし二重発生しない。
14. Scream WarningはFoW外でも位置・範囲・発生元を漏らさず指定文言で通知し、Humanは同一Phaseで1件へ集約、AIは各Eventと`extraLarge`を受け取る。Radius 30はProduction公開面へ出ない。
15. pre-last-two Weightが65/10/10/5/5/5、last-twoが60/10/10/5/5/5/5で、ScreamerにCapがない。
16. ReconがPop5 / HP25 / Recruit9 / MP10 / Vision10 / Range6 / Noise Class medium / Fuel44 / MG40で、Capital / Army Baseから生産できる。
17. ReconのRange1..6 Attack / Counter / Interceptionが常にMG6を要求し、5以下なら不成立になる。
18. Reconが固定MG1 / Turn、自動鎮圧MG1、鎮圧民間被害50%をNational Guardと同じ順序・端数処理で適用する。
19. Recon死亡でSoldier Zombie 1 Unitを生成する。
20. Police / Riot maxFuel 24、Guard / Recon 44。通常移動Fuel Costが旧計算の2倍で、Emergency MovementはFuel0のまま機能する。
21. Police / Riot maxMG10、Guard / Recon40。Police / Riot / Guard Range1 cost2、Guard Range2 cost4、Recon全距離6でUI / Agent / Coreが一致する。Range1でMG0 / 1なら全残量を消費して20%火力になる。
22. 初期Normal Zombie 50、Capital距離8以上、主要Road Branch本線回避、Hunter / Gas固有条件が同Seedで再現する。access spurはSoft回避対象外。
23. 全初期Normal / Hunter / GasがArmy Baseから各個体Visionより遠く、標準ではNormal / Gas距離4以上、Hunter距離6以上になる。
24. 未確保Army Baseが健康Survivor数分だけPlayer所有時と同性能でZombieを迎撃し、専用MG40を消費するが未確保中は補充しない。感染、0人、弾薬不足、陥落時に停止する。
25. 視界外の未確保Army Base迎撃は非公開、視界内では指定Toast / 履歴 / Agent Eventだけを公開し、人数・弾薬・Hidden Zombieを漏らさない。
26. Army Base報酬はPlayer Turn 10中まで、健康Survivor 1人以上、過去にdisabled / ruinedなしの場合だけNational Guard 1 Unitを与え、失効後に復活しない。
27. Waveが10 / 20 / 35 / 50 / 70、Horde/directionが5 / 3 / 8 / 5 / 8、Slot数が3 / 5 / 7 / 7 / 8で一致する。
28. 全ScheduleのBase Horde 66、Slot 73、Base Total 139、Final Base 64をHelp / Agent / Metricsが同じConfigから表示する。
29. 自然回復がCombat5% / Rest10% / Supply外0%、個別切り上げ。
30. Oil Fieldが4候補から独立Seed付き等確率で1基だけ選ばれ、Loadで位置が変わらず、既存Game RNG順を変えない。
31. 未選択Oil Field 3地点にFacility / spur / Survivor / creditが残らない。
32. Refinery initialAllowanceが2000、Oil credit追加、実精製消費、remaining式が一致する。
33. Player-built Windの標準建設費がCivilian Goods150で、初期Wind性能は変わらない。
34. fallen infected FacilityのNoise再SpawnがNormal / Gas / Hunter / Screamer = 70 / 10 / 10 / 10で、除外Typeを生成しない。
35. v1.6.1のSave Round Trip / Session Resume / Replay / Artifactで新StateとRNGが一致し、v1.6.0以前は状態不変で拒否する。全Version境界が15章の値と一致する。
36. TypeScript型検査、通常Unit / Checkpoint / Noise / Wave / Replay回帰、production build、390×844 mobile smoke、2 Assetの透過・寸法・縮小可読性検証を通す。

---

## 18. 確定判断

- Oil Field: 現4候補から独立Seed付き等確率で1基。固定方式は禁止。
- Refinery Allowance: 初期2000。Oil creditによる累積追加は維持。
- Survivor: 全中立恒久Facility、施設ID別1..10抽選後capacity clamp、Player Turn 10後に感染。確保前の人数・期限は非公開。
- Checkpoint deny: 切替前Queueは旧Policyで継続、切替後Arrivalだけ即時拒絶。
- Checkpoint過密Risk: 固定Phase順、Checkpoint IDへ予約、後続感染処理へ接続。
- Screamer: Weight 5、Capなし、非公開Radius 30、AI公開Class extraLarge、Human定型Warning、次回Zombie Phase反応。
- Recon: 全射程MG6、Noise Class medium、固定維持1、自動鎮圧Cost1・民間被害50%。
- 既存Range1 UnitのMG不足: 0 / 1を全消費して20%火力。
- Horde倍率: 固定Horde数だけ`ceil(x * 1.5)`、Slot不変。
- 未確保Army Base: Survivor数による迎撃、未確保中の弾薬補充なし、報酬期限Turn 10、陥落・全滅で不可逆失効。
- 保存互換: v1.6.0以前から移行しない。

ゲーム挙動に影響する複数方式の実装裁量は残さない。内部の型名や純粋関数の分割は、公開契約、決定性、GameAction → GameEngine境界、受入試験を変えない範囲に限る。

---

## 19. 実装順序案

1. Config / schema / Version: Unit fuel/MG、Recon、Screamer、Wave、Allowance、Wind、Survivor、deny Queue、Army Base状態。
2. Map生成: 独立Seed付きOil Field 1基とspur、Army Base離隔を満たす初期Zombie、Map identity、Save validation。
3. Survivor期限・非公開Projection、未確保Army Base迎撃・報酬失効、Checkpoint deny / riskのState遷移。
4. Screamer Scream、Warning、Wave table、fallen-site weighted respawnを既存Noise pipelineへ接続。
5. ReconをProduction / Combat / Fuel / MG / Suppression / Reanimationへ接続。
6. Human UI: AI入口、Construction Accordion、Refinery Allowance、Recon / Screamer / Survivor / Army Base / Checkpoint。
7. 指定済み2 AssetをRegistry / Legend / Help / Replay / Live Viewerへ接続。
8. Agent / Browser / Session / Replay / Artifact / Help / Metrics更新。
9. 決定性、FoW、Save拒否、mobile、production buildを受入試験する。
