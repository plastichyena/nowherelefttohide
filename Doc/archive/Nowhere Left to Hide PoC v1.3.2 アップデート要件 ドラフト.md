# Nowhere Left to Hide PoC v1.3.2 アップデート要件 ドラフト
## Horde Composition Rebalance / Checkpoint Explainability

作成日: 2026-08-30  
ステータス: Draft

---

# 1. 目的

v1.3ではTerrain / Fog of War / Horde Zombie / Final Horde / 新Victory Conditionを導入した。

初回テストプレイでは、

- ChatGPT上のSol MediumはTurn 47で勝利
- Codex経由Sol MediumはTurn 33で敗北
- 両Runとも味方Unit Lossは0
- Codex側はCheckpointを一度も建設せず、未管理流入と感染連鎖から経済崩壊
- Horde Target伝播は通常プレイ上では発生頻度が低かった

という結果が確認された。

v1.3.2では、この結果を踏まえて以下を行う。

1. Horde Zombieを通常Zombieより明確に強いUnitへ調整
2. Periodic Horde構成へ通常Zombieを混在させる
3. Horde Target伝播が通常プレイ上でも発生しやすい構成へ変更
4. Checkpointを建設できない理由をHuman / Agent双方へ明示する
5. 複数方向Horde等のより大きな難易度変更は今回行わず、まず本変更の影響を計測する

---

# 2. 本Versionのテーマ

v1.3.2は、

> **Hordeを「数が多いZombie」から、強い中核個体と通常Zombieが混在する集団へ近づける**

調整とする。

同時に、

> **重要な行政Actionが使えない場合、その理由をプレイヤーとAgentが理解できるようにする**

ことを目的とする。

難易度上昇と説明性改善を同時に行う。

---

# 3. スコープ

## 3.1 変更するもの

- Horde Zombie HP
- Periodic HordeのUnit Composition
- Horde増加ルール
- Horde Target伝播の実戦発生機会
- Checkpoint建設可否UI
- Checkpoint建設不可理由
- Agent Observation / Legal Action補助情報
- 必要なMetrics
- Test

## 3.2 今回変更しないもの

- Normal Zombie HP / Attack / Move / Range / Vision
- Horde Zombie Attack / Move / Range / Vision
- Terrain Defense値
- Forest Defense
- Urban Defense
- Horde Spawn周期
- Final Horde Turn
- Final Horde Victory Condition
- Fog of War
- Noise
- 複数方向から同時に侵入するHorde
- Map Size
- Road Network再設計
- Supply Rule
- Checkpointの基本建設ルール
- Refugee Policy
- Economy Balance

---

# 4. Horde Zombie HP変更

Horde ZombieのHPを現在値の2倍へ変更する。

現行:

```text
Zombie HP = 10
Horde Zombie HP = 10
```

v1.3.2:

```text
Zombie HP = 10
Horde Zombie HP = 20
```

その他の性能は変更しない。

```text
Horde Zombie
HP = 20
Attack = 5
Movement = 3
Range = 1
Vision = 3
```

---

# 5. Horde Zombieの役割

通常Zombieとの性能差を、

```text
Normal Zombie:
軽量・数・周辺脅威

Horde Zombie:
高耐久・Strategic Targetを持つHorde中核
```

として明確化する。

Horde Zombieは引き続き、

```text
Visible Population Target
>
Capital
```

のTargeting Logicを使用する。

通常ZombieへのTarget伝播能力も維持する。

---

# 6. Terrainとの組み合わせ

Terrain Defense Ruleは変更しない。

現在のDamage Multiplierを維持する。

例:

```text
Plain上 Horde Zombie HP20
National Guard Attack10
→ 2回攻撃で撃破
```

Forest上ではZombie側Defenseが適用されるため、

```text
National Guard Attack10
× Forest Damage Multiplier 0.5
= Damage5
```

となり、

```text
HP20 / Damage5
= 4回攻撃
```

が必要となる。

これはv1.3.2で意図された高耐久化として扱う。

Forest Defense値は今回同時に調整しない。

---

# 7. Periodic Horde Composition変更

現在、Horde規模増加分はHorde Zombieのみで構成されている。

これを変更する。

旧概念:

```text
Horde Size Growth:
+2 Horde Zombie
```

新概念:

```text
Horde Size Growth:
+1 Horde Zombie
+1 Normal Zombie
```

総追加Unit数は従来と同じとする。

つまり難易度を単純なUnit数増加ではなく、

**編成内容の変更**

によって調整する。

---

# 8. Horde構成例

現在の既存Horde Count progressionを維持しつつ、増加分をMixed Compositionへ変更する。

概念例:

初回:

```text
2 Horde Zombie
```

次回:

```text
3 Horde Zombie
1 Normal Zombie
```

次回:

```text
4 Horde Zombie
2 Normal Zombie
```

次回:

```text
5 Horde Zombie
3 Normal Zombie
```

実際の初回構成および既存Count Ruleとの整合は既存Configを正本として調整する。

重要なのは、

```text
従来の +2 Horde
```

を、

```text
+1 Horde
+1 Normal
```

へ置き換えること。

---

# 9. Normal ZombieのHorde随伴

Periodic Hordeとして生成されたNormal Zombieは、

Unit Typeとしては通常の、

```text
zombie
```

を使用する。

専用のEscort Zombie Typeは作らない。

性能・AIも既存Normal Zombieと完全に同一とする。

---

# 10. Spawn直後のTarget

Periodic Hordeで同時生成されたNormal Zombieへ、Spawn時点で自動的にCapital Targetを直接付与しない。

通常Zombieは既存AI通り、

```text
Visible Population
>
Noise
>
Inherited Horde Target
>
Idle
```

に従う。

そのため、同時SpawnしたHorde ZombieをVision内に捉え、条件を満たした場合に、

```text
Horde Zombie → Normal Zombie
```

Target伝播が発生する。

これにより既存のHorde Target Inheritance Ruleを自然に実戦へ参加させる。

---

# 11. Horde Target伝播Rule

v1.3で導入したRuleは維持する。

Targetを持たないNormal ZombieのVision内にHorde Zombieが存在する場合、

そのHorde ZombieのCurrent Targetを継承する。

優先順位:

```text
Visible Population
>
Noise
>
Inherited Horde Target
>
Idle
```

Normal → Normalへの伝播は引き続き禁止する。

---

# 12. Mixed Horde導入の目的

この変更の目的は、

単純にNormal Zombieを追加して難易度を上げることではない。

主目的:

1. Horde ZombieとNormal Zombieの性能差を実戦上認識しやすくする
2. Horde Target伝播が通常プレイでも発生しやすくする
3. Hordeを単一Unit Typeの塊ではなく、Mixed Groupとして表現する
4. Horde Zombie HP倍化による全体耐久増加を部分的に緩和する

---

# 13. Final Horde

Final Hordeについては、まず既存仕様を維持する。

```text
Final Horde Count = 12
```

の基本数は変更しない。

Final HordeのCompositionについては実装時に以下のどちらかを選択し、仕様を明示する。

推奨:

```text
Final HordeもMixed Composition Ruleを使用
```

とする。

ただしFinal Horde全12体をHP20 Horde Zombieとして扱う既存構造を維持する場合は、その旨をConfig / Specへ明示すること。

v1.3.2ではFinal Horde総数自体は増やさない。

---

# 14. 複数方向Horde

複数方向から同時にHordeが侵入する仕組みは今回実装しない。

理由:

- Horde Zombie HP倍化
- Mixed Composition
- Horde Target伝播発生率上昇

の3点だけでも難易度が大きく変化する可能性があるため。

まずv1.3.2のPlaytest結果を確認し、その後Multi-direction Horde導入の必要性を判断する。

---

# 15. Checkpoint Explainability

Checkpointは感染流入制御の重要Systemである。

建設できない場合に、

```text
建設不可
```

だけを返すのではなく、

**なぜ建設できないのか**

をHuman Player / Agent双方へ明示する。

---

# 16. Checkpoint Construction Availability

Human UIでは、Checkpoint建設候補を選択した際に、

```text
available: true / false
```

と、

```text
reason
```

を表示可能にする。

建設不可の場合はPlayerが理由をその場で理解できること。

---

# 17. Checkpoint Failure Reason

最低限、以下のようなReason Codeを構造化する。

例:

```text
not_on_road
invalid_branch_position
checkpoint_already_exists_on_branch
insufficient_civilian_goods
checkpoint_action_used
position_occupied
outside_allowed_area
invalid_position
```

実際のReason Codeは既存Core Ruleに合わせて整理する。

UI表示文言とCore内部Reason Codeは分離する。

---

# 18. Human UI表示

Human UIではReason Codeを読みやすい説明へ変換する。

例:

```text
not_on_road
→ 検問所は道路上にのみ設置できます

checkpoint_already_exists_on_branch
→ この方向には既に有効な検問所があります

insufficient_civilian_goods
→ 検問所建設に必要な民需品が不足しています

checkpoint_action_used
→ このターンは既に検問所操作を行っています
```

Mobile / Desktop両方で確認可能にする。

必要以上に大きなModalは不要。

Tooltip、Inline Message、Context Panel等の既存UIに合う方式を使う。

---

# 19. Agent向け情報

AgentがCheckpointを使えない理由を理解できるようにする。

Agent ObservationまたはLegal Action補助情報として、

概念的に以下を提供する。

```text
checkpointConstruction:
  available: false
  reason: "insufficient_civilian_goods"
```

または位置ごとの候補に、

```text
{
  position: { q, r },
  legal: false,
  reason: "not_on_road"
}
```

等を付与する。

---

# 20. Legal Actionsとの整合

既存のCore Legal Action判定を正本とする。

UI / Agent Observation側で、

独自にCheckpoint合法性Ruleを再実装してはならない。

Coreが、

```text
legal / illegal
reason
```

を返し、

Human UIとAgent APIがその結果を表示する形を優先する。

---

# 21. Invalid Action

Agentが実際にIllegal Checkpoint Actionを送信した場合も、

既存の、

```text
action_not_legal
```

だけではなく、可能であれば具体的Reasonを返す。

例:

```text
action_not_legal
reason: checkpoint_already_exists_on_branch
```

Stateは変更しない。

---

# 22. Metrics

v1.3.2ではHorde Composition変更の効果を確認するため、既存Metricsを維持しつつ必要に応じて追加する。

最低限確認する:

```text
normalZombiesKilled
hordeZombiesKilled
hordeTargetInheritedCount
hordeTargetClearedCount
finalHordeKilled
victoryTurn
unitLosses
civilianLosses
resourceShortageLosses
infectionLosses
```

追加候補:

```text
hordeZombieDamageTaken
normalZombieDamageTaken
hordeZombieTurnsAlive
normalZombieTurnsAlive
mixedHordeNormalSpawned
mixedHordeHordeSpawned
```

これらはBalance Analysisに有用なら追加する。

---

# 23. Replay

Replay Artifactでは、

Periodic Horde Spawn時に、

- Horde Zombie何体
- Normal Zombie何体

が生成されたか再現できること。

同じ、

```text
Version
Config
Map
Seed
Actions
```

から同じCompositionを再現する。

---

# 24. UI

Horde ZombieとNormal Zombieは既存のPrototype Assetで視覚的に識別できること。

HP20化に伴い、

Horde Zombieが被弾しても生存していることをHuman Playerが理解できるよう、

既存HP表示が正常に機能することを確認する。

追加の専用演出は不要。

---

# 25. Test

## Horde HP

- Horde Zombie HP20
- Normal Zombie HP10
- PlainでNational Guard Attack10 → Horde HP10
- 2回目で撃破
- ForestでAttack10 → Damage5
- 4回で撃破
- Normal Zombieの既存耐久は変更なし

## Horde Composition

- Horde Growthが +1 Horde +1 Normalになる
- 総Unit増加数は従来と一致する
- Mixed HordeのNormal Zombieは通常Unit Typeを使う
- Normal ZombieへSpawn時直接Capital Targetを付与しない

## Target Propagation

- 同時SpawnしたNormal ZombieがHorde ZombieをVision内に持つ
- NormalにVisible Population Targetなし
- Horde Current Targetあり
- Inheritance発生
- hordeTargetInheritedCount増加
- Normal → Normal伝播なし

## Checkpoint

- 道路外 → not_on_road
- 既存Checkpointあり → checkpoint_already_exists_on_branch
- 民需不足 → insufficient_civilian_goods
- Action使用済み → checkpoint_action_used
- Human UIで理由表示
- Agent向けにReason取得可能
- Illegal ActionでもState変更なし

---

# 26. Playtest観測項目

v1.3.2では勝率だけでなく以下を見る。

- Horde Zombie HP20が過剰に硬くないか
- Forest Horde処理が作業化しないか
- Mixed HordeによりTarget伝播が自然に発生するか
- Normal Zombie混在がHordeの見た目・戦術差を生むか
- Unit Loss 0のまま大量Hordeを処理できる状態が変化するか
- Final Horde後の収束Turnが伸びすぎないか
- Checkpoint ExplainabilityによりAIがCheckpointを理解しやすくなるか
- Checkpoint未使用敗北が「仕様不理解」ではなく明確な戦略選択になるか

---

# 27. Balance判断

v1.3.2実装後は、

- ChatGPT系Sol Medium
- Codex系Sol Medium
- Balanced Agent
- 複数Seed

で再計測する。

特に比較する。

```text
Victory Rate
Victory / Defeat Turn
Final Horde survival
Horde Target inheritance
Checkpoint usage
Civilian Loss
Unit Loss
Food collapse frequency
```

この結果を確認するまではMulti-direction Hordeを追加しない。

---

# 28. 成功条件

v1.3.2が成功した状態:

- Horde ZombieがNormal Zombieより明確に脅威
- Hordeを平地で州兵1撃処理できない
- Mixed Hordeが自然に成立
- Normal ZombieのHorde追従Ruleが通常Playでも観測可能になる
- 総敵数を大幅に増やさずに戦闘難易度が上がる
- Checkpointを建設できない理由がHuman / Agent双方に分かる
- Checkpoint Systemが「分からないから使えない」状態にならない
- 既存のTerrain / FoW / Victory / Economyを壊さない

---

# 29. 設計意図

v1.3では、

> Hordeが大量のZombieとして押し寄せる

ところまで実装された。

v1.3.2では、

> Horde Zombieは倒しにくい中核個体であり、
> 周囲の通常Zombieを引き連れて戦線を形成する

方向へ一段進める。

同時にCheckpointについては、

> 重要な行政判断を要求するなら、
> そのActionがなぜ使えないかをPlayerへ明確に伝える

ことを徹底する。

v1.3.2は大規模Feature追加ではなく、

**v1.3で成立したゲーム構造の敵編成と説明性を調整するVersion**

と位置付ける。