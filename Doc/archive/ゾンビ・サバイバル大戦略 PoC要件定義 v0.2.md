# ゾンビ・サバイバル大戦略 PoC要件定義 v0.2

## 1. 文書の目的

本書は、ゾンビウイルス流行下の架空のアメリカ風州を舞台とした、ターン制大戦略ゲームのPoC（Proof of Concept）実装要件を定義する。

本PoCでは完成品としてのコンテンツ量やバランスを追求せず、以下のゲーム体験が成立するかを検証することを最優先とする。

> **限られた人口・部隊・物資を用いて領土と生産力を拡大したい一方、人口増加・感染・防衛範囲拡大によってリスクも増大する。その状況で数ターン後に襲来するHordeを見据え、「何を確保し、何を守り、何を諦めるか」を考えることが面白いか。**

また、本PoCではゲームロジックをUIから独立させ、以下も副次的な検証対象とする。

- ゲーム状態の完全な記録・再現
- Headless環境でのゲーム実行
- 自動プレイによるルール検証
- AIエージェントによるゲームプレイ
- AIによるプレイ内容の分析・感想生成
- AIを利用したゲームバランス検証

---

# 2. ゲーム概要

## 2.1 ジャンル

- ターン制ストラテジー
- ヘックス制大戦略
- 都市・資源管理
- ゾンビサバイバル

リアルタイム操作や大量のゾンビ個体シミュレーションではなく、ターン単位の意思決定を中心とする。

## 2.2 プレイヤーの立場

プレイヤーは、ゾンビウイルスの流行が始まった架空のアメリカ風国家における州知事となる。

管理対象：

- 都市および住民
- 警察
- 生き残った州兵
- 農場・工場・製油所・発電所等のインフラ
- 検問所

## 2.3 基本目標

デフォルトでは30ターン生存を目標とする。

敗北条件：

- 州政府庁舎が完全感染し、感染都市化する
- プレイヤー管理下の労働者総数が0になる

規定ターン終了時点で敗北条件を満たしていなければ勝利。

ゲーム長はconfigから変更可能とする。

---

# 3. PoCで検証するコアループ

1. 周辺都市・インフラへ警察または州兵を派遣
2. 連絡途絶施設を奪還
3. 労働者を配置して生産力を拡大
4. 避難民を受け入れて人口を増加
5. 増加した人口・施設を維持する資源を確保
6. ゾンビおよび感染へ対処
7. Horde予告に応じて部隊を再配置
8. Hordeを迎撃
9. 失った都市・インフラを奪還・復旧
10. より大規模な次回Hordeへ備える

常に、

**「現在の安全」対「将来の生産力」**

という判断を発生させることを目標とする。

---

# 4. 技術要件

## 4.1 推奨構成

- TypeScript
- Phaser
- Vite
- HTML5 / WebGL / Canvas
- PCブラウザ対応
- スマートフォンブラウザ対応

PoCではネイティブアプリ化を必須としない。

## 4.2 CoreとUIの分離

ゲームルールはPhaserから独立させる。

```text
src/
├── core/
│   ├── GameState
│   ├── GameEngine
│   ├── TurnManager
│   ├── HexMap
│   ├── Economy
│   ├── Combat
│   ├── Infection
│   ├── Refugees
│   ├── Horde
│   ├── ZombieAI
│   ├── ActionValidator
│   ├── ObservationBuilder
│   └── Replay
│
├── agents/
│   ├── RandomAgent
│   ├── RuleBasedAgent
│   └── interfaces/
│
├── config/
│   ├── balance
│   ├── units
│   └── map
│
├── game/
│   └── Phaser描画・入力
│
└── ui/
```

原則として、

```text
UI
 ↓
GameAction
 ↓
GameEngine
 ↓
GameState
 ↓
UI
```

という一方向の構造とする。

Phaser側からGameStateを直接変更してはならない。

---

# 5. Headless Game Interface

ゲームは描画処理なしでも完全に進行可能とする。

最低限、概念的に以下のインターフェースを提供する。

```ts
reset(seed, config): GameState

getState(): GameState

getObservation(): Observation

getLegalActions(): GameAction[]

step(action: GameAction): StepResult

isGameOver(): boolean

getResult(): GameResult
```

これにより、

- 人間プレイヤー
- 自動テスト
- Random Agent
- Rule Based Agent
- 外部AI Agent

のすべてが同じゲームエンジンを利用できるようにする。

---

# 6. GameState

ゲーム進行に必要な状態は可能な限りSerializableにする。

GameStateはJSONへ変換可能であること。

最低限以下を含む。

- 現在ターン
- 最大ターン
- RNG状態またはSeed
- Horde情報
- マップ
- タイル状態
- 所有状態
- 都市人口
- 感染者数
- 施設労働者
- 資源
- ユニット
- HP
- 位置
- 攻撃権
- 避難民
- 検問状態
- 生産状態
- 勝敗状態

---

# 7. GameAction

すべてのプレイヤー操作をGameActionとして表現する。

例：

```ts
type GameAction =
  | MoveAction
  | AttackAction
  | WaitAction
  | AssignWorkersAction
  | SetCheckpointPolicyAction
  | ProduceUnitAction
  | EndTurnAction;
```

UI操作も最終的にはGameActionへ変換してGameEngineへ渡す。

---

# 8. Legal Actions

GameEngineは現在状態から合法手を列挙可能にする。

```ts
getLegalActions(): GameAction[]
```

AI側でゲームルールを推測する必要をなくす。

例：

```json
{
  "unitId": "army_01",
  "availableActions": [
    {
      "type": "move",
      "targets": [[7,5],[7,6],[8,5]]
    },
    {
      "type": "attack",
      "targets": ["zombie_04"]
    },
    {
      "type": "wait"
    }
  ]
}
```

不正なGameActionが渡された場合、GameStateを変更せずエラー結果を返す。

---

# 9. Seeded RNG

ゲーム内のランダム処理は、原則としてSeed付き疑似乱数生成器を利用する。

対象：

- ゾンビAIの同順位選択
- Horde侵入方向
- 避難民感染判定
- 感染発生都市選択
- その他PoCで追加されるランダム判定

同じ、

```text
Game Version
Config
Map
Seed
Action Sequence
```

からは同一結果が再現されることを目標とする。

`Math.random()`をゲームルールから直接使用しない。

---

# 10. Replay

ゲームプレイは再現可能な形式で記録する。

Replayの正データは原則として、

```text
Game Version
Config
Seed
Initial State / Map ID
Action Sequence
```

とする。

例：

```json
{
  "version": "poc-0.2",
  "seed": 42891,
  "config": "default",
  "map": "poc-map-01",
  "actions": [
    {
      "turn": 1,
      "type": "move",
      "unit": "police_01",
      "to": [8,7]
    },
    {
      "turn": 1,
      "type": "assign_workers",
      "target": "farm_01",
      "count": 10
    },
    {
      "turn": 1,
      "type": "end_turn"
    }
  ]
}
```

このデータから同一プレイを再生可能にする。

---

# 11. Debug Snapshot / Event Log

Replayとは別にデバッグ用途として各ターンの状態を保存可能にする。

```text
Turn
State Before
Actions
Events
State After
```

Event例：

```json
{
  "type": "infection_spread",
  "target": "city_north",
  "workersLost": 12,
  "infectedAdded": 12
}
```

想定イベント：

- unit_moved
- combat_started
- damage
- unit_destroyed
- facility_captured
- zombie_infection
- infection_spread
- infection_suppressed
- facility_overrun
- facility_recovered
- resource_produced
- resource_consumed
- resource_shortage
- refugees_arrived
- refugees_accepted
- horde_spawned
- game_over

ログはデバッグ設定時のみ詳細出力可能とする。

---

# 12. AI向けObservation

AIエージェントへGameStateを直接渡すことを必須としない。

GameStateからAI向けのObservationを生成可能にする。

```text
GameState
    ↓
ObservationBuilder
    ↓
Observation
```

Observationには最低限、

- Turn
- Horde予告
- 資源と収支
- 人口
- 都市・施設
- 感染状況
- 自軍
- 確認可能なゾンビ
- 合法手
- 直近の重要イベント

を含める。

将来的なFog of War実装時にも、AIへ内部情報を漏らさない境界として使用できる構造とする。

---

# 13. AI Agent Interface

AIプレイヤーはゲーム本体から独立したAgentとして扱う。

概念的には、

```ts
interface GameAgent {
  decide(
    observation: Observation,
    legalActions: GameAction[]
  ): Promise<GameAction>;
}
```

とする。

これによりAI方式を差し替え可能にする。

---

# 14. Random Agent

PoCでは必須実装とする。

合法手一覧からランダムにActionを選択する。

Random Agentはゲーム攻略能力ではなく、

**ゲームエンジンの破壊テスト**

を主目的とする。

大量のランダム操作を実行し、

- クラッシュ
- 不正状態
- 負の人口
- 負の感染者
- HP異常
- 1タイル複数駒
- 死亡ユニットの行動
- Game Over後の進行
- Replay不一致

等を検出する。

---

# 15. Rule Based Agent

PoCでは簡易版を実装する。

例：

```text
Hordeまで2ターン以下
→ Horde方向の防衛を優先

近隣都市にゾンビ
→ 防衛を優先

Food収支が危険
→ 農場確保・労働者配置を優先

感染都市あり
→ 警察派遣を検討

安全かつ無職者余剰
→ 周辺インフラ拡張

その他
→ 防衛または拡張
```

高度な攻略AIを目的としない。

**ゲームをある程度合理的に最後まで遊べる基準エージェント**

として利用する。

---

# 16. 外部AI / LLM Agent

PoCでは外部AIとの統合そのものを必須完成条件とはしないが、接続可能なインターフェースを用意する。

外部AIには、

```text
Observation
+
Legal Actions
+
Recent Events
```

を入力として渡す。

AIは合法手からActionを選択して返す。

ゲームエンジン側はAIの出力を必ずActionValidatorへ通す。

AIから任意のGameState変更を許可しない。

---

# 17. AIプレイモード

PoCでは開発用機能として、

**AIにゲームを自動プレイさせるモード**

を用意する。

最低限：

```text
Agent:
[ Random ▼ ]

Seed:
[ 42891 ]

Speed:
[ Normal / Fast / Instant ]

[ Run AI Game ]
```

程度でよい。

AI操作中もPhaser上で盤面を観戦可能にする。

Instantでは描画を省略しHeadlessで高速実行可能とする。

---

# 18. AI思考表示

エンターテインメント用途として、AI Agentが理由を出力可能な場合、その判断理由を表示できるようにする。

例：

```text
TURN 14

AI Governor:

「東から3ターン後にHordeが来る。
東部農場は重要だが、防衛線が伸びすぎている。

North Cityの感染は警察で対処可能なので、
州兵をEast Checkpointへ移動させる。」

ACTION:
Move Army #1 → East Checkpoint
```

ただしゲームルール上の正データはActionのみとする。

AIの説明文によってゲーム状態を変更してはならない。

---

# 19. AIプレイ後の感想・レポート

AI Agentを利用する場合、ゲーム終了後にプレイログをもとに感想・分析を生成可能にする。

最低限以下を入力情報として提供できるようにする。

- 勝敗
- 生存ターン
- 最終資源
- 最終人口
- 最大人口
- 最大領土
- Hordeごとの被害
- 失陥した都市・施設
- 復旧した都市・施設
- ユニット損失
- 民間人損失
- 感染による損失
- 飢餓・物資不足による損失
- Action履歴
- Event履歴

AIへの質問例：

> このプレイで最も危険だった場面は？

> 自分の戦略の良かった点と悪かった点は？

> 次に同じSeedをプレイするなら何を変える？

> 面白い判断を迫られた場面はあった？

> 単純作業に感じた部分は？

> 不公平または理不尽に感じた出来事は？

---

# 20. AI感想の目的

AIの感想は「ゲームが本当に面白いこと」の証明として扱わない。

主目的は、

- プレイログの要約
- 特徴的な局面の抽出
- 戦略差の発見
- バランス異常の発見
- エンターテインメントとしてのAI観戦

とする。

最終的な面白さの評価には人間によるプレイテストを必要とする。

---

# 21. AI Governor Persona

エンターテインメント目的として、同一Agentへ異なる戦略方針を与えられる構造を想定する。

例：

### Expansionist

領土・人口・経済規模の拡大を優先。

### Defensive

Hordeへの安全性と州都防衛を優先。

### Humanitarian

民間人損失を最小化し、州兵による感染鎮圧を可能な限り避ける。

### Militarist

軍事力とゾンビ排除能力を優先。

これらはPoC必須実装ではない。

ただしAgentへの方針入力を差し替えられる設計とする。

---

# 22. AI対戦略比較

同一Seedを複数Agentにプレイさせ、結果を比較可能にすることを将来目標とする。

例：

```text
Seed 42891

              Win   Turn   Civ Loss   Max Territory

Expansion     NO     23       84          14
Defensive     YES    30       31           8
Humanitarian  NO     27       22          10
Militarist    YES    30       67          11
```

これにより、

**異なる戦略が実際に異なる結果を生むゲームになっているか**

を検証できる。

---

# 23. Batch Simulation

Headless環境で複数ゲームを連続実行可能な構造とする。

例：

```text
Agent: RuleBased
Games: 1000
Seeds: 1-1000
```

結果として最低限以下を集計可能にする。

- 勝率
- 平均生存ターン
- 敗北ターン分布
- 敗北原因
- 平均最終人口
- 平均最大人口
- Horde別生存率
- 平均ユニット損失
- 平均民間人損失
- 平均施設喪失数

---

# 24. バランス検証

Batch Simulationを用いて以下を確認可能にする。

例：

```text
Horde Survival Rate

Horde #1    98%
Horde #2    91%
Horde #3    73%
Horde #4    42%
Horde #5    11%
```

これにより、

- Horde倍率が急すぎないか
- 特定施設が必須になっていないか
- 特定兵種が強すぎないか
- 特定戦略しか成立していないか
- 資源不足が頻発しすぎないか
- 感染が強すぎる/弱すぎるか

等の調整材料を得る。

---

# 25. ゲームルール

以下はv0.1から継承する。

## マップ

- ヘックス制
- 約15×15
- 中央都市圏
- 東西南北へ道路
- 初期ゾンビ3～4駒
- 固定PoCマップ

## 駒

1タイルにつき敵味方問わず1駒。

PoC人間ユニット：

- 警察：人口5、射程1
- 州兵：人口10、射程2

## 戦闘

- Attack値をそのままダメージとして使用
- 双方射程内なら双方攻撃
- 一方のみ射程内なら一方のみ攻撃
- 1ラウンドにつき攻撃権1回
- 射程侵入時に迎撃
- 迎撃された側は移動終了
- 移動後攻撃可能
- 攻撃後移動不可

## 自然回復

警察・州兵は、

- 移動なし
- 通常攻撃なし
- 迎撃なし

の場合、次自ターン開始時に最大HPの10%回復。

ゾンビは回復しない。

---

# 26. ゾンビAI

優先順位：

1. 最も近い人間タイル
2. 同距離なら人口最多
3. 同数ならSeeded RNGによるランダム

人間ユニットも人数として評価。

---

# 27. Horde

デフォルト：

- 5ターンごと
- 初回2駒
- 毎回2倍
- 東西南北のいずれかから侵入
- 方向と残りターンのみ予告
- 規模は非公開

設定変更可能。

---

# 28. 人口

管理対象：

- 労働者
  - 就業者
  - 無職者
- ユニット人口
- 避難民

都市・インフラごとに配置労働者を保持する。

労働者は全体プールから自由に配置可能。

ただし感染者が存在する施設の労働者は感染が0になるまで再配置不可。

---

# 29. 資源

5資源：

- 食料
- 民需品
- 軍需品
- 燃料
- 電力

### 食料

```text
労働者1 + 燃料1 → 食料3
```

人口分消費。

不足分だけ労働者減少。

### 民需品

民需工場：

```text
労働者1 + 燃料1 → 民需品2
```

都市：

```text
労働者1 → 民需品1
```

人口分消費。

不足分だけ労働者減少。

### 軍需品

```text
燃料1 + 民需品1 → 軍需品1
```

警察・州兵人口に応じ消費。

不足時、州兵射程2→1。

### 燃料

製油所から産出。

不足時は後から占領した生産施設から停止。

### 電力

備蓄ではなくCapacity。

不足時は後から占領した施設から停止。

---

# 30. 感染

都市・インフラは、

```text
workerCapacity
workers
infected
```

を持つ。

ゾンビがタイルに存在してターン終了：

```text
newInfected = min(zombieAttack, workers)
workers -= newInfected
infected += newInfected
```

その後内部感染：

```text
spread = min(infected, workers)
workers -= spread
infected += spread
```

感染者はゾンビ駒とは別の内部数値。

---

# 31. 感染鎮圧

警察・州兵が感染施設に駐留している間、感染自然増加を停止。

警察：

```text
infected -= Police Attack
```

州兵：

```text
infected -= Military Attack
workers -= Military Attack × 0.5
```

値は0未満にしない。

---

# 32. 施設陥落・復旧

労働者0で施設陥落。

- 荒廃感染施設へ変化
- ゾンビ生成
- workerCapacityの50%相当の感染者を保持

警察・州兵が駐留するとAttack分ずつ感染者減少。

0になると通常施設へ復旧。

労働者は0のため再配置が必要。

---

# 33. 避難民・検問所

検問所は東西南北の主要道路に各1つまで。

### 素通り

- 即時100%労働者化
- 毎ターン感染判定50%

### 通常

- 2ターン
- 80%労働者化
- 感染判定25%

### 厳格

- 5ターン
- 50%労働者化
- 感染判定なし

PoCでは詳細キューを簡略化。

検問所がゾンビ襲撃を受けた場合、滞在避難民数に応じ追加ゾンビ発生。

---

# 34. ターン処理

```text
PLAYER TURN START
 ↓
自然回復
攻撃権回復
 ↓
PLAYER ACTION
移動 / 攻撃 / 占領
 ↓
DOMESTIC ACTION
労働者配置 / 検問 / 生産
 ↓
PLAYER TURN END
 ↓
ECONOMY
生産 / 消費 / 不足処理
 ↓
REFUGEES
 ↓
INTERNAL INFECTION
 ↓
ZOMBIE TURN
AI / 移動 / 戦闘
 ↓
ZOMBIE INFECTION
 ↓
HORDE SPAWN
 ↓
WIN / LOSE
 ↓
NEXT TURN
```

Turn 5 HordeはTurn 5終了時に生成し、次回ゾンビ行動フェーズから活動する。

---

# 35. PoC対象外

- 治安
- 暴動
- 難民キャンプ
- 壁
- 車両
- 戦車
- 航空機
- 複数人間兵種
- 複数ゾンビ種
- 装備
- 研究
- 技術ツリー
- 天候
- 昼夜
- ランダムイベント
- 政治
- 外交
- 人物
- 士気
- 医療
- 詳細物流
- 個別弾薬
- 個別燃料
- Fog of War
- ランダムマップ生成
- 詳細避難民キュー

また、**高度なAI攻略能力そのものもPoC完成条件にはしない。**

---

# 36. 自動テスト

通常Unit Testに加え、以下を実装する。

## Determinism Test

同一、

```text
Version + Config + Seed + Actions
```

から同一最終GameStateになること。

## Replay Test

保存Replayを再実行し元プレイと一致すること。

## Random Agent Test

大量の合法手をランダム実行しても不正状態にならないこと。

## Invariant Test

常に以下を満たすこと。

```text
HP >= 0
Workers >= 0
Infected >= 0
Resources >= 0
Unit population >= 0
```

1タイル1駒制が破られないこと。

死亡ユニットが行動しないこと。

Game Over後に状態遷移しないこと。

---

# 37. AIプレイを利用したエンタメ機能

PoC段階では開発者向け機能として扱うが、将来的にはユーザー向け機能への発展も想定する。

例：

**AI Governor Mode**

プレイヤーは操作せずAI州知事の判断を観戦する。

AIが、

```text
「東部防衛線を維持するには燃料が不足している。
South Refineryを確保するためPolice #2を南下させる。」
```

など判断理由を表示。

ゲーム終了後、

```text
AI Governor After Action Report
```

としてプレイを振り返る。

これ自体を、

**「AIにゾンビ災害下の州政府を任せたらどうなるか」**

という観戦型コンテンツとして利用できる可能性を検証する。

---

# 38. PoC完成条件

通常ゲームについて：

1. ブラウザで開始可能
2. ヘックスマップ表示
3. 人間ユニット移動
4. 通常攻撃
5. 迎撃
6. ゾンビAI
7. インフラ奪還
8. 労働者配置
9. 5資源
10. 資源不足
11. 避難民
12. 検問方式
13. 感染
14. 感染鎮圧
15. 施設陥落
16. 施設復旧
17. Horde
18. Horde予告
19. 勝利
20. 敗北
21. PC操作
22. スマートフォン操作
23. Configによる調整

ゲーム基盤について：

24. GameStateをJSON化可能
25. 全操作をGameActionとして実行
26. Legal Actionsを取得可能
27. Seeded RNG
28. Replay保存
29. Replay再生
30. Headless実行
31. Event Log出力
32. Random Agentがプレイ可能
33. Rule Based Agentがプレイ可能
34. Batch Simulation可能
35. AI接続用Observationを取得可能

AI/エンタメ実験について：

36. AI Agentを差し替え可能なInterface
37. AIプレイを観戦可能
38. AI判断理由を任意表示可能な構造
39. ゲーム終了後の統計データ生成
40. 外部AIへAfter Action Report生成用データを渡せる

---

# 39. PoC評価項目

人間プレイでは以下を評価する。

- 拡張に悩むか
- Horde予告がプレッシャーになるか
- 人口増加にリスクがあるか
- 警察と州兵を使い分けるか
- 感染が脅威か
- 局所的敗北から立て直せるか
- 5資源が意味のある判断を生むか
- ターン終了が適度に怖いか

自動プレイでは以下を評価する。

- 特定戦略だけが突出して強くないか
- 特定施設が事実上必須になっていないか
- 何ターン目から死亡率が急増するか
- Hordeごとの生存率
- 平均人口推移
- 平均領土推移
- 感染による平均損失
- 資源不足による平均損失
- 部隊構成と勝率の関係

AI Agentでは以下を観察する。

- AIが異なる戦略を採用できるか
- AIの説明から重要な意思決定点を抽出できるか
- 異なるPersonaで異なるプレイ展開になるか
- AI自身が「判断に迷った局面」を説明できるか
- プレイログから単調な部分を特定できるか

AIの感想は人間の面白さ評価の代替とはしない。

---

# 40. 開発優先順位

AI機能によってPoC本体の完成が遅れないよう、以下の順序で実装する。

### Phase 1 — Game Core

```text
GameState
GameAction
GameEngine
Seeded RNG
Legal Actions
```

まず描画なしでゲームルールを成立させる。

### Phase 2 — Automated Testing

```text
Unit Tests
Random Agent
Replay
Invariant Tests
```

ゲームCoreを機械的に破壊テストする。

### Phase 3 — Playable UI

```text
Phaser
Hex Map
HUD
Touch Controls
```

人間がブラウザから遊べるようにする。

### Phase 4 — Basic AI

```text
Rule Based Agent
Headless Simulation
Batch Simulation
Statistics
```

AIがゲームを一通り遊べる状態にする。

### Phase 5 — LLM Experiment

```text
Observation
     ↓
LLM Agent
     ↓
Decision + Reason
     ↓
GameAction
```

外部AIによるプレイを実験する。

### Phase 6 — AI Entertainment

```text
AI Governor
Live Commentary
After Action Report
Strategy Comparison
```

観戦コンテンツとして成立するか検証する。

---

# 41. 最重要設計原則

ゲームの正しい状態遷移を決定するのは、常に**GameEngine**とする。

```text
Human UI ──────┐
               │
Random Agent ──┤
               │
Rule Agent ────┼→ GameAction → GameEngine → GameState
               │
LLM Agent ─────┘
```

人間もAIもゲームルール上は同じプレイヤーとして扱う。

AIにGameStateを直接変更させない。

UIにもGameStateを直接変更させない。

すべての操作をGameActionとしてGameEngineへ渡す。

---

# 42. 最終的に目指すPoCの状態

人間がブラウザから普通にプレイできる。

同じゲームを描画なしで高速実行できる。

同じSeedをReplayできる。

Random Agentに数千回プレイさせてバグを探せる。

Rule Based Agentに数百回プレイさせてバランス傾向を確認できる。

そして外部AIへ、

```text
「あなたはこの州の知事です。

現在Turn 17。
3ターン後に北からHordeが来ます。

North Cityでは感染者が発生。
食料備蓄は2ターン分。
州兵は西部に展開中。

以下が現在実行可能な行動です……」
```

と渡し、

AIが実際に意思決定してゲームを進められる。

ゲーム終了後には、

> 「最大の失敗はTurn 14で東部への拡張を続けたことだった。Hordeへの再配置が2ターン遅れ、East Cityを失った。次回はTurn 12から防衛態勢へ移行したい。」

のように自分のプレイを振り返らせることができる。

本PoCでは、

**「ゾンビ大戦略ゲームとして面白いか」**

に加えて、

**「人間にもAIにも同じルールで遊ばせられる、小さな戦略ゲームシミュレーションとして成立するか」**

までを検証する。