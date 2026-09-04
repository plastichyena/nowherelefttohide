# Nowhere Left to Hide PoC v1.4.5 アップデート要件 確定版

**Recon-Driven Checkpoint Placement & Human UI Cleanup**

対象リポジトリ: plastichyena/nowherelefttohide / main

基準バージョン: v1.4.4 / Game Rules 2.4.0

文書状態: Final — 実装目標として確定

| **このアップデートの狙い 経済拡張そのものを罰するのではなく、偵察と安全確認を拡張の前提にする。あわせて、人間向けUIから座標の大量列挙を除去し、情報を「全体状態・盤面状態・選択地点の操作」に分離する。** |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

**要約**

- 検問所の新設・移設先は、対象幹線道路ヘックスと州都側から対象までの道路区間が現在のPlayer Visionで連続して確認できる場合のみ合法とする。

- 妨害Zombieによる建設拒否は、Playerが現在確認できる妨害要因だけで判定し、隠れたZombieを理由に突然失敗する挙動を避ける。

- 1方向あたりのprepared checkpoint上限を3から5へ変更する（Activeを含む合計5）。

- 偵察必須化に合わせ、初期Civilian Goodsを230から255へ増やす。

- FacilityとCheckpointの配置を分離し、施設が存在するヘックスへのCheckpoint新設・移設を禁止する。

- 人間向けUIでは検問所候補座標の一覧を廃止し、内政タブで選択した道路ヘックスに対する局所アクションとして建設を提示する。

- EndTurn Forecastの未給電施設ID全列挙を廃止し、盤面上の各未給電施設に個別マーカーを追加する。

# 1. 背景と設計判断

v1.4.4の51×51化後は、合法手として供給圏を拡張し、施設を確保し、経済を成長させる行動が自然に優先される。一方で、遠隔地の検問所候補がCore/APIと人間向けUIから大量に提示されるため、「先に偵察する」ことが拡張ループの必須手順になっていない。

今回の変更では、拡張の収益性そのものを弱めるのではなく、Recon → Checkpoint → Supply Expansion → Economyという順序をルールとして成立させる。失敗時も「見えない危険に突然拒否された」ではなく、「偵察不足／安全確認不足／偵察投資不足」と認識できる状態を目標とする。

## 1.1 現行mainで確認した前提

| **項目**              | **現行実装**                                                                                                                |
|-----------------------|-----------------------------------------------------------------------------------------------------------------------------|
| Version               | src/agent/types.ts は APP_VERSION=1.4.4、GAME_RULES_VERSION=2.4.0。                                                         |
| Checkpoint candidates | src/core/checkpointCandidates.test.ts は全roadBranchesの全roadTilesを候補として返すことをテストしている。                   |
| Hidden blocker        | 同テストは、唯一の妨害要因が隠れたZombieでもcandidate集合を変えず、identityを露出しないことを保証している。                 |
| Human selection       | src/ui/controller.ts の Selection は unit / facility / checkpoint のみで、domestic modeの空道路ヘックスは選択対象ではない。 |

## 1.2 Goals

- 偵察を経済拡張の前提にする。

- AIと人間の合法手判定を同じCoreルールで統一する。

- 隠れたZombieを原因とする建設失敗を避け、情報境界を明確にする。

- 51×51マップに見合う防御深度を用意する。

- 下部情報パネルの大量列挙を減らし、盤面を主要な状況認識UIとして使う。

- 電力不足を「一覧」ではなく「現場」に表示し、原因探索を容易にする。

## 1.3 Non-goals

- Zombieの基礎性能・感染率・Final Horde構成の弱体化は本アップデートの対象外。

- Balanced Agent等の戦略ロジックを直接修正することは本アップデートの対象外。新ルール下で既存Agentが技術的失敗なく動作することは確認する。

- Constructible Facilityの全候補表示方式は、今回はCheckpoint UI整理とは切り分ける。

# 2. 新しい検問所設置ルール

## 2.1 Build / Relocate 共通の偵察ゲート

BuildCheckpointおよびRelocateCheckpointの対象座標は、既存の検問所制約に加え、以下をすべて満たす必要がある。

1. 対象ヘックスが、指定branchの幹線道路（roadTiles）上にある。
2. 対象ヘックスが現在のPlayer Visionに含まれている。
3. 州都側から対象ヘックスまで、同branch上の道路ヘックスが途切れず現在のPlayer Visionに含まれている。
4. 対象ヘックスにFacilityが存在しない。恒久／建設可能、所有者、稼働、感染、陥落、建設中、復旧中等の状態を問わず禁止する。
5. 既存のCheckpoint role / rear-position / Spawn Reserve / occupancy / resource / phase / action-limit等の制約を満たす。
6. 現行のCheckpoint妨害範囲内に、現在のPlayer Visionで確認できるZombieが0体である。

| **公平性ルール v1.4.5では「隠れたZombieがいるため実行時だけ失敗する」を避ける。Checkpoint placementの妨害判定で建設を拒否できるZombieは、Playerに現在可視な個体に限定する。これにより、合法手の提示と実行結果を一致させる。** |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 2.2 「州都から対象まで視界が確保」の定義

roadBranch.roadTiles が州都側から外側へ並ぶ既存のbranch順序を利用し、対象indexまでの全roadTilesが getPlayerVisibleTileKeys(state) に含まれることを条件とする。

```text
targetIndex = branch.roadTiles.indexOf(target)
routeVisible = branch.roadTiles[0..targetIndex].every(tile => visible.has(hexKey(tile)))
legal = existingRules && targetVisible && routeVisible && visibleBlockingZombies.length === 0
```

この定義は「一度見たことがある explored」ではなく「現在見えている」を採用する。対象だけでなく経路の全ヘックスが同時にPlayer Visionへ含まれていなければならない。Drone Baseや部隊配置による継続的なRecon投資を実際の拡張能力へ変換するためであり、本要件内ではexplored履歴へ緩和しない。

Actionの基本形式、phase、Game Over、branch存在、対象が当該branchのroadTilesか等の構造的検証を行った後、配置地点に関する複数の不合法理由がある場合はvisibility reasonを優先する。対象自体が未可視なら`checkpoint_target_not_visible`、対象は可視だが州都側からの途中区間に未可視ヘックスがあれば`checkpoint_route_not_visible`とする。経路が可視になるまでは、その先のZombie、Facility、上限、資源等の理由を候補・UIへ露出しない。

## 2.3 prepared checkpoint上限

config.checkpoint.maxPreparedPostsPerDirection を 3 → 5 に変更する。既存のpreparedPostCountの意味を維持し、Active + Standby の合計上限を5とする。

| **解釈 「5」はActive 1基とStandby最大4基を合わせた上限である。Dormantはprepared post数へ含めない。** |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 2.4 初期資源の小幅増加

初期Civilian Goodsを現行の230から+25し、255とする。Drone Base 1基分の建設投資を吸収することを主目的とし、Food 230 / Military Goods 75 / Fuel 92は変更しない。本要件内で+50への可変調整は行わない。

## 2.5 FacilityとCheckpointの配置分離

FacilityとCheckpointは独立したタイルを使用する。FacilityStateが存在するヘックスは、BuildCheckpointとRelocateCheckpointの対象外とする。Facilityの状態や所有者による例外は設けない。Constructible Facility側のCheckpoint占有禁止と合わせ、相互の重複配置を認めない。

現行51×51固定マップの4 branchはroadTilesを共有せず、Capital `(25,25)`もbranch roadTilesには含まれないため、1ヘックスからbranchを選択するUIは設けない。選択道路ヘックスからbranchを一意に決定する。

将来、複数の幹線道路が交差するマップを追加する場合、交差点は必ずFacilityタイルとし、CheckpointのBuild／Relocate対象外にする。マップ外へ続く新しい幹線道路だけを避難民流入branchとし、既存幹線道路側のCheckpointを施設陥落時の後退候補とする構造は将来拡張として許容するが、その流入・Fallback仕様自体はv1.4.5の対象外とする。

# 3. 人間向けUI変更

## 3.1 Domestic mode: 道路ヘックスを局所アクションの起点にする

内政タブ（domestic mode）では、幹線道路ヘックスを選択できるようにする。選択地点に対する BuildCheckpoint candidate をCoreから照合し、その座標でBuildが合法な場合だけ「検問所を設置」ボタンを表示する。

- 空の道路ヘックス: road selectionとして選択可能。

- 道路上にFacilityがある: Facility selectionを優先し、Facility Bottom SheetにはCheckpointのボタンも設置不可理由も表示しない。

- 既存checkpointがある: checkpoint selectionを優先し、新設ボタンは出さない。

- 現行マップではbranch roadTilesが重複しないため、branch selectorやbranch別複数ボタンは設けない。

## 3.2 ボタンが出ない場合の説明

「合法時だけボタンを表示」を維持しつつ、選択した道路がCheckpoint候補として意味を持つ場合は、ボタンの代わりに短い状態文を1行だけ表示して学習経路を残す。

| **状態**   | **表示例**                                                               |
|------------|--------------------------------------------------------------------------|
| 未偵察     | 検問所を設置できません: この地点までの幹線道路の視界を確保してください。 |
| Zombie妨害 | 検問所を設置できません: 視界内のZombieが設営を妨害しています。           |
| 上限       | 検問所を設置できません: この方向のprepared postが上限です (5/5)。        |
| 資源不足   | 検問所を設置できません: Civilian Goodsが不足しています。                 |

## 3.3 検問所候補座標一覧の廃止

人間向けUIから、BuildCheckpointの候補座標を列挙する表示を廃止する。

- renderBranchFlow() 内の branch-candidate Buildボタン群を削除する。Branch panelにはActive / Standby / Dormant / policy / queue / fallback depth等の状態情報だけを残す。

- Build用 renderCheckpointPlacement() と、Build候補を一覧化する checkpoint-candidates DOMを廃止する。

- Buildモード時に盤面へ全candidate markerを描画する方式を廃止する。選択中ヘックスと局所状態だけを強調する。

- RelocateCheckpointは「既存Checkpointを選択 → 移設 → 盤面で移設先を選択」のplacement modeを維持する。対象branchの合法／不合法候補マーカーは盤面上に維持し、不合法地点を選ぶとCore reasonCodeの理由を表示する。ただし座標テキスト一覧は表示せず、Core側の新しいvisibility gateを適用する。

## 3.4 電力情報の整理

EndTurn Forecastの electricity.unpoweredFacilities を facilityId + reason の全件リストとして表示するUIを廃止する。全体パネルでは集約値に限定する。

- 上部Power HUD: demand / available / shortage の現行集約表示を維持。

- EndTurn Forecast: physical capacity / available capacity / required demand / allocated / shortage を維持。

- 未給電施設: ID／理由一覧は削除し、件数だけ「未給電見込み: N施設」と表示する。

- 個別Facility sheet: 現行の projectedPowerSupplied / projectedPowerReason の警告を維持する。

## 3.5 盤面上の未給電マーカー

Required Powerのplayer-owned Facilityについて、EndTurn Forecast上で`projectedPowerSupplied=false`の場合、盤面上に小さな文字dynamic marker「⚡×」を表示する。専用PNGは追加しない。

- 現在のPlayer Vision外でも、Player所有施設の行政情報として表示する。
- Power SupplyをPlayerが明示的にOFFにした施設も対象に含める。
- Enemy所有または未所有の施設には表示しない。
- 給電見込みへ戻った時点でマーカーを消す。
- Facility詳細では`projectedPowerReason`によりOFF、供給不足、Fuel不足等の原因を区別する。

| **表示の意味 電力配分はEndTurn予測を基準にしているため、マーカーの意味は「このターンを終了した場合、必要電力が供給されない見込み」。単なる現在状態と誤認させないよう、tooltip/施設詳細では「未給電見込み」と表記する。** |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 4. Core / Agent API / Saveへの影響

## 4.1 Coreを唯一の合法判定元にする

Human UI側で独自にvisibility条件を再実装せず、getCheckpointPositionCandidates / validateAction / getLegalActions が同じ条件を共有する。Human UIはCoreのcandidateとreasonCodeを表示するだけにする。

## 4.2 Candidate APIの互換方針

Agent APIでは、既存の「全road tileをcandidateとして返す」形をv1.4.5でも維持する。各candidateの legal / reasonCode を公開情報に基づく新ルールで更新し、AIがなぜ合法でないかを判断できるようにする。Human UIだけが大量列挙をやめる。`getLegalActions()`は従来どおり合法Actionだけを返す。

推奨する追加reasonCode（名称は実装時に既存命名規則へ合わせる）:

- checkpoint_target_not_visible

- checkpoint_route_not_visible

- checkpoint_supply_zombie_blocked（既存codeを再利用）

- checkpoint_prepared_post_limit_reached（既存codeを再利用）

- checkpoint_facility_occupied（新規。名称は実装の既存命名規則に合わせて最終調整可）

候補の理由からhidden Zombie identity・座標・存在を推測できる情報は返さない。routeが可視でない場合は、まずvisibility reasonを返し、その先のhidden occupancy検査結果を露出しない。

## 4.3 Versioning案

| **項目**                            | **v1.4.5確定値**                                                     |
|-------------------------------------|-----------------------------------------------------------------------|
| APP_VERSION                         | 1.4.5                                                                 |
| GAME_RULES_VERSION                  | 2.5.0                                                                 |
| SAVE_FORMAT_VERSION                 | 9維持                                                                 |
| AGENT / OBSERVATION / BRIDGE API    | 6.1.0                                                                 |
| ARTIFACT_SCHEMA_VERSION             | 5.0.0維持                                                             |
| CHECKPOINT_SCHEMA_VERSION           | 2.0.0維持                                                             |
| SESSION_SCHEMA_VERSION              | 2.0.0維持                                                             |

新しい永続フィールドやJSON構造は追加しない。v1.4.4以前のSave／Replay／Artifact／Session／Checkpointは暗黙変換せず、Game Rules Version等の不一致として状態を変更せずに拒否する。

# 5. 実装タッチポイント

| **ファイル**           | **変更概要**                                                                                                                  |
|------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| src/core/engine.ts     | Checkpoint candidate生成・Build/Relocate validationにvisibility corridor、全Facilityタイル禁止、visible blocker gateを追加。 |
| src/core/visibility.ts | 既存 getPlayerVisibleTileKeys を再利用。必要ならbranch route visibilityのpure helperを追加。                                  |
| src/core/supply.ts     | 既存 getBlockingZombiesForCheckpoint を再利用する場合、UIだけでなくCore合法判定に使える公平な「visible blockers」境界を定義。 |
| src/core/config.ts     | maxPreparedPostsPerDirection=5、initial Civilian Goods +25。                                                                  |
| src/ui/controller.ts   | domestic road selection、局所Buildボタン、candidate一覧削除、Facility SheetからCheckpoint操作を分離、EndTurn unpowered一覧を件数化。 |
| src/ui/board.ts        | Build全candidate marker削除、未給電見込みmarker追加。Relocate previewは維持。                                                 |
| src/ui/i18n.ts         | visibility / blocker / unpowered marker説明用のja/en文言追加。                                                                |
| Tests                  | checkpointCandidates / engine / controller / board / i18nの期待値を更新。                                                     |

# 6. Acceptance Criteria / テストケース

- 対象road hexだけ見えていて、その途中のroadに未可視hexが1つでもある場合、BuildCheckpointはlegal=false。

- 州都から対象までのroad corridorがすべてvisibleで、既存条件を満たす場合、BuildCheckpointがlegal=true。

- 現行Checkpoint妨害範囲内の可視Zombieが妨害する場合、legal=falseかつ既存のZombie blocker reasonを返す。

- 同じ位置にhidden Zombieだけを追加しても、合法手がhidden情報だけを理由に突然失敗しない。

- BuildとRelocateの実行結果はcandidate.legal / reasonCodeと一致し、失敗時にstate/resources/RNGを変更しない。

- Facilityが存在する道路ヘックスは、その状態・所有者を問わずBuild／Relocateともlegal=falseである。

- Constructible FacilityとCheckpointは相互に同一ヘックスへ配置できない。

- prepared postsは各direction 5まで作成でき、6つ目はCoreで拒否される。

- domestic modeで合法なroad hexを選択した場合だけBuildボタンが表示される。

- 未合法roadを選択した場合、Buildボタンは表示されず、短い理由だけが表示される。

- Facilityタイルを選択した場合、Facility SheetにCheckpoint操作と設置不可理由を表示しない。

- Branch Flow / Checkpoint Build UIにq,r候補一覧が存在しない。

- Build時は全候補盤面マーカーを表示せず、選択中道路と局所状態だけを強調する。Relocate時は対象branchの合法／不合法盤面マーカーを表示する。

- EndTurn Forecastにunpowered Facility ID／理由一覧が存在せず、「未給電見込み: N施設」だけを表示する。

- 未給電見込みのplayer-owned Required Power Facilityには、視界内外およびPower Supply OFFを問わず盤面上に「⚡×」を表示し、給電見込みになると消える。

- Power HUDと個別Facility forecastは従来どおり不足量・理由を確認できる。

## 6.1 AI / Human共通フェアネス確認

同一GameStateについて、Human UIのBuildボタン表示、Agent Observationのcandidate.legal、getLegalActionsのBuildCheckpoint、engine.step(BuildCheckpoint)の成功可否が一致することを必須とする。

# 7. プレイテストで見る指標

- Drone Baseの初回建設Turnと稼働worker数。偵察必須化後に「建てるが即0 worker」へ偏らないか。

- 初回Checkpoint建設Turn、各方向のprepared post depth、T20/T30時点のSupply radius。

- Civilian Goods runway。+25が不足回避ではなく、偵察投資の余地として機能しているか。

- Checkpoint建設不能reasonの内訳（not_visible / route_not_visible / blocker / resource / limit）。

- Human playで「なぜ置けないか」が盤面と1行理由だけで理解できるか。

- 既存AIが新しい合法手境界で技術的失敗や同一Actionの無限試行を起こさないか。戦略ロジックの変更は本アップデートに含めない。

- T50 Final Horde到達率。v1.4.4のようなT28以前の経済・感染崩壊がどの程度減るか。

# 8. 確定事項

- Checkpoint経路はexplored履歴ではなく、州都側から対象まで全区間の現在Player Visionを要求する。
- 隠れたZombieはCheckpointのBuild／Relocateを妨害しない。現行妨害範囲内の可視Zombieだけを判定する。
- prepared post上限5はActive + Standbyの合計であり、Dormantを含めない。
- 初期Civilian Goodsは255で固定する。
- FacilityとCheckpointは同一タイルへ配置しない。
- 現行マップではbranchを一意に決定し、branch選択UIを設けない。
- Build候補の座標一覧と全候補盤面マーカーを廃止し、Relocate候補盤面マーカーは維持する。
- 未給電見込みは盤面上の「⚡×」とEndTurn Forecastの件数で示す。
- Relocateの操作順は現行方式を維持する。
- Core、Human UI、Agent API、実行結果で同じ合法判定とreasonCodeを使用する。

# 9. Repository baseline notes

この確定要件は2026-09-03時点のmainを基準に作成した。確認に使用した主な実装箇所:

- src/agent/types.ts — v1.4.4 / Game Rules 2.4.0 のversion constants。

- src/core/checkpointCandidates.test.ts — 全road tile候補、legal actions整合、hidden blocker非露出の現行テスト。

- src/ui/controller.ts — Selection / domestic mode / checkpoint placement / branch flow / power forecast。

- src/ui/board.ts — candidate preview marker、facility dynamic warning描画。

Repository: https://github.com/plastichyena/nowherelefttohide/tree/main
