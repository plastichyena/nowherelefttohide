# Nowhere Left to Hide

## PoC v1.2アップデート要件 確定版

- ステータス: 実装前合意版
- 確定日: 2026-08-27
- 対象: PoC v1.1からv1.2への変更
- 安定版正本: `Nowhere Left to Hide PoC 現行仕様.md`（v1.1のまま維持）
- 反映時期: v1.2の実装・テスト・動作確認完了後

本書はv1.2で追加するAgent Observation、組み込みBalanced Agent、Batch Simulation、Replay／Metrics基盤、Developer / Browser Bridgeの要件と受入条件を定義する。実装中は、本書が変更部分の目標仕様となり、本書に記載のない既存ルールは現行仕様を維持する。

v1.2の実装・テスト・動作確認が完了するまでは、現行仕様を安定版v1.1の正本として維持する。完了後に本書を現行仕様へ反映し、実装・テスト・ヘルプとの整合を確認する。

---

# 1. 目的

v1.2の主目的は、AIエージェントが人間プレイヤーと同じ公開情報とゲームルールを使い、ゲーム目標を目指して1ゲームを自律的にテストプレイできる基盤を整えることである。

次の2経路を正式対応する。

1. リポジトリを利用するAgentが、ローカルのHeadless API／CLIからゲームを実行する。
2. ブラウザ操作能力を持つ外部Agentが、公開GitHub PagesのURLを開き、`window.NLTH`を通じて画面操作なしでゲームを実行する。

人手テストを完全に置き換えることは目的としない。自動試行により次を発見・観測し、人間が重点確認するケースを絞り込む。

- 明らかな壊れ戦略または固定化した最適解
- 特定Seedや局面での詰み
- 資源、人口、感染、Horde処理の極端な偏り
- ほとんど利用されないゲームシステム
- 異常に高いまたは低い勝率
- GameAction、Invariant、Replayの不整合
- 合法だが合理的なプレイヤーが通常選ばない不自然な行動列

---

# 2. v1.2の非目標

次はv1.2の必須範囲に含めない。

- OpenAI、Claude、Gemini等の特定LLM API接続
- LLM Agent本体、Agent製品ごとの専用Skill／Plugin
- GitHub Pages上のHTTP／RESTバックエンド
- Browser BridgeからのBatch一括実行
- AIプレイの画面表示、観戦、思考表示、Strategy選択UI
- 人間より強いAIの保証
- 強化学習、Minimax、MCTS等の最適探索
- `balanced`以外の組み込みStrategy実装
- Fog of War、地形効果、Zombie感知、Noise、Supply Line、Larger Map
- v1.2の試行結果に基づくゲームルールまたは標準Configのバランス変更
- すべての将来Versionに対するセーブ移行保証

Batchでバランス問題が見つかった場合は結果を記録し、後続アップデートの判断材料とする。仕様と実装の不一致、不変条件違反、再現不能、合法手の欠落はバランス問題ではなくv1.2内の不具合として扱う。

---

# 3. 基本原則

## 3.1 AI専用ルールを作らない

Human UI、Random Agent、Balanced Agent、外部Agentは、すべて既存のGameActionとGameEngineを利用する。

```text
Human UI ---------┐
Random Agent -----┤
Balanced Agent ---┤ -> GameAction -> GameEngine -> GameState
External Agent ---┘
```

AI専用の状態書換え、資源付与、ユニット直接移動、ルール迂回を禁止する。Agent向けAdapterも、状態変更時には必ずGameEngineの`step()`を使用する。

## 3.2 GameStateとObservationを分離する

```text
GameState
= ゲーム内部の完全な真実

AgentObservation
= その時点でプレイヤー／Agentへ公開される情報
```

Agentの正式入力にGameStateを使用しない。Balanced Agentが`engine.getState()`を参照しなければ成立しない実装は受入対象外とする。

## 3.3 決定性

同一のGame Rules Version、Config、Map、Seed、Agent／Strategy Versionから、Balanced AgentのAction列と結果が一致しなければならない。

- GameEngine内で再現不能な`Math.random()`を使用しない。
- Balanced Agentは独自乱数を使用しない。
- 同点候補は安定したActionキー、ID、座標順等で決定する。
- Random Agentの選択乱数はGameEngineとは独立したSeed付き乱数とする。
- 配列、JSON、CSV、Artifactの出力順も決定的にする。

## 3.4 Versionの分離

最低限、次を別概念として管理する。

- App / Release Version: v1.2
- Game Rules / GameState Version
- Save Format Version
- Agent / Strategy Version
- Agent Observation API Version
- Browser Bridge API Version
- Build ID

v1.2はゲームルールと必須GameStateを原則変更しないため、Game Rules / GameState Versionはv1.1を維持し、v1.1セーブを読み込めることを必須とする。Save Format Versionも変更理由がなければ現行値を維持する。

将来GameStateへ非互換変更を行う場合、旧セーブを理由付きで拒否してよい。移行機能はVersionごとに価値と工数を判断し、恒久的な後方互換性を保証しない。

---

# 4. AgentObservation

## 4.1 公開方針

Observationは、その時点で人間プレイヤーがルール上知り得る情報と、正式なEndTurn予測に限定する。v1.2にはFog of Warがないため盤面情報は広く公開するが、GameStateの完全コピーにはしない。

次を公開しない。

- PRNGの内部状態
- 将来の乱数結果
- 非公開と定められたHorde規模
- デバッグ専用フィールド
- UIにもルールにも公開されていない内部処理情報

## 4.2 必須情報

最低限、次をJSON互換の安定した構造で提供する。

```ts
interface AgentObservation {
  apiVersion: string;
  gameRulesVersion: string;
  turn: number;
  maxTurns: number;
  phase: GamePhase;
  map: AgentMapObservation;
  resources: AgentResourceObservation;
  population: AgentPopulationObservation;
  facilities: AgentFacilityObservation[];
  units: AgentUnitObservation[];
  zombies: AgentUnitObservation[];
  checkpoints: AgentCheckpointObservation[];
  horde: AgentHordeObservation;
  endTurnForecast: EndTurnForecast;
  gameOver: boolean;
  result: AgentGameResult | null;
}
```

実際の型名は既存コードとの整合を優先してよいが、公開内容と境界は本書を満たすこと。

## 4.3 マップ情報

最低限、次を含める。

- Map ID、サイズ、ヘックス座標
- 各タイルの通行可否
- 道路と道路の侵入方向
- 施設、検問所、ユニットの位置
- 隣接関係と距離を再現できる座標規則

v1.3以降のFog of Warに備え、静的マップ情報と可視性が変化する動的情報を分離する。

## 4.4 派生情報

Game Coreまたは共通ルール層で決定的に計算できる客観情報を提供する。

- EndTurn後の資源要求量、不足量、過密追加消費
- 電力Capacityと停止見込み
- Horde残りターンと公開方向
- 施設の所有、感染、稼働、人口、ソフト／ハード上限、操作可否
- 人口移動、編成、鎮圧等の利用可否と客観的な不許可理由
- ユニットの行動状態、HP、攻撃、移動、射程、位置
- 公開情報から算出可能な距離

「危険度が高い」「この施設を守るべき」等の価値判断はObservationへ含めず、Agent側で行う。

## 4.5 安定性

- Observation取得でGameStateを変更しない。
- 返却値は内部参照を共有しないJSON互換コピーとする。
- 配列順を安定化する。
- Observation APIへSemVer形式のVersionを付ける。
- 破壊的変更ではMajorを更新する。

---

# 5. Agent API

## 5.1 正式インターフェース

既存HeadlessGameとGameEngineを二重実装せず、Agent向けAdapterを提供する。

```ts
interface AgentGame {
  reset(options?: AgentResetOptions): AgentObservation;
  getObservation(): AgentObservation;
  getLegalActions(): GameAction[];
  step(action: GameAction): AgentStepResult;
  isGameOver(): boolean;
  getResult(): AgentGameResult | null;
  getRunArtifact(): AgentRunArtifact;
}
```

v1.2の契約は同期式とする。非同期LLM Agent Runnerは実装せず、将来Adapterを追加できる責務分離だけ維持する。

## 5.2 Agent専用StepResult

既存GameEngineのStepResultをAgentへ直接返さない。

```ts
interface AgentStepResult {
  observation: AgentObservation;
  events: AgentPublicEvent[];
  error: AgentActionError | null;
  gameOver: boolean;
  result: AgentGameResult | null;
}
```

完全なGameStateを含めない。Eventも人間プレイヤーへ公開可能な情報へ変換し、非公開情報を漏らさない。

## 5.3 Legal Actionsと再検証

- `getLegalActions()`が返すActionは、その時点でGameEngineが受理する合法Actionであること。
- Game Over後は空配列を返す。
- Agentが一覧外Actionを`step()`へ渡した場合もGameEngineで再検証する。
- 不正Actionは状態、RNG、正規Action列を変更しない。
- エラーは機械処理可能な`code`と人間向け`message`を持つ。
- `EndTurn`は常にAgent自身が候補から選択する。

Balanced Agent／Batchで、合法手として取得したActionが拒否された場合は1回で技術的失敗とする。外部Agentは不正Action後に修正して続行できる。不正試行はRun Artifactへ正規Action列と分けて記録する。

## 5.4 Reset

ResetはSeed、検証済みConfig override、Agent識別情報を受け取れる。

```ts
window.NLTH.reset({
  seed: 123,
  configOverrides: { maxTurns: 10 },
  agent: { id: "codex-manual-test" }
});
```

- 省略時は既定Seedと標準Configを使う。
- 未知項目、非有限値、範囲外値、不正Version／Map IDを拒否する。
- Reset失敗時は現在セッションを変更しない。
- Agent ID等の自由入力には長さと文字種の安全な上限を設ける。

---

# 6. GameAgentとBalanced Agent

## 6.1 共通契約

```ts
interface GameAgent {
  readonly id: string;
  readonly version: string;
  decide(
    observation: AgentObservation,
    legalActions: readonly GameAction[],
  ): AgentDecision;
}
```

AgentDecisionは選択Actionに加え、組み込みAgent向けの優先目標、評価点、理由コードを保持できる。AgentはObservationとLegal Actionsだけを受け取り、GameStateの参照・変更権限を持たない。

## 6.2 必須Strategy

v1.2で必須とする組み込みStrategyは`balanced`だけとする。

`evacuation`、`expansion`、`defense`等は実装しない。ただし、評価重みと閾値の差分で後から追加できる設計を必須とする。「実装コストが小さければ追加」のような任意条件は設けない。

## 6.3 Balancedの役割

Balanced Agentは最適AIではなく、ゲーム目標を理解した再現可能な通常テストプレイヤーとして振る舞う。

- 勝利を目指す。
- 敗北条件を避ける。
- 明白な危険を認識する。
- Hordeへ備える。
- 資源不足を放置し続けない。
- 感染を可能な範囲で対処する。
- 過密と人口配置を考慮する。
- 安全な拡張機会を利用する。
- 検問所の建設と審査方針を評価する。
- 損傷部隊を無意味に危険へ投入しない。
- 不要なActionを連打せずEndTurnする。

## 6.4 目標優先度

基本優先度を次の順とする。

1. 今回のEndTurnまたは目前の敵行動で起きる敗北を回避する。
2. 州都陥落、健全民間人口全滅、重大なHorde被害を予防する。
3. 食料・民需品不足、感染拡大、電力停止等の継続的危機を改善する。
4. 人口、生産、部隊を安定させる。
5. 安全性と維持可能性を確認して施設を確保する。
6. 有益なActionがなければEndTurnする。

同一段階の候補は、ConfigまたはStrategy定義から分離した重み付き評価で比較する。巨大なif文やAction種別だけの固定優先順にしない。

## 6.5 判断領域

最低限、次を評価できること。

- 州都と健全民間人口の即時敗北リスク
- 食料、民需品、燃料、電力、軍需供給
- 感染鎮圧と州兵鎮圧時の民間人被害
- Horde方向、残りターン、防衛、編成、人口避難
- 都市過密と安全都市への人口分散
- 安全な中立施設の価値と確保可能性
- 警察／州兵の状況別編成
- 部隊HP、敵射程、移動、攻撃、待機
- 検問所建設の費用対効果
- 感染リスク、人口需要、受入先に応じた審査方針

---

# 7. 自然な目標達成の合格基準

勝率やRandom Agentとの勝率差をv1.2の合否条件にしない。勝率は観測Metricsとする。

Balanced Agentは最低限、次を満たす。

1. Game Overまで人手なしで自律実行できる。
2. 固定Seed集合でInvariant違反、不正Action、無限ループを発生させない。
3. 固定シナリオで意図した危機対応または合理的代替Actionを選ぶ。
4. 明白な資源不足、感染、Horde警告を継続的に無視しない。
5. 同一Action種別だけを機械的に繰り返さない。
6. 勝利可能な局面で通常は意図的自滅を選ばない。
7. 敗北した場合もAction列をReplayできる。
8. Random Agentとの同一Seed比較結果を出力できる。

完全なAction列への過剰な固定は避け、選択Actionが許容される意図カテゴリに属することを検証する。

## 7.1 必須固定シナリオ

- 即時敗北・州都陥落の回避
- 食料／民需品不足の改善
- 燃料／電力不足と重要施設停止への対応
- 感染鎮圧と州兵の民間人被害の考慮
- Horde直前の防衛、編成、必要に応じた避難
- 過密時の人口分散
- 安全時の施設拡張と危機時の拡張抑制
- 警察／州兵の状況別編成
- 損傷部隊の無謀な突入回避
- 検問所建設と審査方針
- 有益なActionがない場合のEndTurn

---

# 8. Decision Trace

Balanced Agentの各Decisionについて次を機械可読に記録する。

- Turn、Decision番号
- 選択した優先目標コード
- 選択Actionと評価点
- 上位候補と評価点
- 適用した主要評価理由コード

文章の思考過程は保存せず、定義済みコードと数値だけを使用する。通常の集計JSON／CSVには件数を含め、詳細Traceはゲーム単位Replay／Failure Artifactへ保存する。

---

# 9. 統一Agent Runner

## 9.1 実装統合

現在`src/core/`と`src/testing/`に存在するRandom Agent関連の二重実装を、単一のAgent／Batch基盤へ統合する。

- Game Coreにはルール、GameEngine、Headless Interfaceを置く。
- Agent、Runner、Metrics、Replay、ArtifactはCore外へ分離する。
- Random AgentとBalanced Agentは同じRunner、Seed指定、失敗判定、Artifact形式を使用する。
- Human UIとAgentで別の合法条件を作らない。

## 9.2 安全上限

Agent Runnerは次をGameConfigとは別に管理する。

- 1ターンあたり最大Decision数
- 1ゲームあたり最大Decision数
- Runner上の最大ターン数
- 任意のfail-fast設定

上限超過はゲーム上の敗北ではなく技術的失敗とし、Failure Artifactを保存する。正式比較ではAgentごとにGameConfigを変更せず、同一の標準GameConfigを使用する。

## 9.3 失敗時の継続

デフォルトでは、あるゲームが例外、不変条件違反、Agent停止等で失敗してもArtifactを保存し、残りゲームを続行する。`--fail-fast`指定時だけ最初の失敗で停止できる。

---

# 10. Batch Simulation CLI

最低限、次に相当するCLIを提供する。

```bash
npm run sim -- --agent=balanced --games=1000 --seed=1 --out=output/simulations/run-name
```

必須指定項目:

- Agent / Strategy（最低`random`、`balanced`）
- Games数
- 開始Seedまたは明示Seedリスト
- 完全なGameConfigまたは検証済みoverride
- Runner安全上限
- 結果出力先
- fail-fast有無

複数Agentを同一Seed集合、同一標準GameConfigで比較できること。Random Agentの破壊試験用Config変更は正式なバランス比較へ使用しない。

Exit Codeは、全ゲームが技術的に完遂した場合0、1件でも技術的失敗がある場合は非0とする。ゲーム内の敗北は正常完遂であり、Exit Codeを失敗にしない。

---

# 11. Metrics

## 11.1 ゲーム単位

最低限、次を記録する。

### 識別

- App / Release Version
- Game Rules / GameState Version
- Agent / Strategy IDとVersion
- Observation / Bridge API Version
- Build ID
- Map ID、Seed、Config

### 基本

- outcome、gameOverReason、finalTurn
- totalAgentDecisions
- acceptedActionCount、invalidAttemptCount
- Action種別別件数
- 優先目標別件数（Balancedのみ）

### 人口

- initialPopulation
- finalHealthyCivilianPopulation
- maxPopulation
- civilianLosses
- infectionLosses
- resourceShortageLosses
- refugeesAccepted
- maxOvercrowdingまたは最大過密追加消費

### 施設

- facilitiesCaptured
- facilitiesLost
- finalSecuredFacilities

### 部隊・戦闘

- policeProduced
- nationalGuardProduced
- unitLosses
- zombiesKilled
- hordeInterceptions

### 資源

- finalFood
- finalCivilianGoods
- finalMilitaryGoods
- finalFuel

既存Statisticsにない項目は、理由付きEventから決定的に集計できる場合、GameStateへ新規永続フィールドを追加しない。

## 11.2 Agent別集約

JSON集計の正本には最低限、次を含める。

- 実行数、完遂数、技術的失敗数
- 勝敗数、勝率
- 各Metricsの平均、中央値、最小、最大
- 主要Metricsのp10、p90
- Game Over理由の件数分布
- Action種別と優先目標の選択回数
- 同一Seed比較時のAgent間差分

---

# 12. 出力形式とArtifact

## 12.1 Batch出力

次をすべて必須とする。

1. JSON: 実行条件、集約、ゲーム単位Metrics、失敗一覧の正本
2. CSV: ゲーム単位主要Metricsの平坦な表
3. ゲーム単位JSON: 成功・敗北時のReplay Artifact、技術的失敗時のFailure Artifact

CSVはUTF-8とし、列順を固定する。出力先既存ファイルの扱いは明示し、意図しない上書きを防ぐ。

## 12.2 Run / Replay Artifact

成功・敗北を問わず、最低限次を含む。

- 各VersionとBuild ID
- Config、Map ID、Seed
- Agent ID / Strategy / Version
- 受理されたAction列
- 不正Action試行とエラー（存在する場合）
- Final Result、Metrics
- Balanced AgentのDecision Trace

同一Build、Rules Version、Config、Map、Seed、Action列から結果を再現できること。

## 12.3 Failure Artifact

技術的失敗時は追加で次を保存する。

- 失敗直前のObservation
- エラーcode、message、stack（取得可能な場合）
- 失敗箇所とDecision番号
- 失敗直前と失敗後のGameState（ローカル／CIのテスト・デバッグ用途のみ）

公開Browser BridgeのArtifactには完全なGameStateを含めない。

## 12.4 Build ID

- GitHub Pages／CIではGit commit SHAを使用する。
- ローカルでは取得可能ならcommit SHAとdirty状態を記録する。
- 取得不能時は`local-unknown`等の明示値を使用する。
- Build IDはゲームの乱数や結果へ影響させない。

---

# 13. Developer / Browser Bridge

## 13.1 必須性

Developer / Browser Bridgeはv1.2の必須要件とする。GitHub Pagesで追加設定、クエリパラメータ、画面操作なしに`window.NLTH`を利用可能にする。

BridgeはGitHub Pages上のHTTP APIではない。JavaScriptを実行できるブラウザからページ内Globalを呼び出す。ブラウザ機能を持たない環境からURLへ`curl`するだけの利用は対象外とする。

## 13.2 分離

Bridgeは通常UIとは別のインメモリAgentGameセッションを1つ保持する。

- 通常UIのGameEngineへ接続しない。
- 自動保存、localStorage、セーブコード、通常プレイ状態を読書きしない。
- ページ再読み込みでセッションを破棄する。
- `reset()`で現在のAgentセッションだけを置き換える。

## 13.3 公開API

最低限、次だけを公開する。

```ts
window.NLTH = {
  getApiInfo,
  reset,
  getObservation,
  getLegalActions,
  step,
  isGameOver,
  getResult,
  getRunArtifact,
};
```

`getState`、`LoadSnapshot`、任意コード実行、ファイル操作、保存操作、Batch一括実行は公開しない。

## 13.4 自己説明

`getApiInfo()`は、最低限次を機械可読に返す。

- Bridge／Observation API Version
- 利用可能メソッド
- 引数と戻り値のSchemaまたは説明
- 推奨呼び出し順
- 公開情報と禁止事項
- 最小実行例

加えてGitHub Pages内に短いAgent API説明ページを置き、READMEへ公開URLと最小プロンプト例を記載する。通常ゲームUIへの常設表示は不要とする。

## 13.5 セキュリティ条件

- Bridgeからネットワーク送信、認証情報、秘密情報へアクセスしない。
- 引数、Action、Config overrideを境界で検証する。
- 返却値はJSON互換コピーとする。
- 1回の`step()`で1Actionだけ処理する。
- 外部入力の文字列、配列、数値へ上限を設ける。
- 不正入力では状態を変更しない。
- HTTPS配信を維持し、HTTP資産を混在させない。

公開ページであるためBridgeの存在とルール情報は秘匿対象としない。

## 13.6 外部AgentのRun Artifact

Bridgeは成功・敗北を問わず、現在セッションの受理Action列と不正試行をインメモリ記録し、`getRunArtifact()`でJSON互換値を返す。通常保存領域へ自動書込みしない。

外部Agentが開始時に指定したAgent IDを記録する。完全な内部GameStateと、外部Agentの文章上の思考過程は記録しない。

---

# 14. Browser Agent向け資料

特定Agent製品の専用Skill／Pluginはv1.2成果物に含めない。次をツール非依存で提供する。

- Agent API説明
- URLと短い依頼から開始できる最小プロンプト例
- Playwright CLI等でBridge疎通を確認する手順またはSmokeスクリプト
- 外部AI手動E2Eチェックリスト

利用側は必要に応じてPlaywright CLI、ブラウザ操作Skill、Codex Browser、Claude Code向けブラウザ連携等を準備する。

---

# 15. 必須テスト

## 15.1 Observation

- JSON互換である。
- 取得でGameStateを変更しない。
- 返却値変更で内部Stateを変更できない。
- 配列順が決定的である。
- 公開対象の静的マップ情報を含む。
- PRNG状態、将来乱数、非公開Horde規模、デバッグ情報を含まない。
- AgentがObservationとLegal Actionsだけで必須判断を行える。

## 15.2 Agent API

- Legal Actionsを順にGameEngineへ渡すとすべて合法である。
- 一覧外Actionを直接stepしてもStateとRNGが変化しない。
- AgentStepResultにGameStateを含まない。
- Game Over後に通常Actionを返さない。
- Config overrideの不正値を状態変更なしで拒否する。

## 15.3 Balanced Agent

- 7.1の全固定シナリオを意図ベースで検証する。
- GameStateを参照せず、ObservationとLegal Actionsだけを使用する。
- 同一入力から同一Decision、Action列、Traceを生成する。
- 有益なActionがなければEndTurnを選ぶ。

## 15.4 Batch／Replay

- 同一Seed、Config、Agent Versionから同一結果とAction列を得る。
- Random／Balancedを同一Seed、同一標準GameConfigで比較できる。
- JSON、CSV、ゲーム単位Artifactを生成する。
- 失敗後もデフォルトでは残りゲームを継続する。
- Replay Artifactから最終結果を再現する。
- Failure Artifactから失敗を再現または不一致理由を報告する。

## 15.5 CI

GitHub Actionsの必須CIへ次を含める。

- 既存Unit Test、Invariant、Save／Replay、Production Build
- 既存Random Agent 100ゲーム試験
- 標準GameConfig、固定Seed 1〜100によるBalanced Agent 100ゲーム完走試験
- Agent API／Observationの境界試験
- Production Build上のBrowser Bridge自動Smoke Test

1,000ゲーム以上の大規模試行は手動CLIとする。

## 15.6 外部AI手動E2E

公開済みGitHub Pagesに対し、CodexまたはClaude Code等のブラウザ操作可能な外部AIを少なくとも1つ使用し、次を確認する。

- URLと短い依頼からBridgeを発見できる。
- API情報、Observation、Legal Actionsを取得できる。
- 人手による途中介入なしでGame Overへ到達する。
- ゲーム目標を目指してActionを選ぶ。
- 不正Action時に理由を読み、修正して継続できる。
- Run Artifactを取得し、Action列をReplayできる。
- 勝敗と主要Metricsを最終報告できる。

勝利は合格条件にしない。特定外部Agent製品との恒久的互換性も保証しない。

---

# 16. 実装フェーズ

## Phase 1: Versionと境界整理

- App、Rules／State、Save、Agent、Observation、Bridge、Build IDを分離する。
- v1.1セーブ互換を回帰確認する。
- AgentObservationとAgentStepResultの型、公開情報Policyを確定する。

## Phase 2: AgentGame Adapter

- Observation生成を実装する。
- Legal Actions、Step、Result、Run ArtifactをAgent専用型で公開する。
- GameState非公開、JSONコピー、入力検証をテストする。

## Phase 3: Agent／Runner統合

- Random Agent二重実装を単一基盤へ統合する。
- Runner安全上限、失敗継続、Replay／Failure Artifactを実装する。

## Phase 4: Balanced Agent

- Strategy重み、優先目標、理由コードをデータとして分離する。
- 11領域の固定シナリオを先に整備する。
- Balanced判断とDecision Traceを実装する。

## Phase 5: BatchとMetrics

- CLI、Seed集合、同一Config比較を実装する。
- ゲーム単位Metrics、Agent別集約、JSON／CSVを実装する。
- 100ゲームCIと1,000ゲーム手動実行を確認する。

## Phase 6: Browser Bridge

- 通常UIと分離した`window.NLTH`をProduction Buildへ追加する。
- 自己説明、Config override、Run Artifact、セキュリティ境界を実装する。
- 公開説明、README、最小プロンプト、Playwright疎通手順を追加する。

## Phase 7: 統合検証

- 全Unit／Invariant／Agent／Browser／Build試験を実行する。
- GitHub Pagesへ公開し、外部AI手動E2Eを実施する。
- Artifactと再現性を確認する。
- 合格後に本書を現行仕様へ反映し、現行Versionをv1.2へ更新する。

---

# 17. 成果物と受入対応

| 成果物 | 主な受入条件 |
|---|---|
| AgentObservation | 公開情報のみ、JSON互換、決定的、GameState非依存 |
| AgentGame Adapter | Legal Actionsとstepだけで進行、AgentStepResultにStateなし |
| Balanced Agent | 11シナリオ、完全決定的、100 Seed完走 |
| 統一Agent Runner | Random／Balanced共通、上限、失敗継続、再現性 |
| Batch CLI | Seed／Config／Agent指定、同一Seed比較、正しいExit Code |
| Metrics | ゲーム単位とAgent別集約、同一Seed差分 |
| Replay／Failure | Action列、Version、Build ID、再生可能性 |
| Browser Bridge | 常時利用、通常UI／保存と分離、自己説明、安全な入力境界 |
| Browser資料 | API説明、最小プロンプト、Playwright疎通、E2Eチェックリスト |
| CI | Random 100、Balanced 100、Bridge Smoke、既存回帰 |
| 外部AI E2E | 公開URLから人手介入なしで完遂しArtifact取得 |

---

# 18. v1.2完了条件

次をすべて満たした時点でv1.2を完了とする。

1. AgentObservationが存在し、非公開GameStateをAgentへ渡さない。
2. Agentが`getLegalActions()`と`step()`だけでゲームを進行できる。
3. Balanced AgentがGameStateを直接参照せず、完全決定的に動作する。
4. 11領域の固定シナリオ試験が成功する。
5. 固定Seed 1〜100のBalanced AgentがCIで技術的失敗なく完遂する。
6. Random AgentとBalanced Agentを同一Seed、同一標準GameConfigで比較できる。
7. BatchがJSON、CSV、ゲーム単位Replay／Failure Artifactを出力する。
8. 各ArtifactがVersion、Build ID、Config、Seed、Action列、Result、Metricsを持つ。
9. Replayから同一最終結果を再現できる。
10. GitHub Pagesで`window.NLTH`が追加設定なしに利用できる。
11. Bridgeが通常UI、自動保存、localStorageと分離されている。
12. Browser Bridgeの自動Smoke TestがProduction Buildで成功する。
13. 公開GitHub Pages上の外部AI手動E2Eが成功する。
14. v1.1セーブを読み込める。
15. 既存Unit Test、Random Agent、Invariant、Save／Replay、Production Build、CIを壊さない。
16. v1.2でゲームバランス変更を行っていない。
17. 実装・テスト・動作確認後、本書が現行仕様へ反映され、実装・ヘルプ・Versionと整合する。

---

# 19. 実装後に観測するゲームデザイン上の問い

- Balanced AgentはRandom Agentより安定して生存するか。
- Horde警告の利用で生存率が変わるか。
- 食料・民需品不足は主な敗因か。
- 特定の人口移動戦略だけが極端に有利か。
- 州都集中／避難戦略は過密コストに見合うか。
- City確保が他施設より極端に支配的か。
- Police／National Guardは双方利用されるか。
- Infection suppressionは合理的Agentに利用されるか。
- 検問所建設と各審査方針は利用されるか。

これらはv1.2のバランス変更要件ではなく、後続アップデートの判断材料である。

---

# 20. v1.3への接続

v1.3で予定するTerrain、Vision / Fog of War、Zombie sensing、Noiseに向け、v1.2でObservation境界を確立する。

Fog of War導入時はGameStateを書き換えず、Observation生成側で動的情報の可視性を制御できる構造を優先する。AgentがGameStateへ依存しないことで、公開範囲変更だけで既存Agentを適応可能にする。
