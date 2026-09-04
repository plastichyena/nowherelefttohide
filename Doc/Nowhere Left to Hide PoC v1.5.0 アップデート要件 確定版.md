# Nowhere Left to Hide PoC v1.5.0 アップデート要件 確定版

- 作成日: 2026-09-03
- 確定日: 2026-09-04
- ステータス: 要件確定・未実装
- 対象Release: `1.5.0`
- 基準安定版: `v1.4.5`
- 実装状態: 未実装

## 1. 文書の位置づけ

本書はv1.4.5を基準とし、v1.5.0で実装するHuman UIの情報設計、危機喚起情報、Human Unit熟練度、Riot Police／Riot Zombie、Scheduled Hordeの微増強・特殊Zombie混成・Horde移動Noiseを定義する確定要件である。

本書で明示的に変更しないルールはv1.4.5を維持する。

v1.5.0では、v1.4.5で成立した「単純な戦闘火力だけではなく、感染、補給、人口、Checkpoint、Horde予告を同時に管理する」という中心体験を維持する。新規要素は既存Unitの全面置換や経済ルールの再設計ではなく、次の4点を強化することを目的とする。

1. Human UIを選択対象中心に再構成し、一度に表示する情報を人間の認知範囲へ収める。Agent向け情報は削減しない。
2. 人間および外部AIが、公開済みの重大リスクを大量の状態情報から見落としにくくする。
3. Human Unitを生存させる長期的価値を追加し、補充直後のUnitと古参Unitを区別する。
4. Hordeを単純なHP／個体数増加だけで強化せず、Police／Soldier／Riot Zombieの混成と移動Noiseによって戦術的な質を増やす。

本書の標準値を実装初期値とする。100 Seed Batchで合格基準を外れた場合だけ、特殊Zombie Weight、追加Slot数、Riot Police編成Costの順で調整し、最終値を本書へ反映してからReleaseを完了する。熟練度条件、Veteran Attack Charge、Horde Noise Radius 8は調整対象外とする。数値はConfig化し、Core Ruleの書き換えや実行中の動的難易度調整を行わない。

---

## 2. 背景と目的

v1.4.5 Seed 1を外部LLMがAI Portable Sessionから公開Observation／Legal Actionsだけを読みながらプレイした検証では、Turn 23にCapital Lostで敗北した。

同Runでは経済資源が枯渇したわけではなく、Human Unitも一定数維持されていた。一方で次の認知・運用上の失敗が確認された。

- 感染中Facility／CheckpointへPolice／National Guardを駐留させる自動鎮圧を一度も有効活用しなかった。
- 敵が一時的に見えないTurnで、補給圏外の部隊を回復・再配置せずEndTurnした。
- `ready`なUnitや攻撃権が残っているにもかかわらず、行動を使い切ったと誤認してEndTurnしたTurnがあった。
- Capitalが高感染状態である一方、Capitalへ移動可能なPoliceが存在したにもかかわらず、局地Combatを優先した。
- North Checkpointの感染崩壊がFallbackへ連鎖していることを、個別イベントではなく州全体の危機として十分に認識できなかった。

これらは必要情報が非公開だったことによる失敗ではない。v1.4.5 Agent Observationには該当Facility感染、Unit状態、Supply、Legal Move、Forecast等が存在した。しかしObservationとLegal Actionsが大きくなる局面では、重大な公開情報が大量の正しい情報へ埋没し得る。

したがってv1.5.0では、Coreの公開情報完全性を維持したまま、Human UIとAgent Observationへ「危機喚起用の派生要約」を追加する。

同時に、Human UnitへRecruit／Regular／Veteranの熟練度を追加する。初期配置Unitはv1.4.5相当性能を維持するRegularとし、新規編成Unitを原則Recruitとすることで、損耗と補充へ時間的コストを持たせる。

さらにPolice系重装UnitとしてRiot Policeを追加する。Riot Policeは高HP・低射程・中機動の「補給網に接続された動くBlockade／感染鎮圧Unit」とし、通常Policeの高機動即応役、National Guardの射程2野戦火力とは異なる役割を持つ。

Hordeは既存Wave Scheduleを維持しつつ軽度に増強し、Normal Zombie枠の一部をPolice Zombie／Soldier Zombie／Riot ZombieへSeed付きで置換する。これによりVeteran化によるHuman側の戦力成長を単純な敵HP増加ではなく、敵編成の多様化で受ける。

---

## 3. 変更概要

| 項目 | v1.4.5 | v1.5.0確定要件 |
|---|---|---|
| Human UI情報量 | Bottom Sheetへ全体情報と対象詳細を大量表示 | 選択対象だけを表示。未選択時だけ全体情報をAccordion表示し、資源詳細は上部HUDへ分離 |
| 資源HUD | 現在値と電力集約値 | Food／Civilian Goods／Military Goods／Fuel／電力を単一展開Accordion化し、未充足予測を`!`で表示 |
| 危機喚起 | Raw Observation、Forecast、Event、UIカード中心 | Public State由来の`Crisis Summary`／`EndTurn Risk`をHuman UI・Agent Observationへ追加 |
| EndTurn | Legalなら即実行可能 | Legalは維持。CriticalまたはAttack／鎮圧可能な残Chargeがある場合だけHuman UIで追加警告。Agentには全未使用Actionを構造化して返す |
| Human Unit熟練度 | なし | `recruit / regular / veteran` |
| 初期Police／National Guard | 現行性能 | `regular`として現行性能を維持 |
| 新規編成Unit | 完成時から現行性能 | 標準`recruit`。ConfigでUnit Type別に変更可能 |
| Recruit→Regular | なし | Recruitとして5 Turn生存で自動昇格、Attack +25%を切り上げ |
| Regular→Veteran | なし | Regular昇格後にZombie Unit 5体撃破で昇格 |
| Veteran Bonus | なし | Attack Charge +1。標準2回 |
| 自動感染鎮圧 | Unitごと最大1回 | 残Attack Charge数だけ判定。Veteranが2 Charge残していれば最大2回 |
| Police Recruit Attack | 5 | 4 |
| National Guard Recruit Attack | 10 | 8 |
| Riot Police | なし | HP75 / Recruit Attack10 / MP10 / Range1 / Vision5 / Pop10 |
| Riot Regular Attack | なし | `ceil(10 × 1.25) = 13` |
| Riot Zombie | なし | HP50、その他はPolice Zombie相当 |
| Riot死亡 | なし | 同HexへRiot ZombieをReanimation |
| Horde構成 | Horde Zombie + Normal Zombie固定 | Horde Zombieを維持し、非Horde枠をZombie／Police Zombie／Soldier Zombie／Riot Zombieから決定的抽選 |
| Horde規模 | Turn 5/10/20/35/50の現行値 | Wave Turn維持。Turn 10以降、方向ごとの非Horde枠を+1 |
| Warning Composition | Config固定Compositionを表示 | 総数・Horde Zombie数・特殊混成可能性を表示。Spawn前の未確定乱数結果は公開しない |
| Zombie Noise | Human Unit参加Combatだけが発生 | Human CombatとHorde実移動を共通Noise Pulse化。Horde移動はRadius 8 |

---

## 4. 危機喚起通知の改善

### 4.1 基本原則

危機喚起は新しいゲームルールや別AIを作らない。GameStateの公開可能情報、既存Forecast、Legal Actionsから決定的に導出するRead Only Projectionとする。

危機喚起生成は次を満たす。

- State、Resource、Action Count、PRNGを変更しない。
- Hidden Zombie、Enemy内部Target、Noise Target、将来PRNG、Warning前Horde方向等を参照しない。
- 同一公開Stateから常に同一のAlert集合・順序を返す。
- AlertがAction合法性を変更しない。
- Alert自体を「推奨手」または自動操作として扱わない。
- Human UIとAgent Observationは同じCore由来Projectionを使用する。

### 4.2 Crisis Summary

Coreは公開状態から構造化された`Crisis Summary`を生成する。

各Alertは最低限次を持つ。

```text
id
severity: critical | warning | advisory
category
reasonCode
entityIds[]
publicFacts{}
```

`reasonCode`は機械可読で安定させ、Human UI側はi18n表示へ変換する。

Alert、Severity、および関連するEndTurn専用Fieldは次で固定する。

1. `capital_infection_uncontained`
   - Capital infected > 0かつHuman Unit駐留による封じ込めが成立していない。
   - `critical`。Capitalのinfected、healthy population、suppression可能Unit有無を公開Factsとして返す。

2. `critical_site_infection_uncontained`
   - Owned City、Production Facility、Active Checkpointが感染中かつ未封じ込め。
   - `critical`。Facility Type、infected、healthy population、現在Production Loss等の既存公開情報を要約する。

3. `checkpoint_defense_degraded`
   - Active Checkpointがinfected／ruined、またはFallback depthが減少した。
   - `critical`。Branch ID、Active／Standby数、現在のFallback depth、および今Turnの公開Eventから分かるRole変化を公開Factsとして返す。準備深度を回復するまで現在状態由来Alertを継続する。

4. `unused_unit_actions`
   - Crisis Alertへは含めず、EndTurn Risk専用Fieldとする。
   - Unit IDと残Move／Attack Charge数を返すが、Human確認条件には合法なAttack対象または自動鎮圧対象がある残Chargeだけを使用する。

5. `unit_out_of_supply_risk`
   - Human UnitがSupply外で、HP低下、Fuel低下、Military Goods不足等の既存公開条件を満たす。
   - HPが最大値の半分以下またはFuel 0なら`warning`、それ以外は`advisory`とする。

6. `horde_warning_active`
   - 既存Horde Warningを要約する。
   - 到来まで1 Turn以下は`warning`、それ以外のWarning期間は`advisory`。Warning前の方向・将来抽選結果は新たに公開しない。

7. `guaranteed_resource_defeat`
   - 既存Strategic Forecastが現在公開状態のEndTurnでGuaranteed Defeatを返す場合。
   - `critical`。

8. `new_state_loss`
   - 今Turnの公開EventにFacility Fall、Checkpoint Ruin、Human Unit Loss等がある場合。`advisory`とする。ただし現在状態が上記Critical条件も満たす場合は対応するCritical Alertを別に返す。

Alertは`critical`を最優先し、Severity、Category、Entity IDの安定順で全件を返す。Core／Agent側で件数上限を設けない。Human UIだけが段階表示し、Raw Observation、Legal Actions、Event、Forecastは削除しない。

### 4.3 EndTurn Risk Projection

EndTurn Legal Actionが存在する場合、Coreは`EndTurn Risk`を返す。

最低限次を含む。

```text
readyUnits[]
unitsWithMoveRemaining[]
unitsWithAttackChargesRemaining[]
uncontainedInfectedSites[]
criticalAlerts[]
forecastGuaranteedDefeat
```

これは「EndTurnすると必ずZombieがここへ移動する」等のHidden AI予測を行わない。現在公開状態で明示可能な未使用行動・感染・Forecastだけを扱う。

Human UIでは次のいずれかが存在する状態でEndTurnを押した場合だけ確認UIを表示する。

- Critical Alertが1件以上。
- 合法なAttack対象が存在し、Attack Chargeが残っているHuman Unitが1隊以上。
- 感染拠点上で自動鎮圧に使用できるAttack Chargeが残っているHuman Unitが1隊以上。

Move／Waitだけが可能なUnitは確認条件にしない。同じ危機集合では同一Turnに1回だけ表示し、確認後に新しいCritical Alertが発生した場合だけ再表示する。確認後はEndTurnを実行可能であり、Core上のEndTurn合法性を変更・Hard Blockしない。

例:

```text
ターン終了前の確認
- 2部隊に合法な攻撃対象と残Attack Chargeがあります
- 1か所の重要施設で感染が封じ込められていません
- Capital: infected 15

このままターンを終了しますか？
```

Agent APIでは文章だけでなく構造化Fieldを返し、LLMが`ready`や感染状態を再集計しなくても確認できるようにする。

### 4.4 State Delta

AI Portable Sessionの各Decision応答へ、直前Public Decisionとの差分要約を追加する。通常のAgent ObservationとHuman UIには追加しない。

例:

```text
newlyInfectedSites
newlyRuinedSites
newlySpottedEnemies
lostEnemies
unitHpChanges
unitSupplyChanges
checkpointRoleChanges
```

DeltaはSession内の前回Public Observationとの差から導出し、Core GameStateへ履歴依存状態を追加しない。通常のAgent Observationは同一Stateから常に同一内容を返すPure Projectionのままとする。

### 4.5 Human UI

- 上部のTurn／Horde／資源表示と競合しない小型Crisis Stripを追加し、Alertがない時はStripを表示しない。
- Stripには最重要Alert 1件と残件数だけを表示し、`critical`を折りたたみ領域だけへ隠さない。
- Stripをタップすると現在選択を解除し、未選択Bottom SheetのCrisisセクションを開く。
- Crisis一覧はSeverity別にGroup化し、各Groupは最初の3件だけを表示して「さらに表示」で残りを開く。
- Alert対象をタップすると該当Facility／Checkpoint／Unitを選択し、盤面を対象へ移動する。
- UI側独自の危機判定を作らずCore Projectionを描画する。
- Alertの初回発生またはSeverity悪化時だけ能動通知し、同一Alert継続中は再通知しない。解消後の再発は新規通知する。未解決Alertは手動で恒久非表示・既読消去できない。
- 通知済み状態はSaveせず、現在Alert集合とCoreの公開Eventから導出する。

---

## 5. Human Unit熟練度

### 5.1 熟練度Type

Human Unitへ次の熟練度を追加する。

```text
UnitProficiency = recruit | regular | veteran
```

Zombie Unitは熟練度を持たない。

Unit Stateは最低限次を保持する。

```text
proficiency
recruitSurvivalTurns
regularZombieKills
attackChargesRemaining
maxAttackCharges
```

保存Field名は`proficiency`、`recruitSurvivalTurns`、`regularZombieKills`、`veteranPromotionPending`、`attackChargesRemaining`、`maxAttackCharges`とする。Save／Replay／Artifactで決定的に再現できるJSON状態とする。

### 5.2 初期配置Unit

新規Game開始時の初期Police 1隊、National Guard 1隊は`regular`とする。

性能はv1.4.5から変更しない。

```text
Police regular:
HP 25
Attack 5
Movement 15
Range 1
Vision 5
Population 5

National Guard regular:
HP 50
Attack 10
Movement 10
Range 2
Vision 5
Population 10
```

初期Unitは`recruitSurvivalTurns`を要求せず、`regularZombieKills = 0`から開始する。

### 5.3 新規編成Unit

Police、National Guard、Riot Policeの新規編成完成時熟練度は標準`recruit`とする。

ConfigでUnit Type別に完成時熟練度を変更できるようにする。

例:

```text
unitExperience.productionProficiency.police = recruit
unitExperience.productionProficiency.nationalGuard = recruit
unitExperience.productionProficiency.riotPolice = recruit
```

標準Gameではすべて`recruit`とする。

### 5.4 Recruit性能

RecruitのAttackはRegularの80%相当を基礎値としてConfigへ保存する。

標準値:

```text
Police recruit Attack = 4
National Guard recruit Attack = 8
Riot Police recruit Attack = 10
```

HP、Movement、Range、Vision、Population、Fuel、Military Goods等は本書で別途変更しない限り熟練度で変化しない。

### 5.5 Recruit → Regular

Recruit Unitが5 Turn生存した場合、自動でRegularへ昇格する。

標準定義:

- Recruitとして完成・配置されたPlayer Turnを0とする。
- 以後、次のPlayer Turn Startを生存して迎えるごとに`recruitSurvivalTurns`を1増やす。
- 5回目のPlayer Turn Startを生存して迎えた時点でRegularへ昇格する。
- 昇格判定は自然回復・補給・Player Action開始前のTurn Start処理で決定的に行う。

RegularのAttackはRecruit Attackへ25% Bonusを適用し、端数を切り上げる。

```text
regularAttack = ceil(recruitAttack × 1.25)
```

したがって標準値は次となる。

```text
Police: 4 -> 5
National Guard: 8 -> 10
Riot Police: 10 -> 13
```

### 5.6 Regular → Veteran

Regular UnitはRegularになってからZombie Unitを5体撃破するとVeteran昇格条件を満たす。

標準`veteranKillsRequired = 5`はConfig化する。

Kill対象:

- Zombie
- Horde Zombie
- Police Zombie
- Soldier Zombie
- Riot Zombie

Kill CreditはそのHuman Unitが盤面上のZombie Unitへ直接行った通常攻撃、Counterattack、InterceptionのDamageで対象のHPを0にした場合に付与する。Zombie Typeと生成理由を問わず、Noiseによる陥落拠点再Spawn個体も対象に含む。施設内感染者の鎮圧は数えない。

将来、死亡時爆発や連鎖Damageを持つUnit／Zombieを追加した場合、二次効果によるKillを元Attack Unitへ自動帰属させない。直接Combat Damageの最終Damage Sourceを明示できる場合だけ付与する。

Recruit時代のKillは`regularZombieKills`へ持ち越さない。

5体目撃破時に`veteranPromotionPending`へ入り、その場では「Veteran昇格条件達成」と表示する。実際の`proficiency = veteran`への変更とVeteran Bonus適用は次Player Turn Startに行う。同Turn中に追加Attack Chargeを生成しない。昇格待ち状態はSave／Replay対象とする。

### 5.7 Veteran Bonus

VeteranはRegular Attack値を維持し、Attack Chargeを1追加する。

```text
Recruit maxAttackCharges = 1
Regular maxAttackCharges = 1
Veteran maxAttackCharges = 2
```

Veteranに追加のAttack値Bonusは与えない。

Attack Chargeは次のCombat／Suppression権利で共有する。

- Player Phaseの通常Attack
- Counterattack
- Interception
- EndTurn時の自動感染鎮圧

Human Unitは1 TurnにMoveを最大1回とする既存原則を維持する。最初のAttack実行後はMove不可とするが、Attack Chargeが残っていれば追加Attackは可能とする。

WaitはUnitのPlayer Phase上の能動Move／Attackを終了するが、Attack Chargeを消費しない。残ChargeはEndTurn時の自動鎮圧で先に使用し、残っていればZombie PhaseのInterception／Counterattackへ使用できる。各Combat／Suppressionは1 Chargeを消費し、0なら実行しない。次Player Turn Startに最大値へ回復する。`Wait`、能動行動終了、Move済み、Attack Chargeを別状態として扱う。

Veteranは同一対象へ2回、または異なる合法対象へ1回ずつAttackできる。1回目のAttack後はMoveできず、その位置から2回目の合法対象を改めて選ぶ。

### 5.8 Attack ChargeとMilitary Goods

Attack Chargeが2でもCombat 1回ごとのMilitary Goods Costは既存値を維持する。

例:

- Veteran National GuardがRange 2 Attackを2回行う場合、各2 Military Goods、合計4を必要とする。
- Military Goods不足時も既存Combat Ruleを維持する。Police／Riot Police／National GuardのRange 1は保有0でもChargeを1消費し、Effective Attack 20%で攻撃できる。National GuardのRange 2だけは保有2未満なら不成立で、Legal Attackへ列挙しない。
- Counterattack／Interceptionでも同じ携行Military Goodsルールを使う。

Agent Observationは`maxAttackCharges`、`attackChargesRemaining`、各Legal Attack後の残Charge／残Military Goodsを公開する。

### 5.9 感染封じ込め・自動鎮圧

感染Facility／CheckpointへHuman Unitが駐留している場合の感染加算停止はv1.4.5を維持する。

自動鎮圧は残Attack Chargeごとに最大1回判定する。

```text
suppressionChecks = attackChargesRemaining
```

したがってVeteranが通常Attack、Counterattack、Interceptionを一度も行わずEndTurnし、感染Site上に駐留している場合、最大2回の自動鎮圧を行える。

各鎮圧判定:

1. Target infected > 0を確認。
2. Unitの携行Military Goodsが鎮圧Costを満たすか確認。
3. 満たす場合はMilitary Goodsを消費し、Attack Chargeを1消費して鎮圧する。
4. 1回目でinfected 0になった場合は2回目を行わず、余剰Chargeも消費しない。
5. Military Goods 0等で既存ルール上「封じ込めのみ」となる場合は感染加算停止だけを行い、鎮圧せず、不要なAttack Charge消費を行わない。

鎮圧力はUnitの現在熟練度に対応するEffective Attack相当を標準とする。

```text
Police recruit 4 / regular-veteran 5
National Guard recruit 8 / regular-veteran 10
Riot Police recruit 10 / regular-veteran 13
```

Police／Riot Policeは警察系鎮圧として民間人副作用なし、National Guardは既存のCivilian Damage Rateを適用する。

v1.4.5の`policeSuppression = 5`、`nationalGuardSuppression = 10`という独立固定値は廃止し、Human Unitの鎮圧力を現在熟練度の`effectiveAttack`へ統合する。ConfigはHuman Unit別の`recruitAttack`と共通熟練度Multiplier／Roundingを正本とし、別の鎮圧力Fieldを重複保持しない。

### 5.10 回復

自然回復率は熟練度で変更しない。

Combat／Interception／Suppressionを1回以上行ったUnitは既存Combat Recovery区分、Move／Wait／未行動のみはRest Recovery区分を使う。

Veteranが2回攻撃または2回鎮圧しても、自然回復判定は1 Turnにつき1回であり、Combat Recovery Rateを重複適用しない。

---

## 6. Riot Police

### 6.1 役割

Riot Policeを新しいHuman Unit Typeとして追加する。

主用途:

- 感染都市／Facility／Checkpointへの進入と安全な封じ込め・鎮圧。
- Supply Line上での高HP Blockade。
- Range 1の近接戦闘による局地防衛。

通常Policeの高Movement即応性、National GuardのRange 2射撃と差別化する。

### 6.2 標準性能

Recruit Riot Police:

```text
HP 75
Attack 10
Movement 10
Range 1
Vision 5
Population 10
Fuel Cost rule: Policeと同一
Max Fuel: 12
Emergency Movement: 2 MP
Suppression civilian damage: 0
```

Regular／Veteran Attack:

```text
ceil(10 × 1.25) = 13
```

Veteranは他の通常Human Unitと同様にAttack Charge 2を持つ。

Riot Policeは高HPと既存割合自然回復の組み合わせによりSupply内で高い持久力を持つ。これは設計意図であり、標準ではRiot専用回復Nerfを導入しない。

### 6.3 MovementとFuel

Movementは10とする。

Policeと同じFuel Cost式を使用する。

したがってRiotはPoliceほど高速に州全域を移動せず、National Guardと同程度のMovementで補給線・都市・Checkpoint間を移動する重装Unitとなる。

`maxFuel = 12`、Fuel CostはPoliceと同じく距離1～5で1、以後1 Hexごとに+1とする。Fuel 0時のEmergency Movementだけは2 MPとする。すべてConfigへ明示し、`unitType === police ? ... : nationalGuard`の二択分岐へ暗黙に流さない。

### 6.4 Military Goods

Riot PoliceはPoliceより多い編成Military Goodsを必要とする。

標準編成Cost:

```text
Population 10
Civilian Goods 25
Military Goods 25
```

これは実装初期値とする。100 Seed Batchの合格基準を外れた場合だけ定めた調整順に従い、最終値を本書へ反映する。

携行Military Goodsは`maxMilitaryGoods = 5`、固定消費0、Range 1 Attack Cost 1、自動鎮圧Cost 1とする。Police系と同じ0保有時20% Attackを使用する。

### 6.5 生産

Riot Policeは操作可能かつSupply内の次Facilityで予約できる。

- Capital
- City

National Guardと異なりCapital限定ではない。

予約、人口徴用、City Busy、次Player Turn完成、完成Hex選択等は既存Unit Production Ruleを再利用する。

完成時熟練度は標準Recruit。

### 6.6 Combat Noise

Riot Policeの公開Combat Noise Classは`medium`、内部Radiusは5とする。通常Policeの公開Class `medium`／内部Radius 4は変更しない。Class名と内部RadiusはUnit Type別Configとして保持し、同じ公開Class名から内部Radiusが同一であると仮定しない。

### 6.7 Unit Familyの一般化

Riot追加前に、Human Unit TypeがPolice／National Guardの二択であることを仮定したCore分岐を整理する。

特に次をUnit Configまたは明示的なUnit Ruleへ一般化する。

- Recruit可能Facility Type
- Production Material Cost
- Population Cost
- Movement Fuel Cost Rule
- Emergency Movement
- Suppression Side
- Civilian Damage Rate
- Reanimation Zombie Type
- Combat Noise Class
- Military Goods Carry／Cost
- Proficiency基礎Attack

Riotを追加した結果、既存の`police ? A : nationalGuard`分岐で誤ってNational Guard規則を適用しないことをTestする。

---

## 7. Riot Zombie

### 7.1 標準性能

Riot Zombieを新しいZombie Unit Typeとして追加する。

```text
HP 50
Attack 5
Movement 3
Range 1
Vision 5
Population 0
```

HP以外の基本挙動はPolice Zombieと同一とする。

- Normal AI系。
- 単体ではHorde ZombieのCapital Strategic Anchorを持たない。
- Fuel／Military Goodsを持たない。
- 自然回復しない。
- Supply内Zombie clear Victory対象に含める。

### 7.2 Riot Police Reanimation

Riot PoliceがHP 0で盤面から除去された場合、死亡HexへRiot Zombieを1体生成する。

既存Police Zombie／Soldier Zombie Reanimation規則を踏襲する。

- 死亡したRiot PoliceのFuel、Military Goods、HP、Target、熟練度を継承しない。
- 残Fuel／Military Goodsを国家備蓄へ返却しない。
- 生成直後は同じPhase中にMove／Attack／Targetingしない。
- 死亡HexがFacility／Checkpointなら即時占有・感染を1回解決する。
- 連鎖Fallは既存FIFO／Unit ID順決定性を維持する。

Statisticsへ最低限次を追加する。

```text
riotPoliceLosses
riotZombieSpawned
riotZombieKilled
riotPoliceReanimations
```

名称は既存Statistics規約へ合わせる。

---

## 8. Horde微増強と特殊Zombie混成

### 8.1 基本方針

Horde Wave Turn、Warning Lead Turn、方向選択、Final Waveの基本構造はv1.4.5を維持する。

標準Wave Turn:

```text
5 / 10 / 20 / 35 / 50
```

Horde Zombieは引き続きScheduled Hordeの中核とし、方向別に最低1体以上存在する既存Config Validationを維持する。

v1.5.0では、従来`zombie`固定だった非Horde枠を「Zombie Slot」として扱い、各Slotを次TypeからSeed付きで決定的に選択する。

```text
zombie
policeZombie
soldierZombie
riotZombie
```

特殊Zombieは追加Spawnではなく原則として非Horde枠の置換であり、混成だけを理由にWave総数を増やさない。

### 8.2 軽度増強の標準値

Turn 5をv1.4.5のまま維持し、Turn 10以降は方向ごとの非Horde Zombie Slotを+1する。

| Turn | Direction Count | Horde Zombie / direction | v1.4.5非Horde / direction | v1.5.0非Horde / direction |
|---|---:|---:|---:|---:|
| 5 | 1 | 2 | 3 | 3 |
| 10 | 2 | 1 | 4 | 5 |
| 20 | 1 | 4 | 6 | 7 |
| 35 | 3 | 2 | 6 | 7 |
| 50 | 4 | 4 | 7 | 8 |

これは実装初期の標準値であり、v1.4.5比でWave総数を大幅に増やさず、Veteranの追加Attack ChargeとRiot追加に対して軽度な圧力増を与える。100 Seed Batchで合格基準を外れた場合だけ定めた調整手順を適用する。

### 8.3 特殊Zombie抽選Weight

Zombie SlotごとのType WeightはConfig化する。

実装初期Weight:

```text
zombie       70
policeZombie 15
soldierZombie 10
riotZombie    5
```

WeightはConfig化し、特にRiot Zombie HP 50によるWave難易度分散をBatch Simulationで確認する。

1方向1WaveにつきRiot Zombie最大1体のCapを設ける。Cap到達後はRiotを候補から外し、Normal／Police／Soldierの残Weight比で直接決定的抽選する。

CapはConfigへ明示するが、v1.5.0標準値は1とする。

### 8.4 決定性

特殊Zombie Type抽選はGame Seed由来PRNGを使用し、同一Version、Map、Config、Seed、受理Action列から同じWave方向、同じType内訳、同じSpawn位置、同じUnit ID順を得る。

PRNG消費順を固定し、UI表示やAgent Query回数によって結果が変わらないようにする。

Forecast／Crisis Summary／候補QueryはPRNGを消費しない。

### 8.5 Warningでの公開範囲

v1.4.5ではWave Compositionが固定ConfigのためWarning時にCompositionを公開できる。

v1.5.0の特殊混成はSpawn時まで未確定乱数を含むため、Warning前後に未確定Type内訳を漏らさない。

Warning開始後に公開する標準情報:

```text
spawnTurn
directionCount
warningDirections
hordeZombieCountPerDirection
nonHordeSlotCountPerDirection
possibleNonHordeTypes
final
```

具体的なPolice／Soldier／Riot Zombie個体数は、抽選をSpawn時に行う場合はSpawn後に初めて公開する。

特殊Type抽選は実際のWave Spawn時に行う。Warning開始時には抽選せず、Human／Agentの照会回数でPRNGを進めない。

### 8.6 Horde Provenance

Scheduled Hordeから生成されたPolice Zombie／Soldier Zombie／Riot Zombieは、通常Reanimation個体とUnit Typeが同じでもSpawn Provenanceを区別する。

Scheduled／Final Wave由来個体:

```text
spawnGroupId != null
hordeKind = periodic | final
```

これらは各Unit Type固有のNormal AI系Movement／Targetingを使用してよいが、Wave Statistics、Final Horde撃退判定、Artifact上のWave構成には所属個体として数える。

Human Unit死亡から生成されたPolice／Soldier／Riot Zombieは従来どおり`spawnGroupId = null`、`hordeKind = null`とする。

### 8.7 Victory

Final Horde Victoryでは、Final Wave所属のHorde Zombieだけでなく、Final WaveのZombie Slotから生成されたPolice／Soldier／Riot ZombieもFinal Group生存個体として扱う。

Final Wave由来特殊Zombieを残したまま`finalHordeStatus = defeated`にしてはならない。

### 8.8 共通Noise Pulse

Human Unit参加CombatとHorde Zombie実移動が発生させるNoiseを、共通の`Noise Pulse`規則で処理する。

- Human CombatのRadiusはUnit Type別Configを使い、Police 4、National Guard 8、Riot Police 5とする。公開ClassはPolice／Riot Policeが`medium`、National Guardが`large`。
- Horde Zombieが1 Hex以上の実移動を確定した場合、移動先をCenterとしてRadius 8のNoise Pulseを毎回発生させる。待機、経路なし、移動前死亡では発生させない。
- Horde Pulseは、そのHorde Zombieの移動と移動先でのCombat／感染をすべて解決した直後に処理する。
- Horde Zombie自身は全Noiseを無視し、`Visible Population > Capital`のTarget優先順位を維持する。
- `zombie`、`policeZombie`、`soldierZombie`、`riotZombie`は共通してNoiseへ反応する。ただし`Visible Population > inherited Horde Target > Noise > Idle`の優先順位を維持する。
- Human CombatとHorde移動のPulseは次回Zombie Phase開始時のTarget Snapshotでまとめて評価する。同じPhaseの既確定行動を遡及変更しない。
- 各Normal AI系Zombieは範囲内にある新規Noise CenterのうちHex Distance最短を選ぶ。複数の新規Centerが同距離ならZombie ID順にGame Seed由来PRNGで選ぶ。QueryはPRNGを消費しない。
- 既存Noise Targetがある場合も新規Centerと比較し、より近い新規Noiseへ乗り換える。同距離なら現在Targetを維持し、新規候補同士だけを抽選する。
- 選択済みNoise Targetは、Visible Populationまたはinherited Horde Targetで上書きされるか、Target到達まで保持する。次回Snapshotで評価済みのPulse集合は破棄する。
- すべてのNoise Pulseは、範囲内にある感染者5人以上の陥落済み恒久FacilityおよびRuined／Remnant Checkpointへ、既存の感染者由来再SpawnをPulseごとに発生させる。同一Turnの複数Pulseでも感染者Poolが残る限り再Spawnし得る。
- Noise再Spawn個体は通常のZombie Unitであり、Human Unitが直接Combatで倒せばVeteran Killへ数える。Pulse源がFinal Waveでも再Spawn個体へFinal Wave provenanceを付けない。
- Public Eventは既存公開境界内の拠点について「Noiseにより拠点からN体出現」を返すが、Horde Pulse源のUnit ID、位置、距離、正確なRadius、反応したHidden Zombieを返さない。Hidden拠点と未可視EnemyはFog of Warを維持する。

---

## 9. Agent Observation／API変更

### 9.1 Human Unit公開情報

Human Unit Observationへ最低限次を追加する。

```text
proficiency
recruitSurvivalTurns
turnsUntilRegular
regularZombieKills
killsUntilVeteran
maxAttackCharges
attackChargesRemaining
baseRecruitAttack
effectiveAttack
```

Veteran昇格予定が次Turn Startの場合は、その状態も明示する。

Legal Attack Projectionは各Attack後の`projectedAttackChargesRemaining`を返す。

Suppression Projectionは、現在EndTurnした場合の最大鎮圧回数、各判定のMilitary Goods Cost、最大Projected Suppression、Civilian Damageを返す。

### 9.2 Crisis情報

Agent Observationへ次を追加する。

```text
crisisSummary
endTurnRisk
```

Raw Legal Actions、Facility、Unit、Forecastは削除しない。Crisis Summaryは認知補助であり唯一の情報源ではない。

### 9.3 Horde

Warning時は未確定特殊Typeを漏らさず、`possibleNonHordeTypes`とSlot数を公開する。

Spawn後はVisibleな特殊ZombieだけをEnemy配列へ追加し、Fog of Warを維持する。

Visible Enemyには`isScheduledWaveMember`と`isFinalWaveMember`の公開Booleanを追加する。Scheduled／Final Waveの特殊Slot由来個体は対応する値を`true`とし、Human Unit死亡やNoise再Spawn由来個体は`false`とする。内部`spawnGroupId`は公開しない。Human UIも同じ値から`Wave所属`／`Final Wave所属`Badgeを表示する。

### 9.4 API Info

`getApiInfo()`へ次の静的Ruleを追加する。

- Proficiency昇格条件。
- Attack Bonus rounding = `ceil`。
- Veteran Attack Charge数。
- Kill Credit対象Zombie Type。
- Riot Police基礎性能・生産可能Facility。
- Riot Zombie基礎性能。
- Horde特殊Slot Weight／CapのConfig意味。
- Crisis Alert Category／Severity／Reason Code一覧。
- 共通NoiseのTarget優先順位、Noise Center選択、Unit Type別公開Class、Horde移動Noise Radius 8、陥落拠点再Spawn規則。Hidden Noise Target、正確な反応個体、Pulse源位置は含めない。

---

## 10. Human UI変更

### 10.1 選択対象だけを表示する原則

Bottom Sheetは原則として現在選択している1対象の情報とActionだけを表示する。

- Human／Zombie Unit選択時はそのUnitだけ。
- Facility選択時はそのFacilityだけ。
- Checkpoint選択時はそのCheckpointだけ。
- Hex選択時はそのHexだけ。
- 全体Forecast、支線一覧、資源詳細、イベント履歴等を選択対象Panelへ混在させない。
- 同一Hexに複数対象がある場合、`Unit | Facility | Checkpoint | Hex`のうち存在する対象だけを切替Tabとして表示する。初期選択はMap modeでUnit、Domestic modeでFacility／Checkpointを優先する。
- Unit／Facility／Checkpoint Panelに完全な地形詳細を重複表示しない。対象へ直接効く移動Cost、防御補正、道路接続等の結果だけを短く表示し、完全な地形情報はHex Tabで確認する。

空HexはMap／Domesticの両Modeで選択可能とし、地形、Road／Urban属性、移動Cost、防御補正、Player Vision、Supply内外、Player配置禁止を表示する。未発見情報やHidden Zombieは表示しない。建設等の局所ActionはDomestic modeだけに表示する。

### 10.2 未選択時の全体情報

未選択時だけ、Crisis、人口概要、Checkpoint支線、重要Event履歴、建設概要をBottom Sheetへ表示する。資源詳細は表示しない。

- 各Sectionは見出しBar全体を44 CSS px以上の開閉Targetとし、右端に折りたたみ時`›`、展開時`⌄`のChevronを表示する。Hamburger iconはNavigationと誤認するため使わない。
- 見出しには件数または重要値の短い要約を残し、折りたたまれていることと状態を視覚的・支援技術の両方で明示する。`aria-expanded`と日英の「展開／折りたたむ」Labelを持つ。
- 初期状態はCriticalがあるCrisisだけを展開し、それ以外を折りたたむ。CriticalがなければCrisisも折りたたむ。
- Userが開閉した状態は同一Play中に保持するが、GameState／Saveへ含めず、新規開始・Load時は初期状態へ戻す。
- 重要Event履歴は最初に最新10件だけ表示し、「さらに表示」で10件ずつ最大50件まで増やす。
- 建設概要はFacility Type別Cost、建設済み数、短い用途だけを表示し、候補座標や実行Buttonを置かない。

### 10.3 上部資源Accordion

Food、Civilian Goods、Military Goods、Fuel、Electricityを上部HUDで個別に展開できる。展開は同時に1種類だけのAccordionとする。

- 折りたたみ時はFood／Civilian Goods／Military Goods／Fuelの現在備蓄を表示する。Electricityは次回EndTurnの需要／利用可能供給を表示する。
- 次回EndTurn Forecastで未充足が1以上なら、該当資源へ文字`!`と警告Styleを表示する。備蓄が減るだけでは表示しない。
- Food維持不足、Civilian Goods維持／生産入力不足、Military Goods固定消費／補充不足、Fuel発電／Unit補給不足、Electricity未給電を既存Core Forecastから判定する。色だけに依存しない。
- 展開時は開始備蓄、集約した収入／支出、終了見込み、未充足内訳だけを表示する。Unit別Military Goods／Fuel明細は各Unit Panel、Facility別電力理由は各Facility Panelへ置く。
- 詳細は上部HUDから盤面上へ重なるDropdownとして表示し、盤面を恒常的に押し下げない。別資源Tapで切替、同一資源再Tap、Panel外Tap、Escape、盤面操作開始で閉じる。

### 10.4 Bottom Sheetと固定Action領域

Bottom Sheetの折りたたみ／標準／展開の3段階Snapを維持し、Panel全体の高さと内部SectionのAccordionを別状態として扱う。

- 折りたたみ時も対象名、重大状態、主要Actionの有無を短く表示する。
- 選択対象の名前、HP、感染、稼働／補給状態等の主要情報と合法な主要Actionは常時表示する。
- 回復、Fuel、Military Goods、生産、電力、感染、Queue等の詳細は対象内Sectionへ分け、見出しBar＋Chevronで個別に折りたたむ。
- 主要ActionはScroll位置に依存しない固定Action領域へ置く。
- UnitのMove／Attack／Waitは直接ActionまたはMode開始Buttonとし、盤面近傍Action Menuも維持する。
- Facility／Checkpointは`人口`、`電力`、`編成`、`方針`等の短いAction Buttonだけを固定表示し、Tapした操作Formを1つだけ展開する。全Formを同時表示しない。

### 10.5 Human Unit表示

Unit情報PanelのUnit名横に熟練度を括弧付きTextで常時表示する。色だけに依存しない。

```text
Police（Recruit） Regularまであと2 Turn
National Guard（Regular） Veteranまで3 / 5 kills
Riot Police（Veteran昇格待ち）
Riot Police（Veteran） Attack Charge 2 / 2
```

盤面上のHuman Unit文字情報は次の4項目だけとする。

```text
Unit名 / HP current-max / Attack Charge remaining-max / 補給内・圏外
```

例: `Police  HP 18/25  ⚔ 1/2  補給内`

補給表記は色だけに依存しない。熟練度、Fuel、Military Goods等の具体値はUnit Panelで確認する。Veteranが1回Attackした後もChargeが残る場合は完全終了表示にせず、Move不能と追加Attack可能を分けて示す。

### 10.6 Facility／Checkpoint／Zombie表示

- Facility／Checkpointの盤面情報は名称またはTypeと、感染、陥落、未給電見込み、Critical Alert等の重大状態Badgeだけに限定する。人口、生産、Queue、電力数値は対象Panelへ置く。
- 可視Zombieを直接選択可能にし、Type、HP、Attack、Movement、Range、公開Wave所属だけを専用Panelへ表示する。内部Target、Noise Target、未公開Spawn情報は表示しない。
- Scheduled／Final Wave由来の可視特殊Zombieには`Wave所属`／`Final Wave所属`Badgeを表示する。内部Group IDは表示しない。
- Riot Policeへ盤面Asset、Production UI、Help、Legend、日英i18nを追加し、感染鎮圧／Blockade用途を説明する。

### 10.7 局所建設UI

Checkpointに加えてConstructible Facilityも全候補座標一覧と全候補ButtonをHuman UIから廃止する。

- Domestic modeで空Hexを選び、その地点でCore上合法なFacility Typeだけを局所Actionとして表示する。
- 合法Typeがなければ「このHexに建設可能な施設はありません」と、公開可能な最優先Core Reasonの短い説明を表示する。
- Facility／CheckpointがあるHexは対象選択を優先し、別種建設Actionや不合法理由を混在させない。
- Agent APIの全Constructible／Checkpoint候補、Reason Code、Legal Actionsは削減しない。

### 10.8 Crisis／EndTurn UI

4.5のCrisis Strip／一覧を実装する。EndTurn確認は長大なRaw情報を表示せず、Critical件数、攻撃可能Charge保有Unit、自動鎮圧可能Unitと対象だけを短く示す。

---

## 11. Config変更

Config Versionを更新し、少なくとも次をDataとして保持する。

```text
unitExperience:
  productionProficiencyByType
  recruitSurvivalTurnsRequired = 5
  regularAttackMultiplier = 1.25
  regularAttackRounding = ceil
  veteranZombieKillsRequired = 5
  veteranAttackCharges = 2

units.riotPolice:
  hp = 75
  recruitAttack = 10
  movement = 10
  range = 1
  vision = 5
  population = 10
  maxFuel = 12
  emergencyMovementPoints = 2
  maxMilitaryGoods = 5
  fixedMilitaryGoodsUpkeepPerTurn = 0
  attackMilitaryGoodsCostByRange[1] = 1
  suppressionMilitaryGoodsCost = 1
  noiseClass = medium
  noiseRadius = 5
  productionPopulation = 10
  productionCivilianGoods = 25
  productionMilitaryGoods = 25

units.riotZombie:
  hp = 50
  attack = 5
  movement = 3
  range = 1
  vision = 5

horde:
  waves[]
  specialZombieWeights
  riotZombieCapPerDirection
  movementNoiseRadius = 8
```

Human Unit Configは`recruitAttack`を保存上の基礎値とし、Regular／Veteran AttackをMultiplierとRoundingから導出する。Zombie Unitは従来どおり固定`attack`を持つ。旧`UnitConfig.attack`をHuman UnitのRegular値として並存させない。Saveへ保存済みConfig Snapshotを持つ既存原則を維持し、Load後に現在DEFAULT_CONFIGへ暗黙追従させない。

Crisis Alertのv1.5.0 Severity条件は4.2の確定値とし、UI独自閾値を設けない。将来Config化する場合もゲームルール上の危機判定とUI表示閾値を混同しない。

---

## 12. Save／Replay／Session／Artifact互換境界

v1.5.0ではHuman Unit State、Unit Type、Horde Composition、Agent Observation Contractが変更されるため、Game Rules／Save／Replay／Artifact／AI Portable Session／Checkpointの互換Versionを更新する。

v1.4.5以前のSave／Replay／Sessionをv1.5.0へ暗黙変換しない。

互換Versionは次で固定する。

| 境界 | v1.5.0 |
|---|---|
| App / Release | `1.5.0` |
| Game Rules / GameState / Config | `3.0.0` |
| Save Format | `10` |
| Agent / Observation / Browser Bridge API | `7.0.0` |
| Artifact Schema | `6.0.0` |
| AI Portable Session Schema | `3.0.0` |
| Checkpoint Schema | `3.0.0` |
| Balanced Agent | `5.0.0` |
| Random Agent | `3.0.0` |

Autosaveは新しいFormat 10用Keyを使い、旧Keyを削除・上書きしない。

理由:

- v1.4.5 Human Unitは熟練度・Kill Counter・Attack Chargeを持たない。
- Riot Police／Riot Zombie Typeが存在しない。
- Horde WaveのType抽選PRNG消費順が変わる。
- 共通NoiseのPending Pulse、Target再選択、Horde移動再Spawnが追加される。
- Agent ObservationへCrisis／Proficiency情報が追加される。

Failure Artifact／Run Artifactは最低限次を監査可能にする。

```text
unit proficiency transitions
zombie kill credits
attack charge consumption
suppression check count
riot production / loss / reanimation
horde special composition
pending noise pulses / noise target transitions / noise respawn
crisis alerts emitted
endTurn risk summary
```

Public ArtifactへHidden Enemy位置・未確定抽選結果を漏らさない既存原則を維持する。

---

## 13. Event／Statistics追加

イベント候補:

```text
unit_promoted
unit_promotion_pending
unit_kill_credited
attack_charge_consumed
riot_police_commissioned
noise_pulse_emitted
```

既存`attack`、`interception`、`infection_suppressed`、`human_unit_reanimated`、`noise_emitted`等へProficiency／Charge／Noise Source Kind情報を安全に拡張できる場合は、不要なEvent Type乱立を避ける。Horde NoiseのSource位置等はInternal／Verification Eventだけへ保持する。

`unit_promoted`例:

```text
unitId
unitType
from
into
turn
reason: survival | zombie_kills
```

Statistics候補:

```text
recruitsCommissionedByType
regularPromotionsByType
veteranPromotionsByType
veteranZombieKillsByType
riotPoliceProduced
riotPoliceLost
riotZombiesSpawned
riotZombiesKilled
hordeSpecialSpawnedByType
noisePulsesBySourceType
hordeMovementNoisePulses
hordeNoiseRespawnedByType
```

---

## 14. Balanced Agent／Random Agent

### 14.1 共通

AgentはGameStateを直接参照せず、引き続きAgent ObservationとLegal ActionsだけからActionを選ぶ。

Crisis Summaryを使う場合も、Raw Observationに存在しないHidden情報を得てはならない。

### 14.2 Balanced Agent

Balanced Agentは最低限次を評価する。

- Capital／重要SiteのCritical Infection Alertを局地Combatより高く評価する。
- EndTurn前に`unitsWithAttackChargesRemaining`、`readyUnits`を確認する。
- Veteran Unitの生存価値をRecruitより高く評価するが、Capital Lost回避等の即時危機を上回る絶対ルールにはしない。
- Police／Riot Policeを感染鎮圧へ優先し、National GuardのCivilian Damageと比較する。
- Riot PoliceをRange 2火力Unitの代替ではなく、感染Site／Checkpoint Blockadeとして評価する。
- Horde Warning時は特殊Zombieの未確定Typeを推測せず、公開Slot数・可能Typeだけを使う。

### 14.3 Random Agent

Random Agentは新Legal Action Type、Veteran複数Attack、Riot生産を含んでも決定的に完走できる。

---

## 15. Test要件

### 15.1 熟練度

最低限次をUnit Testする。

- 初期Police／National GuardがRegularで現行Attackを維持する。
- 新規編成Unitが標準Recruitになる。
- Config overrideで完成熟練度を変更できる。
- Recruitが5 Turn生存後にRegularへ昇格する。
- Attack Bonusが`ceil`されPolice 5、Guard 10、Riot 13になる。
- Recruit時代のKillがVeteran Counterへ入らない。
- Regularの5体目Zombie撃破で昇格待ちとなり、現在TurnにChargeを増やさず、次Player Turn StartにVeteranへ昇格する。
- 通常Attack／Counterattack／Interceptionの直接Killが正しく付く。
- Noise再Spawn由来Zombieの直接Killを数え、施設内感染者の鎮圧と二次効果Killを数えない。
- 同一Zombie Killを複数Unitへ重複Creditしない。

### 15.2 Attack Charge

- Recruit／Regularは1 Charge、Veteranは2 Charge。
- Veteranが同Player Turnに2回Attackできる。
- 1回Attack後にMoveできない。
- Counterattack／InterceptionがChargeを消費する。
- Military Goods 0でもRange 1の2回目20% AttackがLegalでChargeを消費し、National Guard Range 2は保有2未満でLegalにならない。
- 同一対象への2回Attackと異なる対象への2回Attackが成立する。
- Waitが能動行動だけを終了し、Chargeを自動鎮圧、Interception、Counterattack用に保持する。
- EndTurn時に2 Charge残したVeteranが感染Siteで最大2回鎮圧する。
- 1回目で感染0なら2回目を消費しない。
- Combat Recoveryは2回Attackでも1回分だけ適用する。

### 15.3 Riot Police／Riot Zombie

- RiotがCapital／Cityでのみ予約可能。
- Population 10を正しく徴用・台帳計上する。
- Fuel CostがPolice系規則を使い、National Guard規則へ誤分岐しない。
- HP75、MP10、Range1、熟練度Attackが正しい。
- Riot鎮圧がPolice系でCivilian Damage 0。
- Riot死亡でRiot Zombie HP50が同Hexへ生成される。
- 生成Turn中にMove／Attackしない。
- Facility／Checkpoint上死亡時の即時感染が既存Reanimationと同じ順序で解決される。

### 15.4 Horde

- 同Seedで特殊Type抽選が再現する。
- Agent Query／Forecast呼び出しでPRNGが進まない。
- Warning前に特殊Type内訳を漏らさない。
- Warning後の公開内容が設計どおりである。
- Riot Capが決定的に適用される。
- Final Horde由来Police／Soldier／Riot ZombieがFinal撃退判定に含まれる。
- Reanimation由来特殊ZombieとScheduled Horde由来特殊ZombieのProvenanceが混同されない。
- 可視Scheduled／Final Wave特殊Zombieの公開BooleanとHuman Badgeが一致し、内部Group IDを公開しない。

### 15.5 共通Noise

- Human CombatとHorde実移動が同じNoise Center選択Ruleを使う。
- Hordeが1 Hex以上移動するたび移動先でRadius 8 Pulseを生成し、待機・移動なしでは生成しない。
- Riot Policeは公開`medium`／内部Radius 5、Policeは公開`medium`／内部Radius 4を維持する。
- Normal／Police／Soldier／Riot ZombieがNoiseへ反応し、Horde Zombieは反応しない。
- 複数新規Noiseでは最短距離、同距離はSeed付き抽選となり、現在Targetと同距離なら現在Targetを維持する。
- より近い新規Noiseが既存Noise Targetを上書きする。
- Noise Target反映は次回Zombie Phaseで、同Phaseの既確定行動を変えない。
- Horde Pulseも感染者由来再Spawnを発生させ、複数Pulseで感染者Poolが残る限り繰り返せる。
- Public Eventが再Spawn結果だけを返し、Hidden Horde源、位置、距離、反応個体を漏らさない。
- Noise Query／Human UI描画がState／PRNGを変更しない。

### 15.6 Crisis Summary

- 同一StateでAlert集合と順序が決定的。
- Hidden ZombieをAlert生成へ使用しない。
- Crisis QueryでState／RNG／Action Countが変化しない。
- Capital感染未封じ込めをCriticalとして検出できる。
- `ready` Unit／残Attack ChargeをEndTurn Riskへ列挙できる。
- Criticalが存在してもEndTurn Action自体はCore上Legalのまま。
- Human UI確認とAgent構造化情報が同じProjectionを使用する。
- AgentへAlert全件を返し、Human UIだけがSeverity別3件ずつ段階表示する。
- 同一Alert継続では再通知せず、Severity悪化と解消後再発で通知する。

### 15.7 Human UI

- 選択中は選択対象と局所ActionだけをBottom Sheetへ表示し、地形完全情報はHex Tabだけに表示する。
- 同一Hexの対象TabがMap／Domesticの優先順位どおり切り替わる。
- 未選択時の全体SectionがChevron、要約、`aria-expanded`を持ち、初期開閉状態とPlay中保持が正しい。
- 上部資源Accordionは同時に1件だけ開き、未充足時だけ`!`を出し、集約値だけを表示する。
- Bottom Sheet 3 Snapと内部Accordion、固定Action領域が独立して動く。
- 盤面Human Unit表示が名前、HP、Attack Charge、補給判定だけに限定される。
- Facility／Checkpoint盤面表示が名称／Typeと重大Badgeだけに限定される。
- 可視Zombie選択PanelがHidden Target／Noise／Group IDを表示しない。
- Event履歴が10件ずつ最大50件まで増える。
- Constructible Facility候補座標一覧がHuman UIから消え、Domestic空Hexの局所BuildだけがCore候補と一致する。Agent候補は全件を維持する。

### 15.8 Replay／Session

- Promotion待ち、Promotion、Kill Credit、複数Attack、複数Suppression、Riot Reanimation、Horde特殊抽選、Noise候補選択、Noise再SpawnをReplayで完全再現する。
- AI Portable Session resume後もProficiency Counter／Attack Charge／Horde／Noise PRNG結果が一致する。
- State DeltaはPortable Session Decision応答だけに存在し、通常Observationは同一Stateから同一結果を返す。
- Public Decision LogへHidden情報を追加しない。

---

## 16. Batch Simulationとバランス検証

v1.5.0では熟練度により「生き残っている側がさらに強くなる」Positive Feedbackが追加される一方、損失後の補充はRecruitとなるため、崩壊側は一時的に弱体化する。

またRiotの高HP・Veteran Attack Chargeと、Horde特殊混成・微増強が同時に入る。

したがって単一Seed勝敗ではなく、v1.4.5とv1.5.0を同じ標準Config、Seed 1～100、Runner上限100 Turnで比較する。日常CIの決定的完走確認はSeed 1～30を維持する。

- Win Rate
- Median／P90 Game Over Turn
- Capital Lost比率
- Civilian Loss／Infection Loss
- Human Unit Loss
- Recruit Produced数
- Regular／Veteran昇格数
- Veteran平均生存Turn
- Riot Produced／Lost
- Horde Type別Spawn／Kill
- Checkpoint Ruin／Fallback／Chain Overrun
- Resource Shortage Loss
- EndTurn時Unused Attack Charge発生率（Balanced Agent）
- Critical Infection Alert未対応Turn数（Balanced Agent）

合格基準はBalanced Agentのv1.4.5比Win Rate差が±10 percentage points以内、Technical Failure 0、Replay／Session不一致0とする。

基準を外れた場合は、敵側・Human側のどちらが過剰でも次の順に1項目ずつ調整する。

1. 特殊Zombie Weight。
2. Turn 10以降の追加Slot数。
3. Riot Police編成Cost。

調整後は100 Seed Batchを再実行し、最終値を本書へ反映する。熟練度条件、Veteran Charge、Horde Noise Radius 8、既存Zombie Attack／HP、経済全体を同時変更しない。実行中の自動難易度調整は導入しない。

原因分析では次を確認する。

1. Veteran 2 Attackの実効DPS。
2. Riotの割合自然回復とSupply維持率。
3. Riot編成Material Cost。
4. 特殊Zombie Weight。
5. Horde追加Slot。

複数の基礎パラメータを同時変更して原因を不明瞭にしない。

---

## 17. 本Releaseで対象外とする候補

次の項目はv1.5.0の実装対象外とし、将来Update候補として分離する。

- Random Map／Terrain自動生成。
- Army Base。
- Field Artillery。
- IFV。
- Gas Zombie。
- Scream Zombie。
- Hunter Zombie。
- Human Unit Transport／搭載システム。
- Artillery Friendly Fire／Scatter／Deployment状態。
- VehicleによるZombie轢殺。

これらは熟練度・Riot・Horde混成が安定した後に、諸兵科連合／重装備拡張として再検討する。

---

## 18. Definition of Done

v1.5.0は最低限次を満たした時点で完了とする。

1. Human UIとAgent Observationが同じCore由来Crisis Summary／EndTurn Riskを表示できる。
2. Critical情報はHidden Stateへ依存せず、QueryがState／RNGを変更しない。
3. Human UIが選択対象中心、未選択Accordion、上部資源Accordion、固定Action領域へ再編され、Agent情報を削減しない。
4. Recruit／Regular／VeteranがSave／Replay可能な正式Stateとして実装される。
5. 初期UnitはRegular、標準新規編成はRecruitとなる。
6. Recruit 5 Turn生存、Regular 5 Zombie Unit直接Kill、Veteran Attack Charge 2が決定的に動作する。
7. Veteranの複数Attack／Counterattack／Interception／自動鎮圧が共通Attack Chargeで整合する。
8. Riot PoliceがHP75、Recruit Attack10、MP10、Range1、Pop10、Noise Radius 5の警察系重装Unitとして動作する。
9. Riot PoliceをCapital／CityでCost P10/C25/M25により生産でき、死亡時にRiot Zombie HP50へReanimationする。
10. Scheduled Hordeが軽度増強され、Zombie SlotへPolice／Soldier／Riot Zombieを決定的に混成できる。
11. Warning前に未確定Horde特殊Typeを漏らさない。
12. Horde実移動が毎回Radius 8共通Noiseを発生させ、Normal AI誘引と陥落拠点再Spawnを決定的に解決する。
13. Final Horde由来特殊ZombieがFinal撃退条件へ正しく含まれ、可視時に公開Badgeを持つ。
14. Human UI、Headless、Agent、Browser Bridge、Save／Replay／Sessionが同じCore Ruleを使用する。
15. Unit Test、UI Test、Replay Test、Session Test、Seed 1～30 CI、Seed 1～100比較Batchが完走する。
16. v1.4.5以前との互換境界を確定Versionとして明示し、暗黙変換しない。
17. README、PLAY_WITH_AI、Agent API Help、常設Help、現行仕様書、Release Version表示をv1.5.0へ更新する。

---

## 19. 確定事項と変更管理

1. Bottom Sheetは選択対象だけを表示し、未選択時だけ全体情報をAccordion表示する。資源詳細は上部の単一展開Accordionへ移す。
2. Agent Observation、Legal Actions、Forecast、Event、候補一覧はHuman UI簡略化を理由に削減しない。
3. Crisisは全件をCore／Agentへ返し、Human UIだけを段階表示する。City／生産施設／Active Checkpointの未封じ込め感染とCheckpoint防御深度低下はCritical。
4. Riot PoliceはHP75、Recruit Attack10、MP10、Range1、Vision5、Pop10、Cost P10/C25/M25、Fuel12、Emergency MP2、Military Goods5、Noise `medium`／Radius5。
5. Riot ZombieはHP50、Attack5、MP3、Range1、Vision5。
6. Turn 10以降は方向ごとの非Horde Slotを+1し、WeightはNormal70／Police15／Soldier10／Riot5、Riot Capは1方向1Waveにつき1。
7. 特殊TypeはSpawn時に抽選し、Warning中は未確定内訳を公開しない。
8. 5体目直接Kill時はVeteran昇格待ちとし、次Player Turn Startに昇格・Charge2を適用する。
9. Waitは能動行動だけを終了し、残Chargeを自動鎮圧、Interception、Counterattack用に保持する。
10. Human CombatとHorde移動は共通Noise。Horde実移動は毎回Radius8でNormal AI誘引と陥落拠点再Spawnを起こす。
11. Version境界は12章の値で固定し、v1.4.5以前を暗黙変換しない。
12. 100 Seed Batchで合格基準を外れた場合だけ、16章の順で値を1項目ずつ調整し、最終値を本書へ反映する。ここに明示した固定対象は変更しない。

本書に「案」「必要なら」「実装時に選択」等の代替挙動は残さない。実装中に新しい仕様判断が必要になった場合は、コードだけで決めず本書を更新してから実装・Test・現行仕様反映を行う。
