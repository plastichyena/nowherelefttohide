# Nowhere Left to Hide PoC v1.6.0 アップデート要件 確定版

## 0. 文書情報

- 文書状態: 確定版（実装前）
- 対象リリース: App / Release 1.6.0
- 確定日: 2026-09-13
- 改訂: 2026-09-13 Remote MCP / ChatGPT Plugin 将来互換境界を追加
- 比較基準コミット: f82110c70b388da6b6b5af17c6fd086d93bf282c
- 安定版の正本: [Nowhere Left to Hide PoC 現行仕様](./Nowhere%20Left%20to%20Hide%20PoC%20現行仕様.md)
- 非規範の検証資料: [Claude playtest r2](../output/claude-playtest-20260912-r2/REPORT.md)

本書は v1.6.0 の変更部分だけを定める実装目標である。実装、テスト、動作確認が完了するまでは現行仕様を変更しない。両者が矛盾する変更箇所では本書を v1.6.0 の目標とし、それ以外は現行仕様を維持する。

## 1. 目的

v1.6.0 では次を達成する。

1. 経済危機の原因、行動の直後効果、次 EndTurn の確定影響をプレイヤーと外部 AI が事前に判断できるようにする。
2. 終盤の Fuel 成長手段として Oil Field と全国共有の累積精製枠を導入する。
3. Temp Housing、初回占領報酬、Wind Power Plant 建設上限を調整する。
4. WebMCP 対応クライアントから、ブラウザ上のゲームを観戦可能な外部 AI セッションとして操作できるようにする。
5. 外部 AI のコメントをリプレイ互換の Decision データとして保持し、現在の UI 言語を希望出力言語として伝える実験を行う。
6. 保存、観測、Artifact、Session の境界を明確に更新し、旧版との曖昧な互換動作を残さない。
7. 後続版で通常 ChatGPT の Web / mobile 等から Remote MCP Plugin 経由でプレイできるよう、AI Session の application boundary を WebMCP、DOM、ローカルファイルから分離する。

## 2. 非目標

- Game Core が LLM、WebMCP、DOM、Phaser、ファイル I/O を直接扱うこと。
- 外部 AI コメントが指定言語であることの保証、言語検出、翻訳、拒否。
- built-in Random / Balanced Agent のコメント翻訳。
- live viewer からの人間によるゲーム Action、途中 takeover、LLM によるセッション開始・停止・リセット。
- v1.5.7 以前の Save、Session、Artifact、Replay の移行または再生互換。
- live セッションの自動保存、自動復元、クラウド送信。
- Remote MCP server、HTTP endpoint、ChatGPT Plugin package、MCP Apps UI、公開観戦 URL の実装、hosting、公開審査。
- Remote 経路の認証、アカウント連携、server-side 永続化、課金、rate limit、運用監視。
- 将来の戦闘、感染、難民流入を含む任意ターン数の完全シミュレーション。

## 3. 不変条件

### 3.1 Core 境界

- 状態変更は GameAction → GameEngine の経路に限定する。
- 警告、headroom、preview、WebMCP 観測は公開状態を入力とする純粋な query / projection とし、Core 状態、RNG、ActionSeq、revision を変更しない。
- decisionSummary、requestedCommentLocale、表示ログ、WebMCP requestId は Core の勝敗、合法性、RNG に影響させない。
- UI は局所計算で Core の数値を推測せず、Core が返す共通 DTO を人間、Agent、WebMCP で共有する。
- WebMCP adapter は DOM や window 上の実装を直接 Session の正本にせず、3.4 の transport-neutral application boundary を呼び出す。

### 3.2 公開情報

- 既に観測可能な盤面、施設、資源、人口、履歴だけを公開する。
- hidden seed、未出現の wave 編成、将来のスポーン位置、内部 RNG 状態を追加公開しない。
- 敵の次 wave 情報は、現行仕様で既に公開される情報の範囲に限る。

### 3.3 Action 整合

- preview と act は同じ合法性判定、費用計算、電力配分、人口処理、精製計算を再利用する。
- preview は baseRevision を返す。実行時 revision が異なる場合は再 preview を要求し、古い予測を実行結果として扱わない。
- requestId の冪等性は維持する。同じ requestId に異なる Action、comment、requestedCommentLocale が渡された場合は衝突として拒否する。

### 3.4 AI Session application boundary

v1.6 では、AI が一試合を進める application service / port を transport-neutral にする。名称は実装内で選べるが、責務と境界は次に固定する。

- Session の生成と終了
- context / capabilities / versions の取得
- observe
- bounded query
- legal actions
- preview action
- act
- request result
- game result
- public Artifact の構築

この boundary の入力と出力は JSON-compatible な明示 DTO とし、GameAction、baseRevision、session generation、requestId、decisionSummary、requestedCommentLocale、reasonCode を transport に依存しない形で保持する。

- DOM、window、document、Phaser、WebMCP registration、HTTP request / response、MCP SDK 型、ローカル絶対 path を interface に含めない。
- Session ごとの GameEngine、revision、request ledger を instance に閉じ込め、global singleton にしない。
- lifecycle factory は programmatic に新規 Session を生成できるようにする。v1.6 WebMCP では UI だけが factory を呼び、将来の Remote adapter は別の認可済み start tool から呼べる。
- transport は DTO の検査、認可、表示、配送を担当するが、合法性、preview、状態変更、統計を再実装しない。
- Browser Bridge、Portable / Session、WebMCP が同じ意味の操作に対して同じ public DTO、reasonCode、revision 規則を使う。
- 将来の Remote adapter が WebMCP と異なる tool 名や lifecycle tools を追加できるようにし、WebMCP の固定 tool surface を共通 service interface そのものにしない。
- clock、500 ms 表示保持、描画 watchdog、pause UI は viewer / transport 側の責務とし、application service の Action 確定を待機時間へ結合しない。

## 4. AI 判断支援

### 4.1 構造化アラート

共通 Alert DTO は最低限次を持つ。

- id
- severity: critical / warning / advisory
- category
- reasonCode
- titleKey
- bodyKey
- params
- evidence
- suggestedActionKinds
- sourceRevision

同じ原因から生じる警告は一つの因果鎖に集約し、全国、施設、部隊の同一内容を重複表示しない。重要度は単純な在庫閾値ではなく、確定した不利益と残り時間で決める。

- critical: 次 EndTurn に確定する人口喪失、敗北、回復不能な即時損失、または既に発生中の危機
- warning: 3 turn 以内に予測される不足、条件付きの直近危機
- advisory: それより長い余裕、効率改善、低優先の注意

生産と消費の処理順によって次 EndTurn に不足する場合、単純な netBurn が 0 以下であることを理由に警告を消してはならない。

### 4.2 Military Goods 不足の分離表示

軍需不足は次を別々に表示する。

- 全国 Stock と Production
- 補給可能な需要
- 未補給地域の未充足需要

補給線外の需要を全国 Stock 不足として二重計上しない。原因が異なる場合は、全国不足と補給線切断を独立した reasonCode にする。

### 4.3 Facility / Worker / Recovery アラート

最低限次を対象にする。

- 停電、Fuel 不足、原材料不足
- workers 0 による停止
- 感染または回復待ち
- 補給線切断
- Refinery allowance 枯渇
- Oil Field が allowance を増やせない状態

Wind Power Plant は労働者を必要としないため、workers 0 の停止警告を出さない。

### 4.4 Checkpoint と防壁

- Checkpoint の補正値は通常 UI と同じ source of truth を使う。
- Core 側の checkpointBonus が欠ける旧経路でも、表示は 0 に落とさず現行ルールの既定値 25 を使用する。
- Barbed Wire は耐久度 / 最大耐久度を正しく描画し、設置直後の満タン状態が空バーに見えないこと。

## 5. Action Preview

### 5.1 対象

最低限次を preview できる。

- build
- repair
- salvage
- fortify
- transfer
- recruit
- layBarbedWire
- EndTurn

preview は実行を伴わない。合法でない Action にも reasonCode と不足条件を返す。

### 5.2 表示項目

- Action の合法性と理由
- 消費・獲得資源
- 人口移動、労働者、部隊構成の変更
- 建設または回復の完了 turn
- 効果が初めて発生する economy phase
- 次 EndTurn 後の Food / Civilian Goods / Fuel / Military Goods / Electricity の before / after
- 次 EndTurn に確定する人口喪失と敗北
- 完了後、現在条件を固定した steady-state の per-turn delta
- Refinery allowance の増減
- preview 対象外の不確定要素

危険な Action は警告を表示するが、合法な Action 自体をブロックしない。

### 5.3 予測範囲

数値予測は次に限定する。

1. Action 直後の確定差分
2. 次 EndTurn までの決定論的結果
3. 建設完了または回復完了の時期
4. 完了後に現在条件が変わらないと仮定した steady-state delta

複数 turn 先の戦闘、感染、難民、AI 行動、未公開 wave は予測しない。結果画面と WebMCP act response は、同じ DTO を実行後の確定差分として返す。

## 6. Support Headroom

### 6.1 定義

現在状態のまま追加で維持できる健康な民間人の人数相当を表示する。施設の空き枠数や、建設可能なユニット数への換算は行わない。

資源 r の 1 人あたり維持費を c(r)、次 economy phase の利用可能量を A(r)、既に確定した需要を D(r) とする。

headroom(r) = floor(max(0, A(r) - D(r)) / c(r))

全国の current-condition support headroom は、対象資源の headroom の最小値とする。補給線外、停電、施設停止などによって利用不能な生産は A(r) に含めない。

### 6.2 Action 個別表示

各 preview は Action 後の headroom と差分を表示する。ただし UI は「あと何個建設できる」と断定せず、people-equivalent と、選択した Action 自体の確定影響だけを示す。

## 7. Wave 情報とゲーム終了統計

### 7.1 Wave

- 現在の公開 wave 情報は盤面 UI、観測、query で同じ DTO を使う。
- 追加の警告は既知情報だけで構成する。
- hidden seed や未公開の将来 wave を表示しない。

### 7.2 終了統計

ゲーム終了時に最低限次を表示し、Artifact にも含める。

- 最終 turn と勝敗理由
- 生存健康民間人
- 累積 resource shortage losses
- 最終 economy phase の resource shortage losses
- 敵タイプ別撃破数
- 敵総撃破数
- 施設別、部隊別、Action 別の主要集計

敵総撃破数は、タイプ別集計の合計と一致させる。Normal、Horde、Police、Soldier、Riot、Hunter、Gas を含む実在タイプを一つも落とさない。

## 8. バランス変更

### 8.1 Temporary Housing

- Civilian Goods 維持費を 0.5 / person / turn から 1 / person / turn に変更する。
- Food 維持費は 1 / person / turn のまま。
- 人口 20 人では Food 20、Civilian Goods 20 を消費する。
- 建設費、収容人数、感染、回復、補給の既存ルールは本書に記載がない限り維持する。

### 8.2 初回中立占領報酬

次の施設が neutral から player へ初めて secured に遷移した瞬間、全国 Stock に即時加算する。

| 施設 | Food | Civilian Goods | Fuel | Military Goods |
| --- | ---: | ---: | ---: | ---: |
| City | 100 | 100 | 100 | 0 |
| Civilian Factory | 0 | 100 | 0 | 0 |
| Military Factory | 0 | 0 | 0 | 100 |
| Army Base | 100 | 0 | 0 | 100 |
| Farm | 100 | 0 | 100 | 0 |

- 報酬は補給線外でも全国 Stock に入る。
- 各施設につき一回だけとし、奪還、再占領、感染回復、修理、再建では再付与しない。
- Oil Field、Simple Farm、Wind Power Plant、Drone Base、Refinery、Power Plant、Checkpoint は対象外。
- Army Base を turn 20 までに確保した場合の National Guard 1 部隊報酬は維持し、上表の資源報酬と累積する。
- Army Base の資源報酬には turn 制限を設けず、turn 21 以後の初回確保でも付与する。
- Save には施設ごとの firstCaptureRewardClaimed を保存する。

## 9. 固定マップ v5

### 9.1 既存施設の整理

開始時 player 所有の refinery-1 と power-plant-1 は維持する。次の中立施設を削除する。

- refinery-2: (38, 21)
- refinery-3: (25, 39)
- refinery-4: (11, 30)
- power-plant-2: (40, 22)
- power-plant-3: (10, 28)

削除施設の施設 overlay と urban overlay を除く。削除後の座標は通常の平地として扱う。

削除施設だけに到達して終端となる専用道路は、施設側から最初の junction まで削除する。共有路、通過路、loop の一部は残す。道路削除前後の移動コストと接続性をテストし、別目的地へ向かう路線を壊さない。

### 9.2 Oil Field の配置

Oil Field を東西南北の幹線から 1 hex 外側に一つずつ置く。

| ID | 方角 | Oil Field | 幹線上の接続 hex |
| --- | --- | --- | --- |
| oilfield-north | North | (26, 13) | (25, 13) |
| oilfield-east | East | (37, 24) | (37, 25) |
| oilfield-south | South | (24, 37) | (25, 37) |
| oilfield-west | West | (13, 26) | (13, 25) |

- 各 Oil Field と接続 hex の間に 1 hex 分の access spur を設ける。
- access spur は roadBranches に数えず、Wind Power Plant 建設上限を増やさない。
- 4 施設とも neutral、unsecured、workers 0 で開始する。
- 確保後、労働者は transfer で配置する。
- 既存施設、初期部隊、Army Base 候補、初期予備部隊配置と重複しない。

## 10. Oil Field と Refinery Allowance

### 10.1 全国共有の累積枠

- 初期 refinery allowance は全国共有で 5,000 Fuel。
- これは残り Fuel の lifetime refined capacity であり、turn、奪還、感染回復、修理、再建でリセットしない。
- Oil Field の生産はこの allowance を恒久的に加算する。
- 他手段で得た Fuel、初回占領報酬、初期 Stock、Action 消費は allowance を減らさない。
- Refinery が実際に精製した Fuel だけ allowance を減らす。
- allowance に上限を設けない。

Save と Observation は最低限、initialAllowance、oilCreditsEarned、fuelRefined、remainingAllowance を保持または導出できること。

### 10.2 Oil Field

- 最大 workers: 5
- secured、player 所有、補給線内、operational のときだけ稼働する。
- economy phase ごとに healthy worker 1 人につき allowance を 100 Fuel 加算する。
- 5 人なら 1 turn に 500 Fuel 加算する。
- Electricity と Fuel を入力として消費しない。
- healthy worker は通常の Food / Civilian Goods 維持費、人口統計、感染、回復ルールに従う。
- healthy worker は all-civilians-lost 敗北判定上の生存民間人に含む。
- Oil Field は housing、recruit source、refugee housing ではない。

### 10.3 Economy phase の順序

同じ economy phase では次の順序に固定する。

1. その時点までの発電と既存の Fuel 消費を処理する。
2. 稼働中 Oil Field の worker credits を allowance に加算する。
3. 稼働中 Refinery が allowance の範囲で Fuel を精製する。

Oil Field の同 turn credits は Refinery が直後に使用できる。ただし phase の前段で発電等に必要だった Fuel を遡って補うことはできない。

複数 Refinery がある場合は facilityId 昇順で処理し、各施設の実出力を min(定格出力, remainingAllowance) とする。remainingAllowance が 0 の Refinery は精製用 Electricity を予約・消費しない。部分精製では実出力に比例した既存入力計算を使う。

## 11. Wind Power Plant 建設上限

- player が建設した Wind Power Plant の同時存在上限は 2 × roadBranches とする。
- fixed-51x51-v5 の roadBranches は既存 4 本のため、新規建設枠は 8。
- 開始時所有の Wind Power Plant 1 基は上限計算から除外するため、初期マップで同時に存在し得る総数は 9。
- 建設中の施設も枠を消費する。
- 破壊、salvage 等によって player-built の存在数が減れば枠は戻る。
- Oil Field access spur は roadBranches を増やさない。
- preview、legal actions、観測、UI、WebMCP は limit、used、remaining を同じ DTO で返す。

## 12. WebMCP 外部 AI セッション

### 12.1 対応範囲

WebMCP 対応はブラウザ上の明示的な AI play/watch セッションに限定する。ユーザーが UI の開始ボタンを押したときだけ作成し、開始前は tools を登録していてもゲーム Action を受理しない。

リリース受入では、公式ドキュメントで対応が確認できる実在クライアント一つ以上を使い、tool discovery、observe、preview、act、コメント表示まで end-to-end で確認する。ChatGPT Work と Codex の両方を必須にはしない。その他のクライアントは tested / unverified / unsupported と理由を記録し、未検証を対応済みと表示しない。

トップレベル page で document.modelContext.registerTool を feature-detect して登録する。未対応環境では AI play/watch を unsupported として無効化し、通常プレイと ZIP Replay は維持する。iframe 内登録、宣言的 DOM API、polyfill だけの discovery を対応済み判定に使わない。モード終了と page cleanup で登録を解除する。

### 12.2 固定 tool surface

公開する tool 名は次の 8 個に固定する。

1. nlth_get_context
2. nlth_observe
3. nlth_query
4. nlth_legal_actions
5. nlth_preview_action
6. nlth_act
7. nlth_get_request_result
8. nlth_get_result

この名称固定は v1.6 WebMCP adapter だけに適用する。将来の Remote MCP Plugin は、開いている page や UI 開始ボタンを持たないため、別途 session start / end 等の lifecycle tool を設計できる。両者は3.4の共通 application boundaryを呼び出すが、外部 tool surface の同一性は要求しない。

開始、pause、resume、end、export、new game、reset は UI 専用であり、WebMCP tool にしない。登録は公式に対応する imperative API を使用し、宣言的 DOM API や iframe 内登録をリリース要件にしない。

| Tool | 入力と責務 |
| --- | --- |
| nlth_get_context | 入力なし。contract versions、session generation、revision、公開目的、UI locale、操作可否、pause / end / unsupported 理由を返す。 |
| nlth_observe | 入力なし。現在 revision の bounded summary Observation と利用可能な詳細 query 名を返す。 |
| nlth_query | queryName と、その query に定義された bounded filter / cursor を受ける。経済、施設、部隊、建設、戦略マップ等の既存公開 query だけを返す。任意式、任意 path、任意 JavaScript は受けない。 |
| nlth_legal_actions | baseRevision、任意の actionKind filter、cursor を受ける。候補数と page size に上限を持たせ、巨大な全 preview を同梱しない。 |
| nlth_preview_action | baseRevision と単一 GameAction を受け、合法性、既存の戦闘・移動 preview、5章の経済 preview を返す。 |
| nlth_act | baseRevision、requestId、単一 GameAction、任意 decisionSummary を受け、一つの Decision に結び付ける。 |
| nlth_get_request_result | requestId を受け、accepted / completed / rejected / timed_out と同一の確定結果を返す。pause 中も照会できる。 |
| nlth_get_result | 入力なし。進行中は not_finished、終了後は公開終了理由と7.2の統計を返す。 |

配列長、再帰深度、文字数、座標、page size は Browser Bridge の既存上限以上に緩めない。自由形式 query、Core の生 GameState、save snapshot、hidden metrics、RNG state、AI の内部思考を返す tool は追加しない。

### 12.3 act と冪等性

- nlth_act は Action、requestId、任意の decisionSummary を受け取る。
- requestId はセッション内で一意とし、同一 payload の再送は同一結果を返す。
- 異なる payload の requestId 再利用は拒否する。
- accepted / completed / rejected / timed_out を問い合わせ可能にする。
- rejected Action も Decision として reasonCode、comment、requestedCommentLocale を記録する。ただし schema validation 前の不正入力は Decision にしない。
- stale_revision、busy、paused、session_ended、request_id_conflict、unsupported を機械判定可能な error code として区別する。

書込は WebMCP と Browser Bridge で共有する単一 dispatcher に直列化する。旧 Bridge の write API を同じ dispatcher に通せない場合は live AI mode 中だけ無効化する。

一つの AI 用 AgentGame が返した公開 before / after / record を、Replay 由来の読み取り専用 renderer に直接渡す。観戦用の第二 GameEngine で Action を再実行せず、live frame を完成済み・検証済み Artifact と偽装しない。

### 12.4 セッション寿命

- live セッション状態はメモリ内だけに保持する。
- reload、tab close、page discard 後に自動復元しない。
- LLM への未送信結果の自動再送を行わない。
- ユーザーは UI から pause / resume / end できる。
- LLM は pause 中に Action を投入できない。
- explicit end または game over 後は新しい Action を拒否する。

### 12.5 Remote MCP / ChatGPT Plugin 将来互換

2026-09-13 時点の OpenAI 公式文書では、MCP server を含む Plugin は、利用可能なアカウントにおいて通常 Chat を含む ChatGPT Web / desktop / mobile で利用できる。WebMCP Site tools はこれとは別経路であり、ChatGPT desktop の built-in browser 上の Work / Codex を対象とする。製品提供条件は変わり得るため、Remote MCP 実装を計画する版で公式文書と実機を再確認する。

v1.6 は Remote MCP を提供せず、次の再利用可能性だけを受入対象にする。

- 後続版の Remote MCP server が3.4の application boundaryを呼び出し、Coreや経済式を複製せず一試合を進行できる。
- 将来の server-side Session でも session generation、revision、requestId 冪等性、comment locale、public information boundary を維持できる。
- 将来の MCP Apps UI または外部 watch page は13章の public live frameを入力にでき、別 GameEngine で Action を再実行しなくてよい。
- Remote transport 固有の authentication subject、capability、HTTP metadata、delivery URL は GameState、GameAction、Decision hash に混入させず、server / transport metadata として分離できる。
- 将来の公開観戦では write 権限と read-only watch 権限を分けられる。v1.6 で token、URL、共有設定は定義しない。
- 将来の Plugin が custom UI を描画できない client でも、tools の structured results だけで試合を進行できる。

v1.6 の通常 build は Remote service が存在しなくても完全に動作し、network listener、外部 account、API key、server credential を要求してはならない。

## 13. Live Viewer とコメント

### 13.1 表示順序

Action を受理したら次の順に表示する。

1. Decision 番号、Action、AI comment を表示
2. Action を Core に適用
3. 盤面を最新 state に描画
4. 結果、主要差分、critical alert を表示
5. 描画完了後 500 ms 保持
6. 次 Action の受付を許可

3–8 秒の強制待機や速度スライダーは設けない。コメント、Action、結果はログに残り、viewer は任意に pause できる。

### 13.2 描画 watchdog

- 描画開始から 5 秒で completion を受け取れなければ render sync failure とする。
- Core で確定済みの Action を rollback しない。
- request result は確定結果を返す。
- 新規 Action 受付を pause する。
- 最新公開 state から全描画をやり直し、ユーザーが resume するまで停止する。

### 13.3 人間操作

live AI mode 中に人間が行えるのは次に限定する。

- pan / zoom
- read-only select
- ログ閲覧
- pause / resume
- end
- Artifact export

ゲーム Action、手動 takeover、盤面状態の編集は行えない。通常の人間プレイは別セッションとして扱う。

### 13.4 モバイル

最低限 360×640 portrait と 640×360 landscape で、盤面、現在コメント、結果、pause / resume が操作可能であること。詳細ログは折り畳んでよい。

Canvas は CSS 表示サイズを維持しつつ、devicePixelRatio を最大 2、backing buffer を概ね 4.2 million pixels（2048×2048 相当）以下に抑える。上限を超える場合は内部解像度を下げる。

### 13.5 表示ログの上限

初期目標は直近 100 Decisions か JSON 等価 2 MiB のいずれか早く到達した上限までとする。古い詳細から削り、現在の Action、comment、result、critical alert は残す。省略がある場合は件数と理由を表示する。

実装または実機テストで性能問題を記録できた場合に限り、50 Decisions / 1 MiB まで縮小してよい。縮小時は端末、再現手順、計測または観察結果をテスト記録に残す。50 / 1 MiB 未満への縮小には要件変更を要する。

Canonical Session / Artifact はこの表示用上限で切り詰めない。

## 14. コメント言語

### 14.1 decisionSummary

- WebMCP と外部 AI Portable / Session の全経路で任意とする。
- 省略または空文字は「コメントなし」に正規化する。
- 値がある場合は 1–500 Unicode code points。
- 500 code points 超は Action 実行前に拒否する。
- raw comment を保存・表示し、翻訳、言語判定、指定言語違反による拒否はしない。
- comment は非信頼テキストとして textContent 相当で描画し、HTML / Markdown、link fetch、埋め込み命令を実行しない。

### 14.2 preferred locale

Browser / WebMCP は nlth_act を受理した時点の UI locale（ja / en）を requestedCommentLocale とし、prompt、tool description、context の可能な箇所でその言語による短いコメントを依頼する。

外部 AI Portable / Session はセッション作成時に preferredCommentLocale として ja / en を指定でき、そのセッション中は固定する。未指定時は en とする。

この機能は出力努力を促す実験であり、指定言語であることを成功条件にしない。

外部 AI への指示は、公開情報を根拠にした 1–3 文の短い説明を希望言語で返すよう促す。chain-of-thought、秘密情報、会話全文、外部 chat 履歴を要求しない。AI が誤った説明を返しても公式の Action result や統計を上書きしない。

### 14.3 記録と再生

- 各 Decision に requestedCommentLocale を保存する。
- 後から UI locale が変わっても既存 Decision の requestedCommentLocale と raw comment は変えない。
- Replay は raw comment と requested locale を表示できる。
- Replay のラベル等は現在 UI locale で表示してよいが、comment 本文を自動翻訳しない。

## 15. Artifact export

- WebMCP live session は game over 時とユーザーの explicit export 時に、v1.6 public Artifact ZIP を出力できなければならない。
- 既存の canonical Session / Artifact Writer を再利用し、別形式の独自ログを正本にしない。
- Action、result、decisionSummary、requestedCommentLocale、警告、最終統計を含める。
- 表示ログの 100 / 2 MiB 上限によって Canonical Session を欠落させない。
- ZIP はローカルダウンロードだけとし、自動 upload、cloud 保存、外部送信をしない。
- 途中 export はその時点までの valid session snapshot として扱う。
- canonical Artifact の組立てと配送先を分離する。組立て側はブラウザ download やローカル絶対 path を前提にせず、検証済み bytes / stream と manifest を配送 adapter へ渡せること。
- v1.6 の配送 adapter はローカル download だけを実装する。将来の Remote adapter が同一 Artifact bytes を一時 HTTP response 等で配送できる余地を残すが、その endpoint と保存期間は本書では定義しない。

## 16. Schema、保存、互換性

### 16.1 Version matrix

| 対象 | v1.6.0 |
| --- | --- |
| App / Release | 1.6.0 |
| Rules / State / Config | 10.0.0 |
| Fixed Map | fixed-51x51-v5 |
| Save | 17 |
| Agent API / Observation / Browser Bridge | 15.0.0 |
| Artifact | 14.0.0 |
| Session / Checkpoint | 11.0.0 |
| Balanced Agent | 9.0.0 |
| Random Agent | 6.0.0（据え置き） |

### 16.2 新規保存対象

- firstCaptureRewardClaimed
- Oil Field の所有、secured、worker、感染、回復状態
- initialAllowance
- oilCreditsEarned
- fuelRefined
- remainingAllowance
- Wind Power Plant 建設上限の導出に必要な player-built 識別
- Decision の decisionSummary と requestedCommentLocale

### 16.3 非互換

- v1.5.7 以前の Save、Session、Artifact、Replay は v1.6 で読み込まない。
- 旧版は reasonCode と人間向け説明を返して非破壊で拒否する。
- 自動 migration、best-effort import、暗黙の既定値補完を行わない。
- 読み込み拒否時に元ファイル、ブラウザ保存、ZIP を削除または上書きしない。

## 17. アート要件

Oil Field の runtime asset は既存施設と同じ 256×256 transparent RGBA、muted color、太い outline、低ズームで判別できる board-game token とする。

- 主役は大型 pumpjack 1 基。
- 補助要素は小型 tank と短い pipes。
- tall derrick、refinery tower、煙突、文字、ロゴ、旗を入れない。
- Refinery と silhouette が重ならず、低ズームで Oil Field と判別できること。
- 状態表現は既存 overlay を使用し、画像内に secured / infected / disabled 状態を描き込まない。
- 原生成物と provenance を Art/reference/v1.6.0-oilfield-concept/ に保持する。
- runtime 名は public/assets/board/facilities/facility_oilfield.png とし、boardAssets の registry だけを参照経路にする。

## 18. 受入テスト

| ID | 受入条件 |
| --- | --- |
| T01 | Military Goods の全国不足と補給線外需要が別 reasonCode、別 evidence で表示され、二重計上されない。 |
| T02 | workers 0 の施設停止を表示し、Wind Power Plant には同警告を出さない。 |
| T03 | Checkpoint 補正が通常 UI と fallback 経路の双方で 25 と表示される。 |
| T04 | Barbed Wire 設置直後の耐久表示が満タンになる。 |
| T05 | preview が Core 状態、RNG、revision、ActionSeq を変えない。 |
| T06 | Claude playtest decision 219 の旧 v1.5.7 経済条件を固定した preview 回帰 fixture で、無建設なら次 EndTurn の Civilian Goods は 13、人口喪失 0。1 基目の Wind 建設後は shortage 87、50 人喪失。2 基目後は shortage 187、残存 137 人全員喪失を Action 前に表示する。v1.6 の新バランスで同じ自然進行を再現することは要求しない。 |
| T07 | preview と実行結果の決定論的資源・人口差分が一致する。revision 変更時は再 preview を要求する。 |
| T08 | preview は次 EndTurn と steady-state delta を区別し、未公開の将来要素を数値化しない。 |
| T09 | current-condition support headroom と Action 後 headroom が共通 DTO で一致し、施設個数へ換算しない。 |
| T10 | Temporary Housing 20 人が Food 20、Civilian Goods 20 を消費する。 |
| T11 | 対象施設の初回 neutral→player secured で表どおりの資源を即時加算し、補給線外でも成功する。 |
| T12 | 再占領、回復、修理、再建、save/load 後に初回報酬を再付与しない。 |
| T13 | Army Base の National Guard 報酬と資源報酬が turn 20 以内で累積し、turn 21 以後にも資源報酬だけは付与される。 |
| T14 | fixed-51x51-v5 から指定 5 中立施設と専用 dead-end roads が消え、共有道路、既存施設、初期配置を壊さない。 |
| T15 | 4 Oil Fields が指定座標、neutral、unsecured、workers 0 で開始し、各 1-hex spur は roadBranches に数えない。 |
| T16 | Oil Field は必要条件を満たす healthy worker 1 人につき同 turn allowance を 100 増やし、5 人で 500 増やす。停電や Fuel 不足だけでは停止しない。 |
| T17 | initial 5,000 allowance は全国共有で、複数 Refinery が facilityId 昇順で消費し、0 時は精製用電力を消費しない。 |
| T18 | recapture、recovery、rebuild、save/load で allowance がリセットされず、Oil Field credits は恒久加算される。 |
| T19 | Wind Power Plant は player-built 8 基まで建設でき、9 基目を拒否する。開始時 1 基と spur を上限計算から除外する。 |
| T20 | enemyKillsTotal が全敵タイプ別集計の合計と一致する。Claude r2 trace の最終期待値は 175。 |
| T21 | resourceShortageLossesTotal と finalEconomyResourceShortageLosses を分離する。Claude r2 trace の期待値は累積 352、最終 economy 137。 |
| T22 | WebMCP の 8 tools だけが固定名で discovery され、UI 専用操作が tool として公開されない。 |
| T23 | 公式対応クライアント一つ以上で discovery→observe→preview→act→comment/result 表示を end-to-end 確認する。 |
| T24 | 同一 requestId / 同一 payload は同一結果を返し、Action、comment、locale のいずれかが異なる再利用を拒否する。 |
| T25 | WebMCP Action が盤面再描画、result、500 ms 保持の順で進み、pause 中と end 後は Action を受理しない。 |
| T26 | 描画が 5 秒完了しない場合も Action は一度だけ確定し、受付を pause、最新 state 再描画後にユーザー resume を待つ。 |
| T27 | decisionSummary の省略・空は成功し、1–500 code points は保存され、超過は Action 前に拒否される。 |
| T28 | Browser は act 受付時の UI locale、Portable / Session は開始時指定、未指定は en を requestedCommentLocale に保存する。コメント言語自体は検査しない。 |
| T29 | UI locale 変更後の Replay でも raw comment と記録済み requested locale が変化しない。 |
| T30 | 100 Decisions / 2 MiB の live 表示上限で古い詳細だけを省略し、canonical Artifact は完全なまま。縮小時は性能根拠が記録され、50 / 1 MiB 未満にならない。 |
| T31 | 360×640、640×360、DPR 2 端末で盤面、現在 comment、result、pause / resume が利用でき、buffer が約 4.2M pixels 以下。 |
| T32 | game over と explicit export で v1.6 public Artifact ZIP を生成し、comment と requested locale を再生できる。 |
| T33 | reload / tab close 後に live session を自動復元せず、未送信 Action を再実行しない。 |
| T34 | v1.5.7 以前の Save、Session、Artifact、Replay を理由付きで非破壊拒否する。 |
| T35 | Oil Field runtime asset が透明 256×256 で registry 経由表示され、低ズームで Refinery と区別できる。 |
| T36 | transport-neutral AI Session boundary を DOM / window / document が存在しない test runtime で生成し、context→observe→legal actions→preview→act→result を実行できる。 |
| T37 | 同じ seed、同じ Action、同じ comment / locale を直接 application boundary と WebMCP adapter に与え、public DTO、revision、reasonCode、Decision hash が一致する。 |
| T38 | 二つの Session instance を同時生成しても GameEngine、revision、request ledger、requestId が交差せず、global singleton を共有しない。 |
| T39 | canonical Artifact builder が一つの immutable byte sequence と manifest を生成し、browser download sink と test memory sink がそれを無変換で受け取れる。配送 adapter の違いは Decision / payload hash を変えない。 |
| T40 | Remote service、network、API key、外部 account が存在しない環境で通常 play、WebMCP、Portable / Session、Replay の対象テストが成功する。 |

## 19. 実装順序

1. Version constants、State / Save / Session schema
2. capture reward ledger、Oil Field、allowance、固定マップ v5
3. Temporary Housing、Wind 上限
4. Core query DTO: alerts、preview、headroom、wave、stats
5. transport-neutral AI Session application boundary
6. Agent / Observation / Browser Bridge 15.0.0
7. live viewer、comment locale、WebMCP adapter / tools
8. Artifact 14.0.0 builder、local delivery、replay
9. Oil Field asset の runtime 統合
10. unit / integration / regression / mobile / real-client tests
11. 実装完了後に現行仕様へ反映し、確定要件を archive へ移す

## 20. プレイテスト証跡の扱い

[Claude playtest r2 REPORT](../output/claude-playtest-20260912-r2/REPORT.md) は非規範の発見資料とし、実装期待値は [trace.ndjson](../output/claude-playtest-20260912-r2/sessions/claude-0912-r2/trace.ndjson) の Decision 差分で確認する。

- decision 219 後の Civilian Goods: 273 + 37 - 297 = 13、人口喪失 0
- 1 基目建設後の次 economy shortage: 87、人口喪失 50
- 2 基目建設後の次 economy shortage: 187、人口喪失 137
- 累積 resource shortage losses: 352
- 最終 economy phase の resource shortage losses: 137
- 敵タイプ別合計: 175

REPORT の「最終 turn に352人喪失」と「敵撃破171」は上記の実装期待値に使わない。352 は累積値であり、171 は一部敵タイプが欠けた集計である。

decision 219 周辺の値は preview の計算回帰に使う固定 fixture であり、Temporary Housing の維持費等を変更した v1.6 の通常プレイが同じ状態へ到達することは要求しない。

play-turn 二重起動の hang は確定不具合と扱わない。session lock の回帰テストを維持し、2 個目が session_locked で速やかに終了すること、stdout / stderr の呼び出し側 drain 手順を補足する。

旧 Update_plan2 および存在しない Doc/analysis への参照は要件根拠にしない。

## 21. 参照

- [現行仕様](./Nowhere%20Left%20to%20Hide%20PoC%20現行仕様.md)
- [Claude playtest r2](../output/claude-playtest-20260912-r2/REPORT.md)
- [OpenAI WebMCP / Site tools 公式文書](https://learn.chatgpt.com/docs/webmcp)
- [OpenAI Plugins 公式文書](https://learn.chatgpt.com/docs/plugins)
- [OpenAI MCP server 実装文書](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI MCP Apps UI 実装文書](https://developers.openai.com/plugins/build/chatgpt-ui)

## 22. 確定事項

本書の各数値、座標、tool 名、version、互換方針、言語既定値、性能下限は確定事項である。「提案」「推奨」「未確定」として実装者の選択に戻してはならない。

許容される実装時裁量は次だけとする。

- live 表示上限は、性能問題を記録した場合に限り 100 / 2 MiB から 50 / 1 MiB まで縮小できる。
- JSON 表示は canonical data を壊さない範囲で冗長な旧詳細を省略できる。
- 対応クライアントは公式情報と実測結果に応じ tested / unverified / unsupported を明記できる。
- 3.4 の責務、DTO、instance 分離、依存禁止を満たす限り、transport-neutral application service / port の内部型名、module 名、file 配置は実装時に選べる。

それ以外の要件変更は、要件文書を改訂してから実装する。
