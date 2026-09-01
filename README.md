# Nowhere Left to Hide

モバイル縦画面を基準にした、ターン制ゾンビ・ヘックス戦略ゲームのPoCです。限られた人口・部隊・物資で施設と生産力を広げながら、予告されたHordeに備えます。

公開ページ（GitHub Pages）: <https://plastichyena.github.io/nowherelefttohide/>

ブラウザAgent向けAPI説明: <https://plastichyena.github.io/nowherelefttohide/agent-api.html>

## PoCの範囲

- 固定31×31ヘックス、17恒久施設、東西南北の道路支線とHorde入口
- Plain／Forest／Mountainの固定地形、重み付き移動、Urban／Forest防御、共通VisibilityとFog of War
- 州都、地方都市、農場、工場、製油所、発電所の確保・稼働・感染・陥落・復旧
- 警察・州兵のMovement 10、機種別Fuel、Fuel 0 Emergency Movement、Unit別携行軍需品、補給、迎撃、攻撃、反撃、待機、自然回復
- 食料・民需品・軍需品・燃料・電力Capacityの生産と不足処理
- Fuel不要のWind Power Plant、Supply内に建設できるSimple Farm／Civilian Drone Base
- Fuel／電力、Single Point of Failure、確定経済敗北、Checkpoint供給効果、Queue PressureのForecast
- 所在地を持つ都市住民・生産施設労働者、都市間移住、都市過密
- 検問所、避難民の到着・審査、waiting / screening / approved、潜伏感染
- 道路方面ごとの独立到着予定、複数Checkpoint Post、Active / Standby / Dormant、Automatic Fallback
- 州都と稼働中検問所を起点にした供給範囲、セクター境界、供給外Actionの理由表示
- Seed付き乱数によるゾンビAI、避難民、感染、Hordeの再現
- 戦闘地点から通常Zombieを誘引する決定的なCombat Noiseと、Horde／人口Targetとの優先順位
- HP 20のHorde Zombieと通常Zombieを組み合わせたPeriodic／Final Horde
- Core生成の全道路Checkpoint候補と、Human／Agent共通の利用不能理由
- 自動保存、セーブコード、JSON保存・復元
- 日本語（デフォルト）/英語切り替え、初回ガイド、常設ヘルプ、終了統計
- ブラウザJavaScriptから利用できる、通常UI・保存領域と分離したDeveloper / Browser Bridge
- 公開Observationだけで動くBalanced Agent、同一Seed比較、Metrics、Replay／Failure Artifactを持つBatch CLI
- 1回のAI応答をまたいで継続できるActive Session、Public Decision Log、履歴Checkpoint、分岐Session、7コマンドCLI

ゲームルールの正本は [`Doc/Nowhere Left to Hide PoC 現行仕様.md`](Doc/Nowhere%20Left%20to%20Hide%20PoC%20現行仕様.md) です。v1.4.1の確定アップデート要件は [`Doc/Nowhere Left to Hide PoC v1.4.1 アップデート要件 確定版.md`](Doc/Nowhere%20Left%20to%20Hide%20PoC%20v1.4.1%20アップデート要件%20確定版.md) です。v1.4.0の実装目標となった確定要件は [`Doc/archive/Nowhere Left to Hide PoC v1.4.0 アップデート要件 確定版.md`](Doc/archive/Nowhere%20Left%20to%20Hide%20PoC%20v1.4.0%20アップデート要件%20確定版.md) に履歴資料として保管しています。READMEや変更記録が正本と矛盾する場合は現行仕様を優先します。

## ローカルで起動する

Node.js 22系を推奨します。

```bash
npm ci
npm run dev
```

表示されたURLをPC Chromeで開いてください。スマートフォンで確認する場合は、同じLANから開発サーバーへ接続できるようにし、縦向きで表示します。

本番ビルドと確認用サーバー:

```bash
npm run build
npm run preview
```

## Browser Agent Bridge

ゲームページでは、追加設定やクエリパラメータなしで `window.NLTH` を利用できます。APIの説明ページは [Agent API](https://plastichyena.github.io/nowherelefttohide/agent-api.html) です。Bridgeは通常UIとは別のインメモリセッションで動作し、自動保存・`localStorage`・セーブコードへアクセスしません。

最小プロンプト例:

```text
Open https://plastichyena.github.io/nowherelefttohide/ and use the documented window.NLTH browser bridge. Read getApiInfo(), reset with seed 1, then repeatedly inspect getObservation() and getLegalActions(), submit exactly one legal action per step(), and continue until Game Over. Finally report getResult() and getRunArtifact().
```

公開APIは `getApiInfo`、`reset`、`getObservation`、`getLegalActions`、`step`、`isGameOver`、`getResult`、`getRunArtifact` だけです。`getApiInfo()` はVersion、公開メソッド、Fair Play境界、回復・感染・射程・検問所方針・Checkpoint候補Schema／Reason Code・生産/電力の静的ルールを返します。`getState`、`LoadSnapshot`、保存操作、ファイル操作、ネットワークアクセス、Batch実行は公開しません。

v1.4.1ではHuman UIとAgentが同じVisibility、Forecast、Checkpoint／Constructible候補Queryを使います。ObservationはUnit Fuelと携行軍需品、距離別Attack Cost／予想Damage、通常／Emergency Move、施設状態、Active／Standby／Dormant、構造上のFallback可否、Projected Supply Effect、全Action種別の候補とReason Codeを返します。Combat NoiseはCenter、Unit Type、公開Classだけを返し、正確なRadius、Hidden Enemyの反応数・ID・Targetは公開しません。Vision外のEnemy位置・個体ID・Target・Spawn座標も従来どおり非公開です。

## Agent Simulation CLI

Random／Balancedは共通RunnerとAgentGameを使います。BalancedはGameStateを参照せず、公開Observationと合法手だけから完全に決定的なActionを選びます。

```bash
npx --no-install vite-node --script src/agent/sim-cli.ts --agent=balanced --games=100 --seed=1 --summary-only --out=output/simulations/balanced-run
npx --no-install vite-node --script src/agent/sim-cli.ts --agent=random,balanced --seeds=1,2,3 --summary-only --out=output/simulations/comparison
```

出力先には正本`run.json`、固定列UTF-8の`games.csv`を生成します。既定では成功・敗北・技術的失敗を含むゲーム単位Artifactも生成し、ローカル／CIの完全Artifactだけは`verificationEvents`へMixed Hordeの内部Group・Type別生成数・Unit所属を保持してReplayで内部Event列まで照合します。100ゲーム以上の集計検証では`--summary-only`により指標・成否・比較を`run.json`／`games.csv`へ残しつつ、巨大な完全Replayだけを省略できます。Browser Bridgeの`getRunArtifact()`には内部情報を含めません。既存の非空出力先は既定で上書きしません。上書きする場合だけ`--overwrite`を明示してください。ゲーム内敗北は正常完遂であり、技術的失敗が1件でもある場合だけExit Codeが非0になります。

## AI Session CLI

Session CLIは、外部AIがプロセスや1回の応答をまたいで同じゲームを安全に続けるための永続入口です。通常のSave Format 6とは分離したSessionディレクトリに、Actionごとに更新するActive状態、公開`trace.ndjson`、既定5完了Turnごとの履歴Checkpointを保存します。AIの意思決定に使えるのはCLIが返す公開Observation、Legal Actions、Step結果、公開Event、自身のPublic Decision Logだけで、Private Checkpoint内の完全GameStateやRNG、Hidden情報は再開専用です。

ローカルリポジトリでは次のように実行します。

```bash
npx --no-install vite-node --script src/session/session-cli.ts new --session-id=my-game --seed=1
npx --no-install vite-node --script src/session/session-cli.ts status --session=my-game
printf '%s\n' '{"action":{"type":"EndTurn"},"decisionSummary":"No higher-priority legal action remains."}' | npx --no-install vite-node --script src/session/session-cli.ts step --session=my-game
npx --no-install vite-node --script src/session/session-cli.ts save-checkpoint --session=my-game
npx --no-install vite-node --script src/session/session-cli.ts list-checkpoints --session=my-game
npx --no-install vite-node --script src/session/session-cli.ts load-checkpoint --session=my-game --checkpoint=PASTE_RETURNED_CHECKPOINT_ID --new-session-id=my-branch
npx --no-install vite-node --script src/session/session-cli.ts artifact --session=my-branch
```

正式コマンドは`new`、`status`、`step`、`save-checkpoint`、`list-checkpoints`、`load-checkpoint`、`artifact`の7つです。`status`が同じSession IDのActive復帰入口で、`load-checkpoint`は親を巻き戻さず必ず別IDの分岐Sessionを作ります。`step`はJSONの`action`と1～500文字の公開`decisionSummary`を必須とし、不正Actionも状態とRNGを変えず理由付きDecisionとして記録します。破損時は暗黙に巻き戻さず、Checkpoint一覧から明示的に分岐復旧します。詳細は[`PLAY_WITH_AI.md`](PLAY_WITH_AI.md)を参照してください。

## AI Portable Package

`CI and GitHub Pages`が`main`で成功すると、独立した`AI Portable Package` Workflowが同じCommitからLinux x64 ZIPを生成します。ZIPにはソース、lockfile固定済み依存、Linux x64 Node.js、`PLAY_WITH_AI.md`、Commit SHA・Build ID・App Version・Node Version入り`BUILD_INFO.txt`を同梱します。展開先にNode.jsを別途インストールする必要はありません。

GitHub Actionsの`AI Portable Package`実行からArtifactをダウンロードし、展開後は次でBundled Nodeによる永続Sessionを開始できます。

```bash
./run-session.sh new --session-id=my-game --seed=1
./run-session.sh status --session=my-game
```

WorkflowはBundled Nodeだけで上記7つのSessionコマンドとBuilt-in Agent 1ゲームをSmoke Testします。外部AIへ渡す主要入口、Active復帰、Decision Log、Checkpoint分岐と公開APIだけを使うプレイ手順は[`PLAY_WITH_AI.md`](PLAY_WITH_AI.md)を参照してください。

## 操作

盤面をタップして施設またはユニットを選択します。ユニット選択後は近傍の`Move / Attack / Wait`メニューから行動Modeを明示的に選びます。Moveでは合法な移動先、AttackではVisibilityを維持した合法対象が強調され、対象Hex近傍の`× / ✓`でキャンセルまたは確定します。Waitはその場で行動を確定します。攻撃後の移動や、行動済みユニットの再行動はできません。

画面下部の情報パネルは次の3状態です。上部の供給範囲ボタンは常時利用でき、施設・検問所・建設/移設の確認時には自動表示されます。

- 折りたたみ: 選択対象と最重要情報だけを表示
- 標準: 要約、資源収支、主要Actionを表示
- 展開: 労働者、駐留部隊、感染推移、詳細Actionを表示

パネルのハンドルまたはヘッダーをタップ/ドラッグして切り替えます。本文スクロールと盤面パンを分離し、タッチ対象は原則44 CSS px以上を確保します。ターン終了前には、スライダーと数値入力による生産施設の労働者配置、都市間移住、検問所方針、都市での編成予約を調整できます。人口は所在地のないプールへ退避できず、施設から撤収した労働者は安全な都市へ原子的に帰還します。道路方面ごとの到着予定は検問所がない場合も表示され、到着人数の将来実値は表示せず範囲だけを示します。

## 目的と敗北条件

Turn 30にHorde Zombie 7体とNormal Zombie 5体からなる12体のFinal Hordeが発生し、ゲームはTurn 31以降も勝敗まで続きます。Final Spawn Group全12体の全滅、現在のSupply Network内Zombie 0、同範囲内感染者0の3条件をすべて満たした瞬間に勝利します。次のいずれかが成立した時点で即敗北です。

1. 州都が陥落する
2. 所有中の州都・地方都市・生産施設にいる健全民間人口の合計が0になる

検問所の3健常者プール、施設内感染者、ユニット人口は健全民間人口0の判定には数えません。都市はソフトキャップを超えて受け入れられますが、民需品生産はソフトキャップで止まり、食料・民需品の追加消費が発生します。Periodic HordeはTurn 5～25に5ターンごと、`2/0、3/1、4/2、5/3、6/4`（Horde／Normal）で出現します。Horde ZombieはHP 20、Normal ZombieはHP 10です。

## ConfigとSeed

新規ゲーム開始時に使用した `GameConfig` の完全なコピーを `GameState` に保存します。途中再開したゲームへ、後から変更したオプションを適用しません。

基盤の既定値は `src/core/config.ts` の `DEFAULT_CONFIG` です。`createDefaultConfig()` はネストした設定を複製してから上書きするため、既定値を共有して変更しません。主な変更項目は次のとおりです。

- `finalHordeTurn`
- `terrain` / `vision`
- `checkpoint.maxPreparedPostsPerDirection` / `noise`
- `horde.cycle` / `periodicInitial` / `periodicIncrement` / `finalComposition`
- 避難民の到着間隔・人数・審査枠
- ユニット性能、施設の労働者上限、生産式
- 感染、鎮圧、検問所建設、人口・資源消費

ゲームルール内では `Math.random()` を使いません。`SeededRng` のスナップショット（Seed、状態、呼出回数、アルゴリズム）もJSON化し、同じVersion・Build・Config・Map・Seed・Action列から同じ結果を得られるようにします。App/Release Versionは `1.4.1`、Game Rules / GameState / Configは `2.1.0`、Fixed Mapは `fixed-31x31-v1`、Agent / Observation / Browser Bridge APIは `3.0.0`、Artifact Schemaは `2.1.0`、Checkpoint Schemaは`1.0.0`、Balanced Agentは`4.1.0`、Random Agentは`2.1.0`です。

## CoreとHeadless API

Phaser/UIは表示と入力に限定し、状態変更は `GameAction` を `GameEngine` へ渡す経路だけで行います。CoreはDOM、描画、音響へ依存しません。

概念的なHeadless契約は次のとおりです。

```ts
interface HeadlessGame {
  reset(seed: number, config: GameConfig): Readonly<GameState>;
  getState(): Readonly<GameState>;
  getLegalActions(): GameAction[];
  getCheckpointPositionCandidates(): CheckpointPositionCandidate[];
  getConstructibleFacilityPositionCandidates(type: ConstructibleFacilityType): ConstructibleFacilityPositionCandidate[];
  step(action: GameAction): StepResult;
  isGameOver(): boolean;
  getResult(): GameResult | null;
}
```

UIとRandom Test Agentは同じ `GameAction`、合法手検証、`GameEngine` を使用します。不正ActionやGame Over後の `step` は状態を変更せず、理由付きエラーを返します。`GameState` は `Map`、`Set`、`Date`、関数を含まないJSON互換データです。

## 保存と復元

確定したActionまたはターン終了時にローカル領域へ自動保存します。タイトル画面から続きのゲームを読み込めます。セーブコードはVersion、Config、Map ID、Seed、完全なGameState、チェックサムを含むJSONをgzip圧縮し、Base64URLへ変換します。同じ内容をJSONファイルとしても書き出し/読み込みできます。Version不一致、破損、不正Config、不変条件違反のデータは現在状態へ適用しません。App/Release `1.4.1`、Game Rules / State / Config `2.1.0`、Save Format `6`を使用します。Save 6はUnitごとの`currentMilitaryGoods`／`maxMilitaryGoods`と関連Configを検証し、Emergency Movement可否は保存せずFuelとConfigから再導出します。v1.4.0以前の保存データ、Replay、Artifactは変換せず、現在状態を変更しないまま理由付きで拒否します。旧データを自動変換・削除・上書きしません。

## テスト

```bash
npm run typecheck
npm test
npx --no-install vite-node --script src/agent/sim-cli.ts --agent=random --games=100 --seed=1 --summary-only --out=output/simulations/random-smoke --overwrite
npx --no-install vite-node --script src/agent/sim-cli.ts --agent=balanced --games=100 --seed=1 --summary-only --out=output/simulations/balanced-smoke --overwrite
npx --no-install vite-node --script src/agent/sim-cli.ts --agent=balanced --games=300 --seed=1 --summary-only --out=output/simulations/v1.4.1-balanced-300 --overwrite
npm run build
npm run test:browser-bridge
```

Coreテストでは、移動・戦闘、資源・電力、不足被害、感染・鎮圧・陥落・復旧、避難民、Horde、勝敗、保存往復、不変条件、Seed再現性を確認します。Random／Balancedは公開Observationと合法手だけを使う統一Runnerで実行し、失敗時にはVersion、Config、Map ID、Seed、Action列、直前Observationとデバッグ用Stateを出力します。

リリース前にはRandom／Balancedの標準Config固定Seed 1～100と、Balanced固定Seed 1～300を完遂します。さらにFuel 2水準、Simple Farm Food 2水準、Final Horde Turn 3水準の全12組合せを、Random／Balancedそれぞれ固定Seed 1～100で比較します。軍需品、Emergency Movement、Session再開のMetricsをv1.4.0または同一v1.4.1基準Runと比較し、技術的失敗、決定性違反、Replay／Checkpoint不一致、FoW漏洩を0件にします。

`test:random`と`test:balanced`は標準ConfigのSeed群を共通Batch CLIで実行します。CIでは各100ゲームに加え、Observation境界、Replay、Production Bridge smokeを検証します。

`.github/workflows/v140-release-validation.yml` はファイル名を維持したv1.4.1手動Release検証として、全24感度Batchと標準Balanced 300ゲームを実行します。Balanced検証はSeed `1..100`、`101..200`、`201..300`の3並列Jobに分け、各ReportをArtifactへ保存します。

## GitHub ActionsとPages

`.github/workflows/ci-pages.yml` はPull Request、`main`へのpush、手動実行で次を順番に行います。

1. Node.js 22をセットアップ
2. `npm ci`（lockfile固定）
3. `npm run typecheck`
4. `npm test`
5. `npx --no-install vite-node --script src/agent/sim-cli.ts --agent=random --games=100 --seed=1 --summary-only --out=output/simulations/random-smoke --overwrite`
6. `npx --no-install vite-node --script src/agent/sim-cli.ts --agent=balanced --games=100 --seed=1 --summary-only --out=output/simulations/balanced-smoke --overwrite`
7. `npm run build`
8. `npm run test:browser-bridge`
9. `main`へのpush時だけGitHub Pagesへデプロイ

Workflowは`actions/configure-pages`でPagesの有効化を要求し、相対asset URLで生成した`dist`を公開します。リポジトリ/組織ポリシーが自動有効化を拒否した場合だけ、Pages設定のSourceを「GitHub Actions」に変更してください。

## 実機確認条件と既知の問題

完成判定では、少なくとも次の環境で手動確認します。

- PC Chrome（安定版）: 新規ゲーム、Final Horde後の勝利または敗北、マウス操作、パン/ズーム、保存復元
- iPhone Safari（対応するiOSの安定版）: 縦向き、Safe Area、44pxタッチ対象、3状態パネル、スクロール競合、ページ再読込
- Android Chrome（対応するAndroidの安定版）: 縦向き、タッチ操作、パン/ピンチズーム、3状態パネル、保存復元

ブラウザの実機確認はローカルのNode/Vitestだけでは代替できません。GitHub Pagesのデプロイ後に上記環境で実施し、端末/OS/ブラウザ版と確認日時を記録します。Random Test AgentはCIで最低100ゲームを実行し、失敗時のJSONをWorkflow artifactとして保存します。

## ライセンス

ゲーム本体には現時点で公開用ライセンスを付与していません。依存ライブラリは許諾的ライセンスのみを使用し、実際の `package-lock.json` に記録された依存とライセンスは [`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES) にまとめています。
