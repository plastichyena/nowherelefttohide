# Nowhere Left to Hide PoC v1.3.3 アップデート要件 ドラフト
## Checkpoint Fallback Network / Noise / Balanced Agent Battlefield Awareness

作成日: 2026-08-31  
ステータス: Draft

---

# 1. 文書の位置づけ

本書は、v1.3.2のPlaytest結果を受けてv1.3.3で追加・変更する要素を定義するドラフトである。

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

推奨Version境界は以下とする。

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
- ConfigへCheckpoint Post上限とNoise Radiusが追加される。
- Observation / Agent APIへCheckpoint RoleとNoise Ruleが追加される。
- Balanced Agentは判断原理を拡張するが、既存Agentの目的自体は維持するためminor更新とする。

---

# 5. スコープ

## 5.1 追加・変更するもの

- 1 Branch上の複数Checkpoint Post
- Active / Standby Checkpoint Role
- Active Checkpoint失陥時のAutomatic Fallback
- Relocation後RemnantのStandby化
- Fallback時のSupply Front再計算
- Refugee Arrival前のFallback Resolution
- Noise Radius
- Combat Noise Pulse
- Normal Zombie Noise Target Memory
- Noise / Horde Inheritance / Visible PopulationのTarget優先順位
- Noise Event / Replay / Metrics
- Human UIのNoise可視化
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

# 6. Checkpoint Data Model方針

現行実装ではCheckpointの物理状態として、

```text
operational
remnant
ruined
abandoned
```

を使用している。

v1.3.3では、互換性と責務分離のため、`standby`を新しい物理`status`として追加しない。

代わりに、

```text
Physical Status
+
Branch Role
```

を分離する。

Branch Roleは概念的に、

```text
active
standby
none
```

とする。

実装上は `RoadBranchState.activeCheckpointId` をActiveの正本として維持し、

```text
status === operational
&& checkpoint.id !== branch.activeCheckpointId
```

である同Branch内CheckpointをStandbyとして導出してもよい。

必要なら明示的な`role`をObservation層へ追加する。

---

# 7. Checkpoint Post上限

現在の「1方向1Checkpoint」を、

```text
1 Branch = Active 1 + Standby up to 2
```

へ拡張する。

推奨Config:

```text
checkpoint.maxActivePerDirection = 1
checkpoint.maxPostsPerDirection = 3
```

ただしCore上、Activeは `activeCheckpointId` が単一値であるため、`maxActivePerDirection = 1`を暗黙Ruleとして固定してもよい。

Standby専用維持費はv1.3.3では追加しない。

---

# 8. Active / Standbyの意味

## 8.1 Active

Active Checkpointのみが次を行う。

- 新規Refugee Arrival受付
- Screening
- Branch Policy適用
- Supply Front決定
- Operational Checkpoint Vision提供

## 8.2 Standby

Standby Checkpointは物理的には`operational`だが、Branchの`activeCheckpointId`ではない。

Standbyは、

- 新規Refugee Arrivalを受けない
- 新規Screening Queueを作らない
- Supply Frontを前進させない
- Active Checkpoint失陥時のFallback候補となる

とする。

Visionについては、行政機能停止中であることを優先し、v1.3.3ではStandbyから追加Visionを提供しないことを推奨する。

---

# 9. Checkpoint Front構造

例:

```text
Map Edge
   |
 [ A ] Active
   |
 [ B ] Standby
   |
 [ C ] Standby
   |
Capital
```

通常時はAだけがBranch Frontを構成する。

---

# 10. Automatic Fallback

Active CheckpointがCore Rule上`operational`でなくなった場合、同BranchのStandbyから自動昇格を行う。

候補条件:

- 同じRoad Branch
- Current ActiveよりCapital側
- Physical Statusが`operational`
- Current Activeではない
- Core Rule上利用可能

複数候補がある場合、失陥したActiveに最も近いCapital側、すなわち最前方のStandbyを選ぶ。

例:

```text
A ruined
B standby
C standby

=> B active
=> C standby
```

Bも利用不能ならCを選ぶ。

Standbyが存在しない場合のみ `activeCheckpointId = null` とする。

---

# 11. Fallback Resolution Timing

Fallbackを次Player Turn Startまで待ってはならない。

Active Checkpoint失陥後、最低限次の処理より前にFallbackを解決する。

- 次回Refugee Arrival判定
- Unmanaged Pass Through判定
- Supply Frontを使用する経済・人口判定

目的は、

```text
Enemy PhaseでCheckpoint失陥
→ Playerへ操作権が戻る前にRefugeesが強制Pass Through
```

という行政空白を防ぐことである。

Human UI上のNotificationは次Player Phase開始時に表示してよいが、Core Stateは先に更新する。

---

# 12. Supply Fallback

AからBへFallbackした場合、Supply FrontもB基準へ即時後退する。

```text
A-B間のForward Facilities
→ Out of Supplyになり得る

BよりCapital側
→ Supply維持
```

FallbackはFrontline Lossを無効化しない。

防ぐのはBranch全体が一瞬で行政0になることであり、前方施設喪失やSupply縮小は意図されたPenaltyとして残す。

---

# 13. Refugee Fallback

Fallback後に新規到着するRefugeesは、新Active Checkpointへ到着する。

旧Activeにすでに存在していた、

- waiting
- screening
- approved
- infected

Populationを新Activeへ瞬間移動させない。

前線失陥時に現地へ残ったPopulation Riskは維持する。

---

# 14. Relocation後の旧Checkpoint

現行Relocationでは旧Checkpointを`remnant`へ変更し、新Checkpointを`operational`として作成する。

v1.3.3でもこのTransitionを維持する。

ただし、旧Remnantについて、

```text
waiting = 0
screening = 0
approved = 0
infected = 0
```

等、既存処理上その地点に管理対象Populationが残っていない状態へ到達した場合、削除しない。

旧Remnantを、

```text
status = operational
role = standby
```

相当へ移行する。

これにより、PlayerがFrontを前進させるたび、旧行政線が第二・第三線として残る。

---

# 15. 空Remnant自動削除の変更

現行実装の空Remnant自動削除処理は、v1.3.3ではStandby化へ置き換える。

ただし `maxPostsPerDirection` を超える場合の整理Ruleは必要である。

推奨:

- 前方Relocationを行う前にPost上限をValidationする。
- 上限到達中は、Playerが既存Standbyを撤去するActionを将来追加するか、最も後方の空Standbyを自動撤去するかを実装時に決定する。
- v1.3.3では予期しない自動撤去より、Validation Errorで明示する方を優先する。

Reason Code例:

```text
checkpoint_post_limit_reached
```

---

# 16. Checkpoint RecoveryとActive Role

重要な既存挙動変更として、Ruined Checkpointを感染鎮圧等で`operational`へRecoveryした際、無条件にBranchの`activeCheckpointId`をその地点へ戻してはならない。

Rule:

- BranchにActive Checkpointが存在しない場合: Recovered CheckpointをActiveにしてよい。
- Branchに別Activeが存在する場合: Recovered CheckpointはStandbyとなる。

これにより、Fallback後に前線跡地を回復しただけでSupply Frontが自動的に再前進することを防ぐ。

前線再前進はPlayerの明示的なRelocate / Reactivate相当Actionによって行う。

---

# 17. Checkpoint Policy継承

Fallback時、新ActiveはBranchの運用方針を継続する。

推奨仕様:

```text
East Active = strict
A lost
B standby promoted
=> B currentPolicy = strict
```

実装上Checkpoint個別Policyを保存する場合でも、Automatic Fallbackによって意図せず`normal`へ戻らないことを必須とする。

---

# 18. Checkpoint UI / Agent Observation

Human UIでは、少なくとも次を識別可能にする。

- Active
- Standby
- Remnant
- Ruined
- Abandoned

Road Branch Panelでは概念的に、

```text
East
Active: checkpoint-east-3
Standby: checkpoint-east-2, checkpoint-east-1
Fallback Ready: Yes
```

を確認可能にする。

Agent Observationでも、

```json
{
  "branchId": "east",
  "activeCheckpointId": "checkpoint-east-3",
  "standbyCheckpointIds": ["checkpoint-east-2", "checkpoint-east-1"],
  "fallbackAvailable": true
}
```

相当の情報を公開する。

これはPlayer自身が設置した行政設備の情報でありFog of War対象ではない。

---

# 19. Noise概要

v1.3で延期したNoiseをv1.3.3で導入する。

Noiseは、Human Unitが参加する通常Combat発生地点を中心に、周辺のTargetを持たないNormal Zombieを引き寄せる。

標準Noise Radius:

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

---

# 20. Noise発生Combat

Noise Pulseは、通常Combat ResolutionにPlayer Unitが参加した場合に1回だけ発生する。

対象:

- Player UnitによるAttack
- Zombie / Horde ZombieからPlayer UnitへのAttack
- Interception
- Counterattackを伴う通常Combat

Counterattackは同一Combat Resolution内の追加Damageであり、同じ戦闘から二重Noise Pulseを発生させない。

Noise Centerは、そのCombatに参加したPlayer UnitのCombat開始時Hexとする。

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

これはPlayer / Agentへ公開しない。

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

Noise Targetは、Visible Populationを一時的に追っている間に保存し続ける必要はない。

推奨:

- Visible PopulationへTarget変更した時点でNoise Targetは破棄する。
- Inherited Horde TargetのMemory挙動は現行仕様を維持する。

実装時にはTarget Memoryの復帰挙動を増やさず、単純な優先順位を優先する。

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

Playerが知ってよいのは、自分が発生させたNoiseの、

- Center
- Radius
- Unit Type
- Turn / Phase

のみ。

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
  "radius": 5
}
```

Public Eventへ`affectedZombieIds`や`affectedCount`を含めない。

Internal Metricsでは反応数を計測してよい。

---

# 31. Noise Human UI

Combat発生時、Human UIでは短時間だけNoise Radiusを表示可能にする。

推奨:

- Combat Hexを中心にRing / Hex Highlight
- Police Radius 4
- National Guard Radius 5
- 常時表示は不要
- Fog of Warを突破してZombie位置を示さない

UI上の目的は、

> 「この戦闘はこの範囲まで音が届いた」

とPlayerへ理解させることである。

---

# 32. Noise Agent API

`getApiInfo()`のStatic RulesへNoise Ruleを追加する。

概念:

```json
{
  "noise": {
    "policeRadius": 4,
    "nationalGuardRadius": 5,
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
```

を追加する。

---

# 33. Noise Metrics

追加推奨Metrics:

```text
noisePulsesEmitted
policeNoisePulses
nationalGuardNoisePulses
normalZombiesNoiseTargeted
noiseTargetsReached
noiseTargetsOverriddenByHorde
noiseTargetsOverriddenByVisiblePopulation
```

`normalZombiesNoiseTargeted`等、Hidden Enemy状態を推測可能なMetricsはActive Game Observationへ公開しない。

End Result / Replay Analysis用途に限定する。

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

Attack時のNoise RiskはPublic情報のみから近似する。

推奨:

```text
Visible Normal Zombies within Noise Radius
× attraction risk weight
```

を軽いPenaltyとして使用する。

TargetlessかどうかはAgentから見えないため、Visible Normal Zombieを「反応する可能性がある」として上限評価する。

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

Standbyなし。

期待:

```text
activeCheckpointId = null
```

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
- 空・安全になったらAを削除せずOperational Standby化

---

# 49. Test: Recovery後Role

- Aが旧FrontでRuined
- Fallback後BがActive
- Aの感染を鎮圧してRecovery

期待:

```text
A = operational standby
B = active
```

Aが勝手にActiveを奪い返さない。

BranchにActiveが存在しない場合のみRecovered AをActiveへできる。

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

期待: Visible Populationを優先。

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

Noise EventにはPlayerが知っているCenter / Radiusだけを含める。

---

# 55. Test: Balanced Agent

最低限次をRegression Testへ追加する。

1. Checkpointが`checkpoint_supply_zombie_blocked`の場合、Checkpoint Goalを放棄せず解消Actionを評価する。
2. Non-urgent Forest Hordeに対し、LethalでないAttackだけを盲目的に繰り返さない。
3. Urban Defenderから不必要に離れるMoveを下げる。
4. PlainへZombieが接近するならWaitを候補に残す。
5. Noise Radius内に複数Visible Normal ZombieがいるAttackへ適度なRisk Penaltyを付与する。
6. Immediate Capital ThreatではTerrain / Noise Penaltyより防衛を優先する。

---

# 56. Metrics

Checkpoint追加候補:

```text
standbyCheckpointsCreated
checkpointFallbacks
checkpointFallbacksByBranch
checkpointFallbacksPreventingUnmanagedArrival
maxCheckpointPostsPerBranch
activeCheckpointLosses
```

Noise追加候補:

```text
noisePulsesEmitted
policeNoisePulses
nationalGuardNoisePulses
normalZombiesNoiseTargeted
noiseTargetsReached
noiseTargetsOverriddenByHorde
noiseTargetsOverriddenByVisiblePopulation
```

既存Metricsの、

```text
hordeTargetInheritedCount
normalZombieIdleCount
urbanDefenseApplications
forestDefenseApplications
unmanagedPassThrough
resourceShortageLosses
victoryTurn
```

と合わせて評価する。

---

# 57. Playtest観測項目

v1.3.3では勝率だけでなく以下を見る。

- Standbyが実際にHorde中の行政空白を防ぐか
- StandbyによりCheckpoint Lossが無意味になっていないか
- Supply Front Retreatが段階的損失として機能するか
- 全Branch 3重化が常に唯一の最適解にならないか
- Noise TargetがNormal ZombieのIdleを適度に減らすか
- NoiseによってUrban Defense / Hold Positionの価値が増すか
- NoiseがHidden Zombieの不意の接近を生むが理不尽になっていないか
- Police Radius 4 / National Guard Radius 5の差が意味を持つか
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
- 事前にStandbyを準備したPlayerだけがFallback Benefitを得る。
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
