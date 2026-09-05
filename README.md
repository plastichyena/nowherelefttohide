# Nowhere Left to Hide

v1.5.2は、同一Revisionの読み取りQuery共有、盤面Object再利用、人間側のターン終了時保存と明示的な手動保存、AI Portableの`play-turn`、AI向け生産余力を追加します。ゲームルール・バランスと通常Save 11を維持します。

PC Chromeでの比較証跡は[`v152-performance-evidence.json`](src/testing/fixtures/v152-performance-evidence.json)、AI CLIは[`play-turn-performance-evidence.json`](src/session/play-turn-performance-evidence.json)に記録しています。390×844の同一Saveで、序盤の選択中央値は849→85ms、Turn 51の移動先確認は4,146→133ms、ターン終了操作全体は6,881→972msでした。Core単体のTurn 51は683→372msで、旧新版144回のStepResult hashが一致しています。ブラウザ値には自動操作と描画待ちが含まれ、SOG05の実測値ではありません。パン・ピンチ・人口スライダーは概ね横ばいで、選択・プレビュー・確定・資源／シート表示が主に改善しました。

AI CLIの同一30手は起動30→10回、約92→49秒でした。一方、10ターン比較のpeak exit RSSは旧経路144.6MBに対して対話156.9MB／有限計画174.9MBでした。観測範囲では大きなターン間累積増加はありませんが、ピーク削減や他アプリとの併用時のメモリ不足解消を保証しません。入力・出力・履歴保持の上限と測定条件は証跡を参照してください。

再現用Core比較は`npx vite-node --script src/testing/v152-core-validation.ts --baseline=<v1.5.1 checkout>`で検証済みの序盤・Turn 20／50／51 fixtureを生成します。`v152-agent-comparison.ts`、`v152-endturn-benchmark.ts`は同じfixtureを再利用します。`v152-capacity-benchmark.ts`は追加APIの算定時間・応答bytesを測ります。`python scripts/prepare-browser-fixtures.py`はPlaywright CLI用の式を生成します。隔離したテストブラウザを使ってください（そのプロファイルの共通保存枠をfixtureで置換します）。`scripts/browser-supplement-performance.js`は人口スライダーと到達したTurn 4の攻撃確認用です。

モバイル縦画面を基準にした、ターン制ゾンビ・ヘックス戦略ゲームのPoCです。限られた人口・部隊・物資で施設と生産力を広げながら、予告されたHordeに備えます。

公開ページ（GitHub Pages）: <https://plastichyena.github.io/nowherelefttohide/>

ブラウザAgent向けAPI説明: <https://plastichyena.github.io/nowherelefttohide/agent-api.html>

## PoCの範囲

- 固定51×51ヘックス、29恒久施設、東西南北の道路支線とHorde入口、外周200 HexのHorde Spawn Reserve
- Plain／Forest／Mountainの固定地形、重み付き移動、Urban／Forest防御、共通VisibilityとFog of War
- 州都、地方都市、農場、工場、製油所、発電所の確保・稼働・感染・陥落・復旧
- Police Movement 15／National Guard Movement 10／Riot Police Movement 10、機種別Fuel、Fuel 0 Emergency Movement、Unit別携行軍需品、補給、迎撃、攻撃、反撃、待機、自然回復
- 食料・民需品・軍需品・燃料・電力Capacityの生産と不足処理
- Fuel不要のWind Power Plant、Supply内に建設できるSimple Farm／Civilian Drone Base
- Fuel／電力、Single Point of Failure、確定経済敗北、Checkpoint供給効果、Queue PressureのForecast
- 所在地を持つ都市住民・生産施設労働者、都市間移住、都市過密
- 検問所、避難民の到着・審査・Turn Away、waiting / screening / approved、潜伏感染、拒絶由来Horde増援
- 道路方面ごとの独立到着予定、複数Checkpoint Post、Active / Standby / Dormant、Automatic Fallback
- 州都と稼働中検問所を起点にした供給範囲、セクター境界、供給外Actionの理由表示
- Seed付き乱数によるゾンビAI、避難民、感染、Hordeの再現
- 戦闘地点・Horde移動地点から通常系Zombieを誘引する共通Noise Pulseと、Horde／人口Targetとの優先順位
- Recruit／Regular／Veteran熟練度、Attack Charge、Riot Police／Riot Zombie、特殊Zombie混成を含む固定Multi-direction Wave（Turn 5 / 10 / 20 / 35 / 50）
- 公開ObservationのCrisis Summary／EndTurn Risk、AI Portable Session応答のState Delta
- Core生成の全道路Checkpoint候補と、Human／Agent共通の利用不能理由
- 自動保存、セーブコード、JSON保存・復元
- 日本語（デフォルト）/英語切り替え、初回ガイド、常設ヘルプ、終了統計
- ブラウザJavaScriptから利用できる、通常UI・保存領域と分離したDeveloper / Browser Bridge
- 公開Observationだけで動くBalanced Agent、同一Seed比較、Metrics、Replay／Failure Artifactを持つBatch CLI
- 1 Turnを同じNodeプロセスで対話できる`play-turn`、互換用の既存8コマンド、Active Session、Public Decision Log、履歴Checkpoint、分岐Session、Compact応答と詳細query

ゲームルールの正本は [`Doc/Nowhere Left to Hide PoC 現行仕様.md`](Doc/Nowhere%20Left%20to%20Hide%20PoC%20現行仕様.md) です。直近の反映済み要件は [`Doc/Nowhere Left to Hide PoC v1.5.2 アップデート要件 確定版.md`](Doc/Nowhere%20Left%20to%20Hide%20PoC%20v1.5.2%20アップデート要件%20確定版.md) です。現行仕様はv1.5.2です。長時間のGitHub検証Jobは起動確認までとし、結果未確認のJobを成功済みとは扱いません。READMEや変更記録が正本と矛盾する場合は現行仕様を優先します。

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

公開APIは `getApiInfo`、`reset`、`getObservation`、`getLegalActions`、`step`、`isGameOver`、`getResult`、`getRunArtifact`、`getArtifactPage` です。`getApiInfo()` はVersion、公開メソッド、Fair Play境界、回復・感染・射程・検問所方針・Checkpoint候補Schema／Reason Code・生産/電力の静的ルールを返します。`getRunArtifact()` は既存の完全互換の公開Artifactを返します。大きな履歴は読み取り専用の `getArtifactPage({ target, offset?, pageSize?, expectedRevision? })` で、`manifest`、`observations`、`actions`、`events`、`invalid-attempts`を既定100件・最大500件ずつ取得できます。応答はRevision、件数、総数、続き、次Offset、item列を含み、State変更後の古いRevisionは状態不変で拒否します。`getState`、`LoadSnapshot`、保存操作、ファイル操作、ネットワークアクセス、Batch実行は公開しません。

v1.5.2ではHuman UIとAgentが同じCore Visibility／Crisis Summary／EndTurn Riskを使い、Checkpointの新設・移設には対象地点と州都側からの幹線道路全区間の現在視界が必要です。Hidden Zombieは候補や実行を妨害せず、可視Zombieだけが妨害理由になります。Ground VisionはForest／Mountainで遮蔽され、Civilian Drone BaseのAerial Visionは遮蔽を無視します。ObservationはGround／Aerial種別と最新50件の重要Site Eventを返します。初期Normal Zombie 25体に加え、Seedで決まるHunter Zombie 1～4体が州都から20 Hex以上離れて出現します。Police Zombie／Soldier Zombie／Riot Zombie／Hunter Zombieを含む敵は可視時だけ公開します。Checkpointの拒絶Counterと将来Horde増援数は非公開であり、Turn Awayの定性的なTrade-offだけを公開します。Police／Riot Policeは`medium`、National Guardは`large`、Horde movementは公開ルールとしてRadius 8を使用します。Human Unitの熟練度、Attack Charge、Hordeの非Horde slot数と抽選候補も公開Observationへ含まれますが、未確定の抽選結果、Hidden Enemyの反応数・ID・Target・非可視Spawn位置は公開しません。

## Agent Simulation CLI

Random／Balancedは共通RunnerとAgentGameを使います。BalancedはGameStateを参照せず、公開Observationと合法手だけから完全に決定的なActionを選びます。

```bash
npx --no-install vite-node --script src/agent/sim-cli.ts --agent=balanced --games=100 --seed=1 --summary-only --out=output/simulations/balanced-run
npx --no-install vite-node --script src/agent/sim-cli.ts --agent=random,balanced --seeds=1,2,3 --summary-only --out=output/simulations/comparison
```

出力先には正本`run.json`、固定列UTF-8の`games.csv`を生成します。既定では成功・敗北・技術的失敗を含むゲーム単位Artifactも生成し、ローカル／CIの完全Artifactだけは`verificationEvents`へMixed Hordeの内部Group・Type別生成数・Unit所属を保持してReplayで内部Event列まで照合します。100ゲーム以上の集計検証では`--summary-only`により指標・成否・比較を`run.json`／`games.csv`へ残しつつ、巨大な完全Replayだけを省略できます。Browser Bridgeの`getRunArtifact()`には内部情報を含めません。既存の非空出力先は既定で上書きしません。上書きする場合だけ`--overwrite`を明示してください。ゲーム内敗北は正常完遂であり、技術的失敗が1件でもある場合だけExit Codeが非0になります。

## AI Session CLI

Session CLIは、外部AIが同じゲームを安全に続けるための永続入口です。通常は`play-turn`を1 Turnにつき1回起動し、行単位JSONで結果を読んでから次のActionを決めます。対話接続を保持できない環境では、有限のAction計画を同じ入口へ渡せます。途中の新しい敵、移動中断、想定外の損害、危機の発生・悪化、拒否、Game Overでは残りを停止して再判断します。通常のSave Format 11とは分離したSessionディレクトリに、Actionごとに更新するActive状態、圧縮・分割された損失なしの公開履歴、既定5完了Turnごとの履歴Checkpointを保存します。Compact応答と`query`は公開情報だけを返し、Private Checkpoint内の完全GameState、RNG、Rejected CounterなどのHidden情報は再開専用です。

ローカルリポジトリでは次のように実行します。

```bash
npx --no-install vite-node --script src/session/session-cli.ts new --session-id=my-game --seed=1
npx --no-install vite-node --script src/session/session-cli.ts status --session=my-game
printf '%s\n' '{"action":{"type":"EndTurn"},"decisionSummary":"No higher-priority legal action remains.","expectedRevision":0}' | npx --no-install vite-node --script src/session/session-cli.ts step --session=my-game
npx --no-install vite-node --script src/session/session-cli.ts save-checkpoint --session=my-game
npx --no-install vite-node --script src/session/session-cli.ts list-checkpoints --session=my-game
npx --no-install vite-node --script src/session/session-cli.ts load-checkpoint --session=my-game --checkpoint=PASTE_RETURNED_CHECKPOINT_ID --new-session-id=my-branch
npx --no-install vite-node --script src/session/session-cli.ts query --session=my-branch --target=legal-actions --page-size=100
npx --no-install vite-node --script src/session/session-cli.ts artifact --session=my-branch --out=my-branch.nlth-artifact
```

`play-turn`が標準入口で、`new`、`status`、`step`、`save-checkpoint`、`list-checkpoints`、`load-checkpoint`、`query`、`artifact`の8コマンドは互換・復旧用に維持します。`status`が同じSession IDのActive復帰入口で、`load-checkpoint`は親を巻き戻さず必ず別IDの分岐Sessionを作ります。`step`はJSONの`action`と1～500文字の公開`decisionSummary`を必須とし、任意の`expectedRevision`が不一致ならAction適用・Decision採番前に`stale_revision`で拒否します。不正Actionも状態とRNGを変えず理由付きDecisionとして記録します。`query`はRevisionに結び付き、標準100件・最大500件のPageで`api`、`map`、`units`、`facilities`、`checkpoints`、`branches`、`construction`、`legal-actions`、`forecast`、`history`、`full-snapshot`を取得します。`artifact --out`は巨大な本文ではなく小さなManifestを標準出力へ返し、自己完結したPublic Artifact Packageディレクトリを指定先へ出力します。破損時は暗黙に巻き戻さず、Checkpoint一覧から明示的に分岐復旧します。入力schemaと再送・停止条件は[`PLAY_WITH_AI.md`](PLAY_WITH_AI.md)を参照してください。

## AI Portable Package

`CI and GitHub Pages`が`main`で成功すると、独立した`AI Portable Package` Workflowが同じCommitからLinux x64とWindows x64のZIPを生成します。ZIPにはソース、lockfile固定済み依存、対象OSのNode.js、事前bundle済みSession CLI、`PLAY_WITH_AI.md`、Commit SHA・Build ID・App Version・Node Version入り`BUILD_INFO.txt`を同梱します。展開先にNode.jsを別途インストールする必要はありません。

GitHub Actionsの`AI Portable Package`実行からArtifactをダウンロードし、展開後は次でBundled Nodeによる永続Sessionを開始できます。

```bash
# Linux
./run-session.sh new --session-id=my-game --seed=1
./run-session.sh play-turn --session=my-game

# Windows PowerShell
.\run-session.cmd new --session-id=my-game --seed=1
.\run-session.cmd play-turn --session=my-game
```

`run-session.sh`と`run-session.cmd`は事前bundle済みESMをBundled Nodeで直接実行し、ActionごとにViteやTypeScript変換を起動しません。WorkflowはBundled Nodeだけで`play-turn`と既存8つのSessionコマンド、Artifact Package、Built-in Agent 1ゲーム、公開Observation／Legal Actionsだけを使う外部AI相当DriverのSeed 1・7 Game Over・Action列再実行・公開Artifact一致をSmoke Testします。外部AIへ渡す主要入口、Active復帰、Decision Log、Checkpoint分岐と公開APIだけを使うプレイ手順は[`PLAY_WITH_AI.md`](PLAY_WITH_AI.md)を参照してください。

## 操作

盤面をタップして施設またはユニットを選択します。ユニット選択後は近傍の`Move / Attack / Wait`メニューから行動Modeを明示的に選びます。Moveでは合法な移動先、AttackではVisibilityを維持した合法対象が強調され、対象Hex近傍の`× / ✓`でキャンセルまたは確定します。Waitはその場で行動を確定します。攻撃後の移動や、行動済みユニットの再行動はできません。

画面下部の情報パネルは次の3状態です。上部の供給範囲ボタンは常時利用でき、施設・検問所・建設/移設の確認時には自動表示されます。

- 折りたたみ: 選択対象と最重要情報だけを表示
- 標準: 要約、資源収支、主要Actionを表示
- 展開: 労働者、駐留部隊、感染推移、詳細Actionを表示

パネルのハンドルまたはヘッダーをタップ/ドラッグして切り替えます。本文スクロールと盤面パンを分離し、タッチ対象は原則44 CSS px以上を確保します。ターン終了前には、スライダーと数値入力による生産施設の労働者配置、都市間移住、検問所方針、都市での編成予約を調整できます。人口は所在地のないプールへ退避できず、施設から撤収した労働者は安全な都市へ原子的に帰還します。道路方面ごとの到着予定は検問所がない場合も表示され、到着人数の将来実値は表示せず範囲だけを示します。

## 目的と敗北条件

Turn 50に4方向からHorde Zombie 20体と非Horde slot 32体の合計52 slotからなるFinal Hordeが発生し、各非Horde slotはSpawn時にNormal／Police／Soldier／Riot／Hunter Zombieのいずれかへ決定されます。ゲームはTurn 51以降も勝敗まで続きます。Final Spawn Group全52体の全滅、現在のSupply Network内Zombie 0、同範囲内感染者0の3条件をすべて達成した瞬間に勝利します。次のいずれかが成立した時点で即敗北です。

1. 州都が陥落する
2. 所有中の州都・地方都市・生産施設にいる健全民間人口の合計が0になる

検問所の3健常者プール、施設内感染者、ユニット人口は健全民間人口0の判定には数えません。都市はソフトキャップを超えて受け入れられますが、民需品生産はソフトキャップで止まり、食料・民需品の追加消費が発生します。Warning Leadは2 Turnです。標準WaveはTurn 5（1方向・3 Horde＋3 slot）、Turn 10（2方向・2＋5）、Turn 20（1方向・5＋7）、Turn 35（3方向・3＋7）、Turn 50（4方向・5＋8 Final）で出現します（各CompositionはHorde／非Horde slot）。標準Scheduleの合計はHorde 41、非Horde slot 73、Total 114です。各slotの実TypeはSpawn時に決まり、Horde ZombieはHP 40かつ2 Attack Charge、Normal ZombieはHP 15です。Riot／Hunterは各方向・Waveでそれぞれ最大1体です。ゲームルール上のTurn上限はありません。

## ConfigとSeed

新規ゲーム開始時に使用した `GameConfig` の完全なコピーを `GameState` に保存します。途中再開したゲームへ、後から変更したオプションを適用しません。

基盤の既定値は `src/core/config.ts` の `DEFAULT_CONFIG` です。`createDefaultConfig()` はネストした設定を複製してから上書きするため、既定値を共有して変更しません。主な変更項目は次のとおりです。

- `horde.warningLeadTurns` / `horde.waves`（Final Turnは`final: true` Waveから導出）
- `terrain` / `vision`
- `checkpoint.maxPreparedPostsPerDirection` / `noise`
- `facilities.*.production.powerMode`（`required`または`none`）とWaveの方向別Composition
- 避難民の到着間隔・人数・審査枠
- ユニット性能、施設の労働者上限、生産式
- 感染、鎮圧、検問所建設、人口・資源消費

ゲームルール内では `Math.random()` を使いません。`SeededRng` のスナップショット（Seed、状態、呼出回数、アルゴリズム）もJSON化し、同じVersion・Build・Config・Map・Seed・Action列から同じ結果を得られるようにします。App/Release Versionは `1.5.2`、Game Rules / GameState / Configは `4.0.0`、Fixed Mapは `fixed-51x51-v1`、Agent / Observation / Browser Bridge APIは `9.0.0`、Artifact Schemaは `8.0.0`、Checkpoint／Session Schemaは`5.0.0`、Balanced Agentは`5.0.0`、Random Agentは`3.0.0`です。v1.5.1以前のAI Session、Checkpoint、Artifact、Replayは変換せず拒否し、通常Save Format 11は復元・継続します。

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

新規ゲーム、正常なEndTurnで次の自ターンへ進んだ状態、またはGame Overの確定状態をローカル領域へ自動保存します。ターン途中を残すときは手動保存を使い、どちらも同じ1枠の最後に成功した保存を更新します。タイトル画面から続きのゲームを読み込めます。App／Release `1.5.2`、Game Rules／State／Config `4.0.0`、Save Format `11`を使用します。Save 11はFixed Map 51×51、Seed付き初期Normal／Hunter Zombie、熟練度／Attack Charge、Rejected Counter、Police／Soldier／Riot／Hunter Zombie、Checkpoint初回Build履歴、PRNG、Config完全コピーを検証し、導出値は復元時に再計算します。v1.5.1の通常Save 11（自動保存、セーブコード、JSON保存）は復元・継続します。v1.5.0以前の通常Save、v1.5.1以前のAI Replay／Artifact／Session／Checkpointは変換せず、現在状態と元データを変更しないままVersion不一致として拒否します。

## テスト

```bash
npm run typecheck
npm test
npx --no-install vite-node --script src/agent/sim-cli.ts --agent=random --games=100 --seed=1 --summary-only --out=output/simulations/random-smoke --overwrite
npx --no-install vite-node --script src/agent/sim-cli.ts --agent=balanced --games=100 --seed=1 --summary-only --out=output/simulations/balanced-smoke --overwrite
npx --no-install vite-node --script src/agent/sim-cli.ts --agent=balanced --games=100 --seed=1 --max-turns=100 --summary-only --out=output/simulations/v1.5.2-balanced-100 --overwrite
npx --no-install vite-node --script src/testing/session-release-validation.ts --decisions=1000 --json-out=output/session-release/normal-1000.json
npm run build
npm run test:browser-bridge
```

Coreテストでは、移動・戦闘、資源・電力、不足被害、感染・鎮圧・陥落・復旧、避難民、Horde、勝敗、保存往復、不変条件、Seed再現性を確認します。Random／Balancedは公開Observationと合法手だけを使う統一Runnerで実行し、失敗時にはVersion、Config、Map ID、Seed、Action列、直前Observationとデバッグ用Stateを出力します。

リリース前にはv1.5.1基準commit `e98f1f57f2c1747588d8840d32bf623bbd625dca`とv1.5.2を各版の正しいConfigで比較し、Random／Balancedをそれぞれ固定Seed 1～100、Runner上限100 Turnで実行します。ゲーム規則の出力はVersion metadataを除いて一致し、技術的失敗、決定性違反、Replay／Checkpoint不一致、FoW漏洩を0件にします。Sessionは実Coreの51×51・Human Unit 21体を使い、1,000件の受理Action、Compact／旧full比率、保存容量、RSS、status p50/p95、I/O、Page query、分岐復帰、Artifact read/replayを検証します。長履歴と同一現在状態のゼロ履歴を別fresh processで比較し、履歴Decision数、展開済み履歴bytes、RSS／peak RSSの差分と比率をReportへ残します。この比較には固定MBの合格値を設けず、単一の比較Reportが成功してもRAM改善または有界な増加を証明したとは扱いません。専用Release jobは有効な完全Snapshot履歴とArtifact Packageの実体が512 MiBを超えることも確認します。時間のかかるRelease Workflowは実装とJob dispatchの確認を行い、全Jobの完了待ちは不要です。

`test:random`と`test:balanced`は標準ConfigのSeed群を共通Batch CLIで実行します。通常CIはUnit／Invariant、Observation境界、Replay、Production Bridge smokeに加え、独立したBalanced Seed `1..30` jobと、Pagesを待たせないSession 1,000 Action jobを検証します。v1.5.1基準commitとの100 Seed比較とSession 512 MiB Package境界は手動Release検証へ分離します。

`.github/workflows/v140-release-validation.yml` はファイル名を維持したv1.5.2手動Release検証です。v1.5.1基準commit `e98f1f57f2c1747588d8840d32bf623bbd625dca`とv1.5.2のRandom／Balanced各100ゲームを、同じ100 Turn上限で比較し、比較可能なJSON／CSV ReportとVersion metadataを除く決定性比較ReportをArtifactへ保存します。Sessionの512 MiB Package境界も専用JobでReportを保存します。長時間BatchはPages公開を待たせず、手動Workflowの起動とJob開始を確認すればよいものとします。

## GitHub ActionsとPages

`.github/workflows/ci-pages.yml` はPull Request、`main`へのpush、手動実行で次を順番に行います。

1. Node.js 22をセットアップ
2. `npm ci`（lockfile固定）
3. `npm run typecheck`
4. 長時間Batchを除くUnit／Invariant Test
5. `npm run build`
6. `npm run test:browser-bridge`
7. `main`へのpush時だけGitHub Pagesへデプロイ

Workflowは`actions/configure-pages`でPagesの有効化を要求し、相対asset URLで生成した`dist`を公開します。リポジトリ/組織ポリシーが自動有効化を拒否した場合だけ、Pages設定のSourceを「GitHub Actions」に変更してください。

Pages公開後は実ブラウザでゲームURLを開き、`window.NLTH`をSeed 1でGame Overまで実行します。`appVersion` 1.5.2、Game Rules 4.0.0、各9.0.0 API、Artifact 8.0.0、51×51 Map、Checkpoint偵察ゲート、Ground／Aerial Vision、Crisis Summary／EndTurn Risk、生産余力、熟練度／Attack Charge、Riot／Hunter Unit、混成HordeのWarning公開境界、Turn Awayの公開境界、重要Site Event、`verificationEvents`とHidden Spawn／Rejected Counter情報の非公開、Action列Replay一致を確認します。勝利は合格条件ではありません。

## 実機確認条件と既知の問題

完成判定では、少なくとも次の環境で手動確認します。

- PC Chrome（安定版）: 新規ゲーム、Final Horde後の勝利または敗北、マウス操作、パン/ズーム、保存復元
- iPhone Safari（対応するiOSの安定版）: 縦向き、Safe Area、44pxタッチ対象、3状態パネル、スクロール競合、ページ再読込
- Android Chrome（対応するAndroidの安定版）: 縦向き、タッチ操作、パン/ピンチズーム、3状態パネル、保存復元

ブラウザの実機確認はローカルのNode/Vitestだけでは代替できません。GitHub Pagesのデプロイ後に上記環境で実施し、端末/OS/ブラウザ版と確認日時を記録します。Random Test AgentはCIで最低100ゲームを実行し、失敗時のJSONをWorkflow artifactとして保存します。

## Design influences

Nowhere Left to Hide は個人によって独立に開発されているゲームプロジェクトです。ゲームデザイン上、ターン制ヘックス戦略ゲーム、特に「大戦略」シリーズ、および `They Are Billions` に代表されるHorde-survivalのダイナミクスから影響を受けています。

これらは設計上の影響元であり、本リポジトリにはそれらのゲームのコード、アート、文章その他の素材を含めていません。また、本プロジェクトはそれらの開発元・権利者と提携、後援、承認関係にありません。第三者のゲーム名その他の名称に関する権利は、それぞれの権利者に帰属します。

## ライセンス

本プロジェクトは **source-available** です。利用条件に制限があるため、OSIの定義によるオープンソースとしては提供していません。

- **ソフトウェア本体**: [`LICENSE`](LICENSE) の PolyForm Noncommercial License 1.0.0 を基本条件とします。
- **追加許諾**: [`ADDITIONAL_PERMISSIONS.md`](ADDITIONAL_PERMISSIONS.md) により、人間・AI/LLMによるプレイ、収益化された動画・配信、営利企業を含む研究、AI評価、有料ベンチマーク等を明示的に許可します。
- **禁止する商品化**: ゲームそのもの、または派生ゲームそのものを販売・有料配布したり、ゲームを遊ぶこと自体を主目的とする有料アクセスを提供したりすることは許可していません。
- **画像素材**: 対象となる人間向けUI・盤面・アイコン画像は生成AIを用いて作成しています。対象範囲、来歴、CC BY-NC 4.0による非商用再利用条件、および実況・研究・ベンチマーク向けの商用例外は [`ASSETS_LICENSE.md`](ASSETS_LICENSE.md) を参照してください。
- **第三者依存物**: 実際の `package-lock.json` に記録された依存と各ライセンスは [`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES) にまとめています。

要約すると、**このゲームを使って遊ぶ・研究する・評価する・動画やサービスを作って収益を得ることは広く許可し、ゲームまたは派生ゲームそのものを商品として再販売することは許可しない**、という方針です。詳細条件は上記各ライセンス文書を優先してください。
