# Nowhere Left to Hide PoC v1.3.2 アップデート要件 確定版
## Horde Composition Rebalance / Checkpoint Explainability

- ステータス: 実装・ローカル検証済み（ChatGPT系Sol Medium比較待ち）
- 対象App / Release Version: `1.3.2`
- 基準日: 2026-08-30
- 実装開始時の安定版: `Nowhere Left to Hide PoC 現行仕様.md`（v1.3.1）
- 元ドラフト: `Nowhere Left to Hide PoC v1.3.2 アップデート要件 ドラフト.md`

---

# 1. 文書の位置づけ

本書は、v1.3.2で追加・変更する部分の確定要件である。

- 実装・テスト・動作確認が完了するまでは、`Nowhere Left to Hide PoC 現行仕様.md`を安定版の唯一の正本とする。
- 本書はv1.3.2の実装目標として、現行仕様から変更する範囲だけを優先する。
- 本書に変更記載のない経済、人口、感染、Supply、Terrain、Fog of War、Victory等は現行仕様を維持する。
- 実装・テスト・動作確認完了後、本書を現行仕様へ反映し、Version、実装、テスト、Helpとの整合を確認してから本書をarchiveへ移す。
- 日本語UIでもタイトルは`Nowhere Left to Hide`と表記する。

---

# 2. 背景と目的

v1.3初回テストプレイでは、ChatGPT上のSol MediumがTurn 47で勝利し、Codex経由のSol MediumがTurn 33で敗北した。両Runとも味方Unit Lossは0であり、Codex側はCheckpointを一度も建設せず、未管理流入と感染連鎖から経済崩壊した。また、Horde Target伝播は通常プレイ上で発生頻度が低かった。

v1.3.2では次を目的とする。

1. Horde ZombieをNormal Zombieより明確に高耐久な中核個体にする。
2. Periodic／Final HordeをHorde ZombieとNormal ZombieのMixed Groupにする。
3. Horde Target伝播を通常プレイでも自然に発生させる。
4. Checkpointを建設・移設できない理由をHuman PlayerとAgentの双方へ明示する。
5. 敵総数や侵入方向を同時に増やさず、本変更の影響を独立して計測する。

本Versionのテーマは、Hordeを「数が多い同一Zombie」から「強い中核個体と通常個体が混在する集団」へ近づけることと、重要な行政Actionの利用不能理由を説明可能にすることである。

---

# 3. スコープ

## 3.1 追加・変更するもの

- Horde Zombieの標準HP
- Horde ConfigのUnit Type別Composition
- Periodic Horde Composition
- Final Horde Compositionと全滅判定
- Mixed Horde所属情報、Spawn配置、Target伝播の実戦発生機会
- Horde Spawn Event、Replay、統計
- 新規ゲーム設定画面とHelpのHorde Composition表示
- Checkpoint建設・移設の位置別候補情報
- Checkpoint建設・移設不可理由のCore、Human UI、Agent Observationへの公開
- Version、Save、Agent API、Artifact Schema境界
- 必須TestとPlaytest

## 3.2 今回変更しないもの

- Normal ZombieのHP、Attack、Movement、Range、Vision
- Horde ZombieのAttack、Movement、Range、Vision
- Normal／Horde ZombieのTargeting優先順位そのもの
- Noise System。v1.3.2時点ではNoiseは存在せず、新設しない。
- Terrain Defense値、Forest Defense、Urban Defense
- Horde Spawn周期、標準Final Horde Turn、Horde Warning
- Final Horde Victory Conditionの3条件構造
- Fog of WarとHidden Enemyの公開境界
- 複数方向から同時に侵入するHorde
- Map Size、Fixed Map、Road Network
- Supply Rule、Checkpointの基本建設・移設ルール
- Refugee Policy、Economy Balance
- 専用Escort Zombie Type
- 追加の専用戦闘演出

---

# 4. Versionと互換性境界

v1.3.2では次を使用する。

| 対象 | Version |
|---|---:|
| App / Release | `1.3.2` |
| Game Rules / GameState / Config | `1.4.1` |
| Agent API / Observation / Bridge | `1.4.1` |
| Artifact Schema | `1.4.1` |
| Save Format | `3` |
| Fixed Map | `fixed-15x15-v2` |

- Unit所属属性、Config、Statistics、Agent Observation、Artifact Schemaの変更をVersion境界に含める。
- v1.3.1以前のGameState、Save、Replay、ArtifactはGame Rules Version不一致として変換せず拒否する。
- 不一致時は現在のGameStateを変更、削除、上書きしない。
- Save Format番号は`3`を維持するが、Game Rules Version一致を必須とする。
- 同じVersion、Config、Map、Seed、Action列から同じ結果を得る。

---

# 5. Horde Zombie性能

## 5.1 標準性能

Horde Zombieの標準HPを`10`から`20`へ変更する。その他の性能は変更しない。

| Unit | HP | Attack | Movement | Range | Vision |
|---|---:|---:|---:|---:|---:|
| Normal Zombie | 10 | 5 | 3 | 1 | 3 |
| Horde Zombie | 20 | 5 | 3 | 1 | 3 |

Normal Zombieは軽量・数・周辺脅威、Horde Zombieは高耐久・Strategic Targetを持つHorde中核として区別する。

## 5.2 Terrain Defense

Terrain Defense Ruleは変更しない。

- Plain上のHorde ZombieはNational GuardのAttack 10を2回受けて撃破される。
- Forest上のHorde ZombieはDamage Multiplier `0.5`により1回5 Damageを受け、4回で撃破される。
- RoadはForest Defenseを消さず、Urban優先等の現行Ruleを維持する。

Forest上で必要攻撃回数が増えることは、v1.3.2で意図した高耐久化として扱う。

---

# 6. Horde Composition Config

Horde Compositionは総数から暗黙計算せず、ConfigへUnit Type別に保持する。

```text
periodicInitial:
  hordeZombie: 2
  zombie: 0

periodicIncrement:
  hordeZombie: 1
  zombie: 1

finalComposition:
  hordeZombie: 7
  zombie: 5
```

- Periodic Hordeの各回総数は`periodicInitial + spawnedCount × periodicIncrement`のUnit Type別計算結果を合計する。
- Final Horde総数は`finalComposition`の合計とする。標準値は12体である。
- 各Composition値は0以上の整数とする。
- `periodicInitial`、各回のPeriodic計算結果、`finalComposition`は、それぞれ合計1体以上でなければならない。
- Periodic各回およびFinal CompositionにNormal Zombieが1体以上含まれる場合は、同じCompositionにHorde Zombieも1体以上必要とする。
- `0 Horde Zombie + 1体以上のNormal Zombie`となるConfigは、同Group内のTarget継承元とVision内配置保証を成立させられないため拒否する。
- 標準Horde周期は5、標準Final Horde Turnは30のまま維持する。

---

# 7. Periodic Horde

標準ConfigでのCompositionを次に固定する。

| Spawn Turn | Horde Zombie | Normal Zombie | 合計 |
|---:|---:|---:|---:|
| 5 | 2 | 0 | 2 |
| 10 | 3 | 1 | 4 |
| 15 | 4 | 2 | 6 |
| 20 | 5 | 3 | 8 |
| 25 | 6 | 4 | 10 |

- 現行の総数進行`2、4、6、8、10`を維持する。
- 従来の各回`+2 Horde Zombie`を`+1 Horde Zombie +1 Normal Zombie`へ置き換える。
- Periodic HordeはFinal Horde Turn以後生成しない。
- Spawn Turn、方向決定、Warning、生成Turnは行動せず次のZombie Phaseから行動するRuleを維持する。

---

# 8. Final Horde

標準Final HordeはTurn 30に次の12体を生成する。

```text
Horde Zombie: 7
Normal Zombie: 5
Total: 12
```

- 全12体に同一のFinal `spawnGroupId`と`hordeKind: final`を付与する。
- Final Horde全滅条件はUnit Typeを問わず、Final Spawn Group全12体の死亡で成立する。
- Final所属のNormal ZombieもFinal Horde全滅条件へ含める。
- `finalHordeSpawned`と`finalHordeKilled`はFinal Spawn Group全体の集計とし、標準Configではそれぞれ最大12とする。
- Final Horde総数、標準Final Horde Turn、他の2つのVictory条件は変更しない。

---

# 9. Mixed Horde所属と表示

## 9.1 Unit Typeと所属属性

Mixed HordeのNormal Zombieは既存の`zombie` Unit Typeを使用し、性能とAIを通常のNormal Zombieと完全に共通化する。専用Escort Typeは作らない。

Periodic／Final HordeとしてSpawnしたNormal Zombieには、所属追跡用として同じGroupの次を保存する。

- `spawnGroupId`
- `hordeKind: periodic | final`

Horde以外の初期配置等で生成されるNormal Zombieでは両属性を`null`のまま維持する。所属属性はComposition、Replay、Marker、Metrics、Final Horde全滅判定にだけ使用し、Normal Zombieの性能やTargeting優先順位を変更しない。

## 9.2 Human UI表示

- Normal Zombieは既存Normal Zombie Base Assetを使う。
- Horde Zombieは既存Horde Zombie Base Assetを使う。
- Mixed Horde所属のNormal Zombieにも、`hordeKind`に応じて既存Periodic／Final Horde Markerを表示する。
- Final Horde全滅条件に含まれるNormal ZombieをHuman Playerが識別できること。
- Horde Zombieが被弾後も生存していることを既存HP表示で確認できること。
- 専用の追加演出は不要とする。

---

# 10. Spawn配置とTarget伝播

## 10.1 Spawn配置

- Mixed HordeのNormal Zombieは、Spawn直後に同じSpawn GroupのHorde Zombieを少なくとも1体Vision内に捉える位置へ決定的に配置する。
- 位置決定はSeed付きで再現可能とし、同じVersion、Config、Map、Seed、Actionsから同じ配置を得る。
- Normal ZombieへSpawn時点でCapital Targetを直接付与しない。
- SpawnしたTurnは行動せず、次のZombie Phaseから既存AIに従う。

## 10.2 Targeting優先順位

v1.3.2時点でNoise Systemは存在しない。優先順位は現行仕様を維持する。

```text
Normal Zombie:
Visible Population Target
>
Inherited Horde Target
>
Idle

Horde Zombie:
Visible Population Target
>
Capital
```

## 10.3 継承Rule

- Normal ZombieにVisible Population Targetも有効な継承記憶もなく、Vision内にCurrent Targetを持つHorde Zombieがいる場合だけ継承する。
- `Horde Zombie -> Normal Zombie`だけを許可する。
- `Normal -> Normal`および`Normal -> Horde`への伝播は禁止する。
- 継承元を同じSpawn Groupに限定しない。
- Vision内の全Horde ZombieからHex Distanceが最短の個体を選び、同距離ならUnit ID昇順で選ぶ。
- 同じGroupのHorde ZombieをVision内に置くことは保証するが、別GroupのHorde Zombieがより近ければそちらから継承する。
- Visible Populationを優先する既存記憶Rule、Target到達時の解除Rule、Zombie Phase Snapshot順を維持する。

---

# 11. Checkpoint ExplainabilityのCore境界

## 11.1 単一の合法性判定

- Checkpoint建設・移設の合法性と理由はGame Coreを唯一の正本とする。
- UI、Agent Observation、Legal Action補助情報でCheckpoint Ruleを再実装しない。
- 状態変更は従来どおり`GameAction -> GameEngine`経由に限定する。
- 同じStateとAction候補に対し、候補一覧と実送信時の判定は必ず一致する。

## 11.2 位置別候補一覧

Coreは、各支線の道路タイルごとにCheckpoint建設または移設候補を構造化して返せる純粋なQueryを提供する。

```text
{
  actionType: "BuildCheckpoint" | "RelocateCheckpoint",
  branchId: string,
  checkpointId?: string,
  position: { q, r },
  legal: boolean,
  reasonCode: string | null
}
```

- 稼働Checkpointがない支線は`BuildCheckpoint`候補を返す。
- 稼働Checkpointがある支線は、そのCheckpointを対象とする`RelocateCheckpoint`候補を返す。
- 対象支線の全道路タイルを安定順で返し、合法候補だけに絞らない。
- 合法なら`reasonCode: null`、不合法ならCoreの具体的な`ActionError.code`を返す。
- 既存`getLegalActions()`は合法Actionだけを返す仕様を維持する。

## 11.3 Reason Code

別名のCheckpoint専用Codeを新設せず、Coreが現在返す既存`ActionError.code`を正本とする。対象には最低限次を含む。

```text
invalid_checkpoint_tile
invalid_checkpoint_branch
unknown_road_branch
checkpoint_requires_relocation
unknown_operational_checkpoint
checkpoint_same_position
checkpoint_wrong_branch
checkpoint_infection_blocked
checkpoint_branch_action_limit
checkpoint_abandoned_forward_block
checkpoint_supply_zombie_blocked
insufficient_civilian_goods
action_limit
wrong_phase
game_over
```

- 1候補が複数の不成立条件に該当する場合は、Coreの既存検証順で最初の1件だけを返す。
- 理由の優先順は決定的とし、候補一覧と実送信時で一致させる。
- Human向け表示文言とCore内部Codeを分離する。

## 11.4 Illegal Action

- AgentまたはUIがIllegalなCheckpoint Actionを実送信した場合、`action_not_legal`で包まず具体的な`ActionError.code`を直接返す。
- 失敗時はGameState、資源、Action回数、PRNG状態を一切変更しない。

---

# 12. Fog of WarとCheckpoint候補

- Checkpoint候補のZombie阻害判定は現行仕様どおりVisible Enemyだけを使用する。
- Hidden Enemyは候補一覧、Reason Code、Message、Eventから存在、位置、IDを漏らさない。
- Hidden Enemyを理由に候補を不合法化せず、実送信時にもHidden Enemyを理由として拒否しない。
- `checkpoint_supply_zombie_blocked`はPlayerからVisibleなZombieが原因の場合だけ返す。
- 公開候補一覧に具体的なZombie IDを含めない。

---

# 13. Human UI

Checkpoint建設・移設モード中は、対象支線の全道路タイルについて次を満たす。

- 合法候補は選択可能な既存強調表示を行う。
- 非合法候補は合法候補と区別できる無効表示を行う。
- 非合法候補をタップまたはクリックすると、Bottom Sheet内の小さなInline Messageへ理由を表示する。
- 大型ModalやTooltipを必須としない。
- MobileとDesktopの双方で同じ理由を確認できる。
- 直前に選んだ候補の理由が別候補やState更新後に誤って残らない。
- State変更後は候補一覧をCoreから再取得する。

各Reason Codeに日本語・英語の読みやすい文言を用意する。最低限、道路タイル不正、支線不一致、既存稼働Checkpointによる移設要求、感染による位置変更禁止、支線内操作済み、荒廃地点より前進不可、Visible Zombieによる阻害、民需品不足、全体Action上限を区別する。

---

# 14. Agent ObservationとAPI

- Agent ObservationへCore生成のCheckpoint位置別候補一覧を追加する。
- `legal`と`reasonCode`を全道路タイルについて取得できること。
- Agentが独自に合法性Ruleを再実装しなくても、建設・移設不能理由を判断できること。
- `getLegalActions()`は合法Actionのみを返し、既存のAction Schemaを維持する。
- `getApiInfo()`へ候補一覧Schema、Reason Codeの意味、Fair Play境界を記載する。
- Browser Bridge、AgentGame、Runner Artifactで同じ生成元のSchemaと結果を使用する。
- Hidden Enemy、PRNG内部状態、将来乱数を追加情報から漏らさない。

---

# 15. 新規ゲーム設定とHelp

## 15.1 新規ゲーム設定

Horde設定をUnit Type別の6入力へ変更する。

- Periodic初回Horde Zombie数
- Periodic初回Normal Zombie数
- Periodic増加Horde Zombie数
- Periodic増加Normal Zombie数
- Final Horde Zombie数
- Final Normal Zombie数

各値は0以上の整数とし、標準値は`2 / 0 / 1 / 1 / 7 / 5`とする。Horde周期、警告開始Turn、Final Horde Turnの既存入力は維持する。入力はCore Config検証を通し、合計0またはNormal ZombieだけになるComposition等の不正値でゲームを開始しない。

## 15.2 HelpとBoard Legend

- 進行中は現在GameState Config、GameStateがない場合は標準ConfigからCompositionを表示する。
- Periodic初回、回ごとの増加、Final CompositionをUnit Type別に説明する。
- Normal ZombieとHorde ZombieのHP差、Targeting差、Mixed Horde Markerの意味を日本語・英語で説明する。
- Horde Warningでは現行Fair Play境界を維持し、Spawn前の正確な規模や位置を公開しない。

---

# 16. Event、Metrics、Replay

## 16.1 Spawn Event

Periodic／Final Horde Spawn Eventから最低限次を再現できること。

- `hordeKind`
- `spawnGroupId`
- `direction`
- Horde Zombie生成数
- Normal Zombie生成数
- 各生成UnitのUnit Typeと所属Group

Player-facing EventはFog of War境界を維持し、検証用完全Artifactだけが内部Unit情報を保持できる。

## 16.2 必須Metrics

既存Metricsを維持し、次の4累積Metricsを追加する。

```text
periodicHordeZombiesSpawned
periodicNormalZombiesSpawned
finalHordeZombiesSpawned
finalNormalZombiesSpawned
```

最低限、次を比較可能にする。

```text
normalZombiesKilled
hordeZombiesKilled
hordeTargetInheritedCount
hordeTargetClearedCount
finalHordeSpawned
finalHordeKilled
finalHordeDefeated
victoryTurn
unitLosses
civilianLosses
resourceShortageLosses
infectionLosses
checkpoint build / relocate count
checkpointなし道路Turn
```

- Final所属Normal Zombieの撃破は`normalZombiesKilled`と`finalHordeKilled`の双方へ加算する。
- Final所属Horde Zombieの撃破は`hordeZombiesKilled`と`finalHordeKilled`の双方へ加算する。
- `DamageTaken`、`TurnsAlive`等はv1.3.2の必須Schemaへ追加しない。必要な場合は検証用Artifactから分析する。

## 16.3 ReplayとDeterminism

- 同じVersion、Config、Map、Seed、Actionsから同じComposition、Unit ID、位置、Target継承、戦闘結果を再現する。
- Replay ArtifactはPeriodic／Finalごとの2種類の生成数と所属Groupを保持する。
- Final Spawn Groupに属するNormal Zombieを含めてFinal Horde全滅判定を再現する。

---

# 17. 必須Test

## 17.1 Horde性能

- 標準Horde Zombie HPは20、Normal Zombie HPは10である。
- PlainでNational Guard Attack 10を受け、Horde ZombieはHP 10で生存し、2回目で撃破される。
- Forestで1回5 Damageを受け、4回目で撃破される。
- Normal Zombieの既存耐久と他の全性能が変わらない。

## 17.2 ConfigとComposition

- Unit Type別CompositionをConfig Validation、Clone、Save、API Info、Helpが同じ値で扱う。
- 標準Periodic Hordeが`2/0、3/1、4/2、5/3、6/4`で生成される。
- 標準Final Hordeが`7/5`で生成される。
- 各回の合計が`2、4、6、8、10、12`となる。
- 0未満、非整数、合計0の不正Compositionを拒否する。
- Normal Zombieが1体以上かつHorde Zombieが0体となるPeriodic／Final Compositionを拒否する。
- Custom ConfigでもUnit Type別計算が正しい。

## 17.3 Mixed Horde所属とVictory

- Horde由来Normal Zombieだけが`spawnGroupId`と`hordeKind`を持つ。
- 初期配置等のNormal Zombieは両属性が`null`である。
- Final Spawn GroupのNormal Zombieが生存中はFinal Horde全滅にならない。
- Final Spawn Group全12体の死亡でFinal Horde全滅になる。
- `finalHordeSpawned`、`finalHordeKilled`が全Unit Typeを集計する。
- 4つの新規Spawn Metricsと既存撃破Metricsが正しい。

## 17.4 SpawnとTarget伝播

- Mixed Hordeの各Normal ZombieがSpawn直後に同GroupのHorde ZombieをVision内に持つ。
- Spawn時にNormal ZombieへCapital Targetを直接付与しない。
- Visible Populationがなく、HordeにCurrent Targetがある最初のZombie Phaseで継承が発生する。
- Visible Populationがある場合はそちらを優先する。
- 別Groupを含む複数Horde候補ではDistance、Unit ID順が適用される。
- `hordeTargetInheritedCount`と解除数が正しく増える。
- NormalからNormalおよびNormalからHordeへ伝播しない。
- Noiseに関するState、Action、優先順位を新設しない。

## 17.5 Checkpoint Core

- 全道路タイルのBuild／Relocate候補を安定順で返す。
- 合法候補が`getLegalActions()`に存在し、不合法候補は存在しない。
- 候補一覧の`reasonCode`と実送信時の`ActionError.code`が一致する。
- 複数不成立条件ではCore検証順の最初の1件だけを返す。
- 既存Reason Codeごとの固定Scenarioを用意する。
- Illegal ActionでGameState、資源、Action回数、PRNG状態が変わらない。
- BuildとRelocateの双方を試験する。

## 17.6 Checkpoint UI／Agent／FoW

- 合法・不合法候補をMobile／Desktopで視覚的に区別する。
- 非合法候補のタップ／クリックでInline Messageへ正しい日本語・英語理由を表示する。
- State更新後に候補と理由を更新し、古い理由を残さない。
- Agent Observation、AgentGame、Bridge、Artifactが同じ候補Schemaを返す。
- Hidden Enemyだけが阻害範囲にいても候補を不合法にしない。
- Visible Enemyによる阻害は`checkpoint_supply_zombie_blocked`を返す。
- Hidden Enemyの位置、ID、存在をReasonや候補差分から推測できない。

## 17.7 Version、Save、Replay

- 全Version定数、画面、API資料が`1.3.2 / 1.4.1 / Save 3`で一致する。
- v1.3.1以前のSave／Replay／Artifactを状態無変更で拒否する。
- v1.3.2のSave／Load後にComposition、所属、Metrics、候補情報が一致する。
- 同一入力からReplay結果が一致する。

---

# 18. UI受け入れ確認

最低限、390×844と1280×720で次を確認する。

- Normal／Horde ZombieのBase AssetとPeriodic／Final Markerを識別できる。
- Horde ZombieのHP 20と被弾後の残HPを確認できる。
- Mixed Hordeが単一Unit Typeの塊に見えない。
- Checkpoint合法／不合法候補の差が分かる。
- 非合法理由が盤面を覆わずBottom Sheet内で読める。
- 日本語・英語で欠落、はみ出し、操作不能がない。
- 新規ゲーム設定の6 Composition入力をMobileでも操作できる。

---

# 19. Playtestとバランス観測

## 19.1 必須Run

| Runner / Agent | Seed | 必須結果 |
|---|---|---|
| 組み込みBalanced Agent | 1～100 | 技術的完走 |
| Random Test Agent | 1～100 | 技術的完走 |
| ChatGPT系Sol Medium | 1、2、3 | 比較記録 |
| Codex系Sol Medium | 1、2、3 | 比較記録 |

技術的完走は、例外、Invariant違反、非有限値、Action上限超過、Replay不一致、Version不整合がなく、Game OverまたはRunner安全上限へ到達することを指す。

Sol Medium各3件は勝敗を自動合否にせず、戦略と次を比較記録する。

- Victory Rate、Victory／Defeat Turn
- Final Horde survivalとFinal Horde後Turn数
- Horde Target inheritance／clear
- Checkpoint建設・移設・方針利用
- Checkpointなし道路Turn
- Civilian Loss、Unit Loss
- Food collapse frequency
- 感染Loss、資源不足Loss
- Normal／Horde Zombieの生成数と撃破数

## 19.2 観測事項

- Horde Zombie HP 20が過剰に硬くないか。
- Forest上のHorde処理が単調な作業にならないか。
- Mixed HordeによりTarget伝播が自然に発生するか。
- Unit Type差とGroupとしての見た目・戦術差が生まれるか。
- Unit Loss 0のまま大量Hordeを処理できる状態が変化するか。
- Final Horde後の収束Turnが伸びすぎないか。
- Checkpoint ExplainabilityによりAgentが利用不能理由を判断できるか。
- Checkpoint未使用敗北が仕様不理解ではなく明示的な戦略選択になるか。

勝率、勝利Turn、Checkpoint利用率には固定の合格閾値を設けない。仕様、Test、UI確認、決定性、技術的完走をリリース合否とし、バランス結果はレビュー記録とする。

---

# 20. 実装順序

## Phase 1: Version／Config／State

- Version定数と互換性境界
- Unit Type別Horde Composition Config
- Mixed Horde所属を許容するUnit State／Invariant
- Statistics Schema

## Phase 2: Horde Core

- Horde Zombie HP 20
- Periodic／FinalのMixed Spawn
- Vision内配置保証
- Final Spawn Group全体の全滅判定
- Event／Metrics

## Phase 3: Checkpoint Core Query

- 既存Validationから位置別候補一覧を生成
- Reason優先順と実Action一致
- FoW境界

## Phase 4: Agent／Save／Replay

- Observation、API Info、Bridge、Runner、Artifact
- Save Validation
- ReplayとDeterminism

## Phase 5: Human UI／Help

- Checkpoint候補表示とInline Message
- Mixed Horde Marker
- 新規ゲームComposition入力
- Help／Board Legend／Localization

## Phase 6: 統合検証

- Unit／Integration／Browser Test
- Production Build
- Mobile／Desktop実ブラウザ確認
- Batch／Sol Medium Playtest
- 現行仕様への反映と文書整合

---

# 21. 成果物

- Game Core／Config／State／Invariant変更
- Horde Mixed CompositionとFinal Horde判定
- Checkpoint位置別候補Core Query
- Human UIと日本語・英語Localization
- Agent Observation／API Info／Bridge Schema
- Save／Replay／Artifact／Metrics更新
- Help／Board Legend更新
- Unit／Integration／Browser Test
- Batch／Playtest比較結果
- 実装完了後に更新した`Nowhere Left to Hide PoC 現行仕様.md`

---

# 22. 完了条件

1. Horde Zombieの標準HPが20、Normal Zombieが10である。
2. 標準Periodic Hordeが`2/0、3/1、4/2、5/3、6/4`で生成される。
3. 標準Final Hordeが`7/5`で生成され、12体すべてがFinal全滅条件へ含まれる。
4. Mixed HordeのNormal Zombieが通常Unit TypeとAIを使い、所属情報とMarkerだけを持つ。
5. Mixed HordeのNormal Zombieが同GroupのHordeをSpawn直後のVision内に持つ。
6. Noiseを導入せず、現行Targeting優先順位と伝播方向を維持する。
7. 同Group限定にせず、現行Distance／Unit ID順で継承元を決める。
8. Checkpointの全道路タイル候補について合法性と具体的Reason CodeをCoreから取得できる。
9. 候補一覧、`getLegalActions()`、実Actionの合法性が一致する。
10. Human PlayerがMobile／Desktopで不合法候補と理由を確認できる。
11. Agent Observationから同じ候補と理由を取得できる。
12. Hidden Enemy情報がCheckpoint候補やReasonから漏れない。
13. 4つのComposition Metricsと全体Final Horde Metricsが正しく集計される。
14. 新規ゲーム設定、Help、ReplayがUnit Type別Compositionを一意に扱う。
15. Version、Save、Agent API、Artifact Schema境界が一致する。
16. 必須Test、Production Build、実ブラウザ確認、Agent技術的完走、Replay一致を満たす。
17. Sol Medium各3 Seedの比較結果を記録する。
18. Terrain、FoW、Economy、Supply、Refugee、Victoryの非変更部分を壊さない。
19. Multi-direction Hordeを本Versionへ追加しない。
20. 実装・検証完了後に本書を現行仕様へ反映し、両者の整合を確認する。

---

# 23. 設計意図

v1.3.2は大規模Feature追加ではなく、v1.3で成立したゲーム構造の敵編成と説明性を調整するVersionである。

Horde Zombieは倒しにくい中核個体となり、Normal Zombieは既存AIのままそのTargetを継承して戦線を形成する。総敵数と侵入方向を同時に増やさず、耐久差、Mixed Composition、Target伝播の影響を測定できる形にする。

Checkpointについては、重要な行政判断を要求するなら、そのActionがなぜ使えないかをHuman PlayerとAgentへ同じCore判定から明確に伝える。ExplainabilityはRuleの複製ではなく、既存合法性判定を構造化して公開することで実現する。

---

# 24. 実装・検証記録

## 24.1 自動検証

- `npm run typecheck`: 成功
- `npm test`: 30 Test Files、259 Tests成功
- `npm run build`: Production Build成功。既存のBundle Size警告のみでBuild Errorなし
- `npm run test:browser-bridge`: Production Bundle、`window.NLTH`、`agent-api.html`のSmoke Test成功
- App `1.3.2`、Game Rules / Config / State `1.4.1`、Save Format `3`、Agent / Observation / Bridge / Artifact Schema `1.4.1`の境界を確認
- Game Rules、Artifact Schema等が一致するReplayはApp Version metadata差だけで拒否せず、v1.3.1以前のRules／Schemaは状態無変更で拒否する
- ローカル／CI Runnerの完全Artifactは内部`verificationEvents`へMixed HordeのGroup／Type別生成数／Unit所属を保持し、Browser Bridge Artifactには露出しない

## 24.2 実ブラウザ

- 390×844と1280×720のChromiumで日本語／英語を確認
- 新規ゲームの6 Composition入力、Mixed Horde Help、全28道路Checkpoint候補、合法／不合法の✓／×、不合法候補のクリック、Bottom Sheet内の日英Inline Reasonを確認
- Agent APIの`1.3.2 / 1.4.1`、28候補Schema、公開Eventの内部情報非露出を確認
- Console Error 0件。横方向の欠落、盤面を覆う理由表示、操作不能な不合法候補なし

## 24.3 組み込みAgent 100 Seed

Seed 1～100を標準Configで実行した。勝敗は合否に使わず、全件のGame Over／安全上限到達と技術健全性を判定した。

| Agent | 完走 | 技術失敗 | Win / Loss | 平均Final Turn | 平均Periodic H/N Spawn | 平均Final H/N Spawn | 平均H/N Kill | 平均Target inherit/clear |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Balanced | 100/100 | 0 | 0 / 100 | 13.54 | 6.30 / 2.14 | 0.14 / 0.10 | 2.05 / 12.67 | 4.20 / 0.00 |
| Random | 100/100 | 0 | 0 / 100 | 6.72 | 1.52 / 0.04 | 0.00 / 0.00 | 0.06 / 3.41 | 0.17 / 0.00 |

- Balanced平均: Unit Loss 1.39、Civilian Loss 105.37、Infection Loss 93.58、Resource Shortage Loss 10.64、Checkpoint Build 2.94、Relocate 14.12、未管理支線Turn 29.27
- Random平均: Unit Loss 0.26、Civilian Loss 93.32、Infection Loss 46.35、Resource Shortage Loss 46.92、Checkpoint Build 2.55、Relocate 3.10、未管理支線Turn 15.77
- 保存したBalanced 100件とRandom 100件の全200 Replay Artifactを新規Gameへ再生し、Action、Observation、Resultの相違0件を確認

## 24.4 Codex系Sol Medium比較

公開Agent APIのObservation、`getLegalActions()`、`step()`だけを使い、組み込みAgentへ代替せずモデル主導で実施した。

| Seed | 結果 | Final Horde | Final後Turn | Spawn P-H/P-N/F-H/F-N | Kill H/N | inherit/clear | Checkpoint build/relocate | 未管理支線Turn | Civilian / Unit Loss | 技術結果 |
|---:|---|---|---:|---|---|---|---|---:|---|---|
| 1 | Defeat `capitalLost` Turn 29 | 未生成 | 0 | 20/10/0/0 | 18/22 | 0/0 | 5/0 | 9 | 76 / 0 | 169 Action Replay一致、技術失敗0 |
| 2 | Defeat `capitalLost` Turn 45 | 12/12撃破、全滅 | 15 | 20/10/7/5 | 27/41 | 3/0 | 8/0 | 9 | 174 / 1 | 347 Action Replay一致、技術失敗0 |
| 3 | Defeat `capitalLost` Turn 17 | 未生成 | 0 | 9/3/0/0 | 4/15 | 0/0 | 6/0 | 9 | 122 / 0 | 126 Action Replay一致、技術失敗0 |

- 3件とも資源不足Lossは0で、主因は感染連鎖だった。Seed 2のみFinal Hordeを全滅させたが、その後の感染収束に失敗した。
- HP 20 Hordeは平地2撃とTerrain防御によりAction枠を圧迫したが、Seed 2ではNational Guard損失0で全Hordeを処理でき、耐久だけが過剰な壁になる結果ではなかった。
- Checkpoint候補Reasonは初期Zombie阻害、方面Action上限、感染阻害の判断に利用できた。Mixed Target継承はSeed 2の3回のみで、他Seedは可視Population優先により0回だった。

## 24.5 未実施の外部比較

ChatGPT系Sol Medium Seed 1～3は、このローカルCodex実行環境にChatGPT系Runner／認証済み外部実行経路がないため未実施である。結果を捏造せず、外部Runnerを利用できる環境で同じ公開Agent APIとSeed 1～3を用いて比較記録を追記する。これは完了条件17の未充足部分であり、勝敗はRelease合否にしないが比較記録自体は残作業とする。
