# Nowhere Left to Hide

モバイル縦画面を基準にした、ターン制ゾンビ・ヘックス戦略ゲームのPoCです。限られた人口・部隊・物資で施設と生産力を広げながら、予告されたHordeに備えます。

公開ページ（GitHub Pages）: <https://plastichyena.github.io/nowherelefttohide/>

ブラウザAgent向けAPI説明: <https://plastichyena.github.io/nowherelefttohide/agent-api.html>

## PoCの範囲

- 固定15×15ヘックス、16施設、東西南北の道路とHorde入口
- Plain／Forest／Mountainの固定地形、重み付き移動、Urban／Forest防御、共通VisibilityとFog of War
- 州都、地方都市、農場、工場、製油所、発電所の確保・稼働・感染・陥落・復旧
- 警察・州兵の移動、迎撃、攻撃、反撃、待機、自然回復
- 食料・民需品・軍需品・燃料・電力Capacityの生産と不足処理
- 所在地を持つ都市住民・生産施設労働者、都市間移住、都市過密
- 検問所、避難民の到着・審査、waiting / screening / approved、潜伏感染
- 道路方面ごとの独立到着予定、検問所の建設・移設、remnant / ruined / abandoned状態
- 州都と稼働中検問所を起点にした供給範囲、セクター境界、供給外Actionの理由表示
- Seed付き乱数によるゾンビAI、避難民、感染、Hordeの再現
- 自動保存、セーブコード、JSON保存・復元
- 日本語（デフォルト）/英語切り替え、初回ガイド、常設ヘルプ、終了統計
- ブラウザJavaScriptから利用できる、通常UI・保存領域と分離したDeveloper / Browser Bridge
- 公開Observationだけで動くBalanced Agent、同一Seed比較、Metrics、Replay／Failure Artifactを持つBatch CLI

ゲームルールの正本は [`Doc/Nowhere Left to Hide PoC 現行仕様.md`](Doc/Nowhere%20Left%20to%20Hide%20PoC%20現行仕様.md) です。v1.3の変更要件は [`Doc/Nowhere Left to Hide PoC v1.3アップデート要件 確定版.md`](Doc/Nowhere%20Left%20to%20Hide%20PoC%20v1.3アップデート要件%20確定版.md) で確認できます。READMEや実装判断が正本と矛盾する場合は正本を優先します。

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

公開APIは `getApiInfo`、`reset`、`getObservation`、`getLegalActions`、`step`、`isGameOver`、`getResult`、`getRunArtifact` だけです。`getApiInfo()` はVersion、公開メソッド、Fair Play境界、回復・感染・射程・検問所方針・生産/電力の静的ルールを返します。`getState`、`LoadSnapshot`、保存操作、ファイル操作、ネットワークアクセス、Batch実行は公開しません。

v1.3ではHuman UIとAgentが同じVisibility関数を使います。Observationは固定Terrain、実効移動コスト、防御補正、各タイルの可視状態、自軍と現在可視なEnemy、Periodic／Final Horde警告、3つのVictory進捗を返します。Vision外のEnemy位置・個体ID・Target・Spawn座標は公開しません。経済Forecast、回復、鎮圧、補給、検問所の既存公開情報も維持します。

## Agent Simulation CLI

Random／Balancedは共通RunnerとAgentGameを使います。BalancedはGameStateを参照せず、公開Observationと合法手だけから完全に決定的なActionを選びます。

```bash
npm run sim -- --agent=balanced --games=100 --seed=1 --out=output/simulations/balanced-run
npm run sim -- --agent=random,balanced --seeds=1,2,3 --out=output/simulations/comparison
```

出力先には正本`run.json`、固定列UTF-8の`games.csv`、成功・敗北・技術的失敗を含むゲーム単位Artifactを生成します。既存の非空出力先は既定で上書きしません。上書きする場合だけ`--overwrite`を明示してください。ゲーム内敗北は正常完遂であり、技術的失敗が1件でもある場合だけExit Codeが非0になります。

## AI Portable Package

`CI and GitHub Pages`が`main`で成功すると、独立した`AI Portable Package` Workflowが同じCommitからLinux x64 ZIPを生成します。ZIPにはソース、lockfile固定済み依存、Linux x64 Node.js、`PLAY_WITH_AI.md`、Commit SHA・App Version・Node Version入り`BUILD_INFO.txt`を同梱します。展開先にNode.jsを別途インストールする必要はありません。

GitHub Actionsの`AI Portable Package`実行からArtifactをダウンロードし、展開後は次でBundled Nodeによる1ゲームSmokeを実行できます。

```bash
./run-npm.sh run sim -- --agent=random --games=1 --seed=1 --out=output/portable-smoke --overwrite
```

外部AIへ渡す主要入口と公開APIだけを使うプレイ手順は[`PLAY_WITH_AI.md`](PLAY_WITH_AI.md)を参照してください。

## 操作

盤面をタップして施設またはユニットを選択します。ユニットを選択すると合法な移動先が表示され、移動先を選ぶと経路・到達地点・最初の迎撃リスクを確認できます。確認後に移動を実行し、攻撃対象を選ぶか待機して行動を確定します。攻撃後の移動や、行動済みユニットの再行動はできません。

画面下部の情報パネルは次の3状態です。上部の供給範囲ボタンは常時利用でき、施設・検問所・建設/移設の確認時には自動表示されます。

- 折りたたみ: 選択対象と最重要情報だけを表示
- 標準: 要約、資源収支、主要Actionを表示
- 展開: 労働者、駐留部隊、感染推移、詳細Actionを表示

パネルのハンドルまたはヘッダーをタップ/ドラッグして切り替えます。本文スクロールと盤面パンを分離し、タッチ対象は原則44 CSS px以上を確保します。ターン終了前には、スライダーと数値入力による生産施設の労働者配置、都市間移住、検問所方針、都市での編成予約を調整できます。人口は所在地のないプールへ退避できず、施設から撤収した労働者は安全な都市へ原子的に帰還します。道路方面ごとの到着予定は検問所がない場合も表示され、到着人数の将来実値は表示せず範囲だけを示します。

## 目的と敗北条件

Turn 30に12体のFinal Hordeが発生し、ゲームはTurn 31以降も勝敗まで続きます。Final Horde全滅、現在のSupply Network内Zombie 0、同範囲内感染者0の3条件をすべて満たした瞬間に勝利します。次のいずれかが成立した時点で即敗北です。

1. 州都が陥落する
2. 所有中の州都・地方都市・生産施設にいる健全民間人口の合計が0になる

検問所の3健常者プール、施設内感染者、ユニット人口は健全民間人口0の判定には数えません。都市はソフトキャップを超えて受け入れられますが、民需品生産はソフトキャップで止まり、食料・民需品の追加消費が発生します。Periodic HordeはTurn 5～25に5ターンごと、Final Hordeは既定Turn 30に出現し、種類・方向・残りターンは常時表示されます。

## ConfigとSeed

新規ゲーム開始時に使用した `GameConfig` の完全なコピーを `GameState` に保存します。途中再開したゲームへ、後から変更したオプションを適用しません。

基盤の既定値は `src/core/config.ts` の `DEFAULT_CONFIG` です。`createDefaultConfig()` はネストした設定を複製してから上書きするため、既定値を共有して変更しません。主な変更項目は次のとおりです。

- `finalHordeTurn`
- `terrain` / `vision`
- `horde.cycle` / `initialCount` / `increment`
- 避難民の到着間隔・人数・審査枠
- ユニット性能、施設の労働者上限、生産式
- 感染、鎮圧、検問所建設、人口・資源消費

ゲームルール内では `Math.random()` を使いません。`SeededRng` のスナップショット（Seed、状態、呼出回数、アルゴリズム）もJSON化し、同じVersion・Config・Map・Seed・Action列から同じ結果を得られるようにします。App/Release Versionは `1.3.1`、Game Rules / GameState / Configは `1.4.0`、Fixed Mapは `fixed-15x15-v2`、Agent / Observation / Browser Bridge / Artifact Schemaは `1.4.0`です。

## CoreとHeadless API

Phaser/UIは表示と入力に限定し、状態変更は `GameAction` を `GameEngine` へ渡す経路だけで行います。CoreはDOM、描画、音響へ依存しません。

概念的なHeadless契約は次のとおりです。

```ts
interface HeadlessGame {
  reset(seed: number, config: GameConfig): Readonly<GameState>;
  getState(): Readonly<GameState>;
  getLegalActions(): GameAction[];
  step(action: GameAction): StepResult;
  isGameOver(): boolean;
  getResult(): GameResult | null;
}
```

UIとRandom Test Agentは同じ `GameAction`、合法手検証、`GameEngine` を使用します。不正ActionやGame Over後の `step` は状態を変更せず、理由付きエラーを返します。`GameState` は `Map`、`Set`、`Date`、関数を含まないJSON互換データです。

## 保存と復元

確定したActionまたはターン終了時にローカル領域へ自動保存します。タイトル画面から続きのゲームを読み込めます。セーブコードはVersion、Config、Map ID、Seed、完全なGameState、チェックサムを含むJSONをgzip圧縮し、Base64URLへ変換します。同じ内容をJSONファイルとしても書き出し/読み込みできます。Version不一致、破損、不変条件違反のデータは現在状態へ適用しません。App/Release `1.3.1`、Game Rules / State / Config `1.4.0`、Save Format `3`を使用します。v1.2.7以前の保存データ、Replay、Artifactは移行せず、現在状態を変更しないまま理由付きで拒否します。旧データを自動変換・削除・上書きしません。

## テスト

```bash
npm run typecheck
npm test
npm run test:random -- --games=100
npm run test:balanced -- --games=100
npm run sim -- --agent=balanced --games=100 --seed=1 --out=output/simulations/v1.3-balanced-300-part-1
npm run sim -- --agent=balanced --games=100 --seed=101 --out=output/simulations/v1.3-balanced-300-part-2
npm run sim -- --agent=balanced --games=100 --seed=201 --out=output/simulations/v1.3-balanced-300-part-3
npm run build
npm run test:browser-bridge -- --dist=dist
```

Coreテストでは、移動・戦闘、資源・電力、不足被害、感染・鎮圧・陥落・復旧、避難民、Horde、勝敗、保存往復、不変条件、Seed再現性を確認します。Random／Balancedは公開Observationと合法手だけを使う統一Runnerで実行し、失敗時にはVersion、Config、Map ID、Seed、Action列、直前Observationとデバッグ用Stateを出力します。

リリース前300 Seedは完全なReplay／Failure Artifactを保持するため、Node.jsの既定ヒープ内で安定して実行できる100ゲーム単位に分割します。3実行は連続した固定Seed 1～300を網羅します。

`test:random`と`test:balanced`は標準ConfigのSeed群を共通Batch CLIで実行します。CIでは各100ゲームに加え、Observation境界、Replay、Production Bridge smokeを検証します。

## GitHub ActionsとPages

`.github/workflows/ci-pages.yml` はPull Request、`main`へのpush、手動実行で次を順番に行います。

1. Node.js 22をセットアップ
2. `npm ci`（lockfile固定）
3. `npm run typecheck`
4. `npm test`
5. `npm run test:random -- --games=100`
6. `npm run test:balanced -- --games=100`
7. `npm run build`
8. `npm run test:browser-bridge -- --dist=dist`
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
