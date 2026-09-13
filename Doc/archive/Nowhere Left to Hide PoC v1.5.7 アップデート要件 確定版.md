# Nowhere Left to Hide PoC v1.5.7 アップデート要件 確定版

- ステータス: 要件確定・実装／現行仕様への反映済み。通常回帰、公開Pagesの実ブラウザ動作、両OS Portableの完遂を確認。長時間Workflowは依頼に従い起動確認まで（結果未確認）。
- 確定日: 2026-09-12
- アセット承認日: 2026-09-12。採用source: `Art/reference/v1.5.7-barbed-wire-concept/barbed-wire-candidate-v1.png`（生成記録は同フォルダのREADME.md）。後続実装ではこの承認素材を使用する。
- 作成日: 2026-09-11
- 基準: `Nowhere Left to Hide PoC 現行仕様.md`（v1.5.6）
- 対象: AI Portable / Sessionの負担軽減、AI向け情報可読性、ランダムマップ準備の公開Query、有刺鉄線ビジュアル、有刺鉄線HP調整、Horde Zombie Attack Charge調整
- 非対象: ランダムマップ本体、WebMCP、ChatGPT Site tools、Remote MCP、外部AIサービス向け専用Adapter、外部LLMの勝率保証
- 根拠: v1.5.6現行仕様・実装、`output/claude-playtest-20260910/`（seed 11）、`output/claude-playtest-20260910-r2/`（seed 23）の公開応答・レポート、および本タスクの一問一答16件。レポートの自己診断をゲーム仕様とみなさない。

本書はv1.5.7の確定実装目標を定める。以下の「未着手」「後続実装」「本書作成時点」は要件確定時点の記録である。実装・検証結果は現行仕様18.7に記録し、公開確認前の項目を成功済みとして扱わない。

文書のarchive移動に伴う現行仕様の参照パス修正は、ゲーム仕様変更に含めない。今回は要件確定とアセット候補の生成・確認までを行い、ゲーム実装・runtime登録は後続作業とする。19章は一問一答で合意した内容と、その実装・検証上の境界を定める。

## 1. 目的・基本方針

### 1.1 目的

- 背景として、ChatGPT、Claude、Gemini等のWeb上のAIにも遊んでもらえる環境を目指す。現在利用できるインフラではNode同梱Portable ZIPを実用的な配布経路とし、既存機能を可能な限り効率化する。将来WebMCP等を利用できる機会に備えた責務分離も独立した目的とする。ZIPだけで全Web AI環境での実行を保証するものではない。

- Node同梱AI Portableを引き続き、ChatGPT、Claude、Gemini等のローカルファイル実行能力を持つ環境で共通利用できる正式なAIプレイ経路として維持する。
- Portable ZIPの展開量、ファイル数、Sessionの保存量、AIへ返すJSON量について、AI向け情報可読性、Fair Play、Replay再現性、Resume安全性を落とさずに削減できる余地を調査し、安全な改善だけを採用する。
- AIが重要な状態変化、施設停止理由、資源依存、戦略的位置関係を固定マップの座標暗記に頼らず判断しやすくする。
- 将来ランダムマップを追加した場合も、AIがRaw Hex全件を毎回読むことを前提にしない公開Query境界を準備する。
- 将来WebMCP等の別Transportを検討するとき、Game Coreや公開判断ロジックを作り直さずAdapterを追加できる責務分離を維持する。ただしv1.5.7ではWebMCP等を実装しない。
- 有刺鉄線の盤面表示を、国境・封鎖線で使われるような金属フェンスと有刺鉄線／コンサーティーナワイヤを組み合わせた専用ビジュアルへ置き換える。
- 有刺鉄線Max HPを10から20へ変更する。
- Horde Zombieの最大Attack Chargeを2から4へ変更する。

### 1.2 効率化の評価方針

- Portable / Session効率化には、ZIP容量、展開後容量、ファイル数、Session容量、1応答のJSON byte数等について必達の数値目標を設定しない。
- 理由は、主な利用対象が実際のWeb版ChatGPT、Claude、Gemini等であり、それらに対する大量・反復の実サービス試験を受入条件にすると、サービス側負荷、利用制限、費用、規約上の配慮の点で不適切になり得るためである。
- 外部Webサービス上の反復ベンチマーク、限界値探索、失敗するまでの連続アップロード／展開／コマンド実行は行わない。
- ローカルNode、GitHub Actions、既存のBrowser-safe Reader、fixture、単体・統合テストで、変更前後のPackage size、展開サイズ、ファイル数、Session size、代表応答size等を観測可能な範囲で記録する。
- 改善量が小さい、または安全に削減できない領域は現行維持を許容する。効率化を理由に必要な公開情報、Replay再現性、障害復旧性を削らない。
- 「小さくなったこと」自体をゲーム仕様上の成功条件にせず、「不要な重複や開発用依存を配布・通常応答へ持ち込まない構造へ改善したこと」を主眼とする。

### 1.3 アーキテクチャ原則

- Game CoreはUI、CLI、Session永続化、将来のWeb/MCP Transportから独立させる。
- 状態変更は引き続きGameAction → GameEngine経由とする。
- Forecast、Crisis、Strategic Map、Route、Entity Projectionは、公開情報のみを読む純粋QueryとしてCore/Agent側へ置く。
- Session CLIはTransport/永続化Adapterとして上記Queryを呼び、ゲームルールや意味判定をSession CLI固有コードへ複製しない。
- 将来別Transportを追加しても、同一の公開ProjectionとGameAction契約を再利用できることを設計基準とする。
- v1.5.7ではHTTP server、WebMCP登録、ブラウザAgent Console、外部認証、クラウドDBを追加しない。

## 2. AI Portable配布物の効率化

### 2.1 現行構成の扱い

- 現行Linux/Windows AI Portableは、リポジトリ一式、`node_modules`、Node runtimeを配布物へコピーし、その上で`src/session/session-cli.ts`を`dist/portable/session-cli.mjs`へbundleしている。
- AIによる通常プレイの正規入口はSession CLIとし、毎ActionでViteやTypeScript変換を起動しない現行方針を維持する。
- v1.5.7では、bundle済み`session-cli.mjs`が実際に必要とするruntime dependencyと、開発・テスト用にのみ必要なファイルを明確に分ける。

### 2.2 Player用Portableの最小化

- GitHub Actionsが生成する通常のAI Portableを「Player package」として扱い、AIがゲームをプレイ・再開・Query・Artifact出力するために不要な開発ファイルを配布物から除外する方向で整理する。
- Player packageの最低限の構成は、以下を基準とする。
  - bundled Node runtime
  - bundled `session-cli.mjs`
  - Linux/WindowsのSession launcher
  - `PLAY_WITH_AI.md`
  - Build / Version identity
  - 本配布に必要なLicense / Notice
  - Session実行に実際に必要と検証で判明した追加ファイル
- `node_modules`全体、TypeScript source全体、Vite、Vitest、開発用script、Board runtime画像等を、Session CLI実行に不要であることをテストで確認できる場合はPlayer packageから除外する。
- 「削除候補だから削る」のではなく、クリーンな最小Packageから全Session commandを実行するsmoke testを正本とし、実行依存が判明したファイルだけを戻す。
- Repository自体はGitHubで引き続き完全公開する。カスタムTypeScript driver、Built-in Agent開発、UI開発、テスト実行はRepository checkoutを開発経路とし、通常AI Player packageへ開発環境一式を同梱することを必須としない。
- `run-npm` / `run-vite-node`をPlayer packageから外す場合は、`PLAY_WITH_AI.md`で「Portable Player」と「Repository development」の導線を明確に分離する。既存ユーザーが誤ってPortableに開発環境一式があると期待しない文面に更新する。
- Linux/Windows間でPlayer packageの能力差を作らない。

### 2.3 配布検証

- Package組立前のRepository環境で、Typecheck、unit/integration tests、build、必要なrelease validationを実行できるようにする。
- 組立後のPlayer packageでは、開発依存を必要としない以下のsmokeを行う。
  - `--help`
  - `new`
  - `status`
  - `play-turn`
  - `step`
  - `query`
  - `save-checkpoint`
  - `list-checkpoints`
  - `load-checkpoint`
  - `artifact`
  - Session resume
  - Replay / Artifactの整合確認に必要な最小検証
- Player packageの検証のために、配布物へテストsourceや`node_modules`を戻す構成にはしない。検証driverが必要ならActions側のcheckout環境から実行し、Player packageを外部対象として呼ぶ。
- 変更前後のZIP bytes、展開bytes、ファイル数をCI記録へ残すことは推奨するが、削減率の合否閾値は置かない。

## 3. Session保存・応答の効率化

### 3.1 現行Storeの長所を維持

- 現行Session Storeのcontent-addressed payload、gzip、chunk、fixed mapの単一保存、lossless public diff、一定間隔のpublic snapshot、hash chain、bounded cacheを維持する。
- 効率化のためにSessionを単一巨大JSONへ戻したり、毎DecisionでFull Snapshotを複製したりしない。
- Replay、Checkpoint branch、request idempotency、stale revision、破損検出を弱めない。

### 3.2 低リスクの冗長性調査

- ローカルfixtureで長めのSessionを生成し、以下の占有割合を測定する。
  - public payload pool
  - private payload pool
  - legal action payload
  - repeated event/history projection
  - Decision record
  - request index
  - checkpoint metadata
  - lock/diagnostic history
  - Artifact package
- 同一内容の重複、毎Revisionでの不要な再保存、極端な小ファイル増加、通常Resumeに不要な履歴複製が確認された場合だけ改善する。
- 既にCAS/gzip/diffで十分に抑制されている領域は、追加圧縮や複雑な独自formatへ変更しない。
- Session schemaの複雑化に対し実益が不明な最適化は採用しない。

### 3.3 Public ObservationとSession Compactの分離

- 完全な`AgentObservation`はFair Play上の公開情報の正本として維持する。
- `status`、`new`、`step`、`play-turn`が返すCompactは「意思決定に必要な小さいDecision Packet」として扱う。
- Compactへ全Tile、全Construction candidate、全Legal Action、全Move candidate、全Attack previewを無制限に埋め戻さない。
- 重い詳細はRevision-pinned `query`へ残し、Compactには重要項目、件数、summary、detail query導線を返す。
- `full-snapshot`は互換・診断用に維持してよいが、通常のAIプレイ手順では推奨しない。
- README/`PLAY_WITH_AI.md`の推奨操作を`status / play-turn compact → 必要なtargetだけquery`へ統一する。

## 4. AI向け情報可読性

### 4.1 Compact Facility情報

- CompactのFacility項目を、現在の`id/type/position/status/owner/population/inSupply`だけではなく、判断に直接必要な小さい状態へ拡張する。
- 少なくとも以下を返す。
  - `operationalStatus`
  - `populationCapacity`
  - `populationOperational`
  - `populationUnavailableReason`
  - `populationIncreaseAvailable`
  - `populationDecreaseAvailable`
  - `production.stoppedReason`
  - `production.projectedPowerReason`
  - `recovery.status`
  - `recovery.missingConditions`
- 完全なFacility production表、入力出力表、全Recovery補足は`query facilities`を正本とし、Compactへ複製しない。
- ruined、感染、新規確保待ち、recovering、人口上限、人口供給不足、給電不足をAIが試行錯誤せず区別できることを目標とする。

### 4.2 重要変化のSemantic Summary

- 現行`SessionStateDelta`の`facilityChanges`、`branchFlowChanges`、`newlyInfectedSites`、`newlyRuinedSites`、Enemy発見、Unit HP/Supply、Checkpoint role変化を維持する。
- これらから公開情報だけで導出できる、少数の`importantChanges`をAction Resultに追加する。
- `importantChanges`は少なくとも以下の構造を持てるようにする。
  - stable/diagnostic ID
  - severity: `critical | warning | advisory`
  - category
  - entity IDs
  - reason codes
  - related public event types
  - bounded consequences summary
- consequencesは既存公開Forecastやbefore/after Observationで確定できるものだけに限定する。Hidden enemy、PRNG、未開始Wave、内部Targetを推測して埋めない。
- 例として、Player所有Civilian Factoryの陥落では「ownership/status change」「production lost」「Civilian Goods依存リスク悪化」を関連付けられる。
- 発電所陥落では、単なる`electricityCapacity`減少だけでなく、公開EventとFacility statusから「power source lost」を識別できる。
- 同じ事象を`events`、`stateDelta`、`crisisSummary`、`importantChanges`で巨大に重複させない。Compact側は少数summary、詳細は既存Event/Queryを参照する。

### 4.3 Resume時の重要変化

- `play-turn`中のAction Resultだけでなく、後続応答でSessionを再開したAIが直前の重大変化を見落とさない導線を用意する。
- `status`で直近のEndTurn処理中の重要変化と、その完了後から現在Revisionまでの操作中の重要変化を返す。EndTurn前ならSession/branch開始から現在までを対象とする。
- 重要度順で最大10件、総件数、省略件数、範囲、同じRevisionの`history` detail query導線を返す。詳細は19.2に従う。

### 4.4 危険なCombat PreviewのCompact要約

- 完全な`attackPreviews`とGas chain previewは`query units`を正本とする。
- Compactには、現在合法な攻撃のうちPlayer側に重大な確定副作用を持つものを`combatHazards`として最大5件、攻撃元・攻撃対象・被害対象を伴って必ず要約する。詳細Queryへの案内だけで代替しない。超過件数と詳細Query導線を返す（19.3）。
- 最低限、Gas Zombieへの致死攻撃により現在公開済みの味方Unitが死亡する見込み、Player施設/Checkpointがfallする見込みを識別できること。
- Hidden entityの存在でhazard entryの有無を変えない。公開Previewと同じFair Play境界を使用する。
- 単なるDamage数値の全件列挙はCompactへ追加しない。

### 4.5 Query Contractの機械可読性

- `query api`で各Query targetの利用可能filters、必須/任意field、pagination、返却形を機械可読に取得できるようにする。
- 現在文章で説明しているfilter contractを、AIが誤った`filters`形を試行して学習しなくてもよい形式へ寄せる。
- 少なくとも`map`、`units`、`facilities`、`construction`、`legal-actions`、`forecast`、`history`、`population-transfers`、`worker-assignments`、本版で追加する戦略Queryを対象とする。
- 人間向け説明文は残してよいが、Action/Queryの正しいパラメータを自然言語だけに依存させない。

## 5. 資源依存Forecastの改善

### 5.1 現行Dependency Forecastの拡張

- 現行`strategicForecast.resources`のcontributors、largest contributor、largest contributor喪失時供給、shortage、singlePointOfFailureを維持する。
- 「現在Stockがあるため今Turnは不足しないが、主要生産源を失うと短期間で枯渇する」状態を表現できるよう、各Resourceへ以下の公開Projectionを追加する。
  - current stock（Electricityを除く）
  - projected current production
  - largest contributor output
  - production without largest contributor
  - current demand basis
  - net burn without largest contributor
  - estimated stock runway turns without largest contributor
  - assumption / unavailable reason
- Runwayは将来乱数を予測しない。現在の人口、需要、生産条件が継続するという静的仮定に基づく推定値と明示する。
- Electricityは非貯蔵ResourceなのでStock runwayとして扱わない。主要電源喪失直後の不足有無・shortageを別fieldで表す。
- 無限、ゼロ、計算不能を同じ数値で表さず、null/reason等で区別する。

### 5.2 Crisisとの接続

- 主要生産源を仮想的に失った場合のリスクは参考情報とし、それだけではCrisis停止を起こさない。実際の現状態で不足が迫る場合は、施設喪失・停止、人口増加、過密、燃料不足等の原因を問わず既存Crisis systemへ接続し、原因を別に示す。
- 必要なら`resource_dependency_risk`等の安定Reason Codeを追加する。
- 既存`new_state_loss`を無条件にcritical化しない。Facility lossそのものと、その結果生じるResource riskを分離する。
- `new_crisis` / `crisis_worsened`の既存play-turn停止契約を再利用し、新しいtransport-specific停止機構を作らない。
- 貯蔵資源は、次のEndTurnを1回目として不足が3回以内ならwarning、1回目ならcriticalとする。需要を全て賄って在庫0になるだけでは不足としない。電力と既存の確定敗北判定は既存契約を維持する。計算境界は19.4に従い、Seed別に閾値を変えない。

## 6. Strategic Map / Route Query

### 6.1 目的

- 固定51×51 Mapの2601 Hexや将来さらに大きなMapを、AIが毎Turn全件読み直すことを前提にしない。
- Facility座標とnorth/east/south/westの固定配置をAIが暗記しなくても、施設、入口、幹線、交差点、Checkpointの関係を判断できるようにする。
- v1.5.7ではMap生成規則自体をランダム化しない。

### 6.2 `strategic-map` Query

- `SessionQueryTarget`へ`strategic-map`を追加する。
- Core/Agent側に、公開Mapから戦略グラフを導出する純粋Queryを追加する。
- Node候補は以下を基本とする。
  - Capital
  - permanent / constructible Facilityの道路接続点
  - Checkpoint
  - Horde / refugee entrance
  - road junction
  - 必要に応じrole transition点
- Road Networkの単純なdegree-2直線区間はEdgeへ圧縮し、全Road HexをNode化しない。
- Edgeは少なくとも以下を返す。
  - from / to node ID
  - public coordinates of endpoints
  - length
  - road roleまたはrole集合
  - branch IDが一意に該当する場合のbranch reference
- 方向名`north/east/south/west`を主キーにしない。`branchId`、Node ID、Facility ID等を主識別子とし、directionは現在Mapの表示属性として残す。
- Hidden enemy、内部Zombie target、未公開Wave情報をgraphへ混入させない。
- Strategic graphはMap topologyから導出し、Map generatorがAI専用graphを別途持つ二重正本にはしない。

### 6.3 `route` Query

- `SessionQueryTarget`へ`route`を追加する。
- source/targetは可能な限りUnit ID、Facility ID、Checkpoint ID、Strategic Node IDで指定できるようにする。Raw coordinate指定は補助的に許容してよい。
- 既存pathfinding、terrain movement cost、Road、公開占有、Supply Queryを再利用し、新しい独立pathfinderをSession層に作らない。
- 返却summaryは少なくとも以下を含める。
  - reachable / unavailable reason
  - resolved source/destination
  - strategic node sequence
  - total terrain/effective movement costまたは該当するcost summary
  - road distance / road-role summary
  - current single-action reachability
  - public supply transition summary
- Raw Hex pathは必要時だけ取得できるようにし、default応答へ長大なpath配列を強制しない。`includeHexPath`等の明示filterを使用してよい。
- Route Query自体はGame Stateを変更しない。
- 自軍Unitを移動主体に指定した場合は実際の移動条件、施設・Node間だけの指定は参考経路とする。施設中心Hexへの到達と隣接Hexへの接近を区別する。公開情報による到達見込みであり、Hidden enemyによる中断は保証しない。詳細は19.5に従う。

### 6.4 Raw Map互換

- 既存`query map`を削除しない。
- 局所Hex、terrain、visibility、厳密position確認にはRaw Map Queryを利用できる。
- `PLAY_WITH_AI.md`では、初回戦略把握に`strategic-map`、詳細確認に`route` / 局所`map`を使う順序を推奨し、通常判断で`full-snapshot`全件を読む必要がないことを明記する。

## 7. 将来Transportへの負債を増やさないための境界

- v1.5.7ではWebMCP、Remote MCP、ChatGPT Plugin、Agent Consoleを実装しない。
- ただし新しい`importantChanges`、Strategic Map、Route、Resource DependencyはCLI stdout専用formatter内に実装しない。
- Transportから独立したTypeScript型と純粋関数として公開Projectionを定義し、Session CLIはJSON serializationとRevision/Store管理だけを担当する。
- Query input/outputはJSON-compatibleなplain dataとし、callback、DOM、filesystem handle、Node stream等をCore Query contractへ入れない。
- Sessionの`query` targetとAgent APIのQuery helperが同じ意味論を共有できるようにする。
- 将来ブラウザ内AdapterやMCP Adapterを追加するとき、Game Coreをimportして任意コード実行させるのではなく、同じbounded public QueryとGameActionだけを公開できる構造を目標とする。
- v1.5.7の受入条件に将来Transportでの実動作を含めない。

## 8. 有刺鉄線ビジュアルアセット

### 8.1 目的・外観

- 現在のBoard Asset Registryには有刺鉄線専用runtime画像がないため、専用assetを追加する。
- 見た目は「細い線だけのワイヤ」ではなく、国境・封鎖線・検問防御等で使われるような、金属フェンス／支柱と上部または前面の有刺鉄線・コンサーティーナワイヤを組み合わせた障害物とする。
- 現実の特定国家、軍、警察、国境施設を再現しない。旗、国章、実在ロゴ、文字、警告標識の固有意匠を入れない。
- ゲーム盤の24〜34px程度の表示でも「道路」「Checkpoint」「Facility」「Unit」と区別できる太いsilhouetteを優先する。
- 過度なフォトリアル表現、流血、人体、地雷等を含めない。

### 8.2 Asset契約

- 既存Board asset方針に合わせ、runtimeは256×256 RGBA PNGとする。
- 透明背景と十分なpaddingを持つ。
- 推奨runtime pathは`public/assets/board/obstacles/obstacle_barbed_wire.png`とし、Board Asset Registryに`obstacles.barbedWire`等の明示的categoryを追加する。
- Barbed WireをFacilityやUnit asset categoryへ偽装しない。Core typeは引き続き独立障害物とする。
- 承認した高解像度source、生成prompt、provenanceを`Art/reference/v1.5.7-barbed-wire-concept/`に保持し、runtime derivativeだけを通常preload対象にする。
- `ASSET_MANIFEST.md`へ生成日、生成手段、source/runtime対応、license/provenance、runtime fileを追記する。
- 原則として既存assetと同じOpenAI組み込み画像生成を利用し、本Repository向けに新規生成したオリジナル素材とする。第三者画像のトレースや無断素材利用をしない。
- 要件確定版生成後、同じタスクでアセット候補を生成・提示する。ユーザーが確認・承認したsourceを上記referenceフォルダへ保持し、後続実装でそのsourceからruntime画像を作る。確認前の候補を承認済みと記載せず、通常preloadへ登録しない。

### 8.3 Art direction

- top-downまたはnear-top-downの2D board-game / war-game style。
- muted earth / olive / slate / dark teal系の既存盤面になじむ金属灰色・暗色を主体とする。
- 短い金属mesh fenceまたは支柱列に、明瞭な有刺鉄線／concertina coilを組み合わせる。
- asset単体でHexを完全に塗り潰さず、下のterrain/roadが一部読める構成とする。
- Human Unitが同Hexにいる場合でもUnit silhouetteを隠し切らない。描画順はterrain/road等の下地より上、主要Unit表示より下またはUnit識別を妨げない専用layerとする。
- 壁HPは画像へ数字として焼き込まない。20/20等のHP表示、選択、hover、damage状態は既存dynamic UIで扱う。
- damage段階別の別画像は必須としない。1asset + dynamic HPを正本とする。

### 8.4 Fallback

- Asset load失敗時にゲーム進行不能にしない。必要なら現行のprimitive/code-drawn表現をfallbackとして残してよい。
- Fallbackは通常時の正規表示にしない。
- Board Legend / Helpでも同じruntime assetを利用する。

## 9. 有刺鉄線バランス変更

### 9.1 Max HP

- Barbed Wire Max HPを`10 → 20`へ変更する。
- 建設時HPは20。
- 修理、自然回復、売却、返金、Upgradeは引き続きなし。
- 建設費Civilian Goods 5 + Military Goods 5、Human entry MP5、放射方向minimum distance 3、視界・補給・配置条件、Gas非吸収等のv1.5.6規則は変更しない。
- UI、Help、Legend、Agent API、`BARBED_WIRE_RULES`、Preview、test fixture、現行仕様のHP表記を20へ統一する。

### 9.2 Human肩代わり

- 既存のwall-first damage、余剰DamageのHumanへの貫通、Human側terrain軽減、Gas非肩代わり規則を維持する。
- HP20を前提にpreviewを再計算する。
- 例:
  - Fresh wall HP20へDamage5: wall HP15、Human Damage0
  - Fresh wall HP20へDamage20: wall消滅、Human Damage0
  - Fresh wall HP20へDamage25、Humanにterrain軽減なし: wall消滅、Human Damage5
- minimum 1 damageは貫通0には適用しない現行規則を維持する。

### 9.3 Zombie突破評価

- `wireBreakCost`等の突破評価は、wall HP20と各Zombieの現在Attack / remaining Charge / max Chargeから既存式で自動導出する。
- HP20専用のHorde優遇値や固定突破Turnを別にhard-codeしない。
- 壁破壊時のpath/cache invalidation、残MP移動、Human隣接停止、基地迎撃、行動済みUnitの非再行動を維持する。

## 10. Horde Zombie Attack Charge変更

### 10.1 基本値

- `hordeZombie.maxAttackCharges`を`2 → 4`へ変更する。
- Horde Zombie以外のZombieのAttack Chargeは変更しない。
- Human Veteran等のAttack Chargeも変更しない。
- Player Turn / Zombie phase開始時のCharge初期化、消費、public projection、Replay、Saveの既存一般ロジックを再利用し、Horde専用counterを追加しない。

### 10.2 4 Chargeの意味

- Horde Zombieは既存のAttack可能条件を満たす限り、同一enemy phase中に最大4回までAttack Chargeを消費できる。
- 1回のAttackごとに通常どおり1 Chargeを消費する。
- 4 Chargeは攻撃力4倍を意味せず、1 AttackのDamage、range、movement、vision、HPは変更しない。
- 壁単独への攻撃、壁上Humanへの攻撃、通常Humanへの攻撃について、既存の一般Attack処理がChargeを消費する。
- 空の壁を破壊後に残MPで移動できる既存特例を維持する。Chargeを使い切ったことだけを理由に移動を禁止しない。
- Humanを攻撃した後の既存の再移動禁止等は維持し、4 Chargeを理由に移動→Human攻撃→再移動を許可しない。

### 10.3 HP20 Barbed Wireとの期待関係

- Horde ZombieのAttack 5が現行値のままである場合、Fresh Barbed Wire HP20に4回攻撃できれば、そのenemy phase内に合計20 damageで破壊できる。
- この挙動はHP20と4 Chargeの自然な組合せとして許可し、Fresh wallだけを特別に4回目で破壊する例外処理は追加しない。
- Charge不足、事前に別ActionでChargeを消費した状態、攻撃不能、死亡、interruption等では当然4回すべてを保証しない。
- 壁上Humanでは、各Attackごとに残壁HPを再評価してwall-first damageを適用する。1回のまとめDamageとして処理しない。

## 11. AI/API/文書への数値反映

- `query api`のZombie rules、public Unitの`maxAttackCharges`、current `attackChargesRemaining`、Attack PreviewをHorde 4 Chargeに一致させる。
- Barbed Wire static rules、wire HP projection、wall combat projectionをHP20に一致させる。
- CompactがUnitのAttack Chargeを返す既存契約を維持する。
- `PLAY_WITH_AI.md`、Help、日英UI、Board Legend、現行仕様、関連fixtureの数値を更新する。
- 旧文書archiveを書き換えて歴史的数値を新値へ置換しない。

## 12. 保存・互換性・Version

### 12.1 Version方針

- 実装完了時に`APP_VERSION`を1.5.7へ更新する。
- Barbed Wire HPとHorde Attack ChargeはGame Rule変更なので`GAME_RULES_VERSION`を更新する。
- Public Observation / Query / Compact / SessionStateDeltaへfield/targetを追加するため、Agent API / Observation / Bridgeのversionを更新する。
- Sessionのpersisted public document、Decision record、Query contract、Artifactが変更される場合はSession / Checkpoint / Artifact schemaも対応して更新する。
- Save内にUnitの`maxAttackCharges`等が保存されるため、v1.5.6のPrivate Saveをv1.5.7で黙って継続してHordeだけ2 Chargeのまま残す状態を許可しない。
- Migrationは実装しない。Save Formatを更新し、v1.5.6以前のSave・Session・Checkpoint・公開Artifact/Replayを明示的にrejectする。旧形式の観戦互換性も不要とする。
- CLIとUIで非対応Version/形式である理由と、新規v1.5.7ゲーム/Session開始の案内を示す。旧データを黙って補正・上書きしない。v1.5.7内での保存・再開・分岐・観戦は維持する。

### 12.2 Session Store

- Store効率化によるformat変更は、必要性が確認できるものだけにする。
- schema bumpを避けるために不正確な互換性を装わない一方、単なるPackage file削減だけで不要なSession schema bumpを行わない。
- v1.5.7のSession/Artifactがv1.5.6以前と非互換であることをCLI error、観戦UI、`PLAY_WITH_AI.md`、実装完了後の現行仕様で明示する。

## 13. UI

- Barbed Wire assetを通常Board、Legend、選択表示へ統合する。
- wall HP20、現在HP、建設費5/5、Human MP5、修理不可を既存の情報導線で確認できる。
- HumanとBarbed Wireが同Hexに存在する場合、両者を視覚的に識別できる。
- 低ZoomでもBarbed Wireが道路線やCheckpoint ringだけに見えないことを確認する。
- Horde Zombieの4 ChargeはUnit detail/helpで表示し、4回攻撃可能性を「Attack 20」等と誤表現しない。
- PC/モバイル相当viewportで、asset追加により選択、hover/tap、HP表示が隠れないことを確認する。

## 14. テスト・検証

### 14.1 Portable / Session

- Player packageから開発依存を削った状態で全Session CLI command smokeを実行する。
- Linux/Windowsの双方でnew → play-turn/query/action/EndTurn → status resume → checkpoint branch → artifactを確認する。
- Runtimeに不要と判断したファイルが実行時に暗黙参照されていないことを確認する。
- 代表的なローカルSessionで変更前後のZIP bytes、展開bytes、file count、Session bytes、代表Compact bytesを記録する。数値合否閾値は置かない。
- 大容量synthetic fixtureを使用する場合もローカル/CIに限定し、ChatGPT/Claude/Gemini Webへ限界試験を反復投入しない。
- Session hash、Replay一致、request idempotency、Checkpoint branch、corruption detectionを回帰確認する。

### 14.2 AI可読性

- ruined発電所に対し、Compactだけでruined/operation不能を識別でき、AssignWorkersを試さないための理由が得られる。
- Simple Farm等のhard population capacityと現在人数をCompact/Facility Queryで識別できる。
- Civilian Factory等の主要生産施設喪失時、Action Resultのimportant changeとResource Dependency Forecastから、生産源喪失と推定runwayを識別できる。
- Fuel shortage、power source lost、allocation priority、infection、recovery待ちを同一の「workers disappeared」等へ潰さず区別できる。
- Gas Zombie致死Attackで、現在公開済み味方Unitのlethal splashがある場合、Compact hazard summaryへ具体的な攻撃と被害対象を示し、上限超過時は省略件数とdetail query導線を返す。
- Query APIからfilters schemaを取得し、不正filter形式を試行しなくても主要targetを問い合わせられる。
- Compact増強後も全Move candidate、全Attack preview、全Hexを通常応答へ無制限に戻していない。

### 14.3 Strategic Map / Route

- 現行固定MapからCapital、Facility、Checkpoint、entrance、junctionを含むdeterministic graphを生成できる。
- 同じMap/RevisionではNode/Edge orderingが安定する。
- 直線Road Hexを圧縮し、Raw Map全件と同規模のgraphにならない。
- Facility座標を変更したtest map、Road Networkを変更したtest mapでも、固定の東西南北座標をhard-codeせず関係を導出できる。
- Route Queryが既存pathfindingと矛盾しない。
- `includeHexPath=false`相当のsummaryと詳細path取得を分けられる。
- Hidden enemyの有無でStrategic graph自体が変化しない。

### 14.4 Barbed Wire HP20

- Build時HP20。
- Damage 5/20/25、損傷壁、wall-first、Human terrain defense、貫通0、Gas非肩代わりを確認する。
- Route penaltyがHP20から計算され、旧HP10をhard-codeした期待値が残っていない。
- UI/API/Help/Agent Rulesが20で一致する。
- Save/Replay/Artifactで現在HPが一致する。

### 14.5 Horde Zombie 4 Charge

- new Horde Zombieがmax/current 4 Chargeでenemy phaseを開始する。
- 1/2/3/4回目の攻撃でChargeが3/2/1/0へ減少する。
- Charge 0で5回目のAttackを行わない。
- Fresh wall HP20をAttack 5で4回攻撃した場合にwallが0となる。
- 途中でwallを破壊した場合、空壁破壊後の既存残MP移動規則を確認する。
- 壁上Human、空壁、通常Human、counter/other applicable combat pathsでCharge消費が一般ロジックと一致する。
- Other Zombie typesのmax Charge 1を維持する。
- Public Projection / API metadata / Replayが4 Chargeと一致する。

### 14.6 Asset

- `obstacle_barbed_wire.png`が256×256 RGBA、transparent background、Registry経由で解決される。
- runtime file存在test、registry mapping test、production buildを通す。
- 24〜34px程度でFence + Barbed Wireとして識別できる。
- Human同Hex、Road上、Plain/Forest/Mountain上、低Zoomで確認する。
- Board Legend、PC/モバイル相当viewportで確認する。
- 第三者商標、旗、文字、watermark等がないことを目視確認する。
- Source/provenanceとManifestを更新する。

### 14.7 バランス観測

- HP20とHorde 4 Chargeの影響は複数SeedのローカルBuilt-in Agent / deterministic simulationで観測してよい。
- 壁建設数、壁Damage、破壊数、主要施設接触Turn、Resource loss等を記録できる範囲で比較する。
- 特定勝率、Final Horde到達率、特定Turnまでの生存を受入条件にしない。
- 外部AI Webサービス上の大量反復playtestを要件にしない。
- 明確な技術的不具合、無限loop、pathfinding停止、Replay不一致があればbalance結果にかかわらず修正対象とする。

## 15. 実装対象ファイルの目安

以下は責務の目安であり、実装時により適切な分割があれば変更してよい。

### 15.1 Portable / Session

- `.github/workflows/ai-portable.yml`
- `scripts/build-portable.mjs`
- `PLAY_WITH_AI.md`
- `src/session/service.ts`
- `src/session/store.ts`（安全な冗長性改善が確認できた場合のみ）
- `src/session/types.ts`
- `src/session/play-turn*.test.ts`
- Portable / Session size evidence用testing script/fixture

### 15.2 AI Projection

- `src/agent/types.ts`
- `src/agent/apiInfo.ts`
- `src/agent/observation.ts`
- `src/agent/facility-changes.ts`または新しい`state-changes.ts`
- `src/core/forecast.ts`
- `src/core/crisis.ts`
- 新規`src/core/strategic-map.ts`
- `src/core/movement-query.ts` / `path.ts`の既存ロジック再利用

### 15.3 Barbed Wire / Horde / Asset

- `src/core/barbed-wire.ts`
- `src/core/config.ts`
- 必要なUnit lifecycle / enemy phase test
- `src/ui/boardAssets.ts`
- `src/ui/board.ts`
- `src/ui/controller.ts`
- `src/ui/i18n.ts`
- `scripts/build_board_assets.py`
- `public/assets/board/ASSET_MANIFEST.md`
- `Art/reference/v1.5.7-barbed-wire-concept/`
- `public/assets/board/obstacles/obstacle_barbed_wire.png`

## 16. 非対象・禁止事項

- v1.5.7でランダムマップを実装しない。
- WebMCP、Remote MCP、ChatGPT Plugin、Claude Connector、Gemini-specific extensionを実装しない。
- 外部AIサービスのtool-call limitや一時disk limitを迂回する目的の未公開挙動、無限batch、規約回避機能を追加しない。
- AI向け可読性のためにHidden Enemy、PRNG state、未公開Wave draw、内部Zombie targetを開示しない。
- CompactをFull Snapshot相当に肥大化させない。
- Portable削減のためにFair Play監査、Session resume、Artifact、Replayを削除しない。
- Session size削減のためにlossless diff/hash verificationをlossyな独自summaryへ置き換えない。
- Strategic MapをMap generatorの第二正本にしない。
- Horde 4 Chargeを4倍Attack damageとして実装しない。
- Barbed Wire HP20変更を修理・regen追加と混同しない。
- Asset生成に第三者素材、実在国境機関のロゴ・旗・標識を持ち込まない。

## 17. 受入条件まとめ

v1.5.7は以下を満たした時点で実装完了候補とする。

1. AI Player PortableがSession CLIの実行に必要な内容へ整理され、不要な開発依存を安全に除ける範囲で除外している。削減率の必達値はない。
2. 外部Web AIサービスへの反復限界試験なしで、ローカル/CIのPackage・Session evidenceを残している。
3. Compactが全詳細を抱えず、重要Facility状態、直近重要変化、重大Combat hazard、Query導線を読みやすく返す。
4. Resource Dependency Forecastが主要生産源喪失時の推定runwayを、仮定付きの公開情報として表現する。
5. `strategic-map`と`route`が固定座標暗記なしに道路・施設関係を問い合わせられ、将来ランダムマップに流用できる純粋Queryとして実装されている。
6. WebMCP等は未実装だが、新しい意味論がCLI固有層へ閉じ込められていない。
7. Barbed WireにFence + Barbed Wireの専用runtime assetが追加され、既存Board art direction、provenance、256px RGBA契約に従う。
8. Barbed Wire Max HPが20でUI/Core/API/Save/Preview/Docs一致する。
9. Horde Zombie Max Attack Chargeが4でCore/API/Replay/Docs一致し、Other ZombieのChargeを変更しない。
10. HP20 wallと4 Charge Hordeの組合せが既存の一般Damage/Charge/path規則で処理され、専用hard-codeを増やしていない。
11. 通常のtypecheck/build/unit/integration、Session/Replay/Artifact、Board asset testsに技術的失敗がない。
12. 勝率、ZIP削減率、外部Webサービス上の最大連続Action数を受入条件にしていない。

## 18. 文書管理

- 本書は実装前に確定した要件である。以後の要件変更はユーザーの判断と変更理由を記録する。
- 実装中に本書と現行コードの不一致が判明した場合、推測で仕様を増やさず、不一致と推奨修正を明示する。
- 実装完了時は本書のステータスと検証記録を更新し、`Nowhere Left to Hide PoC 現行仕様.md`、`PLAY_WITH_AI.md`、API metadata、Asset Manifestへ反映する。要件確定と実装完了を区別する。
- v1.5.6以前の確定版・ドラフトは歴史資料としてarchive規則に従い、数値を後から書き換えない。
- 外部AIリプレイを追加で取得した場合も、自己診断文だけを仕様根拠にせず、公開Observation/Action/Event/Session recordと実装を照合する。

## 19. 一問一答による確定事項と判定境界

### 19.1 合意記録

| 問 | 確定内容 |
| --- | --- |
| 1 | 有刺鉄線の建設数・破壊数・吸収ダメージ・攻撃チャージ消費の統計を追加する。 |
| 2 | 旧Save・Sessionは移行せず明示的に拒否。旧公開Replayを含め互換維持不要。 |
| 3 | 主要生産源の仮想喪失リスクは参考情報、実際の収支悪化は警告・停止判定へ接続。 |
| 4 | 貯蔵資源の不足が3回以内でwarning、次回EndTurnでcritical。電力と確定敗北は既存判定を維持。 |
| 5 | statusの重要変化は直近EndTurn＋その後の操作、重要度順最大10件、省略件数と詳細Query付き。 |
| 6 | 重大Combat hazardは具体的な攻撃元・対象・被害対象を最大5件表示し、超過件数と詳細Query付き。 |
| 7 | Routeは自軍Unit指定時に実移動条件、施設・Node間だけなら参考経路。後者の単一Action到達は判定対象外。 |
| 8 | 施設中心Hexへの到達が基本。入れない場合は理由と到達可能な隣接Hex候補。 |
| 9 | 壁の実被ダメージと、同Hexの味方の肩代わりダメージを分ける。 |
| 10 | 攻撃チャージ消費は空壁と壁上Humanへの攻撃を分け、追加消費を推測しない。 |
| 11 | Routeは公開情報だけで判定し、Hidden enemyによる中断は保証しない。 |
| 12 | 効率化に必達数値なし。前後実測と安全性を根拠に採用。将来Transportへの責務分離は独立した完了条件。 |
| 13 | 要件確定版作成後、このタスクで画像生成・提示・ユーザー確認を行い、後続実装で承認素材を使う。 |
| 14 | 有刺鉄線統計を通常プレイの終了統計にも表示し、AI/Replayと共通集計する。 |
| 15 | 実際の不足は施設喪失・人口増加・過密等、原因を問わず共通基準で判定し、原因を併記。 |
| 16 | 次のEndTurnを1と数え、需要を賄えない最初の回を返す。在庫20・赤字10なら3回目。 |

### 19.2 Important Changesの境界

- Action ResultはそのDecision内、statusは4.3の範囲を対象にする。どちらもsummary上限10件とし、`totalCount`、`omittedCount`、対象Decision/Revision範囲、同じRevisionのhistory Query hintを返す。
- 分岐後はそのbranchの履歴だけを対象とし、分岐元の未来の変化を混入させない。Rejected Actionは新しいゲーム状態変化を作らない。idempotent再送でsummaryや統計を重複加算しない。
- severityはcritical → warning → advisory、同一severity内は新しいDecision優先、同一Decision内は安定ID順とする。同じRevisionの応答順を固定する。
- 同じ原因・entityの同一事象をまとめ、production lostと所有変更等の関連をreason codesで表す。関連Event ID/型を付ける。別Decisionで起きた喪失と復旧を消し合わせない。
- 1件のentity ID・reason・consequence配列にも上限10を設け、超過は件数と詳細導線で表す。上限により公開情報を失うことなく詳細Queryで取得できること。
- importantChangesは解釈済みsummaryであり、公開Eventとlossless stateDeltaを置き換えない。重大変化後に移動等をしてもstatusから見落とさない回帰例を必須とする。

### 19.3 Combat Hazardsの境界

- 1件は1つの合法攻撃（攻撃元＋対象）の組合せとする。Gas chainも既存公開Attack Previewと同じ計算を使う。
- 公開済みの味方死亡とPlayer Facility/Checkpoint陥落を対象にし、同一攻撃の複数被害をまとめる。攻撃元/対象ID、被害entityのIDと結果、reason、詳細queryを返す。
- 最大5攻撃を安定した攻撃元ID・対象ID順で返す。被害entityも1攻撃あたり最大10件とし、全被害数と省略数を返す。`query units`から同一Revisionの完全な公開Previewを取得できること。
- Hidden entityの有無で件数、順序、省略数、summaryの有無が変わらない。同じ公開状態に対する比較テストを設ける。

### 19.4 Resource RunwayとCrisisの境界

- 各貯蔵資源で、現状態の継続と最大寄与施設を仮想喪失した状態の推定を区別する。最大寄与施設が同量の場合は安定したFacility ID順で選ぶ。仮想喪失側だけを見てcriticalや停止にしない。
- 基準在庫は現在の公開在庫。生産・需要は既存のEndTurn Forecastの公開計画に基づき、消費された量ではなく要求量を使う。不足で消費が抑制された量を需要と誤認しない。
- Foodは維持需要、Civilian Goodsは維持＋生産入力、Military Goodsは既存の補充需要、Fuelは発電＋Unit補充需要を基準とする。任意の将来建設、徴兵、攻撃等を需要へ推測追加しない。内訳と基準を返す。
- 実際の次回不足は既存の経済処理順を再利用して判定する。特に当TurnのRefinery Fuelは発電・Unit補給へ前借りできない。収支が黒字でも次回不足ならcriticalを優先する。
- 複数Turnの推定は現在の人口、過密・停電追加、需要、生産条件が継続する静的推定。将来の死亡による需要減、感染、敵行動、難民、乱数、施設の自動復旧等は織り込まない。
- 生産・消費順による制約がない場合、在庫S、継続生産P、需要D、赤字B=D−P>0なら、最初の不足回はfloor(S/B)+1。在庫20・生産0・需要10は3、在庫10なら2、在庫0なら1となる。
- 処理順制約がある資源は、この単純式だけで回答せず、同じ静的入出力を処理順に当てた不足時期を使う。入力不足等のため継続値を正確に定められない場合はnull＋unavailable reasonとし、誤った有限値を返さない。次回の確定不足判定は引き続き返す。
- 不足しない推定はnull＋`not_depleting`、計算不能はnull＋別のreason、電力はnull＋`non_storable`。JSON Infinityや0を無期限の代用にしない。1回目が最小値。
- 仮想喪失は現在の最大寄与分を除いた静的Projectionと明示する。需要は現在基準に固定し、別資源への連鎖停止や施設消失による人口減まで再現した未来Simulationとは呼ばない。
- 実状態の推定1回目はcritical、2～3回目はwarning、4回以上または不足なしはこの新規警告を出さない。計算不能を安全と表示しない。原因コードは複数可とし、公開根拠がない原因を断定しない。
- `new_crisis` / `crisis_worsened`は既存契約で判定する。EndTurn内部の途中停止を追加せず、既存のEndTurn完了優先を維持する。同一警告が継続するだけで新規危機を作らない。
- 既存の確定敗北や電力不足警告を弱めたり重複した同義警告で埋めたりしない。1/2/3/4回境界、在庫ちょうど0、次回Fuel不足、黒字、仮想喪失のみ、人口増加・過密起因を検証する。

### 19.5 Strategic Map / Routeの境界

- Strategic graphは公開Mapの地形・道路と公開施設等から導出する。敵の占有はtopologyを変更しない。Unit移動等でtopologyが変わらなければNode/Edge IDは安定させる。
- 保持すべき施設接続・入口・Checkpoint等のNode間をdegree-2道路で圧縮する。分岐、行き止まり、孤立成分、道路loopを欠落させない。loopのみの成分には座標順等で決定的な基準Nodeを置く。
- 座標に基づく決定的IDは許容するが、特定施設の固定座標や東西南北の4本だけを前提にしない。道路に接続しない施設も、未接続として一覧から確認できるようにする。
- graph QueryにはNode/Edgeの標準100件・最大500件の既存paginationを適用する。同じRevisionの複数pageでグラフ全体を復元できること。
- Route inputは移動主体Unitの有無を明示する。自軍Unit指定なら開始地点はその現在位置とし、矛盾したsource指定を拒否する。敵Unitを移動主体にはできない。
- 施設・Node・Checkpoint・座標だけの参考経路は地形/道路の一般経路であることを明示し、Unit固有のMP補正、行動状態、単一Action到達を確定しない。該当fieldはnull＋理由とする。
- Unit経路は既存の地形費用、道路、壁進入費、公開占有、現在MP、攻撃済み等を共通Queryから取得する。複数Turnの到達Turn数や最適行動計画は本版の対象外。
- 地形上の経路存在と、現在1 Actionでの到達可否を別fieldにする。既に目的地にいる場合は経路長0とし、移動Actionが不要であることを明示する。
- Facility指定は中心Hexを目的地とする。中心へ入れない場合は理由と隣接6Hex内の到達可能候補を返し、候補の到達を中心到達として扱わない。候補は費用、座標順で安定させる。
- 補給遷移は現在の公開Supplyでの開始・終点と経路中の出入りを要約する。経路外のHidden enemyや未来の補給網変更を予測しない。道路外区間に架空の戦略Nodeを補わず、対応するNodeがない区間を明示する。
- defaultはRaw Hex pathを省略。Node列・補給遷移列も標準100件・最大500件の明示範囲取得と省略情報を持ち、必要時に同一Revisionの全列を取得できるようにする。`includeHexPath`時も同じ範囲取得を使う。
- Hidden enemy差分で経路、到達可否、費用、候補、理由が変わらないことを検証する。実Moveでの発見・中断は既存処理が担う。

### 19.6 有刺鉄線統計

- 建設成功数、破壊数、実被ダメージ総量、肩代わりダメージ量、空壁への攻撃で消費したCharge、壁上Humanへの攻撃で消費したChargeを共通統計に追加する。名称は日英UI/APIで意味を一致させる。
- 実被ダメージは壁HPの実減少量。肩代わりは同HexのHumanがいる攻撃で壁が引き受けた部分であり、実被ダメージの内数。Humanのterrain軽減後に実際に防げたHP差の反実仮想ではない。両値を足して総ダメージにしない。
- 例: 空壁HP20へ5なら実被ダメージ5・肩代わり0・空壁Charge1。壁上Humanへ25なら実被ダメージ20・肩代わり20・同居Charge1、Humanへの貫通は別の既存統計。損傷壁HP3に5なら壁実被ダメージ3。
- Chargeは攻撃処理で実際に消費した量を1回だけ加算する。壁が存在した攻撃開始時点の対象で空壁/同居を分類し、壁破壊後の通常Human攻撃やGas爆発、chargeを消費しないdamageを数えない。
- 「壁がなければ使わなかった追加Charge」は計算しない。UIでも単に壁への攻撃に使われた実績と説明する。
- 建設拒否・Preview・Query・Replay再生では加算しない。HP0での消滅時に破壊を1回加算する。建設成功した時点に1回建設を加算する。
- 新規ゲームは0、Save/Resumeは値を保持、Checkpoint loadは保存時点の値に戻り、分岐元の未来を合算しない。Session再送やArtifact再生で増殖しない。
- 通常終了統計、Agent結果/公開統計、公開Replayの記録済み結果で共通の数値を使う。Hidden戦闘情報の漏洩経路を新設せず、公開Event/Observationで開示できる実績の境界を守る。
- 19.6の具体例、破壊の重複防止、貫通0、Gas、Save/Resume、Checkpoint分岐、idempotency、通常終了画面とArtifactの一致を追加受入条件とする。

### 19.7 Query/APIと配布の完了条件

- Query schemaは実Validatorと同期するJSON-compatibleな機械可読情報とし、field型、enum、必須、nullable、default、数値範囲、pagination、返却field、失敗形を説明する。実装で使用するschema形式の名称・versionを固定してAPIへ出す。
- CLIの`--input`が受け取るtarget filterと、play-turn query stepの`filters` envelopeを区別した実行可能例を掲載する。不正形を黙って0件の正常結果にしない。既存で許す形式を変更するなら新versionの契約として明示する。
- `RelocateCheckpoint`の`checkpointId`必須や、CLI失敗時のstderr・非0終了を実Validator/CLIと照合して推奨例を訂正する。
- Windows/Linux Player packageは同じSession機能を満たす。実行不要な開発ファイルを除外できなかった部分は依存理由と前後測定を残せばよく、無理なformat最適化を成功条件にしない。
- 新規ProjectionはTransport非依存の純粋Queryとしてテストする。Node I/O、DOM、Session Storeをimportしなくても計算できることを確認する。WebMCP実接続試験は不要。

### 19.8 根拠の照合と今回の成果物の境界

- `output/claude-playtest-20260910-r2/t31.json`の公開Compactには既に`forecastSummary.endTurn.maintenanceBreakdown`があり、Food/Civilian Goodsのbase 472、overcrowding 241、housingOutage 0、total 713を返している。「full-snapshotにしかない」というREPORTの記述を新設理由にしない。既存fieldを維持し、推奨表示で省略しない。
- 同応答のCompact roadBranchesには`preparedPostCount`/`fallbackAvailable`がない一方、公開Observationには既存の定義がある。これらの新規意味論は作らず、支線詳細Queryで取得する導線を推奨手順に明記する。Hidden Zombieを含まない構造上のFallback可否という既存の意味を維持する。
- 報告にある人口・過密の独自計算や「1Turn1アクション」等の表現は、現行仕様の計算順・移動後攻撃規則と照合する。プレイヤーAIの推論をそのままヘルプへ転載しない。
- 2件のリプレイは課題の根拠資料として保管するが、v1.5.7が読める互換fixtureにする必要はない。旧形式の明示拒否確認と、新v1.5.7 fixtureの正常再生を分けて検証する。
- 要件確定時点ではゲームコード・Version・安定版の仕様内容は更新しない。テスト完了や性能改善を実施済みと記録しない。
- ドラフトは確定版作成後に`Doc/archive/`へ移す。現行判断は本確定版を使用し、履歴ドラフトの内容は書き換えない。
