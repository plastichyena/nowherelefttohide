# Nowhere Left to Hide PoC v1.6.1 アップデート要件 ドラフト

- ステータス: **ドラフト／要レビュー。ゲーム実装・リリースではない。**
- 作成日: 2026-09-14
- 改訂日: 2026-09-15。Oil Field、Wind、Refinery Allowance、Fuel／Military Goods、Survivor、Screamer、Horde倍率、Reconの曖昧さを具体化。
- 基準: v1.6.0 / commit `6364ea196629bd5aa71d89066c0051d35911a98d`
- 根拠: 依頼者のv1.6.1要望、2026-09-15追加指定、現行 `Doc/Nowhere Left to Hide PoC 現行仕様.md`
- この変更は文書のみ。既存の現行仕様、実装、アプリのバージョン番号は変更しない。

本書の「必須」は依頼事項または、それを既存Coreへ矛盾なく接続するために必要な受入要件を示す。今回の追加指定により、前版ドラフトで残していたSurvivor人数、Screamer Wave Weight、Recon弾薬消費、Horde 1.5倍の配分は確定扱いへ移す。Oil Fieldの1基化だけは依頼者が実装上の裁量を明示しているため、許容する2方式と優先順位を本書で限定する。

---

## 1. 目的

v1.6.1はv1.6.0の基盤を全面的に作り直さず、Human UIの操作性、避難民・Survivor・感染圧、偵察とNoise、資源制約、Horde圧力を強める調整版とする。

主目的:

1. スマートフォンHuman UIの操作阻害を解消し、内政・施設情報を発見しやすくする。
2. 中立施設Survivor、Checkpoint deny、waiting過密感染を導入する。
3. Screamer ZombieとRecon Teamを導入する。
4. 初期Zombie、Horde、自然回復、Fuel、Military Goodsを再調整する。
5. Oil Fieldを希少資源化し、Refinery Allowanceを1500へ下げ、Wind建設費を引き上げる。
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
| SURV-02 | Survivor人数は1..10のSeed付き乱数、施設収容上限でclamp | 必須 |
| SURV-03 | 未確保SurvivorをZombieのPopulation Target対象にする | 必須 |
| SURV-04 | 未確保Survivorを10 Turn後に感染者へ変換 | 必須 |
| CP-01 | Checkpoint Policyへ`deny`を追加 | 必須 |
| CP-02 | deny時にwaitingのみEndTurnで全員追い返す | 必須 |
| CP-03 | waiting > 100で翌Turn感染リスクを予約 | 必須 |
| Z-01 | Screamer Zombieを追加 | 必須 |
| Z-02 | Population / inherited Horde Target取得時に初回だけRadius 30 Noise | 必須 |
| Z-03 | Horde由来Screamerは実配置直後にScream | 必須 |
| Z-04 | Wave WeightはNormalから5を移してScreamer 5、Capなし | 必須 |
| UNIT-01 | Recon Teamを追加 | 必須 |
| UNIT-02 | Recon攻撃時Military Goods Costは距離1..6すべて5 | 必須 |
| UNIT-03 | Recon死亡時Soldier Zombie 1 Unitを生成 | 必須 |
| UNIT-04 | Recon専用Assetを追加 | 必須 |
| INIT-01 | 初期Normal Zombieを25から50へ | 必須 |
| INIT-02 | Capitalから8 Hex以上、幹線から外れ気味に配置 | 必須 |
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
| ECO-02 | 初期Refinery Allowanceを5000から1500へ | 必須 |
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

- `Initial Refinery Allowance`: 標準1500
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

各対象Facilityごとに独立してSeed付きで1..10の整数を等確率抽選し、Facilityが保持可能な健康人口上限でclampする。

```text
rolled = randomIntInclusive(1, 10)
survivors = min(rolled, facilityHealthyPopulationCapacity)
```

例:

- 上限30 → 1..10
- 上限10 → 1..10
- 上限5 → 1..5

開始時中立Facilityに人口上限0のTypeが将来追加された場合はConfig validationで明示的に扱い、架空の収容枠を作らない。現行対象Typeは少なくとも1人を収容可能であることをリリース検証する。

乱数はGame Seedから決定的に得る。同Seed / Map / ConfigならFacilityごとの人数が一致する。Save / Loadで再抽選しない。

### 4.3 早期確保

Survivorが残る中立FacilityをPlayerが確保した瞬間、残存健康SurvivorをそのFacilityのPlayer健康人口として引き継ぐ。

- 追加Action不要。
- 既存の初回確保資源報酬と累積する。
- 再確保でSurvivorを再生成しない。
- 確保後は通常の維持費、感染、敗北判定、人口操作ルールへ入る。

### 4.4 10 Turn期限

ゲーム開始から10回のEndTurnを完了するまで未確保だったFacilityでは、残る健康Survivorを同Facilityの感染者へ全員変換する。

- 人口新規生成ではなく`healthy -> infected`。
- Save / Resumeで期限をリセットしない。
- Zombie接触で先に感染・死亡した人数は二重変換しない。
- 10 Turn到達時のPhase順はCoreで固定しReplayと一致させる。

### 4.5 Zombie AI Target

未確保Survivorは実在する健康人口として、ZombieのVisible Population Target対象に含める。

- Normal AI優先度`Visible Population > wave_capital / inherited Horde > Noise > Idle`を維持。
- Zombieから見えないSurvivorをTargetにしない。
- Facility到達時は既存のFacility接触・感染処理へ接続する。
- Hidden Survivor数をHuman / Agentへ漏らさない。

---

## 5. Checkpoint `deny` — CP-01, CP-02

現行`pass / normal / strict`に`deny`を加える。

`deny`の意味:

- 新規ArrivalはActive Checkpointの`waiting`へ入る。
- deny中はwaitingから新しいScreeningを開始しない。
- 既存`screening`はBatch開始時Policyと残りTurnを維持する。
- `approved`は自動配置待ちを継続し、denyで追い返さない。
- EndTurnのRefugee処理で、その時点の`waiting`を全員Turn Awayする。
- 自動Turn Away人数は既存Rejected Counterへ加える。Final roster freeze後は既存どおりCounter加算しない。
- 自動拒絶は追加Player Actionを消費しない。

UI / Agentは「waitingのみ拒絶」「screening / approvedは対象外」「新規Screening停止」を明示する。

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

Turn末に求めたRiskを次TurnのRefugee処理で解決する。

推奨固定順序:

1. 前Turn末に予約したRiskを解決。
2. 既存Screening進行・判定。
3. 新規Arrival。
4. denyならwaiting全員をTurn Away。
5. 残ったwaitingから翌Turn用Riskを計算・保存。

Risk発生時:

- Seed付きRNGで発生有無を1回判定。
- 成立時に1..5人を等確率抽選。
- 実感染人数=`min(currentWaiting, rolledCount)`。
- waitingからinfectedへ変換し、screening / approvedは対象外。
- waiting 0なら0人。

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

Screamerごとに`hasScreamed`を保持する。通常出現個体は初めて以下のいずれかをTargetとして獲得した時点で、自身のHexを中心にRadius 30 Noise Pulseを1回発生する。

- Visible Population Target
- inherited Horde Target / wave_capital系のHorde inherited target

Noise Target、Idle、単なる移動だけではScreamしない。一度Screamした個体はTargetを失って再取得しても再発生しない。

既存Noise Systemへ接続し、Screamer専用の第二Targeting Systemを作らない。

### 7.3 Horde由来Screamer

Horde roster由来Screamerは、PendingからMapへ実配置された直後にRadius 30 Noiseを1回発生し、`hasScreamed=true`にする。

- Pending中はScreamしない。
- Spawn space不足で未配置ならScreamしない。
- 配置後のPopulation / inherited Target取得では二重Screamしない。
- 複数Screamerが同batchに出れば各個体が1 Pulseずつ出す。

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

専用Assetは1体の痩せこけたZombie。ムンク『叫び』を想起させる絶叫・不安のシルエットを持たせるが、絵画そのものの構図や背景を複製する必要はない。Asset Registry、Legend、Help、Replay、Live Viewerで同じTypeへ解決する。

---

## 8. Recon Team — UNIT-01..04

### 8.1 基礎性能

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

### 8.3 Fuel

ReconのFuel能力はv1.6.1 National Guardと同値にする。

- Max Fuel 44。
- 通常移動Fuel CostはNational Guardの「v1.6.0計算結果×2」。
- 完成時の有償Fuel補給、Round Robin、Supply内補給もNational Guardと同じ。
- Fuel 0時Emergency Movementは既存National Guardと同じ2 MP、Fuel消費0のまま維持。

### 8.4 Military Goods

ReconのMax carried Military GoodsはNational Guardと同じ40。ただし**攻撃時Costは距離に関係なく固定5**とし、National Guardの距離1 / 2 Cost式は流用しない。

Attack / Counterattack / InterceptionのいずれもRange 1..6で5消費する。5未満の場合はそのCombatを不成立とし、距離1だけ最低攻撃へ落とす等のNational Guard不足特例をReconへ暗黙適用しない。

自動感染鎮圧に参加する場合のCostは「攻撃時Cost」とは別の既存鎮圧規則を用いる。今回の2倍化対象はAttack / Counterattack / InterceptionのCombat Costであり、既存のターン固定Military Goods消費や自動鎮圧Costを暗黙に2倍にしない。

### 8.5 Noise / Reanimation / Asset

- Human Combat NoiseはRadius 6。
- 死亡時はSoldier Zombieを1 Unit生成する。Pop5だから5 Zombieを作る等の解釈はしない。
- Assetはscoped sniper rifleを持つ兵士2人＋spotter / escort歩兵3人の5人組。

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
- Recon Range1..6: 固定5（Recon固有規則を優先）

National Guard Range2は4未満なら不成立。Police / Riot / National Guard Range1の「弾薬0時最低攻撃」等の不足時挙動は既存意味論を保ち、Cost閾値だけ新値に合わせる。具体的には必要量未満だが0より大きいケースをCoreで明示的に検証し、UIとAgentで実行可否・実効Attackを同じQueryから表示する。

通常のEndTurn固定Military Goods消費、自動鎮圧Cost、Army Base専用迎撃Costは、依頼が「攻撃時消費」を対象としているため本項では変更しない。

---

## 10. 初期Zombie — INIT-01, INIT-02

初期Normal Zombieを25から50へ変更する。

- 初期Hunter 1..4、Gas 1..2は維持。
- 初期Screamer 0。
- Normal ZombieのCapital最小Hex Distanceは8以上。
- Hunterの20以上、Gasの9以上というより厳しい固有条件は維持。
- Reserve、Facility、初期Human Unit、既存Zombieとの非重複を維持。

「幹線道路からやや外れた」はHardな候補不足を避けるため、次の決定的優先順位とする。

1. 幹線Road Hexでない候補を優先。
2. さらに幹線Roadに隣接しない候補を優先。
3. 候補不足時だけ次の優先層へ緩和。
4. 各層内はSeed付きの既存決定配置を用いる。

これにより道路を絶対禁止にはせず、意図として幹線から外す。

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

採用優先順位:

1. **推奨方式:** 4候補から等確率で1つをSeed付き決定抽選する。
2. 実装構造上、Map / Save / Road生成への影響が不釣り合いに大きい場合のみ、実装時に4候補のどれか1つへ固定してよい。

推奨方式ではOil Field選択専用の独立したLayout RNG / deterministic hashを使い、Army Base、初期Zombie、Refugee、Wave等の既存Game RNG消費順をずらさない。同Seed / Map / Configで同じ方角を選ぶ。

固定方式を採る場合は選択方角をMap Config / 要件確定記録へ明示し、Buildごと・Reloadごとに変わらないこと。

いずれの方式でも:

- 選ばれた1候補だけFacilityと1-Hex access spurを生成。
- 未選択3候補はOil Field Facilityとして存在せず、専用access spurも生成しない。
- 未選択地点にSurvivor、Worker、報酬、Vision、Oil creditを作らない。
- Map / Save / Artifactは実際に選択されたOil Field位置を保持し、Load時に再抽選しない。
- Map IDまたはMap schemaは4基版と取り違えないようv1.6.1で更新する。

Oil Field性能自体は既存どおり最大Worker 5、healthy worker 1人につきeconomy phaseでAllowance +100、電力／Fuel不要を維持する。

### 13.2 Refinery Allowance 1500

全国共有の`initialAllowance`を5000から**1500 Fuel**へ下げる。

これは既存Allowanceモデルの初期値変更であり、Oil Field creditによる累積追加は維持する。つまり1500はOil Field確保前の初期Lifetime Refining Capacityであり、Oil Field稼働によって総利用可能Allowanceが1500を超えることは許可する。Hard ceiling 1500へ変更するものではない。

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
- Neutral Facility Survivor healthy / infected / expiry
- Checkpoint waiting risk予約
- Oil Field selected candidate / Map identity
- Refinery Allowance initial 1500と既存ledger
- 新Max Fuel / Military Goodsと新Combat Cost
- 新Wave Schedule / Horde count / Screamer Weight

Save / Session / Artifact:

- LoadでSurvivor、Risk、hasScreamed、Oil Field方角、Allowanceを再抽選／リセットしない。
- 同一Seed / Config / Map / Action列でScreamer draw、Survivor人数、Risk、fallen-site drawが一致する。
- schema変更後、v1.6.0データをv1.6.1として黙って読むことは禁止。Migrationを作らない場合はVersion mismatchで状態不変拒否。
- v1.6.1のRules / State / Config / Map / Save / Agent / Artifact / Session versionは実装時に一括更新し、旧番号の部分残しをしない。

Agent / Browser Bridgeは公開範囲内で:

- Recon性能、Fuel / Military Goods、固定攻撃Cost 5
- Screamer公開性能とWave混成可能性
- 可視Neutral Survivor
- Checkpoint deny / waiting risk
- 新Wave schedule / count
- Refinery Allowance
- Oil Field位置

を取得できる。内部Target、Hidden Survivor、Hidden Zombie、未解決RNGを漏らさない。

---

## 16. UI / Help / Asset / Metrics更新

Human UI:

- ReconをUnit Production Accordionへ追加。
- Recon Bottom SheetにRange 6、Vision 10、Noise 6、Fuel 44、Military Goods 40、Attack Cost 5を表示。
- Visible ScreamerのType / HP / Attack / MP / Vision / Rangeを表示。
- Checkpointを4Policyへ更新しdenyとwaiting riskを表示。
- 可視Neutral FacilityのSurvivor人数を表示。
- Refinery Facility詳細へAllowance ledgerを表示。
- Wind候補にCivilian Goods 150を表示。
- Helpの自然回復、Fuel、Military Goods、Wave Turn、Horde数、Screamer Weight、Oil Field 1基、Allowance 1500を更新。

Live Viewer / Replay:

- Recon / Screamer Assetを表示。
- Scream、Survivor救出／感染、Risk感染、deny、fallen-site Type等の公開Eventを既存timelineで扱う。

Metrics:

- Survivor初期／救出／時間切れ感染／接触感染
- deny Turn Away
- waiting risk予約／成立／感染人数
- Screamer生成源、Scream数、Noise Pulse数
- Recon完成／損失／Kill／Fuel／Military Goods
- Unit Type別Fuel消費、新Maxまでの補給需要
- Unit Type別Combat Military Goods消費／不足
- Wave別Horde base count、Slot、Screamer draw
- Oil Field選択方角、Oil credit
- Refinery initial / earned / refined / remaining allowance
- Wind建設費支出
- fallen-site respawn Type内訳

---

## 17. 受入試験

最低限:

1. 390×844相当ChromeでHuman Game中にAI Play Watch固定入口がなく、タイトルからViewerへ入れる。
2. Constructible Accordionでコスト・性能・上限・Reasonを確認できる。
3. Refinery選択時にInitial 1500、Oil Credits、Fuel Refined、Remaining Allowanceを確認できる。
4. 新規ゲームの全中立恒久Facilityに`1..min(10, capacity)`のSurvivorが同Seedで再現する。初期Player所有Facilityには追加されない。
5. Survivorを10 Turn前に確保すると健康人口として取得し、未確保なら期限で感染する。
6. Visible SurvivorがZombie Population Targetになり、Hidden Survivorは公開されない。
7. denyでwaitingだけがTurn末に全拒絶され、screening / approvedは残る。
8. waiting 100 / 101 / 150 / 200で0 / 1 / 50 / 100%を予約し、成立時1..5人だけwaitingから感染する。
9. ScreamerがHP15 / ATK10 / MP3 / Vision2で、Target初取得Screamを一度だけ出す。
10. Horde由来Screamerは実配置直後にScreamし二重発生しない。
11. pre-last-two Weightが65/10/10/5/5/5、last-twoが60/10/10/5/5/5/5で、ScreamerにCapがない。
12. ReconがPop5 / HP25 / Recruit9 / MP10 / Vision10 / Range6 / Noise6 / Fuel44 / MG40で、Capital / Army Baseから生産できる。
13. ReconのRange1..6 Attack / Counter / Interceptionが常にMG5を要求する。
14. Recon死亡でSoldier Zombie 1 Unitを生成する。
15. Police / Riot maxFuel 24、Guard / Recon 44。通常移動Fuel Costが旧計算の2倍で、Emergency MovementはFuel0のまま機能する。
16. Police / Riot maxMG10、Guard / Recon40。Police/Riot/Guard Range1 cost2、Guard Range2 cost4、Recon全距離5でUI / Agent / Coreが一致する。
17. 初期Normal Zombie 50、Capital距離8以上、Road Avoidance、Hunter / Gas固有条件が同Seedで再現する。
18. Waveが10 / 20 / 35 / 50 / 70、Horde/directionが5 / 3 / 8 / 5 / 8、Slot数が3 / 5 / 7 / 7 / 8で一致する。
19. 全ScheduleのBase Horde 66、Slot 73、Base Total 139、Final Base 64をHelp / Agent / Metricsが同じConfigから表示する。
20. 自然回復がCombat5% / Rest10% / Supply外0%、個別切り上げ。
21. Oil Fieldが1基だけ存在し、推奨Seed選択または明示固定方式のどちらか一つに実装が統一され、Loadで位置が変わらない。
22. 未選択Oil Field 3地点にFacility / spur / Survivor / creditが残らない。
23. Refinery initialAllowanceが1500、Oil credit追加、実精製消費、remaining式が一致する。
24. Player-built Windの標準建設費がCivilian Goods150で、初期Wind性能は変わらない。
25. fallen infected FacilityのNoise再SpawnがNormal/Gas/Hunter/Screamer=70/10/10/10で、除外Typeを生成しない。
26. Save Round Trip / Session Resume / Replay / Artifactで新StateとRNGが一致する。
27. Fog of War下でHidden Survivor、Hidden Screamer、内部Target、Noise Target、未解決Risk / drawを漏らさない。
28. TypeScript型検査、通常Unit / Checkpoint / Noise / Wave / Replay回帰、production build、mobile smokeを通す。

---

## 18. 実装判断として残す範囲

前版ドラフトで未確定だった4件は今回すべて確定した。

- Survivor人数: 全中立Facility、1..10、capacity clamp
- Screamer Wave: Normal Weight -5 / Screamer +5、Capなし
- Recon弾薬: 全射程5
- Horde倍率: 固定Horde数だけ`ceil(x * 1.5)`、Slot不変

残る実装裁量はOil Field方角の選択方式だけであり、許容範囲を次に限定する。

- 第一選択: 現4候補からSeed付き等確率選択。
- 実装負担が不釣り合いな場合: 現4候補から1地点を固定。
- どちらを採ったかは確定版／検証記録へ残す。
- runtimeで非決定的に選ぶ、Loadで再抽選する、4候補のうち複数を残す実装は禁止。

これ以外の数値・順序は本ドラフトをv1.6.1の既定要求として扱える粒度まで固定する。

---

## 19. 実装順序案

1. Config / schema: Unit fuel/MG、Recon、Screamer、Wave、Allowance、Wind cost、Oil Field count。
2. Map生成: Oil Field 1基とspur、Map identity、Save validation。
3. Survivor、Checkpoint deny / riskのState遷移。
4. Screamer Scream、Wave table、fallen-site weighted respawnを既存Noise pipelineへ接続。
5. ReconをProduction / Combat / Fuel / MG / Reanimationへ接続。
6. Human UI: AI入口、Construction Accordion、Refinery Allowance、Recon / Screamer / Survivor / Checkpoint。
7. Agent / Browser / Session / Replay / Artifact / Help / Metrics更新。
8. 決定性、FoW、Save、mobile、production buildを受入試験する。
