# Nowhere Left to Hide PoC v1.3.3 アップデート要件 確定版
## Checkpoint Fallback Network / Noise / Balanced Agent Battlefield Awareness

作成日: 2026-08-31  
ステータス: 確定版

---

# 1. 文書の位置づけ

本書は、v1.3.2のPlaytest結果を受けてv1.3.3で追加・変更する要素を定義する確定要件である。

- 実装・テスト完了までは `Doc/Nowhere Left to Hide PoC 現行仕様.md` を安定版の正本とする。
- v1.3.2で成立したHorde HP20、Mixed Horde、Terrain、Fog of War、Checkpoint Explainability、Final Horde Victoryは原則維持する。
- 本書では、Checkpointの行政冗長化、Noise、Balanced Agentの戦場選択改善を一つの更新として扱う。
- Multi-direction Horde、大型Map、Road Network再設計は本Versionでは導入しない。

---

# 2. 背景

v1.3.2 Sol Mediumのリベンジテストでは、同じPlayer Modelが敗北理由を学習しながら3回目でTurn 43 Victoryへ到達した。

主な学習過程は次の通り。

1. Checkpointを建設せず、内部感染頻発から崩壊。
2. Checkpoint建設不可理由を解消して建設するようになったが、敵を倒すことだけを優先し、不利なTerrainでHordeと戦って崩壊。
3. 全方向Checkpointを確立し、Forest上のZombieを追わずPlainへ誘導し、Urban Defenseを利用して勝利。

勝利Runでは、`checkpointsBuilt = 4`、`unmanagedPassThrough = 0`、`resourceShortageLosses = 0`、`unitLosses = 0`、`hordeTargetInheritedCount = 15`となり、Checkpoint、Terrain、Mixed Horde Targetingが実際の勝敗要因として機能した。

一方、Horde戦中にActive Checkpointが陥落すると、Playerが即座に後方へ再配置する余裕がない場合、

```text
Checkpoint Loss
→ Branch Unmanaged
→ Refugee Pass Through
→ Supply Front Collapse
→ Production Loss
→ Infection / Economy Collapse
```

という連鎖が発生し得る。

v1.3.3ではこれを「無条件に救済する」のではなく、Playerが事前に後方Checkpoint設備を残しておくことで吸収できるようにする。

また、v1.3で延期したNoiseを導入し、戦闘そのものが周辺Normal Zombieを引き寄せる要素を追加する。

---

# 3. 本Versionのテーマ

> **Administrative Resilience / Battlefield Awareness / Combat Noise**

v1.3.3では、Playerへ次の判断を要求する。

- 前線が崩れる前に第二・第三の行政線を準備する。
- 全てのZombieを見つけ次第追撃せず、どこで戦うかを選ぶ。
- 発砲・戦闘によって周辺Zombieを引き寄せるRiskまで考慮する。
- 必要ならUrban Defense上で待ち、敵を有利な場所へ誘導する。

---

# 4. Version境界

Version境界は以下で確定する。

| 対象 | v1.3.3 |
|---|---|
| App / Release | `1.3.3` |
| Game Rules / GameState / Config | `1.4.2` |
| Fixed Map ID | `fixed-15x15-v2` |
| Save Format | `4` |
| Agent API | `1.4.2` |
| Observation API | `1.4.2` |
| Browser Bridge API | `1.4.2` |
| Artifact Schema | `1.4.2` |
| Balanced Agent | `3.1.0` |
| Random Agent | `1.2.0` |

理由:

- Checkpoint Post構造とNoise Target MemoryがGameStateへ追加される。
- ConfigへCheckpoint Role上限、Noise Radius、Noise Classが追加される。
- Observation / Agent APIへCheckpoint RoleとNoise Ruleが追加される。
- Balanced Agentは判断原理を拡張するが、既存Agentの目的自体は維持するためminor更新とする。

v1.3.2以前のSave／Replay／Artifactは自動変換しない。Version不一致として現在Stateを変更せず理由付きで拒否し、旧データを削除、上書きしない。App Version差だけでなくGame Rules、Save Format、Artifact Schemaの互換性境界を使用する。

---

# 5. スコープ

## 5.1 追加・変更するもの

- 1 Branch上の複数Checkpoint Post
- Active / Standby Checkpoint Role
- Dormant Checkpoint Role
- Active Checkpoint失陥時のAutomatic Fallback
- Standby直接建設
- Standby / Dormantの手動Active化
- Relocation／Activate後RemnantのStandby／Dormant化
- Fallback時のSupply Front再計算
- Refugee Arrival前のFallback Resolution
- Noise Radius
- Combat Noise Pulse
- Normal Zombie Noise Target Memory
- Noise / Horde Inheritance / Visible PopulationのTarget優先順位
- Noise Event / Replay / Metrics
- Human UI／Agent APIのNoise Class公開（正確なRadiusは非公開）
- Development Build限定のNoise Debug Overlay
- Agent APIのNoise Rule公開
- Balanced AgentのCheckpoint重視
- Balanced AgentのTerrain-aware Combat
- Balanced AgentのNoise Risk評価
- Test / Replay / Metrics更新

## 5.2 今回変更しないもの

- Horde Zombie HP20
- Normal Zombie HP10
- Mixed Horde Composition
- Final Horde Composition
- Horde Spawn Cycle
- Final Horde Turn
- Victory Condition
- Terrain Damage Multiplier
- Vision Range
- Fog of War
- TerrainによるNoise遮蔽・減衰
- Noiseの重複増幅
- Facility / Vehicle / Aircraft由来Noise
- NoiseによるHorde Zombie Target変更
- Multi-direction Horde
- Map Size
- Road Network再設計
- Economy Balance

---

# 6. Checkpoint Data Model

Checkpointの物理状態と支線上の行政Roleを分離する。

物理`status`は現行の次の4値を維持する。

```text
operational
remnant
ruined
abandoned
```

Branch Roleは次の3値とする。

```text
active
standby
none（Dormant）
```

Roleの正本は`RoadBranchState.activeCheckpointId`と`RoadBranchState.standbyCheckpointIds`とする。`status === operational`で、いずれのIDにも含まれない同支線PostをDormantとして導出する。`CheckpointState`へ重複する可変`role`を保存しない。

`standbyCheckpointIds`は重複を許さず、存在する同支線のoperational Postだけを参照する。Observation、UI、EventではCoreの共通導出関数からRoleを返す。

---

# 7. Checkpoint Role上限

1支線のRole上限は次で固定する。

```text
Active = 最大1
Active + Standby = 最大3
Dormant / Remnant / Ruined / Abandoned = 上限外
```

Configは`checkpoint.maxPreparedPostsPerDirection = 3`とする。ActiveとStandbyだけを数え、従来案の`maxPostsPerDirection`は使用しない。

Remnant、Ruined、Abandoned、Dormantは上限を消費しないがMap上の物理地点として残り、同じHexへの建設を妨げる。Standby専用維持費は追加しない。

上限到達時は`checkpoint_prepared_post_limit_reached`で新しいStandby建設を拒否する。v1.3.3では自動撤去、自動降格、`DecommissionCheckpoint`を追加しない。

---

# 8. Active / Standby / Dormant

## 8.1 Active

Activeだけが次を行う。

- 新規Refugee Arrival受付
- Screening Queue開始
- Branch Policy適用
- Supply Front決定
- Checkpoint Vision提供

## 8.2 Standby

Standbyは物理的にoperationalで、Automatic Fallbackの第一候補となる。

- 新規Refugee Arrivalを受けない
- 新規Screening Queueを作らない
- Supply Frontを変更しない
- Visionを提供しない

## 8.3 Dormant

Dormantは物理的にoperationalだが、Active＋Standby上限の外にある無役Postである。

- 新規Refugee Arrival、Screening、Supply、Visionを提供しない
- Automatic FallbackではStandbyが存在しない場合だけ第二候補になる
- Playerは`ActivateCheckpoint`で手動Active化できる

---

# 9. Checkpoint建設・移設・切替

## 9.1 BuildCheckpoint

- Activeがない支線への`BuildCheckpoint`は、新PostをActiveとして建設する。
- Activeがある支線では、現Activeより州都側の空き道路Hexに限り、`BuildCheckpoint`でStandbyを直接建設できる。
- Standby直接建設は民需品5、支線ごとのCheckpoint操作1回、全体Action 1回を消費する。
- Standby建設先HexにVisible Zombieがいる場合だけ拒否する。現在のSupply Sector内の別HexにいるZombieは妨げない。Hidden Zombieは候補差分や実Actionを阻害しない。
- 同支線の別Postに感染者がいてもStandbyを建設できる。

## 9.2 RelocateCheckpoint

- 現行どおりActiveを同支線の新しい空き道路Hexへ移設し、新地点をActive、旧地点をRemnantにする。
- 前線側・州都側のどちらへも移設できる。
- 移設元Active自身に感染者がいる場合だけ拒否し、別Postの感染者は移設を妨げない。
- 民需品5、支線ごとのCheckpoint操作1回、全体Action 1回を消費する。
- 後方の同一Hexについて、Standby追加の`BuildCheckpoint`と即時後退の`RelocateCheckpoint`は別の合法候補として同時に提示できる。

## 9.3 ActivateCheckpoint

新しい`ActivateCheckpoint` Actionを追加する。

```json
{
  "type": "ActivateCheckpoint",
  "branchId": "east",
  "checkpointId": "checkpoint-east-2"
}
```

- 対象は同支線のStandbyまたはDormantに限る。
- 民需品は消費せず、支線ごとのCheckpoint操作1回と全体Action 1回を消費する。
- 前線側のPostをActive化してSupplyを再拡大する場合は、現行と同じ`checkpoint_supply_zombie_blocked`をVisible Zombieだけで判定する。
- 対象HexにVisible ZombieがいるPostは利用不能とする。Hidden ZombieはPlayer Actionの候補差分や実Actionを阻害しない。
- 同支線の別Postに感染者がいても、対象自身が利用可能なら切替を許可する。
- 旧Activeに管理人口または感染者が残る場合はRemnantにし、瞬間移動させない。
- 旧Activeが空かつ同HexにZombie不在なら、上限に空きがある場合はStandby、空きがない場合はDormantにする。
- DormantをActive化した結果、Active＋Standbyが4になる場合は旧ActiveをStandbyにせず、前項のRuleで合計3を維持する。

Checkpoint候補Query、Human UI、Agent Observation、合法手は、同一Hexに複数Actionが成立する場合もAction種別ごとに全候補を返す。全候補Query、`getLegalActions()`、実Action Validationは同じCore判定を使用する。

---

# 10. Automatic Fallback

Activeが敵襲、感染、荒廃等によってCore Rule上operationalでなくなった直後、同支線で次の順に自動昇格する。

1. 失陥地点より州都側にあるStandbyのうち、失陥地点に最も近い最前方Post
2. 1がなければ、同条件のDormant
3. どちらもなければ`activeCheckpointId = null`

Game Truth上でPostのHexにZombieがいる候補は除外する。前線側のStandby／DormantはAutomatic Fallback候補にしない。Hidden Zombieの存在、候補除外理由、ID、位置は公開しない。

```text
A active -> ruined
B standby
C standby

=> B active
=> C standby
```

Relocate／Activateは新Active設定と旧Role変更を1つの原子的Actionとして完了させ、その途中状態をAutomatic Fallback Triggerにしない。

---

# 11. Fallback Resolution Timing

Fallbackを次Player Turn Startまで待たず、Active失陥を起こしたCore処理の直後に解決する。最低限、次より前にCore State、Supply、Observationを更新する。

- 次回Refugee Arrival／Unmanaged Pass Through判定
- Supply Frontを使用する経済・人口判定
- 後続Unitの行動または自動サブフェーズ

Human UI Notificationは次Player Phase開始時にまとめて表示できるが、Core State更新を遅延させない。

---

# 12. Supply Fallback

AからBへFallbackした場合、Supply FrontもB基準へ即時後退する。

```text
A-B間のForward Facilities -> Out of Supplyになり得る
BよりCapital側 -> Supply維持
```

FallbackはForward Territory、Facility Supply、Defense Line、Economic Capacityの損失を無効化しない。防ぐのは事前設備がある支線の行政機能が一瞬で0になることだけである。

---

# 13. Refugee Fallback

Fallback後に新規到着するRefugeesは新Activeへ到着する。旧Activeの`waiting`、`screening`、`approved`、`infected`を移動させない。旧地点は物理Statusに従って処理を継続する。

---

# 14. Remnant処理完了後のRole

Relocate／Activate後の旧Activeは、管理人口または感染者が残る場合にRemnantとなる。

次をすべて満たした時点でRemnantを削除せずoperationalへ戻す。

```text
waiting = 0
screening = 0
approved = 0
infected = 0
Post Hex上にZombieがいない
```

Active＋Standbyが3未満ならStandby、3ならDormantにする。ZombieがHex上にいる間はRemnantのままとし、復帰させない。

---

# 15. Ruined RecoveryとRole

Ruined Postの感染者が0になり、同HexにZombieがいない場合はoperationalへRecoveryする。

- BranchにActiveがない場合はRecovered PostをActiveにする。
- 別Activeがあり、Active＋Standbyが3未満ならStandbyにする。
- 別Activeがあり、上限3ならDormantにする。
- Recoveryだけで既存Activeを奪わず、Supply Frontを自動的に前進させない。

前線側のRecovered Standby／Dormantを再びFrontにするには、Playerが明示的に`ActivateCheckpoint`を実行する。

---

# 16. Checkpoint Policy

Policyの正本をCheckpoint個別状態から`RoadBranchState.currentPolicy`へ移す。初期値は`normal`とする。

`SetCheckpointPolicy`は`checkpointId`ではなく`branchId`を受け取る。Activeがある支線だけ変更可能とし、Activeがない間は直前値を保持する。

Build、Relocate、Activate、Automatic Fallback、RecoveryでPolicyを`normal`へ戻さない。新Activeは常に支線Policyを使用する。既に開始済みのScreening Batchは開始時Policyを保持し、支線Policy変更の影響を遡及させない。

---

# 17. Checkpoint UI / Agent Observation

Human UIとAgent Observationは次を識別する。

- Active
- Standby
- Dormant
- Remnant
- Ruined
- Abandoned

Road Branch Panelは、Active、Standby、Dormant、Fallback可否、支線Policy、Role上限使用数を表示する。

```json
{
  "branchId": "east",
  "activeCheckpointId": "checkpoint-east-3",
  "standbyCheckpointIds": ["checkpoint-east-2", "checkpoint-east-1"],
  "dormantCheckpointIds": ["checkpoint-east-0"],
  "fallbackAvailable": true,
  "currentPolicy": "strict",
  "preparedPostCount": 3,
  "preparedPostLimit": 3
}
```

Player自身が設置したPostのID、位置、物理Status、RoleはFog of War対象外とする。ただしAutomatic Fallbackで候補から除外されたHidden Zombieの情報は公開しない。

公開`fallbackAvailable`は「州都側に物理StatusとRole上の候補が存在する」という構造上の可否を表し、Hidden Zombieによる内部候補除外を反映しない。実Fallbackが成立しなかった場合も、Hidden Zombieの存在をReasonやEventで明示しない。

---

# 18. Checkpoint Invariants

- 各支線のActiveは最大1。
- `activeCheckpointId`と`standbyCheckpointIds`は同じIDを参照しない。
- Standby IDは同支線のoperational Postだけを参照する。
- Active＋StandbyはConfig上限3以下。
- Remnant／Ruined／AbandonedはActiveまたはStandbyにならない。
- ActiveだけがRefugee Arrival、Supply、Visionを提供する。
- Role変更、Supply再計算、Event生成はGameEngine内で原子的かつ決定的に行う。

---

# 19. Noise概要

v1.3で延期したNoiseをv1.3.3で導入する。

Noiseは、Human Unitが参加する通常Combat発生地点を中心に、周辺のTargetを持たないNormal Zombieを引き寄せる。

内部標準Noise Radius:

| Human Unit | Noise Radius |
|---|---:|
| Police | 4 |
| National Guard | 5 |

Config例:

```json
{
  "noise": {
    "police": 4,
    "nationalGuard": 5
  }
}
```

DistanceはHex Distanceとする。

```text
hexDistance(zombie, noiseCenter) <= noiseRadius
```

Terrain、Road、Forest、Mountain、UrbanはNoiseを遮蔽・減衰しない。

Production向け公開情報では正確なRadiusを公開せず、次のNoise Classだけを使用する。

```text
small
medium
large
extraLarge
```

v1.3.3の公開ClassはPolice、National Guardともに`medium`とする。内部ではPolice 4、National Guard 5の差を維持する。正確な値はCore Config、Test、Verification Artifact、Development Build限定Debug Overlayでだけ確認できる。

---

# 20. Noise発生Combat

Noise Pulseは、通常Combat ResolutionにPlayer Unitが参加した場合に1回だけ発生する。

対象:

- Player UnitによるAttack
- Zombie / Horde ZombieからPlayer UnitへのAttack
- Interception
- Counterattackを伴う通常Combat

Counterattackは同一Combat Resolution内の追加Damageであり、同じ戦闘から二重Noise Pulseを発生させない。

Noise Centerは、Combat Resolution開始時点にそのCombatへ参加するHuman Unitが実際にいるHexとする。

- 移動後Attack: 移動先Hex
- ZombieからのAttack: Human Unitの防御地点
- Interception: 移動が停止してCombatを解決するHex

Noise RadiusはそのPlayer Unit Typeで決定する。

以下はNoiseを発生させない。

- Infection Suppression
- 自動感染鎮圧
- Resource Shortage
- Infection Spread
- Facility Overrunそのもの
- Moveのみ
- Wait

将来Vehicle / Aircraft / Facility Noiseを追加可能とするがv1.3.3では扱わない。

---

# 21. Noise対象Unit

NoiseによってTarget変更するのはNormal Zombie (`zombie`) のみ。

Horde Zombie (`hordeZombie`) はNoiseを完全に無視し、現行Targetingを維持する。

```text
Visible Population
>
Capital Strategic Anchor
```

NoiseによってHorde ZombieのTargetを変更しない。

---

# 22. Normal Zombie Noise Target Memory

Normal ZombieへInternal-onlyのNoise Target Memoryを追加する。

概念:

```text
noiseTarget: HexCoord | null
```

これはPlayer / Agent／Production Browser Bridgeへ公開しない。

現行の `inheritedTarget` はHorde由来Target Memoryとしてそのまま維持する。

NoiseはHorde Inheritanceとは別の低Priority Memoryとして扱う。

---

# 23. Noise Pulse受信条件

Noise発生時点で、Normal Zombieが次を満たす場合、そのNoise Centerを`noiseTarget`として記憶する。

- Noise Radius内にいる
- Noise Centerと同一Hexではない
- `inheritedTarget`を現在保持していない
- `noiseTarget`を現在保持していない
- 現時点で明白なVisible Population Targetが存在する場合はNoiseよりPopulationを優先する

すでにTarget Memoryを持つNormal Zombieは新しいNoiseでTargetを上書きしない。

複数Noiseが同じPlayer Turn内に発生した場合、TargetlessなZombieが最初に受理したNoiseを保持し、そのTargetが有効な間は後続Noiseを無視する。

---

# 24. Normal Zombie Target優先順位

v1.3.3のNormal Zombie優先順位を次のように確定する。

```text
1. Visible Population Target
2. Existing / Newly Inherited Horde Target
3. Existing Noise Target
4. Idle
```

Noise PulseはTargetless ZombieへNoise Targetを生成するTriggerであり、Target Decision時には上記3番目として扱う。

重要:

旧v1.3要件では将来Noiseを `Visible Population > Noise > Inherited Horde` の位置へ追加可能と記載していたが、v1.3.3ではこれを明示的に変更する。

v1.3.3では、

```text
Visible Population
>
Inherited Horde
>
Noise
>
Idle
```

を正本とする。

理由は、HordeからのStrategic Target伝播をNoiseより強い集団行動として扱うためである。

---

# 25. Noise TargetからHorde Targetへの変更

Noise Targetへ移動中のNormal Zombieが、既存Horde Inheritance条件を満たした場合、Noise Targetを破棄してHorde Targetを継承する。

例:

```text
Normal Zombie
noiseTarget = (8,8)

途中でHorde ZombieをVision内に確認
Horde Current Target = Capital

=> inheritedTarget = Capital
=> noiseTarget = null
```

以後、そのInherited Targetが有効な間は新しいNoiseを無視する。

Normal -> NormalへのTarget伝播は引き続き禁止する。

---

# 26. Visible Populationによる上書き

Noise TargetまたはInherited Horde Targetを持つNormal ZombieがVisible Population Targetを発見した場合、Visible PopulationをそのZombie Phaseの行動Targetとして最優先する。

Visible PopulationへTarget変更した時点でNoise Targetを破棄する。そのPopulationを後で見失っても、以前のNoise地点への移動を再開しない。

Inherited Horde TargetのMemory挙動は現行仕様どおり維持し、Visible Populationの一時優先だけでは破棄しない。

---

# 27. Noise Target到達

Normal ZombieがNoise Centerへ到達した場合、Noise Targetをclearする。

その時点で、

- Visible Population Targetあり -> そちらをTarget
- Horde Inheritance可能 -> 継承
- どちらもなし -> Idle

となる。

Noise Targetは永続的なStrategic Anchorではない。

---

# 28. Zombie Phase Snapshotとの整合

現行CoreはZombie Phase開始時に全ZombieのTarget Decision Snapshotを作成し、その後Unit ID順に行動を解決する。

この決定論をv1.3.3でも維持する。

したがって、

- Player Phase中に発生したNoise: 次のZombie Phase Target Snapshotへ反映される。
- Zombie PhaseのTarget Snapshot作成後に発生したCombat Noise: そのPhaseですでに確定したDecisionをretroactiveに変更しない。Noise Target Memoryとして保存し、次回Target評価から有効になる。

これにより、Zombie処理順によって「先に動いたZombieだけNoiseへ反応する」等のOrder Dependencyを導入しない。

---

# 29. NoiseとFog of War

Noise判定はGame Truth上の全Normal Zombieへ適用する。

Noise Radius内にHidden Zombieがいても反応可能である。

ただしHuman / Agentへ次を公開してはならない。

- NoiseでTargetされたHidden Zombie ID
- Noiseで反応したHidden Zombie数
- Hidden ZombieのNoise Target
- Hidden ZombieのCurrent Target Reason

PlayerとAgentが知ってよいのは、自分が発生させたNoiseの、

- Center
- Noise Class
- Unit Type
- Turn / Phase

のみ。

正確なRadius、反応数、反応Unit、Noise TargetはProductionのObservation、公開Event、終了結果、Browser Bridge Artifactへ含めない。ローカル／CIのVerification ArtifactとDevelopment Build限定Debug Overlayでは検証目的で保持できる。

---

# 30. Noise Event

新しいGame Eventを追加する。

例:

```text
noise_emitted
```

Public Payload例:

```json
{
  "sourceUnitId": "national-guard-1",
  "sourceUnitType": "nationalGuard",
  "q": 8,
  "r": 10,
  "noiseClass": "medium"
}
```

Public Eventへ正確な`radius`、`affectedZombieIds`、`affectedCount`を含めない。

Internal Metricsでは反応数を計測してよい。

---

# 31. Noise Human UI / Debug UI

Production Human UIでは正確なNoise Radius、Ring、Hex Highlightを表示しない。Unit詳細、Help、Combat LogにNoise Classだけを表示する。

```text
Police: Noise 中 / Medium
National Guard: Noise 中 / Medium
```

Combat LogにはCenterとなったCombat、Unit Type、Noise Classを残せるが、正確なRadiusと反応数は残さない。

Development Build限定のDebug Overlayを追加し、次を確認可能にする。

- 正確なCenterとRadius
- Radius内Hex
- 反応したNormal Zombie
- Internal Noise Target

Debug OverlayはProduction Buildへ含めず、Agent API／Browser Bridgeから呼び出せない。Debug表示がCore State、RNG、Action列へ影響してはならない。

---

# 32. Noise Agent API

`getApiInfo()`のStatic Rulesへ公開Noise Ruleを追加する。正確なRadiusは含めない。

概念:

```json
{
  "noise": {
    "classes": ["small", "medium", "large", "extraLarge"],
    "policeClass": "medium",
    "nationalGuardClass": "medium",
    "distance": "hex",
    "terrainAttenuation": false,
    "normalZombieAffected": true,
    "hordeZombieAffected": false,
    "targetPriority": [
      "visible_population",
      "inherited_horde",
      "noise",
      "idle"
    ]
  }
}
```

Agent APIのProhibited Informationへ、

```text
Zombie Noise Target
Exact Noise Radius
Affected Hidden Zombie IDs / Count
```

を追加する。

---

# 33. Noise Metrics

次のMetricsを必須追加する。

```text
noisePulsesEmitted
policeNoisePulses
nationalGuardNoisePulses
normalZombiesNoiseTargeted
noiseTargetsReached
noiseTargetsOverriddenByHorde
noiseTargetsOverriddenByVisiblePopulation
```

`normalZombiesNoiseTargeted`等、Hidden Enemy状態を推測可能なMetricsはActive Game Observation、Production終了結果、公開Event、Browser Bridge Artifactへ公開しない。ローカル／CIのVerification ArtifactとReplay Analysisへ限定する。

---

# 34. Replay

Replay ArtifactはNoiseをDeterministicに再現可能であること。

同一、

```text
Version
Config
Map
Seed
Actions
```

から、

- Noise Pulse発生
- Noise Target Memory
- HordeによるNoise Target Override
- Noise Target到達

が同じ結果になること。

Noiseそのものに追加乱数を使用しない。

---

# 35. Balanced Agent: Checkpoint Priority

Balanced Agentは、Checkpointを建設できないことをCheckpoint戦略放棄理由として扱わない。

Game序盤の高Priority Goalとして、

```text
全Road BranchへActive Checkpoint確立
```

を強化する。

Checkpoint建設不可の場合は`checkpointPositionCandidates.reasonCode`を読み、解消可能な原因をSubgoal化する。

例:

```text
checkpoint_supply_zombie_blocked
→ Blocking Zombieの除去 / Supply条件改善
→ Checkpoint建設を再評価
```

---

# 36. Balanced Agent: Standby Checkpoint

全方向Active Checkpoint確立後、資源と戦況に余裕がある場合、Standby Post構築を評価する。

後方Standbyの`BuildCheckpoint`、既存Standby／Dormantの`ActivateCheckpoint`、新地点への`RelocateCheckpoint`を異なるActionとして評価する。同じHexにBuildとRelocateの両候補がある場合も、前線維持と即時後退の効果を区別する。

優先度に使えるPublic情報:

- Horde Warning Direction
- Branch turnsUntilArrival
- Active Checkpoint周辺Visible Zombie Threat
- Active Checkpointより前方にある重要Facility
- Civilian Goods Reserve

Standby建設は絶対Goalにせず、軍備・食料・感染対策を犠牲にして全Branchを常に3重化するHard Ruleにはしない。

---

# 37. Balanced Agent: Terrain-aware Combat

現在のCombat Scoreに、単なるTarget Threat / Lethal判定だけでなくBattlefield Terrainを明示的に追加する。

概念:

```text
CombatScore =
  TargetThreat
+ StrategicValue
+ FriendlyTerrainAdvantage
- EnemyTerrainAdvantage
- PostAttackExposure
- NoiseAttractionRisk
+ Urgency
```

---

# 38. Enemy Terrain Advantage

ZombieがForest上にいる場合、Zombie側Damage Reductionがあるため、Immediate ThreatでなければAttack Priorityを下げる。

特にHorde Zombie HP20 + Forest Defenseでは撃破Action数が大きくなるため、Plainへ出てくる可能性があるならWait / Repositionを評価する。

ただし、

```text
if forest: never attack
```

のHard Ruleは禁止する。

---

# 39. Friendly Terrain Advantage

Friendly UnitがUrban Defenseを受けられる位置にいる場合、その位置を保持する価値をCombat Scoreへ加える。

Immediate Threatがなければ、Zombieを追ってUrbanから出るより、

```text
Wait
Hold Position
Lure Enemy
```

を評価可能にする。

---

# 40. Waitの戦術利用

Waitを「行動することがない時のAction」だけとして扱わない。

次の目的で積極的に評価可能とする。

- Hold Defensive Position
- Avoid Forest Fight
- Lure Enemy into Plain
- Lure Enemy toward Urban Defender
- Avoid Overextension
- Preserve Formation

v1.3.2勝利Patternで確認された「有利なTerrainまで敵を誘う」行動をBalanced Agentへ反映する。

---

# 41. Balanced Agent: Noise Awareness

Balanced Agentは、Attackが周辺Normal Zombieを引き寄せる可能性を考慮する。

ただしZombie Target Memoryは非公開なので、Hidden StateやCurrent Targetを推測してはならない。

Attack時のNoise RiskはPublic情報だけから近似する。正確な内部Radiusは使用しない。

```text
Human Unit自身のVision Range内にいるVisible Normal Zombie数
× 公開Noise Class Weight
```

を軽いPenaltyとして使用する。TargetlessかどうかはAgentから見えないため、Visible Normal Zombieを「反応する可能性がある」として上限評価する。v1.3.3ではPolice／National Guardとも公開Classが`medium`であり、内部Radius 4／5の差をAgent判断へ使用しない。

---

# 42. Noiseを利用した防御

Noise Riskは常にNegativeとは限らない。

Friendly UnitがUrban Defense上におり、HP / Support / Retreat条件が十分な場合、Combat Noiseで周辺Normal Zombieを防御地点へ引き寄せることは許容する。

v1.3.3では高度なAggro誘導を必須実装としないが、少なくとも、

```text
Urban上からAttack
```

をNoiseだけを理由に過剰に避けない。

---

# 43. 緊急Threat例外

Terrain / Noise Penaltyより優先するケース:

- CapitalへのImmediate Threat
- Active CheckpointへのImmediate Threat
- 唯一のFarm / Military Factory等へのImmediate Threat
- Civilian PopulationへのImmediate Threat
- 今Turn中にOverrunが予測される
- Final Horde Victory条件の収束に必要

「戦う場所を選ぶ」は「不利Terrainなら何もしない」という意味ではない。

---

# 44. Balanced Agent Playstyle目標

v1.3.3 Balanced Agentは次の優先関係を理解することを目標とする。

```text
Administrative Stability
↓
Active Checkpoint Network
↓
Fallback Depth
↓
Economic Stability
↓
Threat Assessment
↓
Battlefield Selection
↓
Noise Risk
↓
Target Destruction
```

状況に応じUrgencyが上位判断を上書きできる。

Zombie Kill Maximizationを単独の最優先Goalにしない。

---

# 45. Test: Checkpoint Fallback

## Case A

```text
A active operational
B operational standby
C operational standby
A ruined
```

期待:

```text
B becomes active
C remains standby
```

## Case B

```text
A ruined
B ruined
C operational standby
```

期待:

```text
C becomes active
```

## Case C

Standbyなし、州都側Dormantあり。

期待: 最前方DormantがActiveになる。

## Case D

Standby／Dormantなし、または候補HexにZombieあり。

期待:

```text
activeCheckpointId = null
```

## Case E

前線側Standbyと州都側Standbyがある。

期待: 州都側だけを候補にし、前線側へ自動復帰しない。

Hidden Zombieによる候補除外情報が公開Observation／Eventへ漏れないことも確認する。

---

# 46. Test: Refugee Timing

- Enemy処理中にActive Checkpoint失陥
- 次のRefugee ArrivalがPlayer操作前に発生
- Standbyあり

期待:

```text
Fallback Resolution
→ Standby Active化
→ Refugeesは新Activeへ到着
→ Unmanaged Pass Through発生なし
```

---

# 47. Test: Supply Timing

- Active A失陥
- Standby B昇格
- A-B間にForward Facilityあり

期待:

- Forward FacilityはOut of Supplyになり得る
- Bより後方のSupplyは維持
- Branch全体を無条件Supply 0にしない

---

# 48. Test: Relocation Remnant

- Active Aを前方BへRelocate
- AにRefugeesあり

期待:

- AはRemnantとして処理継続
- Population / Infectionが解消するまでStandby化しない
- 4人口値が0かつHex上にZombieがいなくなったらAを削除しない
- Active＋Standbyが3未満ならOperational Standby、3ならDormant

---

# 49. Test: Build / Activate / Recovery Role

## Case A: Standby直接建設

- Activeより州都側の同一Hexに`BuildCheckpoint`と`RelocateCheckpoint`の両候補が出る
- Buildは民需品5、支線操作1回、全体Action 1回を消費し、Activeを変更しない
- 建設先HexのVisible ZombieだけがStandby Buildを阻害する
- 別Postの感染と、Supply Sector内の別HexにいるZombieは阻害しない
- Active＋Standbyが3なら具体的な上限Reasonで拒否し、自動撤去しない

## Case B: Activate

- Standby／Dormantを同支線のActiveへ切り替えられる
- 民需品0、支線操作1回、全体Action 1回を消費する
- 旧Activeに人口等があればRemnant、空かつ安全なら空き枠に応じStandby／Dormantとなる
- Dormant切替時もActive＋Standbyが3を超えない
- 別Postの感染は阻害しない
- 前線側へ再拡大する場合はVisible Zombieによる`checkpoint_supply_zombie_blocked`を適用する

## Case C: Recovery

- Aが旧FrontでRuined
- Fallback後BがActive
- Aの感染を鎮圧してRecovery

期待:

```text
A = operational standby（上限に空きがある場合）
B = active
```

Aが勝手にActiveを奪い返さない。上限3ならAはDormantになる。

BranchにActiveが存在しない場合のみRecovered AをActiveへできる。

## Case D: Branch Policy

- `SetCheckpointPolicy`は`branchId`を受け取る
- Activeがない支線では拒否する
- Build／Relocate／Activate／Fallback／RecoveryでPolicyをリセットしない
- 開始済みScreening BatchのPolicyは変更しない

---

# 50. Test: Noise Radius

## Police

- PoliceがCombat
- Noise CenterからHex Distance 4以内のTargetless Normal Zombie

期待: Noise Target取得。

Distance 5のNormal Zombieは反応しない。

## National Guard

Distance 5以内で反応、6では反応しない。

Terrainによる減衰なし。

Production Human UI／Agent API／公開EventにはRadius 4／5を出さず、両Unitを`medium`として返す。Development Build限定Debug Overlayでは正確なRadius、範囲Hex、反応Unit、Noise Targetを確認できる。

移動後Attack、ZombieからのAttack、Interceptionで、Combat Resolution開始時のHuman Unit所在HexがCenterになることを確認する。Counterattackを含む1回のCombatからPulseが重複しないことを確認する。

---

# 51. Test: Noise Target Priority

## Case A: Idle -> Noise

```text
Visible Populationなし
Inherited Hordeなし
Noise Radius内
```

期待:

```text
noiseTarget = combat hex
```

## Case B: Existing Inherited Target

Noise Radius内でもInherited Targetを維持。

## Case C: Noise移動中にHorde継承可能

期待:

```text
Inherited Horde Targetへ変更
noiseTarget clear
```

## Case D: Noise移動中にVisible Population発見

期待: Visible Populationを優先し、Noise Targetを即時clearする。後でPopulationを見失ってもNoise地点へ戻らない。

## Case E: Horde Zombie

Noise Radius内でもTargetingに一切影響なし。

---

# 52. Test: Multiple Noise

同一Player TurnにCombat A、Combat Bの順でNoise発生。

Targetless Normal ZombieがAを受理した後BのRadiusにも含まれる場合、Aを維持する。

新しいNoiseでTargetを上書きしない。

---

# 53. Test: Zombie Phase Determinism

Zombie Phase Target Snapshot作成後にCombat Noiseが発生しても、そのPhaseですでに確定したDecisionを変更しない。

次回Target SnapshotでNoise Memoryを評価する。

Zombie Unit ID順を変更しても、同じ入力StateからNoiseによる行動結果が不当に変化しないことを確認する。

---

# 54. Test: Fog of War Leakage

Hidden Normal ZombieがNoiseへ反応するScenarioを作る。

Human / Agentへ、

- Hidden Zombie ID
- Hidden affected count
- Hidden noiseTarget

が公開されないこと。

ProductionのNoise EventにはPlayerが知っているCenter、Unit Type、Noise Classだけを含める。正確なRadius、反応数、反応IDを含めない。

Production終了結果とBrowser Bridge ArtifactにもHidden反応Metricsを含めず、Verification Artifactだけに保持する。Debug OverlayがProduction Buildに含まれないことを確認する。

---

# 55. Test: Balanced Agent

最低限次をRegression Testへ追加する。

1. Checkpointが`checkpoint_supply_zombie_blocked`の場合、Checkpoint Goalを放棄せず解消Actionを評価する。
2. Non-urgent Forest Hordeに対し、LethalでないAttackだけを盲目的に繰り返さない。
3. Urban Defenderから不必要に離れるMoveを下げる。
4. PlainへZombieが接近するならWaitを候補に残す。
5. Human Unit自身のVision Range内に複数Visible Normal ZombieがいるAttackへ、公開Noise Classに基づく適度なRisk Penaltyを付与する。
6. Immediate Capital ThreatではTerrain / Noise Penaltyより防衛を優先する。

Noise Risk TestはHuman Unit自身のVision Rangeと公開`medium` Classだけを入力に使い、内部Radius 4／5へ依存しないことを確認する。

標準Configの固定Seed 1～300を技術的失敗なく完遂し、v1.3.2基準と主要Metricsを比較する。固定勝率、Victory Turn、勝率非低下を合否条件にはせず、上記固定Scenario Regression Testを機能合否の正本とする。

---

# 56. Metrics

Checkpoint必須追加Metrics:

```text
standbyCheckpointsCreated
dormantCheckpointsCreated
checkpointActivations
checkpointFallbacks
checkpointFallbacksByBranch
checkpointFallbacksFromStandby
checkpointFallbacksFromDormant
checkpointFallbacksPreventingUnmanagedArrival
maxCheckpointPostsPerBranch
maxPreparedCheckpointPostsPerBranch
activeCheckpointLosses
```

`maxCheckpointPostsPerBranch`はMap上に残る全物理Post、`maxPreparedCheckpointPostsPerBranch`はActive＋Standbyだけを数える。

Noise必須追加Metrics:

```text
noisePulsesEmitted
policeNoisePulses
nationalGuardNoisePulses
normalZombiesNoiseTargeted
noiseTargetsReached
noiseTargetsOverriddenByHorde
noiseTargetsOverriddenByVisiblePopulation
```

これらを既存Metricsの、

```text
hordeTargetInheritedCount
normalZombieIdleCount
urbanDefenseApplications
forestDefenseApplications
unmanagedPassThrough
resourceShortageLosses
victoryTurn
```

と合わせて評価する。Hidden Enemy状態を示すNoise Metricsの公開境界は#33に従う。

---

# 57. Playtest観測項目

v1.3.3では勝率だけでなく以下を見る。

- Standbyが実際にHorde中の行政空白を防ぐか
- Standby不在時のDormant Fallbackが連続後退を支えるか
- StandbyによりCheckpoint Lossが無意味になっていないか
- Supply Front Retreatが段階的損失として機能するか
- 全Branch 3重化が常に唯一の最適解にならないか
- Noise TargetがNormal ZombieのIdleを適度に減らすか
- NoiseによってUrban Defense / Hold Positionの価値が増すか
- NoiseがHidden Zombieの不意の接近を生むが理不尽になっていないか
- Police Radius 4 / National Guard Radius 5の差が意味を持つか
- Radius非公開・両Unit`medium`表示でもNoise RuleをHumanが理解できるか
- Balanced AgentがForest上の敵を追い回す傾向を減らすか
- Balanced AgentがCheckpoint不可理由を解消するか
- Wait率
- Unit Loss
- Civilian Loss
- Infection Loss
- Resource Shortage Loss
- Victory Turn
- Final Horde後の収束Turn

---

# 58. Multi-direction Horde

v1.3.3では引き続き実装しない。

理由:

- Horde HP20
- Mixed Horde
- Horde Target Inheritance
- Checkpoint Fallback Network
- Noise
- Terrain-aware Balanced Agent

が同時に作用するため、まずSingle-direction Hordeで戦況を再評価する。

NoiseによってNormal Zombieが戦線外から引き寄せられることで、実質的な局所Threat密度が上がる可能性もある。

Multi-direction Hordeは、v1.3.3でも戦線分割が不足すると確認された後に検討する。

---

# 59. Balance上の注意

Checkpoint FallbackはFailureを消す安全装置ではない。

残すPenalty:

- Forward Territory Loss
- Forward Facility Supply Loss
- 旧Active上のRefugee Risk
- Ruined Post
- Defense Line Retreat
- Economic Capacity低下

Noiseも単純なDifficulty Increaseだけを目的としない。

Noiseの目的は、

> **撃つ場所そのものを戦術判断へ変えること**

である。

Playerが、

- Forestへ追撃して発砲する
- Plainへ誘って発砲する
- Urbanで待って発砲する

のどれを選ぶかによって、その後のNormal Zombie Movementが変わることを狙う。

---

# 60. 成功条件

v1.3.3が成功した状態:

- Active Checkpoint Lossが即Branch行政消滅にならない。
- 事前にStandbyまたはDormantの物理Postを残したPlayerだけがFallback Benefitを得る。
- Standbyがない場合でも、残存Dormantがあれば第二候補としてFallbackできる。
- Frontline LossによるSupply縮小は残る。
- 過去のCheckpoint跡地がStrategic Depthとして意味を持つ。
- Normal ZombieがCombat Noiseへ自然に反応する。
- Horde ZombieはNoiseに影響されない。
- Horde Target InheritanceがNoiseより上位の集団行動として維持される。
- Noise TargetはHidden Enemy情報を漏洩しない。
- Balanced AgentがCheckpointを行政基盤として扱う。
- Balanced AgentがTerrainとNoiseを含めて「どこで戦うか」を評価する。
- 既存Replay Determinism / FoW / Victory / Economyを壊さない。

---

# 61. 設計意図

v1.3.2では、

> **Checkpointを理解すること**
>
> **Terrainを理解すること**

が、単なる知識ではなく勝敗へつながる攻略要素になった。

v1.3.3ではその次の段階として、

> **前線が崩れることを前提に行政の第二線・第三線を準備する**

ことを導入する。

さらにNoiseによって、

> **戦闘は敵を減らすだけでなく、新しい敵を呼び寄せる可能性がある**

という副作用を追加する。

これによりPlayerは、単純なZombie Kill Maximizationではなく、

- Checkpoint Network
- Supply Depth
- Terrain
- Defensive Position
- Wait
- Combat Noise

を合わせて戦場を管理する必要がある。

v1.3.3は、

> **戦線を維持するGameから、戦線の後退と敵の誘導まで管理するGameへ進めるVersion**

と位置付ける。
