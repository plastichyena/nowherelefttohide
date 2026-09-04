# Nowhere Left to Hide PoC v1.5.0 アップデート要件 ドラフト

- 作成日: 2026-09-03
- ステータス: ドラフト
- 対象Release: `1.5.0`
- 基準安定版: `v1.4.5`
- 実装状態: 未実装

## 1. 文書の位置づけ

本書はv1.4.5を基準とし、v1.5.0で検討する危機喚起情報の再設計、Human Unit熟練度、Riot Police／Riot Zombie、Scheduled Hordeの微増強と特殊Zombie混成を定義するドラフトである。

本書で明示的に変更しないルールはv1.4.5を維持する。

v1.5.0では、v1.4.5で成立した「単純な戦闘火力だけではなく、感染、補給、人口、Checkpoint、Horde予告を同時に管理する」という中心体験を維持する。新規要素は既存Unitの全面置換や経済ルールの再設計ではなく、次の3点を強化することを目的とする。

1. 人間および外部AIが、公開済みの重大リスクを大量の状態情報から見落としにくくする。
2. Human Unitを生存させる長期的価値を追加し、補充直後のUnitと古参Unitを区別する。
3. Hordeを単純なHP／個体数増加だけで強化せず、Police／Soldier／Riot Zombieの混成によって戦術的な質を増やす。

本ドラフトでは、Hordeの最終増加数・特殊Zombie抽選Weight、Riot Policeの最終編成Material Costはバランステスト対象として暫定値を置く。実装前または検証中にConfig値として調整できるようにし、数値変更のためにCore Ruleを書き換えない。

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

| 項目 | v1.4.5 | v1.5.0案 |
|---|---|---|
| 危機喚起 | Raw Observation、Forecast、Event、UIカード中心 | Public State由来の`Crisis Summary`／`EndTurn Risk`をHuman UI・Agent Observationへ追加 |
| EndTurn | Legalなら即実行可能 | Legalは維持。重大危機・未使用行動がある場合はHuman UIで追加警告。Agentには構造化Riskを返す |
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
| Horde規模 | Turn 5/10/20/35/50の現行値 | Wave Turn維持。標準案ではTurn 10以降、方向ごとの非Horde枠を+1する軽度増強 |
| Warning Composition | Config固定Compositionを表示 | 総数・Horde Zombie数・特殊混成可能性を表示。Spawn前の未確定乱数結果は公開しない |

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

Coreは公開状態から小さな`Crisis Summary`を生成する。

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

標準Alert候補:

1. `capital_infection_uncontained`
   - Capital infected > 0かつHuman Unit駐留による封じ込めが成立していない。
   - Capitalのinfected、healthy population、suppression可能Unit有無を公開Factsとして返す。

2. `critical_site_infection_uncontained`
   - Owned City、Production Facility、Active Checkpointが感染中かつ未封じ込め。
   - Facility Type、infected、healthy population、現在Production Loss等の既存公開情報を要約する。

3. `checkpoint_defense_degraded`
   - Active Checkpointがinfected／ruined、またはFallback depthが減少した。
   - Branch ID、Active／Standby数、直前Role変化等を公開Factsとして返す。

4. `unused_unit_actions`
   - EndTurn可能なPlayer Phaseで、行動可能Unitまたは残Attack Chargeを持つUnitが存在する。
   - Unit IDと残Move／Attack Charge数を返す。

5. `unit_out_of_supply_risk`
   - Human UnitがSupply外で、HP低下、Fuel低下、Military Goods不足等の既存公開条件を満たす。

6. `horde_warning_active`
   - 既存Horde Warningを要約する。
   - Warning前の方向・将来抽選結果は新たに公開しない。

7. `guaranteed_resource_defeat`
   - 既存Strategic Forecastが現在公開状態のEndTurnでGuaranteed Defeatを返す場合。

8. `new_state_loss`
   - 直前Decision以後にFacility Fall、Checkpoint Ruin、Human Unit Loss等の重大Public Eventが発生した場合。

Alert数が多い場合は`critical`を最優先し、Severity、Category、Entity IDの安定順で返す。Agent向け要約がRaw Observationより大きくならないよう上限を設け、完全情報は既存Observation／Eventから参照できる状態を維持する。

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

Human UIではCritical Alertまたは未使用Attack Chargeが存在する状態でEndTurnを押した場合、確認UIを1回表示する。確認後はEndTurnを実行可能であり、Hard Blockしない。

例:

```text
ターン終了前の確認
- 4部隊がまだ行動可能です
- 1か所の重要施設で感染が封じ込められていません
- Capital: infected 15

このままターンを終了しますか？
```

Agent APIでは文章だけでなく構造化Fieldを返し、LLMが`ready`や感染状態を再集計しなくても確認できるようにする。

### 4.4 State Delta

AI Portable Session／Agent Observationでは、可能な範囲で直前Public Decisionとの差分要約を追加する。

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

DeltaはSession内の前回Public Observationとの差から導出し、Core GameStateへ履歴依存の秘密状態を追加しない設計を優先する。

### 4.5 Human UI

- 上部のTurn／Horde／致命的不足表示と競合しない小型Crisis Stripを追加する。
- `critical`が1件以上ある場合は折りたたみ領域だけへ隠さない。
- 詳細を開くと該当Facility／Checkpoint／Unitを選択できる。
- UI側独自の危機判定を作らずCore Projectionを描画する。
- EndTurn確認は同一Turn内で繰り返し過剰表示しないが、危機集合が重大に変化した場合は再表示できる。

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

命名は実装時に既存型規約へ合わせて調整可能だが、Save／Replay／Artifactで決定的に再現できるJSON状態とする。

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

Kill CreditはそのHuman Unitが直接行った通常攻撃、反撃、迎撃等のDamageで対象ZombieのHPを0にした場合に付与する。

将来、死亡時爆発や間接Damageを持つUnit／Zombieを追加した場合、二次効果によるKillを元Attack Unitへ自動帰属させない。Kill Creditは最終Damage Sourceを明示できる場合だけ付与する。

Recruit時代のKillは`regularZombieKills`へ持ち越さない。

5体目撃破時に昇格条件を満たす。ドラフト標準では、その場で追加Attack Chargeを生成せず、次Player Turn StartからVeteran Bonusを適用する。これにより5体目撃破による同Turn中の追加Action生成を避ける。

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

WaitはUnitのPlayer Phase上の能動行動を終了するが、設計上必要ならEnemy PhaseのCounterattack用Attack Chargeを残せるよう、`Wait`と`Attack Charge消費`を別概念として扱う。既存挙動との整合は実装テストで固定する。

### 5.8 Attack ChargeとMilitary Goods

Attack Chargeが2でもCombat 1回ごとのMilitary Goods Costは既存値を維持する。

例:

- Veteran National GuardがRange 2 Attackを2回行う場合、各2 Military Goods、合計4を必要とする。
- 1回目で残Military Goodsが不足し2回目が成立しない場合、2回目のLegal Attackを列挙しない。
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

この変更に伴い、v1.4.5の`policeSuppression = 5`、`nationalGuardSuppression = 10`を固定独立値として維持するか、熟練度Effective Attackへ統合するかをConfig Schema更新時に整理する。本ドラフトのゲーム挙動上は上記熟練度別鎮圧力を正とする。

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
Max Fuel: Policeと同一を標準案とする
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

Emergency Movement、Max Fuel等のPolice系継承値は実装時Configへ明示し、`unitType === police ? ... : nationalGuard`の二択分岐へ暗黙に流さない。

### 6.4 Military Goods

Riot PoliceはPoliceより多い編成Military Goodsを必要とする。

暫定標準編成Cost:

```text
Population 10
Civilian Goods 20
Military Goods 25
```

これは初期バランステスト用の暫定値とし、最終値はBatch Simulationで調整する。ただし標準RiotのMilitary Goods編成CostはPoliceの10より高くする。

携行Military Goods上限と1回のRange 1 Attack／Suppression Costは、初期案ではPolice系と同じ値を使う。具体的な`maxMilitaryGoods`はConfigへ明示し、バランステストで必要なら調整する。

### 6.5 生産

Riot Policeは操作可能かつSupply内の次Facilityで予約できる。

- Capital
- City

National Guardと異なりCapital限定ではない。

予約、人口徴用、City Busy、次Player Turn完成、完成Hex選択等は既存Unit Production Ruleを再利用する。

完成時熟練度は標準Recruit。

### 6.6 Combat Noise

Riot PoliceのCombat Noise Classは初期案ではPolice系として扱い、具体ClassはConfigへ明示する。本ドラフトではNoiseシステム自体の再設計を行わない。

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

### 8.2 軽度増強の暫定標準値

初期案ではTurn 5をv1.4.5のまま維持し、Turn 10以降は方向ごとの非HordeZombie Slotを+1する。

| Turn | Direction Count | Horde Zombie / direction | v1.4.5非Horde / direction | v1.5.0暫定非Horde / direction |
|---|---:|---:|---:|---:|
| 5 | 1 | 2 | 3 | 3 |
| 10 | 2 | 1 | 4 | 5 |
| 20 | 1 | 4 | 6 | 7 |
| 35 | 3 | 2 | 6 | 7 |
| 50 | 4 | 4 | 7 | 8 |

これは確定値ではなく、v1.4.5比でWave総数を大幅に増やさず、Veteranの追加Attack ChargeとRiot追加に対して軽度な圧力増を与える初期テスト値である。

### 8.3 特殊Zombie抽選Weight

Zombie SlotごとのType WeightはConfig化する。

暫定初期案:

```text
zombie       70
policeZombie 15
soldierZombie 10
riotZombie    5
```

Weightは最終値ではない。特にRiot ZombieはHP 50のため、Batch SimulationでWave難易度分散を確認する。

初期案では1方向1WaveにつきRiot Zombie最大1体のCapを設ける。Cap到達後にRiotが抽選された場合の再抽選／Weight正規化手順を決定的に固定する。

将来ConfigでCapを0または複数へ変更可能にしてよい。

### 8.4 決定性

特殊Zombie Type抽選はGame Seed由来PRNGを使用し、同一Version、Map、Config、Seedから同じWave方向、同じType内訳、同じSpawn位置、同じUnit ID順を得る。

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

もし実装上Warning開始時にType内訳を確定する設計を選ぶ場合、PRNG消費時点を正式Ruleとして固定し、確定したCompositionをHuman／Agent双方へ同じように公開する。Hidden future randomだけをAgentへ先行公開してはならない。

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

---

## 10. Human UI変更

### 10.1 Unit表示

Unit Bottom Sheet／盤面選択要約へ熟練度を表示する。

例:

```text
Police — Recruit
Regularまで: あと2 Turn

National Guard — Regular
Veteranまで: 3 / 5 kills

Riot Police — Veteran
Attack Charges: 2 / 2
```

熟練度色だけに依存せずText／Iconでも区別する。

### 10.2 Attack UI

Veteranが1回Attackした後もChargeが残る場合、Unitを`acted`として完全終了させず、追加Attack可能であることをUIへ表示する。

Move可能性とAttack可能性を別に表示し、「1回攻撃済みだが2回目攻撃可能」を誤認しないようにする。

### 10.3 Riot Police

Police／National Guardと同様に盤面Asset、Bottom Sheet、Production UI、Help、Legend、i18nを追加する。

Riotは重装警察・感染鎮圧／Blockade用途であることをHelpへ明示する。

### 10.4 Crisis UI

Critical Alertは盤面上部から確認でき、対象をタップして該当Site／Unitへ移動できる。

EndTurn Risk確認は長大なRaw情報を表示せず、最重要件数と対象だけを短く示す。

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
  ...fuel / militaryGoods / suppression fields

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
```

既存`UnitConfig.attack`をRegular値として保持するか、Recruit基礎値＋熟練度Projectionへ再構成するかは実装時に統一する。Saveへ保存済みConfig Snapshotを持つ既存原則を維持し、Load後に現在DEFAULT_CONFIGへ暗黙追従させない。

Crisis Alert閾値をConfig化する場合も、ゲームルール上の危機判定とUI表示閾値を混同しない。例えばCapital感染は感染1以上でAlert可能であり、Severity閾値だけをConfigで調整する設計を優先する。

---

## 12. Save／Replay／Session／Artifact互換境界

v1.5.0ではHuman Unit State、Unit Type、Horde Composition、Agent Observation Contractが変更されるため、Game Rules／Save／Replay／Artifact／AI Portable Session／Checkpointの互換Versionを更新する。

v1.4.5以前のSave／Replay／Sessionをv1.5.0へ暗黙変換しない。

理由:

- v1.4.5 Human Unitは熟練度・Kill Counter・Attack Chargeを持たない。
- Riot Police／Riot Zombie Typeが存在しない。
- Horde WaveのType抽選PRNG消費順が変わる。
- Agent ObservationへCrisis／Proficiency情報が追加される。

Failure Artifact／Run Artifactは最低限次を監査可能にする。

```text
unit proficiency transitions
zombie kill credits
attack charge consumption
suppression check count
riot production / loss / reanimation
horde special composition
crisis alerts emitted
endTurn risk summary
```

Public ArtifactへHidden Enemy位置・未確定抽選結果を漏らさない既存原則を維持する。

---

## 13. Event／Statistics追加

イベント候補:

```text
unit_promoted
unit_kill_credited
attack_charge_consumed
riot_police_commissioned
```

既存`attack`、`interception`、`infection_suppressed`、`human_unit_reanimated`等へProficiency／Charge情報を拡張できる場合は、不要なEvent Type乱立を避ける。

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
- Regularの5体目Zombie撃破でVeteran昇格条件が成立する。
- Direct Attack／Counterattack／InterceptionのKill Creditが正しく付く。
- 同一Zombie Killを複数Unitへ重複Creditしない。

### 15.2 Attack Charge

- Recruit／Regularは1 Charge、Veteranは2 Charge。
- Veteranが同Player Turnに2回Attackできる。
- 1回Attack後にMoveできない。
- Counterattack／InterceptionがChargeを消費する。
- Military Goods不足時に2回目AttackがLegalにならない。
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

### 15.5 Crisis Summary

- 同一StateでAlert集合と順序が決定的。
- Hidden ZombieをAlert生成へ使用しない。
- Crisis QueryでState／RNG／Action Countが変化しない。
- Capital感染未封じ込めをCriticalとして検出できる。
- `ready` Unit／残Attack ChargeをEndTurn Riskへ列挙できる。
- Criticalが存在してもEndTurn Action自体はCore上Legalのまま。
- Human UI確認とAgent構造化情報が同じProjectionを使用する。

### 15.6 Replay／Session

- Promotion、Kill Credit、複数Attack、複数Suppression、Riot Reanimation、Horde特殊抽選をReplayで完全再現する。
- AI Portable Session resume後もProficiency Counter／Attack Charge／Horde PRNG結果が一致する。
- Public Decision LogへHidden情報を追加しない。

---

## 16. Batch Simulationとバランス検証

v1.5.0では熟練度により「生き残っている側がさらに強くなる」Positive Feedbackが追加される一方、損失後の補充はRecruitとなるため、崩壊側は一時的に弱体化する。

またRiotの高HP・Veteran Attack Chargeと、Horde特殊混成・微増強が同時に入る。

したがって単一Seed勝敗ではなく複数Seed Batchで最低限次を比較する。

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

v1.4.5との比較では、v1.5.0の敵増強により勝率が急落した場合、最初にHorde特殊Weight／追加Slot数を調整し、既存Zombie Attack／HPや経済全体を同時に変更しない。

逆にVeteran／Riotで勝率が過度に上がる場合、最初に次を確認する。

1. Veteran 2 Attackの実効DPS。
2. Riotの割合自然回復とSupply維持率。
3. Riot編成Material Cost。
4. 特殊Zombie Weight。
5. Horde追加Slot。

複数の基礎パラメータを同時変更して原因を不明瞭にしない。

---

## 17. 本Releaseで対象外とする候補

次の案はv1.5.0本ドラフトでは実装対象外とし、将来Update候補として分離する。

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
3. Recruit／Regular／VeteranがSave／Replay可能な正式Stateとして実装される。
4. 初期UnitはRegular、標準新規編成はRecruitとなる。
5. Recruit 5 Turn生存、Regular 5 Zombie Kill、Veteran Attack Charge 2が決定的に動作する。
6. Veteranの複数Attack／Counterattack／Interception／自動鎮圧が共通Attack Chargeで整合する。
7. Riot PoliceがHP75、Recruit Attack10、MP10、Range1、Pop10の警察系重装Unitとして動作する。
8. Riot PoliceをCapital／Cityで生産でき、死亡時にRiot Zombie HP50へReanimationする。
9. Scheduled Hordeが軽度増強され、Zombie SlotへPolice／Soldier／Riot Zombieを決定的に混成できる。
10. Warning前に未確定Horde特殊Typeを漏らさない。
11. Final Horde由来特殊ZombieがFinal撃退条件へ正しく含まれる。
12. Human UI、Headless、Agent、Browser Bridge、Save／Replay／Sessionが同じCore Ruleを使用する。
13. Unit Test、Replay Test、Session Test、複数Seed Batchが完走する。
14. v1.4.5以前との互換境界をVersionとして明示し、暗黙変換しない。
15. README、PLAY_WITH_AI、Agent API Help、常設Help、現行仕様書、Release Version表示をv1.5.0へ更新する。

---

## 19. 未確定事項

実装着手前または初期Batch後に確定する項目:

1. Riot Policeの最終Civilian Goods／Military Goods編成Cost。
2. Riot Policeの`maxMilitaryGoods`最終値。
3. Riot Police Combat Noise Class。
4. Turn 10以降の非Horde Slot +1案をそのまま採用するか。
5. Police／Soldier／Riot Zombieの最終抽選Weight。
6. Riot Zombieの1方向あたりCap最終値。
7. Regular→Veteranの5体目Kill後、昇格表示を即時にするか、Bonus適用を次Player Turn Startに限定する最終UI表現。
8. `Wait`後にVeteranのCounterattack Chargeを残すかを含む、Player Phase Action StateとAttack Chargeの最終状態機械。
9. 熟練度別鎮圧力をEffective Attackへ統合した際のConfig Schema名称。
10. Crisis Alertの最終Severity閾値・同Turn再通知抑制規則。

未確定項目はすべてConfig／状態機械／UI表現の調整範囲とし、v1.5.0の中心設計である「公開危機情報の可読化」「熟練度」「Riot」「特殊Zombie混成Horde」は維持する。
