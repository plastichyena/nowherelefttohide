# Nowhere Left to Hide PoC v1.5.7 アップデート要件 ドラフト

- ステータス: ドラフト
- 作成日: 2026-09-11
- 基準: `Nowhere Left to Hide PoC 現行仕様.md`（v1.5.6）
- 対象: AI Portable / Sessionの負担軽減、AI向け情報可読性、ランダムマップ準備の公開Query、有刺鉄線ビジュアル、有刺鉄線HP調整、Horde Zombie Attack Charge調整
- 非対象: ランダムマップ本体、WebMCP、ChatGPT Site tools、Remote MCP、外部AIサービス向け専用Adapter、外部LLMの勝率保証
- 根拠: v1.5.6実装、2026-09-09/10の外部AIリプレイ調査、現行Portable/Session/Agent APIの実装確認

本書はv1.5.7の実装目標を定める。現行仕様は実装・テスト・動作確認が完了するまでv1.5.6の安定版として維持する。本書作成時点ではコード、Version定数、現行仕様を変更しない。実装完了後に確定要件、実測、互換性判断を現行仕様へ反映する。

## 1. 目的・基本方針

### 1.1 目的

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
- `status`で直前Decisionのbounded important change summaryを返す、または同等の`history` detail query hintを明示する。
- 何十Turn分ものchange historyをCompactへ蓄積しない。直近Decisionまたは直近Turn等、明確なbounded範囲とする。

### 4.4 危険なCombat PreviewのCompact要約

- 完全な`attackPreviews`とGas chain previewは`query units`を正本とする。
- Compactには、現在合法な攻撃のうちPlayer側に重大な確定副作用を持つものだけをbounded `combatHazards`として要約できるようにする。
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

- 主要生産源の喪失または停止により短いrunwayしか残らない状態を、既存Crisis systemへ公開情報のみで接続する。
- 必要なら`resource_dependency_risk`等の安定Reason Codeを追加する。
- 既存`new_state_loss`を無条件にcritical化しない。Facility lossそのものと、その結果生じるResource riskを分離する。
- `new_crisis` / `crisis_worsened`の既存play-turn停止契約を再利用し、新しいtransport-specific停止機構を作らない。
- Severity閾値を実装時に固定し、テスト可能にする。勝敗結果に合わせてSeed別に動的調整しない。

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
- Migrationを実装しない場合はSave Formatを更新して旧Saveを明示的にrejectし、新規v1.5.7 Session開始を案内する。Migrationを実装する場合はHordeのcurrent/max Charge、wall HP、Game Rules整合を決定的に変換し、専用fixtureを必須とする。
- ドラフト段階では単純で安全な「旧Game Rule stateはreject」を推奨方針とする。

### 12.2 Session Store

- Store効率化によるformat変更は、必要性が確認できるものだけにする。
- schema bumpを避けるために不正確な互換性を装わない一方、単なるPackage file削減だけで不要なSession schema bumpを行わない。
- v1.5.7のSession/Artifactがv1.5.6と非互換になる場合、CLI error、`PLAY_WITH_AI.md`、現行仕様で明示する。

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
- Gas Zombie致死Attackで、現在公開済み味方Unitのlethal splashがある場合、Compact hazard summaryまたは明確なdetail query導線で見落としにくい。
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

- 本書はドラフトであり、実装開始前の一問一答またはレビューで変更してよい。
- 実装中に本書と現行コードの不一致が判明した場合、推測で仕様を増やさず、不一致と推奨修正を明示する。
- 実装完了時に確定版へ更新し、`Nowhere Left to Hide PoC 現行仕様.md`、`PLAY_WITH_AI.md`、API metadata、Asset Manifestへ反映する。
- v1.5.6以前の確定版・ドラフトは歴史資料としてarchive規則に従い、数値を後から書き換えない。
- 外部AIリプレイを追加で取得した場合も、自己診断文だけを仕様根拠にせず、公開Observation/Action/Event/Session recordと実装を照合する。
