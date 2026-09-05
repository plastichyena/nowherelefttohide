# Nowhere Left to Hide PoC v1.5.2 アップデート要件 確定版

- 作成日・確定日: 2026-09-05
- 状態: 実装・ローカル自動テスト・PCブラウザ確認を完了し、現行仕様へ反映。GitHub PagesとAI PortableはRelease時に公開先・配布物を確認する。SOG05は公開後にユーザーが確認する。
- 対象Release: `1.5.2`
- 確定方法: 本タスクでの一問一答8件と、その前の合意を反映。
- 基準: v1.5.1、調査commit `e98f1f57f2c1747588d8840d32bf623bbd625dca`
- 正本: [PoC 現行仕様](Nowhere%20Left%20to%20Hide%20PoC%20現行仕様.md)。実装・検証完了までは更新しない。
- 関連: [v1.5.1確定要件](Nowhere%20Left%20to%20Hide%20PoC%20v1.5.1%20アップデート要件%20確定版.md)。今回、既存の旧仕様資料を参照・移動していない。今回作成したv1.5.2ドラフトは履歴としてDoc/archiveへ保管する。

本書はv1.5.2の実装目標である。明示した人間側の保存頻度、AI CLI・公開情報の変更以外のゲームルール・バランスはv1.5.1を維持する。技術構成はTypeScript／Phaser／Viteを継続し、別エンジンへの移行は含めない。数値の性能達成目標は設けない。要件確定は実装・検証・公開の完了を意味しない。

### 一問一答による決定事項

- 第1問・A: v1.5.1の通常セーブ（自動保存・セーブコード・JSON保存）は引き継ぐ。AIのSession／Checkpoint／Artifact／Replayはv1.5.2への移行対象外とし、AIプレイは新規開始する。旧AIデータは削除・上書きせず旧版で利用する。
- 第2問・A: AIの複数手実行は、新しい敵の発見、移動中断、想定外の損害、危機の発生・悪化等の状況変化で停止し、AIに再判断させる。残りのActionが合法でも自動続行しない。各手の保存と、明示的EndTurn／Game Overでの終了を維持する。
- 第3問・変更案採用: 人間側の毎Action自動保存を、EndTurn処理が正常完了して次の自ターンへ入った時の自動保存に変更する。任意のタイミングで手動保存できる機能を追加する。AI Sessionは引き続き各Decisionを保存する。
- 第4問・A: 人間側の自動保存と手動保存は同じ1枠を使用し、最後に成功した保存で上書きする。「続きから」はこの共通枠を読み込む。特定時点の別途保管は既存セーブコード・JSON出力を使用する。
- 第5問・A: 新しい資源生産余力は今回AI向けだけに公開する。人間側への余力表示は将来に回し、v1.5.2では追加しない。
- 第6問・A: PCで性能比較・スマホ相当のブラウザ操作・自動テストを完了して公開する。SOG05は公開後にユーザーが手動確認し、追加改善が必要なら次回更新の候補にする。実機確認待ちをv1.5.2のRelease・現行仕様反映の条件にしない。
- 第7問・A: AIへ示す設備上の生産上限には、感染・復旧中など一時的に使えない所有施設も含め、現在使えない理由を別に公開する。未確保・建設中・破壊済み施設は除外する。
- 第8問・A: 現在の画質・情報量を維持して描画を軽量化する。既存LODは維持するが、解像度や装飾を落とす軽量品質設定は追加しない。

## 1. 目的と実装範囲

1. SOG05のChromeで、序盤から発生する部隊選択、移動先選択、ターン終了、パン・ピンチズームの応答遅延を改善する。
2. 同じ状態に対する重複計算、操作と無関係な再描画、同期保存の負荷を減らす。
3. 将来の多様なユニット、戦闘効果、マップ・シナリオ追加に向け、既存ルールを保ったままCoreの責任を分ける。
4. 外部AIのCLIプレイで、毎手のプロセス起動・状態復元・履歴の重複保持を減らし、他アプリと同時利用しやすくする。
5. AIへ資源の現在生産量と既存設備の生産余力、その制約をコンパクトに公開する。

v1.5.2は性能改善を主目的とする。読み取りQueryの整理、既存ユニット定義の集約、戦闘・移動・死亡処理の限定的な抽出を拡張準備として組み合わせる。単にengine.tsを複数ファイルへ移すだけでは高速化とは認めない。

新ユニット、最低射程、範囲攻撃、死亡爆発、轢殺、航空・輸送、有限油田、ランダムマップ、新勢力のプレイ内容は将来版の対象とする。新しい仕様を仮決めしてGameStateへ未使用フィールドを加えることはしない。

## 2. 調査結果と確度

### 2.1 ユーザーから確認した環境

- SOG05、Chrome。
- 部隊選択、移動先を押した直後、ターン終了、マップの拡大縮小のすべてで応答が悪い。
- 比較的序盤から遅くなりやすい。
- Chrome／AndroidのVersion、端末温度、画面倍率、実プレイSaveとトレースは未取得。

### 2.2 PC上の補助計測

Windows、Node v22.14.0、AMD Ryzen 7 3700X。標準Config、Seed 1、Turn 1、29 Unit、29施設、Event 0件、状態JSON 466,911 bytes、合法手1,295件。Core等の関数単体を同期計測した。各関数3回warm-up後20回、Observationのみ10回。中央値は中央2値の上側、p95は昇順のnearest-rank。小標本であり、実機の遅延や改善率への換算はしない。

| 処理 | 中央値ms | p95 ms | 読み取り |
| --- | ---: | ---: | --- |
| `getLegalActions()` | 223.29 | 235.40 | 最優先の削減候補 |
| `createAgentObservation()` | 232.56 | 244.04 | UIの部分表示用に全Observationを作るコストに注意 |
| `encodeSaveCode()` | 129.73 | 141.35 | Storage書き込みを含めなくても重い |
| `previewMove()` | 28.79 | 30.93 | 合法手等と合わせた重複を確認する |
| `getState()` | 4.53 | 5.42 | 呼び出しごとに状態全体を複製 |
| `cloneState()` | 4.38 | 5.85 | 回数と後半の状態サイズが重要 |
| `getPlayerVisionCoverage()` | 0.74 | 0.92 | 初期単体では主因とまでは言えない |
| `forecastEndTurn()` | 0.12 | 0.29 | 初期単体は小さい。最優先にしない |
| `forecastFacilityProduction()` | 0.09 | 0.11 | 同上 |

初期状態からのEndTurnは、新規Engine作成を計測外にして同一条件を8回、最初の3回を除いた5回が66.18～69.02ms。序盤の1回だけの結果であり、Horde出現後のコストは未計測。

再実行用のローカル調査資料:

- `output/v152-investigation/core-benchmark.ts` と `core-benchmark.json`
- `output/v152-investigation/observation-benchmark.ts` と `observation-benchmark.json`
- 実行例: `node_modules/.bin/vite-node.cmd --script output/v152-investigation/core-benchmark.ts`

`output/`はGit管理外。上表は計画書にも保持するが、恒久的な性能回帰試験は実装工程で管理対象のfixture・スクリプトとして用意する。

### 2.3 コード上で確認した負荷候補

行番号は調査commit時点。以下は構造上の事実であり、SOG05上での寄与率は未確定。

| 対象 | 確認した構造 | 方針 |
| --- | --- | --- |
| `src/ui/controller.ts:3072` | `legalActions()`がその都度Engineの全件列挙を呼ぶ | 同じ確定状態内で共有し、対象別Queryへ移行 |
| `src/ui/controller.ts:2778,3044,3056,3217,3414,4279,4485` | HUD、選択対象、操作UI等から全Observationを生成 | 必要な公開情報だけを共通Queryから取得 |
| `src/ui/board.ts:922,984,837,1460` | `setZoom → draw → clearRenderLayers`でLayer内ImageとTextを破棄し、全Mapの描画Passで再生成 | 連続Zoomから全再構築を外し、静的LayerとObjectを保持 |
| `src/core/engine.ts:4942` | 全施設の撤去可否調査で、候補ごとに全状態をcloneして実行関数を試す | 撤去の純粋validatorを抽出し、非対象施設を早期除外 |
| `src/core/engine.ts:4552` | 多くの`validateAction`がclone後に実際のAction処理を試行 | 受理条件と実行を共通の読み取り検証に分ける |
| `src/core/state.ts:57`、`engine.ts:4817,5004` | JSON往復で複製。stepの作業用copyと外部返却copyもある | 不要な呼び出しを先に減らし、原子性と非共有を保つ |
| `src/persistence/save.ts:1167,1229` | 検証、正規化、gzip level 9、Base64生成、localStorage保存を同期実行 | 保存区間を分解計測し、圧縮設定・重複処理を改善 |
| `src/core/map.ts:527`、`path.ts` | 探索中の地形取得が配列find。探索frontierを反復sort/shift | Map索引と優先度Queueを、同距離の決定順を保って導入 |
| `src/core/visibility.ts:115`以降 | 視界源ごとにMapを走査し、呼び出しごとに集合を再構築 | 同一Query内で共有。必要なら視界半径内だけ列挙 |
| `src/core/engine.ts:2747`付近 | ゾンビの対象・隣接到達地点ごとに最短経路探索 | 後半fixtureで計測後、同じ探索条件内で再利用 |
| `src/core/supply.ts:26,89` | 補給の静的形状cacheが`map.id`をキーとする | 将来異なる生成Mapを同じIDで混同しない識別・寿命を設計 |

単体時間の単純合算を操作時間と見なさない。ブラウザではさらに入力待ち、DOM更新、Canvas/WebGL描画、GC、Storage待ちが加わる。特に拡大縮小はCoreを改善するだけでは解決しない可能性がある。

描画は既にLayerへ分かれているが、更新時にまとめてclearされるため、Layer分離だけでは再構築を避けられていない。Textのキー管理もclear時に破棄される。既存Layerを維持しながら更新条件を分ける改善が適している。

## 3. 性能改善の実装要件

### P0-1: PCでの基準値と再現操作を用意

- production buildを基準に、端末、Chrome／Android Version、commit、Seed／Save、Turn、Unit・施設・Event数、viewport、DPR、Zoom、rendererを記録する。
- 序盤の標準状態、施設・部隊が増えた中盤、Final Horde前後の保存fixtureを用意する。後半fixtureは現行Engineで到達した検証済み状態を使う。
- 各fixtureで部隊選択、Move Mode、移動先確認、移動確定、攻撃、EndTurn、パン・ピンチ、シート・資源展開、人口スライダーを測る。
- 入力受付→最初の表示反応、入力→最終表示完了、Core step、合法手／Query、描画更新、保存生成／書き込みを別計測する。処理中表示の高速化だけでAction全体が高速化したとは扱わない。
- PC Chromeで通常画面とスマホ相当viewportのCPU profile・描画・GCを調べる。改善前後は同じ条件で比較し、CPUスロットリングを使用した場合はその設定を明記する。PCの結果をSOG05の実測値として扱わない。
- 同一操作30回程度、3セッションを目安に中央値・p95と最大値を記録。初回とwarm状態、継続プレイ時を区別する。
- SOG05の確認は公開後にユーザーが手動で行う。実機への開発者接続、Release前の実機計測、ユーザーの確認待ちは必須にしない。残る問題は次回更新の候補として記録する。

### P0-2: 読み取りQueryとUI更新の重複を減らす

- GameEngineが確定した状態に対するQuery Contextを導入する。合法手、視界、補給、経済予測、公開対象情報、選択部隊の移動候補を必要時に生成・共有する。
- UI選択やAccordionの開閉でGameState、RNG、CoreのRevisionを進めない。
- ContextはEngine instanceと確定状態のRevisionに結び付ける。新規開始・Load・受理Actionで失効する。Turn番号だけをキーにしない。
- Action実行中の可変candidateへ確定状態用cacheを流用しない。移動・死亡・占有・Fallbackで途中状態が変わるため、内部処理では更新時点を限定したContextか再計算を使う。
- UIはCoreの共通Queryから表示を作り、AgentObservation全体を部分情報の取得に使わない。Agentも同じQueryを利用し、非公開情報を漏らさない。
- 最初は全合法手をRevision内で1回にするだけでもよい。次に対象部隊・施設等のQueryへ分ける。Headlessの全合法手APIは維持し、対象別結果と全件結果の一致を保証する。
- HUD、Bottom Sheet、選択Overlay、盤面のdirty状態を分け、同じイベント内の重複更新をまとめる。閉じた詳細は必要になったとき作るが、危機の見出し・主要Actionは現行仕様どおり常時表示する。

### P0-3: パン・ズームと盤面描画を軽量化

- カメラ移動とゲーム内容更新を分離する。パン・連続Zoom中は原則カメラ変換と画面上の操作位置更新だけにする。
- 地形・装飾道路・施設の静的部分、Unit・状態Marker、Fog、選択・移動先Overlayを別の更新単位にする。
- 既存Image/Textを再利用し、ゲーム状態が変わらない操作で破棄・再生成しない。LODは閾値通過時だけ更新する。
- 必要な場合は可視範囲単位の描画や地形chunkを比較する。現在の画質・表示情報と既存LODの条件を維持し、描画解像度・DPRの引下げ、文字情報や装飾の省略を高速化の手段にしない。51×51全体を巨大な単一textureへ焼く案はGPUメモリと最大texture制約を評価してから採用する。
- パン・ピンチ入力を1フレームに集約し、タップとの識別、ズーム中心、44 CSS pxの操作域、端への追随、FoWと選択整合を保つ。
- 軽量品質設定は追加しない。Workerはprofileで必要性が確認された場合に限り検討し、採用する場合も画質・情報量は維持する。

### P0-4: 保存負荷を下げ、復元の信頼性を維持

- 人間側は、EndTurnの全処理が正常にcommitされ、次の自ターン開始処理まで完了した状態を自動保存する。ターン途中の移動・攻撃・待機・内政Actionでは自動保存しない。失敗・拒否されたEndTurnでは保存しない。
- 新規ゲームの初期状態も保存する。勝利・敗北で次の自ターンへ移行しない場合は、確定した終了状態を自動保存する。いずれも処理途中の状態を保存しない。
- 人間向けに任意の時点で現在の確定状態をローカル保存する「手動保存」を追加する。既存セーブコード出力・JSON出力も維持する。処理中の未確定状態へ保存要求が来た場合は、処理完了後に保存可能とする。
- 自動保存と手動保存は既存のローカル保存1枠を共有する。正常に保存できた最新状態で更新し、「続きから」はその状態を読み込む。別の手動保存枠や保存枠選択画面は追加しない。特定時点を残す場合は既存セーブコード・JSON出力を使う。
- 最後に保存できたTurnと、以降に未保存の変更があることを表示する。未保存のまま中断・強制終了した場合は、直前の自動／手動保存状態まで戻ることを日英Helpで説明する。保存失敗時は成功表示にせず、最後に成功した保存情報を保持する。
- アプリ切り替え・ブラウザ終了時の自動保存は必須にせず、その成功にも依存しない。ターン途中の進行を残したい場合は手動保存を使う。
- この保存頻度変更は人間側だけに適用する。AI Sessionの各Decision commit、履歴、Checkpointの保証は維持する。
- 生成時検証、checksum、正規化、gzip、Base64、Storage書き込みを個別計測する。
- gzip設定変更は生成時間、容量、decode互換性を比較して決める。levelを下げれば必ず十分速くなるとは仮定しない。
- まず保存頻度の変更と重複処理削減を行い、必要性を計測して追加最適化を判断する。保存の非同期化自体を必須にはしない。同じStateを何度も複製・保存せず、保存対象の確定snapshotを使う。
- 非同期保存を採用する場合は専用保存adapterでRevision順を管理し、古い完了結果が最新Saveを上書きしない。新規ゲーム／Loadを跨ぐ古いJobも破棄する。
- 保存の処理中・完了・失敗を明示できること、保存失敗・容量不足時にも最後に成功した保存から復帰できることを合格条件にする。ターン途中の終了時は最後に成功した保存まで戻る、という新しい保存方針どおりに検証する。
- Save Format 11とv1.5.1通常セーブの復元・継続を維持する。自動保存・セーブコード・JSON保存を対象とし、AI Session等の互換性とは区別する。
- 破損検証の無効化、Event切り捨て、セーブ互換性の無断破棄を高速化の手段にしない。

### P1: Coreの計算量を減らす

- まず純粋validatorを抽出し、合法手列挙中の候補ごとの全状態複製をなくす。実行側も同じvalidatorを利用する。
- Tile、Unit ID／占有Hex、Facility ID／Hexの索引を適切な寿命で作る。Mapの配列順を仮定する場合は検証済みMapであることを保証し、既存の入力契約を壊さない。
- 最短経路のfrontierを優先度Queueへ変更する場合、重み、同Costの経路署名、座標順、到達地点順を保持する。単なる同距離の別経路も、Noiseや迎撃を変え得るため不可。
- 複数目的地探索の共有は、occupancyとterrain等の条件が一致する範囲に限る。ゾンビのPhase開始Target Snapshotと実移動時の占有変化を混同しない。
- 状態全体のcopy方式の変更は最後に評価する。内部への可変参照流出、拒否Actionの部分反映、失敗時RNG消費を許さない。

## 4. エンジン分割と拡張準備

### 4.1 依存方向

```text
UI / Headless / Agent / Session
          ↓ 公開Query / GameAction
GameEngine: 検証 → 作業状態 → 処理順制御 → 不変条件 → commit
          ↓
Query / Combat / Movement / Unit lifecycle / Economy / Zombie AI
          ↓
Unit定義 / Map参照 / Terrain / Hex / RNG / JSON型
```

公開入口はGameEngineを維持する。抽出先の状態変更関数はEngine内部からだけ使用し、UIへ別の変更経路を公開しない。抽出モジュールがengine.tsへ逆importする循環構造を作らない。公開Eventを内部効果の汎用イベントバスに流用しない。

### 4.2 v1.5.2で行う下地

1. **Query境界**: 合法性、戦闘距離予測、視界・補給・経済の公開情報をEngineの実行制御から分ける。前節の性能改善と同じ作業として扱う。経済は既存`calculateEconomyPlan`の純粋計算を共有し、Forecastと実生産で二重の計算規則を作らない。経済フェーズの全処理を移植する必要はない。
2. **ユニット定義の集約**: 既存9種について、陣営・Human／Zombie分類・Normal AI／Horde AI・Wave候補・Reanimation対応などの重複リストを集約する。列挙順、抽選順、現在値を維持し、未知のTypeは拒否する。自由な文字列や任意スクリプトの登録機構は不要。
3. **戦闘の計算と適用を分ける**: 既存`forecastUnitCombatAtDistance`を土台に、攻撃可否・距離・軍需消費・damage計算と、Charge消費・HP変更・反撃・Noise等の適用を分ける。通常攻撃、反撃、迎撃、UI予測、Agentが同じ判定を使う。
4. **移動と死亡の境界を明示する**: 経路選択、1Hex進入、迎撃、移動中断と、damage後の死亡、Kill Credit、Reanimation、即時占有・感染を限定的に抽出する。今回、新しい効果Queueや死亡処理順を導入しない。
5. **固定Mapと共通参照の分離**: 現行固定Map生成・固定配置検証を一まとまりにし、共通のHex参照・索引・経路探索から分ける。現在の初期部隊の位置・Type・熟練度も内部の初期配置定義として分け、生成順を維持する。公開の`FixedMap`型、51×51、Map ID、保存形式を無理に変更しない。

engine.ts全体の一括分割、経済・避難民・感染・Hordeの全面移植は今回の必須範囲にしない。上記の境界を切るのに必要な共通処理だけを抽出し、残りは機能追加時に順次分ける。行数目標ではなく、依存方向・共通判定・回帰一致で完了を判断する。

### 4.3 将来機能ごとの受け皿と未決事項

| 将来機能 | 現在再利用できる部分／準備する境界 | 将来版で仕様を決める内容 |
| --- | --- | --- |
| 人間・ゾンビの多種追加 | Config、Unit catalog、生成、AI分類、Asset Registry | 生産・生成条件、熟練度、Wave枠、Reanimation、Agent評価、日英Help |
| 距離別威力・最低射程・併用 | 距離引数を持つ既存戦闘Query | 射程帯、各距離の威力・Cost、最低射程での反撃・迎撃、軍需不足時の例外 |
| 対象Hexと隣接Hexへの攻撃 | 戦闘計算／適用と対象列挙の境界 | 味方・施設・民間人口への作用、空Hex攻撃、遮蔽・地形軽減、FoW、反撃回数、Kill Credit |
| 死亡時の周辺damageゾンビ | Unit lifecycleと既存死亡・占有連鎖 | damage対象・順序、死亡位置の確定、爆発の連鎖、二重死亡防止、反撃より前後のどちらか |
| 移動経路上の轢殺車両 | 経路探索と1Hex進入の分離 | 敵Hex通過許可、隠れ敵への接触、轢殺と迎撃の順、爆発ゾンビ、Fuel・停止、撃破経験値 |
| 着陸条件以外は対ゾンビ免疫の航空機 | 対象可否を共通戦闘Queryへ集約 | 地上／空中の占有、移動とVisionの扱い、着陸判定時点、攻撃・反撃・迎撃免疫、占領・補給 |
| 歩兵輸送 | Unit catalogと移動／lifecycle | 歩兵分類、搭載容量、Load／Unload Action、搭載中の位置・行動権・視界、輸送車死亡、人口保存則 |
| 有限製油所／油田 | 経済計画と生産適用の境界 | 製油所単体枯渇か油田資源かを選ぶ。部分生産、残量減算、占領・再確保、補給、UI予測 |
| ランダムMap | 固定Map生成を共通Map参照から分離 | generator Version、Map Seed、Rules RNGとの分離、到達性、施設配置、開始安全性、Horde入口、保存再現性 |
| 幹線道路＋施設への装飾道路 | Map定義と描画layer | 戦略道路と装飾道路を区別。装飾道路は移動Cost、補給、Checkpoint可否に影響させない |
| 米国風・日本風・中東風・スイス風等 | Map生成、Config、初期化、UI Assetの境界 | scenario ID／Version、地形傾向、編成直後の熟練度、初期人口・資源、Unit構成、名称・見た目を分ける |

現状にも距離別の軍需Cost・実効射程、Config指定の編成熟練度がある。これらを土台にする。一方、空中Visionがあることは航空機の移動・攻撃免疫実装済みを意味しない。

装飾道路を現在の`tile.road`へそのまま混ぜると、移動・建設制限・補給等へ意図しない影響が出るため別属性が必要になる。ランダムMapを導入する版では固定Map前提の保存validator、Agent metadata、Session、補給cacheもまとめて改訂する。

## 5. AI CLIの性能改善と利用導線

### 5.1 報告された問題と現行コード

ユーザーは、このPCでClaudeCodeにテストプレイをさせ、メモリを大量に消費する別アプリを同時起動した際、メモリ確保失敗・ClaudeCodeのクラッシュを確認した。Claude側の自己申告では、当時は1手ごとに`npx vite-node`を新規起動し、1回あたり数百MBを確保していた。その後、1ターン1プロセスで複数手を扱うバッチドライバへ切り替え、プロセス生成とメモリ圧が減ったとのこと。生ログと計測値は未確認であり、数百MBや改善の程度は自己申告として扱う。

ユーザーはClaudeだけが原因とは考えておらず、他アプリとの同時利用と将来のMap／Unitパターン増加に備えた改善を希望している。単一プロセス自体のピーク削減も対象にし、複数手化だけでメモリ不足が解消するとは保証しない。

逐次起動したプロセスが正常終了していれば、起動回数だけで同時使用メモリが累積するとは限らない。起動・復元時のピーク、重複起動、残留プロセス、Vite等の実行時変換、応答を保持するAIホスト、OS全体のメモリ不足を分けて確認する。現象の報告と、原因が確認済みであることを区別する。

コード上の根拠:

- `src/session/session-cli.ts:116,193`付近: 1コマンドを実行して終了し、各実行でServiceを生成する。stdinも現状はEOFまで一括で読む。
- `PLAY_WITH_AI.md`: 1手ずつ`step`する起動例が中心で、同じプロセスへ次の要求を送る標準導線がない。
- `src/session/service.ts:284,766`: 同一Service内のcontinuation cacheは存在するが、毎回のCLI起動では維持されない。
- `src/session/service.ts:328,784`: 同一Serviceで`step`を繰り返しても、`restoreAndVerify`でRuntimeを再生成している。stdin loopを追加するだけではこの負荷は残る。
- `src/agent/game.ts:625`付近: 復元時にEngineを生成してLoadSnapshotを適用し、Observationを再生成する。
- `src/session/store.ts:164`: 書き込みpayload参照cacheのMapがある。長く同じプロセスを使う場合は件数・寿命の上限が必要になる。
- `scripts/build-portable.mjs`: Portable向けの事前bundleは既存。開発用の`npm run session`と、配布済みmjsの直接実行を区別する。

### 5.2 ターン単位の対話実行＋複数手入力の代替経路

新しいCLI入口を`play-turn`とする。標準は行単位JSONで対話し、`--input`指定時は有限の複数手計画を読み込む。起動には既存の`--root`、`--session`を使用する。型・CLI help・機械可読API情報に同じ入力schemaを載せ、以下の振る舞いを保証する。

**標準経路は、1ターン中に同じNodeプロセスを使い続ける対話方式とする。** 1行1 JSONの要求・応答を使い、AIが各手の結果を読んでから次の手を決める。ゲームの1 Decision = 1 GameActionは維持し、プロセス寿命とDecisionの単位を分ける。

```text
play-turnでSessionを開く（Node起動・検証・復元）
  → 現在のCompact状態・生産余力・利用可能なQueryを返す
  ← 対象部隊の合法手Query
  → Query結果
  ← Action + 短いdecisionSummary + expectedRevision + requestId
  → 1手を保存確定した結果・公開変化・現在Revision
  ← 結果を踏まえた次ActionまたはQuery
  …
  ← 明示的なEndTurn
  → EndTurn結果・次TurnのCompact状態を返してプロセス終了
```

- AIホストが実行中プロセスのstdin/stdoutを複数のツール呼び出しに跨いで利用できることを確認して使う。ClaudeCodeを含め、対応を仮定しない。
- 対話接続を保持できない環境では、同じ`play-turn`へJSONの複数手計画を渡し、1起動で順に処理する。成功した各手は個別保存し、最後にCompact状態と手別の簡潔な結果を返す。
- 複数手を事前に決める方式だけを強制しない。途中の視界変化・迎撃・失敗等で再判断が必要になった場合は処理を止め、残りの未実行Actionを明示する。途中停止後に同じTurnを再開するための追加起動を認める。
- 「1ターン1プロセス」は通常の利用導線とし、正しい判断や復旧より優先する絶対条件にはしない。1手ごとの子Node起動を内部で繰り返す実装は不可。
- 既存の単発`step`等8コマンドは呼び出し方式の互換とv1.5.2 Sessionの復旧用に残す。旧版AIデータの復元は含めない。常駐daemonやネットワーク公開を必須にせず、ターン完了時にプロセスを解放する。

### 5.3 実行・中断・再送の契約

- `play-turn`開始時にSession、開始Turn、expectedRevisionを固定する。途中の各Actionも現在の合法性で再検証する。開始時の合法手一覧を全Actionへ流用しない。
- EndTurnはAIから明示された場合だけ実行し、成功した最初のEndTurnで終了する。EOF、入力不足、timeout、Action上限で勝手にEndTurn／Waitを補わない。Game Over時も直ちに残りを停止する。
- 複数手計画は有限のAction列であり、汎用スクリプトや未承認の自動戦略を受け取らない。開始RevisionとActionごとの短い公開理由を必須にする。
- 複数手計画は、拒否、移動中断、想定外の損害・Unit損失、新しい敵の発見、危機の新規発生・悪化、Game Overで停止する。残りのActionが合法でも続行しない。検出はAIへ公開可能な情報だけを使う。予定している戦闘結果等を許容する場合は対象・公開条件を計画に明示し、曖昧な「全部無視」を標準例にしない。
- 比較基準は各Actionの直前・直後の公開Observationと当該Actionの公開Eventとする。新しい敵は「直後の可視Enemy ID集合−直前の集合」で検出し、以前に見た敵の再発見も含む。Move成功でも実到達地点が指定先と異なる場合は移動中断とする。Player Unitの消失・死亡は必ず停止する。
- 損害の想定内指定は、そのAction直後のPlayer Unit HPの許容範囲をIDごとに指定する形式に限定する。指定のないPlayer UnitのHP減少、指定範囲外の結果は停止する。攻撃対象の敵への通常のdamage・撃破だけでは停止しないが、新しい敵、味方死亡、移動中断、危機の条件はこの指定で無効化できない。損害の許容指定がない場合は、すべてのPlayer Unit HP減少を想定外とする。
- Crisisは公開の理由コードと対象ID集合を安定した識別子にする。新規Crisis、深刻度上昇は停止する。同じCrisisでも不足量・感染者数等の悪化を検出できるよう、各Crisis型に公開値由来の比較項目と悪化方向を定義し、Core Queryで共通判定する。単なる文言変更は悪化にしない。比較定義は全Crisis型を網羅するテストで検証する。
- 停止時は`stopReason`、実行済み／拒否／未実行のindex、現在Revision、Compact状態、必要な再Queryを返す。拒否ActionのDecision採番は既存Session契約を維持し、未実行Actionは採番しない。
- プロセスを再利用しても、各Decisionのcommit、公開Decision Log、hash chain、Checkpointの保証は維持する。ターン末まで未保存にしない。途中停止で実行済みの正常な手を巻き戻さない。
- requestIdと要求内容をcommitと対応付けて記録する。応答を受け取る前に切断されても、再送時に同じActionを二重実行しない。同じrequestIdで違う内容は拒否し、現在状態と元の処理結果を区別して返す。
- 同じSessionに複数の書き込み用`play-turn`を同時起動しない導線と検出を持つ。既存lockとcommit identityで競合を検知し、別commitやLoad・分岐を跨いで古いRuntimeを使わない。異常終了後のlock復旧は生存中プロセスを奪わない既存方針を維持する。
- 読み取りQueryはDecision／RNGを変えない。行長・入力件数・待機中要求・出力buffer・cacheに上限を設け、stdoutが遅い場合はbackpressureを適用する。長い無通信は保存済み状態を案内して終了できるようにし、AIの思考中にゲームを進めない。

### 5.4 プロセス内でも復元・メモリ確保を減らす

- 1つの実行コンテキストでSessionStore、SessionService、Runtimeを再利用する。検証済みの現在commitと一致する間は、各手でGameEngineを作り直してLoadSnapshotしない。
- 起動時、外部commit検出時、復旧時は必要な復元・整合検証を行う。Actionの不変条件検証、保存hash、拒否時の無変更保証は継続する。検証を外して速くする案にはしない。
- 起動時のCode／Map／Configと、Revision内のObservation／合法手／Forecastを共有する。Queryも最新の検証済み状態を参照し、毎回ディスクから全復元しない。
- Sessionが履歴保存を所有する実行では、Agent側へ履歴の別copyを蓄積しない。既存`recordHistory`等の責任を確認し、Artifact／Replayに必要な情報はSessionから完全に復元できるようにする。
- cacheは現在状態・必要な静的参照・上限付きの直近要求に限定する。全DecisionのObservationや全payloadを常駐させない。ターン終了・close時に解放する。
- 通常プレイは事前bundleしたCLIを直接Nodeで実行する。開発用TypeScript変換を毎手起動しない。Windows向けlauncherと既存Linux Portable launcherに同じ入口を用意し、実行時のnpm installや再buildを不要にする。
- `npx vite-node`をActionごとに使う例を標準案内から外す。バッチ用の公式driverも事前bundleした実行経路とし、既存の開発用driverをAIが自作しなくても複数手を処理できるようにする。
- メモリ不足への標準対応をNode heap上限の増加にしない。RSS、heap、Buffer等の外部メモリ、子プロセス数、他アプリを含むOS使用状況を区別して調べる。

### 5.5 AIが自然に効率的な経路を選ぶ案内

- `PLAY_WITH_AI.md`、README、Portable同梱案内、CLI help、`query api`、`new/status`の案内を更新する。最初の例を`play-turn`にし、1手ごとの新規プロセス起動は互換経路として説明する。
- capability情報に、対話／複数手の利用可否、protocol Version、入力上限、開始コマンド、終了条件を機械可読で載せる。コマンドは実在するlauncher・正しいroot／Sessionを示す。
- 対話可能なAI向け例と、ファイル入力しか使えないAI向け例を両方用意する。後者は安全に連続できる内政操作等をまとめ、戦闘後の再判断を省略させない。
- 標準応答はCompact状態、当該Actionの成否、公開Event／変化、重大な危機、生産余力、対象別Query入口とする。全Map・全合法手・全履歴を毎回出さない。配列の全件取得手段とページ数を維持する。
- 入力行数だけを減らして毎手の巨大応答をまとめて返す実装は避ける。複数手は手別の小さい結果＋最後のCompact状態とし、詳細のDecision履歴は必要時にQueryする。停止理由に関係する損害・発見等は要約から落とさない。
- AIモデルがこの導線を利用することを、実際の外部CLIプレイで確認する。文書を置くだけで、ClaudeCodeを含む全AIが必ず従うとは保証しない。

### 5.6 AI実行側の検証

- 同一の検証済みSessionとAction列で、旧単発、新対話、新複数手入力を比較する。Node起動回数、wall time、ピークRSS、heap／外部メモリ、I/O、出力bytesを記録する。可能ならプロセスツリーとWindowsのメモリ状況も記録する。
- 明示的EndTurnまで対話方式で複数手を処理した通常ケースはNode本体1起動、手ごとの子Node起動0であることを確認する。
- 改善率・MBの固定合格値は設けない。起動回数減少だけで完了とせず、時間・メモリ負荷の改善と長時間増加の有無を確認する。意図的に他アプリやClaudeCodeをクラッシュさせる負荷試験は行わない。
- 終了直前／commit直後の切断、同一request再送、古いRevision、壊れたJSON、遅いstdout、途中Game Over、拒否後の未実行列、EndTurn後の余剰入力、二重起動、異常終了後の再開を検証する。
- 現在状態、RNG、受理Action列、公開Event、Decision Log、Replay結果が単発方式と一致する。request診断や転送単位の差はゲーム結果と別に扱う。
- Windowsの外部AI向け経路とLinux Portableで複数手・再判断・再開を確認する。長いSessionでは履歴ファイルの増加とRAMの増加を区別する。v1.5.1の履歴容量改善を再び悪化させない。

## 6. AI向け資源生産余力

### 6.1 目的と表示の意味

AIが、備蓄不足なのか、働かせていない設備があるのか、電力・原料が不足しているのか、設備確保が必要なのかを判断できる公開情報を追加する。生産余力を備蓄量や生産後の純収支と混同しない。

今回の追加先はAIの公開Observation、SessionのCompact応答・詳細Query、および同じ公開APIを提供するBrowser Bridgeとする。人間側の資源パネル・HUD・詳細画面には新しい生産余力表示を追加しない。計算はCoreの共通経済Planから導出し、既存の人間向け生産予測と矛盾させない。

- 生産量は既存の次EndTurn Forecastを基準にする。前Turn実績を表示する場合は別名・別時点を明示する。
- 所有設備の名目能力、現在人員での能力、現在の経済Planによる出力を並べる。上限との差は条件付きの余地であり、今すぐ追加生産できる保証ではない。
- 軍需工場は維持費予約後の同じCivilian Goods、施設間では同じ電力、増員では同じ都市人口を使う。資源別上限が同時達成可能だとは表示しない。
- 「現在の合法Actionを組み合わせて今Turnに到達できる最大生産量」の厳密最適化は今回の対象外。上限値を出すために全合法手の組合せ探索を実行しない。

### 6.2 公開項目と算定範囲

公開項目を`StrategicForecast.productionCapacity`とし、既存`query forecast`から取得可能にする。全体に対象Turnと現在人口基準等の算定条件を持たせ、Session応答・QueryのRevisionへ結び付ける。以下のキーと意味を共通型・API情報・テストで一致させる。

4備蓄資源（Food／Civilian Goods／Military Goods／Fuel）ごとに、以下を返す。

| 項目 | 意味 |
| --- | --- |
| `projectedEndTurnOutput` | 現在の配置・電源設定・入力資源・給電順で次EndTurnに生産する総量。消費差引前 |
| `installedFacilityRatedCapacity` | 都市以外の対象設備を最大人員で動かした名目量。人員・給電・入力不足を解消できるとは仮定しない |
| `residentRatedOutputAtCurrentPopulation` | 現在の都市人口配置に基づく定格出力。都市ごとに`min(現在健常住民, 生産SoftCap) × 出力係数` |
| `ratedUpperBoundAtCurrentCityPopulation` | 上記2値の和。都市人口を現在値に固定した比較基準であり、再配置後の最大量ではない |
| `currentFacilityWorkerRatedCapacity` | 都市以外の設備に現在配置済みの人員での定格量。都市住民由来出力を含めず、停電等による実際の停止とも区別 |
| `currentTotalRatedCapacity` | `currentFacilityWorkerRatedCapacity + residentRatedOutputAtCurrentPopulation`。都市と設備を二重計上しない |
| `currentPlanPrePowerOutput` | 共通の経済Planで計算した、最終給電適用前の出力。単純な原料制約だけの値ではない |
| `ratedGapUpperBound` | `ratedUpperBoundAtCurrentCityPopulation − projectedEndTurnOutput`。非負であることを検証し、実行可能余力とは呼ばない |
| `utilizationRatio` | 予測生産量÷同じ算定範囲の名目量。上限0ならnullと理由を返す |
| `blockingReasonCounts` | 未配置、感染・復旧等の稼働不可、電源OFF、入力不足、発電設備／Fuel不足、給電順位等の件数 |
| `feasibleHeadroom` | `not_computed`とし、実行可能な最大増産量は未計算と明示 |

名目設備の範囲は現在player所有の完成した未破壊設備とする。建設中・未確保・破壊済み施設を現在の生産上限に含めない。感染・復旧中・電源OFF等の設備能力は、稼働不能の理由を添えて名目量に含める。稼働可否や補給圏の条件は現行Coreの判定を使い、Supply外だから全生産0といった独自規則を加えない。

Civilian Goodsには都市人口由来の出力があるため、設備能力と都市出力を分ける。都市の`workerCapacity`は生産SoftCapとして利用されるが、人口収容のHard上限ではない。詳細Queryには`residentSoftCapRatedCeiling`と現在住民による出力との差も示し、人口増加で伸ばせる構造上の余地を確認できるようにする。工場へ都市住民を移すと都市出力も変わるため、工場満員と現在都市人口の同時達成を保証しない。感染都市は現在住民ベースの定格値と感染による停止を区別する。

`blockingReasonCounts`は重複し得る説明情報であり、足し合わせて総損失量にしない。現状でもMilitary Factoryの電源OFFは入力配分へ影響するため、段階値の差を無条件に「原料不足損失」「停電損失」と分類しない。

施設別詳細ではinactive理由と該当設備能力を示す。既存`facilityStoppedReason`は復旧中等を`power_unavailable`へまとめるため、その文字列だけに依存せず、公開の稼働状態・感染・電源・Planの給電理由を使って区別する。

電力は非備蓄なので別形状にする。所有発電設備の名目能力、現在人員の発電能力、現Planの物理能力・Turn-start Fuel制約後の利用可能量、給電需要、実割当量、未割当の利用可能量を返す。未割当電力は備蓄できる量ではない。Refineryの今Turn生産Fuelを今Turnの発電・Unit補給に先取りしない。

共通条件として、増員に利用できる公開都市人口、残りAction数、`exactReallocationCapacityComputed: false`を1回だけ示す。各資源へ同じ人口や入力在庫を重複割当した例を作らない。

### 6.3 表示・実装と検証

- `new/status/play-turn`の開始・結果と通常Compact応答には資源別の小さな要約だけを載せる。詳細な施設別内訳は既存`query forecast`等へ分け、Revision付き・必要ならページ化する。
- 同一Economy Planから現在出力・段階値・理由を生成し、UI／Agent／Session間で第二の生産規則を作らない。現在の`baseOutputs`は軍需入力等の条件が反映済みであり、そのまま名目設備上限へ流用しない。
- 同一RevisionではQuery Contextを共有し、資源ごとに全経済予測を再実行しない。追加情報による応答bytesと計算時間も計測する。
- 例として「食料の名目量300、現在10人の定格100、停電により予測0、名目との差300」を返しても、『今すぐ300増産できる』とは説明しない。例の数値は説明用であり新しいバランス値ではない。
- 予測生産量と実際の経済処理の一致、上限0、満員、都市SoftCap超過、感染都市、停電、電源OFF、感染・復旧、建設中・破壊済み設備の除外、共有原料の競合、複数工場、人口再配置、Refinery Fuelの翌Turn利用を検証する。
- 同じ公開StateのAgent／Compact／詳細Queryで値が一致し、QueryがState／RNGを変えず、非公開情報を漏らさない。行動後・Load後は値を更新する。
- Compactは各資源の`projectedEndTurnOutput`、`ratedUpperBoundAtCurrentCityPopulation`、`ratedGapUpperBound`、`utilizationRatio`、`blockingReasonCounts`と算定前提を保持する。中間段階値、施設別内訳、都市SoftCapの詳細は`query forecast`で取得する。電力は利用可能量・需要・実割当・未割当量を要約する。

## 7. 互換性・決定性の受入条件

- 現行v1.5.1と同一Seed／Config／Action列で、State、RNG、Event列、勝敗、合法手の内容と順序を維持する。表示更新の回数・時刻は比較対象外とする。
- 等Cost経路、同距離対象、ZombieのID順、Phase順、Noise、Reanimation・FIFO感染連鎖、即時Defeat優先を固定する。
- 通常攻撃／反撃／迎撃について、予測と実処理の距離、Cost、Charge、damageが一致する。
- Queryは無副作用。返却値の変更がEngineへ届かない。Rejected ActionはState・Event・RNGを変更しない。
- FoW内の敵情報、Noise内部Target、未公開Wave情報をUI／Agentのcache経由で漏らさない。Load後も古い視界を表示しない。
- 盤面の画質、表示情報、既存のZoom範囲・LOD条件を維持する。画質低下や新しい軽量品質モードを改善結果へ含めない。
- `App 1.5.2`への更新と、Rules／State／Config、Save、Observation、Artifact、Session各Versionを区別する。挙動・形式が不変なら後者を機械的に上げない。追加の公開API等で契約が変わる場合は個別に判定する。
- 今回追加する生産余力は導出情報であり、GameState／Saveへ保存項目を追加しない。Observation／Agent／Bridge／Artifactへの公開項目追加とplay-turn protocol、request再送記録については、対応するschemaとVersionの変更を個別に明示する。
- v1.5.1以前のAI Session／Checkpoint／Artifact／Replayはv1.5.2への移行・復元対象外とする。AIプレイは新規Sessionで開始する。旧AIデータを変更・削除せず、Version不一致を明示して拒否する。旧版での利用を維持し、移行専用readerや変換機能は今回実装しない。
- v1.5.1通常セーブのfixtureで復元・継続を検証する。それ以前を受け入れる変更は含めない。AIデータはv1.5.2内の保存・復元・分岐・Replay一致と、旧版入力の状態不変での拒否を検証する。現在の厳格な形式検証を保つ。
- 既存ルールテスト、影響するUI／Core／Save／Agent／Replay／Sessionテスト、型検査、本番buildを実施する。次に既存の日常Seed試験とBrowser Bridge／Portable smokeを行う。同じ検証の根拠のない再実行はしない。
- 性能回帰は固定fixtureと固定Action列で比較する。Random／Balancedが同一の公開情報と合法手から同一Actionを選ぶことも確認する。
- 生産余力の追加により公開JSON全体は旧版と同一にはならない。旧来の公開項目・合法手・State／Event／RNGは一致、新規導出項目はCore計算と一致、という比較を分ける。旧Artifact／Sessionは非対応Versionとして拒否し、新項目欠落を理由に破損と誤表示しない。

## 8. 性能改善の確認方針

2026-09-05のユーザー指定により、SOG05の機種の古さも考慮し、具体的な改善率を合格目標にしない。前案の固定応答時間・fps目標も設けず、パフォーマンスの改善を確認できればよい。現在達成済みとは扱わない。

- 同じ端末・Save・操作条件で改善前後を比較し、部隊選択、移動先選択、ターン終了、パン・ピンチ等の応答・滑らかさが改善したことを確認する。
- Release前の比較はPC環境で行う。SOG05の使用感は公開後にユーザーが確認し、追加改善は次回更新で検討する。SOG05の実測結果がないことを未完了理由にせず、実機改善済みとも断定しない。
- 中央値・p95・フレーム時間・処理回数等は原因調査と改善の根拠として記録する。特定のms、fps、改善率への到達は合格条件にしない。
- 計測のばらつきを改善と誤認しないよう、繰り返し測定と実操作で確認する。受付表示だけを先行させた場合は、ゲーム処理完了の短縮とは区別する。
- 他の主要操作に明らかな退行がないこと、同じ盤面で選択・ズームを繰り返してObject数・保持メモリが増え続けないことを確認する。
- AI実行側も固定改善率・メモリ量の目標を設けず、同じAction列で起動・復元・計算・出力の負荷改善を確認する。将来のMap／Unit多様化に備え、Unit数・施設数・履歴量による増加傾向も記録する。
- ゲームルール、公開情報、セーブ・復元、決定性の受入条件は維持する。

INP、Event Timing、Long Tasks、フレーム時間は用途が異なる。DOMのINPだけでCanvasのパン・ピンチやゲーム処理完了を評価しない。測定時に未対応のAPIがあっても独自の区間計測で補えるようにする。

## 9. 作業順と完了判定

| 段階 | 作業 | 次へ進む条件 |
| --- | --- | --- |
| 0 | PC baselineと固定fixture、区間計測 | 操作別の主要コストが説明できる |
| 0-AI | CLI起動経路・プロセス数・メモリと入出力のbaseline | 報告された現象と未確定の原因を分離できる |
| 1 | Query共有、全Observation依存削減、純粋validator | 合法性・公開情報一致、重複計算削減を実測 |
| 1-AI | 実行Context再利用、play-turnの対話・複数手入力、案内更新 | 1プロセスで逐次判断でき、各Decisionの復旧保証を維持 |
| 1-資源 | 共通Economy Planから生産余力要約と詳細Queryを生成 | 上限の前提・共有制約が明確、既存予測と一致 |
| 2 | カメラ／盤面更新分離、Object再利用、保存最適化 | PCとスマホ相当viewportで操作・保存復元を検証 |
| 3 | 索引・経路探索等の必要なCore最適化 | 中盤・後半の改善と決定性一致 |
| 4 | Unit catalog、戦闘・移動・死亡の限定抽出、固定Map境界整理 | 依存方向が明確、既存Action列の結果一致 |
| 5 | 統合試験・PC性能再測定・互換確認 | 要件の合否と未達項目を記録 |

段階1で必要な抽出は先行してよい。大規模な分割とアルゴリズム変更を同時に行わず、回帰原因を追える単位で進める。Core Worker化、全面的なimmutable化、ECS導入は上記で不足すると実測された場合の追加検討とする。

実装結果は現行仕様へ反映した。PCでの比較条件・結果は`src/testing/fixtures/v152-performance-evidence.json`、AI CLI比較は`src/session/play-turn-performance-evidence.json`に保持する。GitHub Pagesの公開と公開先のHuman UI／Browser Bridge、配布Portableのsmokeを確認する。SOG05は公開後にユーザーが手動確認し、追加改善が必要なら次回更新の候補にする。ユーザー指定により、本書はDoc直下に保持し、Doc/archiveは参照・変更しない。

ファイル配置、cache・入力上限の具体値、Worker採否などの内部実装判断は、上記の動作・互換・性能条件を満たす範囲で実装担当が決定し、APIから利用者に関係する上限はhelpとcapability情報へ明示する。新たなゲームルールや今回対象外の機能は追加しない。実装・検証完了後に現行仕様へ反映して整合を確認し、本確定要件が比較資料として不要になった時点でDoc/archiveへ移す。

## 10. 計測方法の参考資料

- [Chrome DevTools: Androidのリモートデバッグ](https://developer.chrome.com/docs/devtools/remote-debugging/)
- [web.dev: Optimize Interaction to Next Paint](https://web.dev/articles/optimize-inp)
- [Chrome: Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames)
- [Node.js: Readline](https://nodejs.org/docs/latest-v22.x/api/readline.html)（対話CLIの行単位入力）
- [Node.js: Process](https://nodejs.org/docs/latest-v22.x/api/process.html)（プロセスのメモリ計測）

公式資料は入力遅延・処理・描画の区別、長い処理の調査、Android実機計測の手順の参考とする。本プロジェクトのボトルネックの証拠は上記のコードとローカル計測であり、一般資料だけで断定しない。
