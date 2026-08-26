# Nowhere Left to Hide

## PoC v1.2アップデート案 ドラフト

- ステータス: 検討用ドラフト
- 作成日: 2026-08-26
- 対象: PoC v1.1からv1.2への変更案
- 主目標: AIエージェントが、人間プレイヤーと同じルールのもとでゲーム目標の達成を自然に目指し、テストプレイを自律実行できる基盤を整える

本書はv1.2で追加するAgent / Observation API、RuleBasedAgent、Batch Simulationおよびテストプレイ記録基盤の案を定義する。v1.2ではゲームルール自体の変更を原則行わず、既存のGameEngineとGameActionをAIテストプレイから安全かつ再現可能に利用できるようにする。

---

# 1. 目的

v1.2の中心目的は、単に「AIがActionを送信できる」状態ではなく、AIエージェントが現在のゲーム状況を観測し、勝利条件を目指しながら、資源・人口・感染・Horde・施設確保・部隊運用を考慮して1ゲームを自律的に完遂できる状態を作ることである。

人手によるテストプレイを完全に置き換えることは目的としない。AIエージェントによる大量試行で、次のような問題を早期発見し、人間が重点的に確認すべきケースを絞り込むことを目的とする。

- 明らかな壊れ戦略、固定化した最適解
- 特定Seedや特定局面での詰み
- 資源・人口・感染処理の極端な偏り
- ほとんど利用されないゲームシステム
- 異常に高いまたは低い勝率
- GameAction / Invariant / Replayの不整合
- ルール上は合法だが合理的プレイヤーが通常選ばない不自然な行動列

---

# 2. v1.2の基本原則

## 2.1 AI専用ルールを作らない

Human UI、Random Agent、RuleBasedAgent、将来のLLM Agentは、すべて既存のGameActionとGameEngineを利用する。

```text
Human UI ---------┐
Random Agent -----┤
RuleBasedAgent ---┤-> GameAction -> GameEngine -> GameState
Future LLM Agent -┘
```

AI専用の状態書換え、資源付与、ユニット直接移動、ゲーム内部値の直接変更を許可しない。

## 2.2 GameStateとObservationを分離する

将来v1.3でFog of Warを導入する予定を考慮し、v1.2から次の概念を明確に分離する。

```text
GameState
= ゲーム内部の完全な真実

AgentObservation
= 現在のプレイヤー / Agentへ公開される情報
```

v1.2時点ではFog of Warが存在しないため、ObservationがGameStateの多くを公開してもよい。ただしAgentの正式な入力としてGameStateそのものを使用しない。

## 2.3 Deterministicであること

同一のVersion、Config、Map、Seed、Action列から同一結果を得る既存原則を維持する。

Agent側で乱数を利用する場合もSeedを明示的に管理し、再現可能にする。ゲームルールおよびAgentの意思決定で、再現不能な`Math.random()`を使用しない。

---

# 3. Headless Agent API

## 3.1 正式API

最低限、次の操作をAgent向け正式インターフェースとして提供する。

```ts
interface AgentGame {
  reset(seed: number, config?: GameConfig): AgentObservation;
  getObservation(): AgentObservation;
  getLegalActions(): GameAction[];
  step(action: GameAction): StepResult;
  isGameOver(): boolean;
  getResult(): GameResult | null;
}
```

既存Headless APIが同等機能を持つ場合は新しいGameEngineを二重実装せず、既存実装を整理・拡張して利用する。

## 3.2 Action検証

- `getLegalActions()`が返すActionは、その時点でGameEngineにより合法であること。
- Agentが合法手一覧にないActionを`step()`へ直接渡した場合もGameEngine側で再検証する。
- 不正Actionは現在Stateを変更しない。
- 不正Action理由を機械処理可能な`code`と人間向け`message`で返す。

## 3.3 EndTurn

Agentが合法Actionを実行し続けるだけでなく、自ら適切なタイミングで`EndTurn`を選択できることを必須とする。

「合法手が存在する限り全Actionを消化してからEndTurnする」のような固定処理は、自然なゲームプレイとはみなさない。

---

# 4. AgentObservation

## 4.1 目的

AgentがGameState内部構造へ依存せず、現在の局面を判断するために必要な情報を安定した形式で提供する。

最低限、次の情報を含む。

```ts
interface AgentObservation {
  version: string;
  turn: number;
  maxTurns: number;
  phase: GamePhase;

  resources: AgentResourceObservation;
  population: AgentPopulationObservation;

  facilities: AgentFacilityObservation[];
  units: AgentUnitObservation[];
  zombies: AgentUnitObservation[];
  checkpoints: AgentCheckpointObservation[];

  horde: AgentHordeObservation;
  endTurnForecast: EndTurnForecast;

  gameOver: boolean;
  result: GameResult | null;
}
```

実際の型名は既存コードとの整合を優先してよい。

## 4.2 Observationへ含めたい派生情報

Agentが既存ルールを毎回再実装しなくてもよいよう、ゲーム側ですでに計算できる重要な派生情報はObservationへ含める。

例:

- EndTurn後の資源不足予測
- 過密追加消費
- Horde残りターンと方向
- 施設の所有状態、感染状態、稼働状態
- 施設の現在人口、ソフト / ハード上限
- 人口移動・編成の利用可否
- ユニットの行動済み状態
- 各部隊のHP、攻撃、移動、射程
- 現在の敗北条件に近い危険状態

## 4.3 Observationの将来互換

v1.3以降、Fog of Warが導入された場合はObservationから未観測情報を除外またはUnknown化できる構造とする。

Agentロジックが`engine.getState()`を参照しなければ成立しない実装はv1.2の受入対象外とする。

---

# 5. Agent Interface

## 5.1 共通インターフェース

Agent実装は少なくとも次の契約を持つ。

```ts
interface GameAgent {
  readonly id: string;
  decide(
    observation: AgentObservation,
    legalActions: readonly GameAction[],
  ): GameAction;
}
```

非同期LLM Agentを将来追加する可能性を考慮し、必要なら`Promise<GameAction>`へ拡張可能な設計とする。

## 5.2 AgentはStateを変更しない

AgentはObservationとLegalActionsからActionを選択するだけとし、GameStateへの参照・変更権限を持たない。

---

# 6. RuleBasedAgent

## 6.1 主目的

Random Agentとは異なり、現在のゲーム目標を理解した「普通のテストプレイヤー」として振る舞う。

強いAIや最適AIを目指すことはv1.2の目的ではない。

受入上重要なのは、次の性質を持つことである。

- 勝利を目指す。
- 敗北条件を避けようとする。
- 明白な危険を認識する。
- 将来のHordeへ備える。
- 資源不足を放置し続けない。
- 感染を可能な範囲で対処する。
- 安全な拡張機会を利用する。
- 人口を無意味に移動し続けない。
- 不要なActionを連打せず、適切にEndTurnする。

## 6.2 意思決定構造

単純なAction種別優先リストだけではなく、次の流れを基本とする。

```text
Observation
  ↓
局面評価
  ↓
現在の優先目標を決定
  ↓
LegalActionsを評価
  ↓
目標に最も適したActionを選択
  ↓
step(Action)
  ↓
再Observation
```

## 6.3 初期ヒューリスティック例

優先順位や重みはConfig化してもよい。

### 緊急対応

- 州都陥落リスクが高い場合は防衛を最優先する。
- 感染施設が存在し、Policeによる安全な鎮圧が可能なら優先する。
- EndTurn Forecastで食料または民需品の重大不足が予測される場合、生産・人口配置を優先する。

### Horde対応

- Horde到着まで残り2ターン以下なら予告方向の防衛を強く評価する。
- 必要に応じてPolice / National Guard編成を評価する。
- 防衛不能と判断した施設からの人口避難を評価できる。

### 経済

- 食料不足予測時はFarmの稼働を優先する。
- 電力不足により重要施設が停止する場合はPower Plant稼働を評価する。
- 過密が深刻で安全な地方都市が存在する場合は人口分散を評価する。

### 拡張

- 直近に重大なHorde / 感染 / 資源危機がない場合、安全に確保可能な中立施設へ部隊を進める。
- City、Food、Fuel、Power等の不足状況に応じ、施設価値を変える。

### 部隊

- 大きく損傷した部隊を無意味に危険地帯へ突入させない。
- 行動価値が低ければWaitまたはEndTurnを選択する。

上記は初期例であり、具体的な数値は実装時にテスト可能な定数または設定として分離する。

---

# 7. 「自然な目標達成」の判定

v1.2では単純な勝率だけをRuleBasedAgentの品質基準にしない。

最低限、次を満たすことを目標とする。

1. Game Overまで人手なしで自律実行できる。
2. 通常Seed群でInvariant違反を発生させない。
3. Random Agentよりゲーム目標に関連する行動を明確に多く選ぶ。
4. 明白な資源不足、感染、Horde警告を継続的に無視しない。
5. すべての局面で同一Action種別だけを機械的に繰り返さない。
6. 勝利可能な局面で意図的な自滅を通常選択しない。
7. 敗北した場合でも、そのAction列をReplay可能である。

勝率については、v1.2実装開始前に特定値を合格基準として固定しない。まず同一Config / Seed群に対するRandom Agentとの比較ベースラインを取得する。

---

# 8. Strategy Preset

## 8.1 目的

単一のRuleBasedAgentだけでは、特定戦略が支配的かを比較しにくい。

同じ意思決定基盤の評価重みを変更した複数Presetを用意できる設計とする。

初期候補:

- `balanced`: 生存、経済、防衛、拡張を均等に評価
- `evacuation`: 民間人損失を強く嫌い、危険地域からの避難を高く評価
- `expansion`: 安全な施設確保を高く評価
- `defense`: Horde防衛と戦力維持を高く評価

v1.2必須範囲として最低`balanced`を実装する。

残りPresetはRuleBasedAgentの実装コストが小さい場合に追加する。少なくとも後から重み差分だけで追加可能な設計を受入条件とする。

---

# 9. Batch Simulation

## 9.1 CLI

Headlessで複数ゲームを連続実行できるCLIを提供する。

例:

```bash
npm run sim -- --agent=balanced --games=1000
```

最低限、以下を指定可能とする。

- Agent / Strategy
- Games数
- 開始SeedまたはSeedリスト
- GameConfig
- 結果出力先

## 9.2 同一Seed比較

複数Agent / Strategyを比較する場合、同じSeed集合を使用できること。

これによりMap / Horde / Refugee等の乱数差ではなく、戦略差を比較しやすくする。

## 9.3 実行失敗

次の場合、Batch Runnerは該当Gameを失敗として記録し、可能な限り残りゲームを継続できること。

- Invariant違反
- 例外
- 不正Actionの連続
- AgentがActionを返せない
- 設定した最大Agent Step数を超過

無限ループ防止のため、1ゲームあたりのAgent decision回数に安全上限を設ける。

---

# 10. Metrics

各ゲームについて、最低限次を記録する。

## 基本

- gameVersion
- seed
- agentId / strategy
- outcome
- gameOverReason
- finalTurn
- totalAgentDecisions

## 人口

- initialPopulation
- finalHealthyCivilianPopulation
- maxPopulation
- civilianLosses
- infectionLosses
- resourceShortageLosses
- refugeesAcceptedまたはそれに相当する集計
- maxOvercrowdingまたは最大過密追加消費

## 施設

- facilitiesCaptured
- facilitiesLost
- finalSecuredFacilities

## 部隊 / 戦闘

- policeProduced
- nationalGuardProduced
- unitLosses
- zombiesKilled
- hordeInterceptions

## 資源

- finalFood
- finalCivilianGoods
- finalMilitaryGoods
- finalFuel

既存Statisticsで取得できない項目は、イベントログから集計可能であれば必ずしもGameStateへ新規永続フィールドを追加しなくてよい。

---

# 11. Replay / Failure Artifact

## 11.1 Replay記録

AIがプレイしたゲームは最低限次の情報から再現可能であること。

```text
Game Version
Config
Map ID
Seed
Agent ID / Strategy
Action sequence
Final Result
```

## 11.2 失敗ケース

Invariant違反、例外、不正Action、Agent停止等が発生した場合、次をJSON artifactとして保存できること。

- Seed
- Config
- Agent情報
- Action列
- 直前Observation
- 直前GameState（テスト / デバッグ用途のみ）
- Error内容

人間が同一SeedとAction列から問題を再現できることを重視する。

---

# 12. テスト

## 12.1 Observation

- ObservationがJSON互換である。
- Observation取得でGameStateを変更しない。
- Observationの配列順等がSeed再現性を壊さない。
- AgentがObservation経由だけで必要な意思決定を行える。

## 12.2 LegalActions

- 返却Actionを順にvalidateした場合、すべて合法である。
- 不正Actionを直接stepしてもStateが変更されない。
- Game Over後に通常Actionを返さない。

## 12.3 RuleBasedAgent

固定Seedによるシナリオテストを用意する。

例:

- 食料不足予測時に、改善可能なら食料改善Actionを優先する。
- 感染施設と利用可能なPoliceがある場合に鎮圧を評価する。
- Horde直前に無関係な遠方拡張だけを優先しない。
- 深刻な過密と安全な受入都市がある場合に分散を評価できる。
- 行動価値がなければEndTurnを選択できる。

特定の完全Action列への過剰な固定は避け、意思決定意図を検証する。

## 12.4 Batch

- 同じSeed + Agent設定から同じ結果を再現する。
- 100ゲーム以上をInvariant違反なく完遂する。
- Failure artifactが再生可能である。

CIでは既存Random Agentテストを残し、RuleBasedAgentによる一定数のSmoke Simulationを追加することを検討する。CI時間が過大になる場合、大規模1000ゲーム等はローカル / 手動実行とする。

---

# 13. Developer / Browser Bridge

GitHub Pages上のゲームを将来Claude Code等のブラウザ操作Agentからテストする可能性を考慮する。

v1.2では必須実装としない。

将来的に次のような薄いDeveloper Bridgeを追加可能な構造を維持する。

```ts
window.NLTH = {
  getObservation,
  getLegalActions,
  step,
  getResult,
};
```

本BridgeはHeadless APIの別実装ではなく、同じAgent APIをブラウザから呼び出すAdapterとする。

---

# 14. 非目標

v1.2では次を必須範囲に含めない。

- OpenAI / Claude / Gemini等、特定LLM APIとの接続
- LLM Agent本体
- 強化学習
- Minimax / MCTS等による最適探索
- 人間より強いAIの保証
- AI専用ゲームルール
- AIのためのゲームバランス変更
- Fog of War本体
- 地形効果
- 騒音 / Zombie感知AI変更
- Supply Line
- Larger Map
- UI上でAIプレイをリアルタイム観戦する機能
- GitHub Pages Browser Bridgeの完成

これらは後続バージョンまたは別タスクで扱う。

---

# 15. 実装上の注意

## 15.1 GameEngineの肥大化を避ける

Agentの判断ロジックを`engine.ts`へ追加しない。

概念的には次のように責務を分ける。

```text
src/core/
  GameEngine / rules

src/agent/
  observation
  agent interface
  ruleBasedAgent
  strategies
  metrics

src/testing/
  batch runner
  replay / failure output
```

実際のパスは現行構造に合わせて調整してよい。

## 15.2 RuleBasedAgentのルールをデータ化する

可能な限り、優先度・閾値・戦略差分を巨大なif文へ直接埋め込まない。

後から`balanced`、`evacuation`、`expansion`等を比較できるよう、評価重みを分離する。

## 15.3 GameStateへの依存禁止

RuleBasedAgentがGameStateの非公開情報へ依存しないことをテストで保証する。

Fog of War導入時にAgentを書き直さずObservationの公開範囲変更で対応できることを目標とする。

---

# 16. v1.2完了条件案

v1.2は最低限、次をすべて満たした時点で完了候補とする。

1. Agent向けObservation APIが存在する。
2. AgentがGameStateを直接参照せずプレイできる。
3. `getLegalActions()`と`step()`だけでゲームを進行できる。
4. Balanced RuleBasedAgentが1ゲームを自律完遂できる。
5. Balanced RuleBasedAgentがゲーム目標を自然に目指す基本ヒューリスティックを持つ。
6. 同一Seed / Config / Agentから結果を再現できる。
7. Batch Simulationで少なくとも100ゲームを連続実行できる。
8. 各ゲームのMetricsをJSONまたはCSV等の機械処理可能形式で出力できる。
9. 失敗ゲームのSeed / Config / Action列を保存し再現できる。
10. 既存Random Agent、既存Unit Test、Invariant、Save / Replay、Production Buildを壊さない。
11. CIが成功する。

---

# 17. v1.2実装後に最初に確認したい問い

Agent基盤完成後、まず次のようなゲームデザイン上の問いを同一Seed集合で検証する。

- Balanced AgentはRandom Agentより安定して生存できるか。
- Horde警告を利用することで生存率が改善するか。
- 食料・民需品不足は主な敗因になっているか。
- Population v1.1導入後も、特定の人口移動戦略だけが極端に有利ではないか。
- 州都集中 / 避難戦略は過密コストに見合うか。
- City確保が他施設確保に比べて極端に支配的ではないか。
- Police / National Guardは双方利用されるか。
- Infection suppressionは合理的Agentに実際に利用されるか。

これらはv1.2のゲームバランス変更要件ではなく、後続アップデートの判断材料を得るための観測項目とする。

---

# 18. v1.3への接続

v1.3で予定するTerrain、Vision / Fog of War、Zombie sensing、Noiseへ向け、v1.2ではObservation境界を確立する。

特にFog of War実装時はGameStateを変更せず、Observation生成側で可視情報を制御できる構造を優先する。

そのためv1.2の成果物は単なるAIテストコードではなく、今後の情報公開モデルとAgent拡張の基盤として扱う。
