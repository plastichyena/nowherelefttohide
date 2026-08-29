# Nowhere Left to Hide

## PoC v1.2.6アップデート要件 確定版

- ステータス: 確定要件
- 対象App / Release Version: `1.2.6`
- 確定日: 2026-08-28
- 安定版の正本: `Nowhere Left to Hide PoC 現行仕様.md`
- 主題: Unit Recovery / Production Capacity / AI Context Improvement

本書はv1.2.6で変更する部分の実装目標である。実装・テスト・動作確認が完了するまでは、`Nowhere Left to Hide PoC 現行仕様.md`をv1.2.5安定版の唯一の正本として維持する。v1.2.6の完了後に本書を現行仕様へ反映し、実装、テスト、Human UI、AI向け資料、Version、保存形式との整合を確認する。

---

# 1. 背景と目的

v1.2.5を人間およびChatGPTのSol mediumでプレイした結果、ルールとして利用可能な機能であっても、その戦術的・行政的な意味が外部AIへ十分伝わらない場合が確認された。

特に次の理解がプレイ品質へ大きく影響した。

- 補給網内でのユニット自然回復
- 州兵の射程2を使った施設接触前の排除
- 警察・州兵の駐留による感染拡大阻止と自動鎮圧
- 検問所方針における人口増加と感染リスクの交換関係
- 発電所停止が複数生産施設へ及ぼす波及

また、避難民を任意に大量追放しない現行設計では、終盤人口を生産力へ変換するための生産施設労働者上限が不足する可能性がある。

v1.2.6では大規模な経済再設計を行わず、次の3点を実施する。

1. 補給網を使ったユニット自然回復を10%／20%の二段階へ改善する。
2. 生産施設の標準労働者上限を25人から30人へ緩和する。
3. Human UIと外部AIが同じ公開ルールを理解できる自己説明、Observation、資料を整備する。

目的は単純な難易度低下ではない。補給網を維持する軍事的価値、部隊の後退・休養・再投入、人口を生産力へ変える余地を増やし、外部AIが非公開GameStateや固定攻略法に依存せず合理的に判断できるようにする。

---

# 2. スコープ

## 2.1 変更対象

- 警察・州兵の自然回復条件、回復率、回復予測、Event
- ユニット行動履歴と回復区分判定
- 感染拡大阻止・自動鎮圧の公開操作境界
- 生産施設の労働者上限
- Capacity連動の陥落時感染者下限
- Human UIの日英ヘルプ、ユニット回復表示、労働者上限表示
- `PLAY_WITH_AI.md`
- AgentGame / Browser Bridgeの自己説明
- Agent Observationのユニット、施設、感染、電力情報
- `public/agent-api.html`
- Portable AI Packageの同梱内容とSmoke Test
- Balanced Agent、Batch、Metrics、Replay／Artifact
- v1.2.5 Save Format 2からの決定的移行

## 2.2 原則変更しない要素

- 警察・州兵・ゾンビの最大HP、Attack、Move、基本Range
- 軍需不足時に州兵の実効Rangeを1へ下げる現行ルール
- 警察・州兵の感染鎮圧量
- 州兵鎮圧時の民間人被害式
- 1労働者あたりの資源入力、資源出力、発電量
- 市民1人あたりの資源消費量
- 州都100、地方都市50のソフトキャップ
- 検問所3方針の時間、合格率、感染率
- 感染拡大、鎮圧、陥落、復旧の基本式
- Hordeの周期、規模、増加量
- v1.2.5の道路、検問所、補給セクター
- Fog of War、地形効果

## 2.3 対象外

- Horde強度の変更
- 感染率の変更
- 基礎資源消費量と1労働者あたり生産効率の変更
- 新規施設建設、臨時生産施設
- 市民の能動的な州外追放
- 新ユニット
- 道路・補給網の再設計
- 地形、Fog of War
- 特定Seed、特定Turn、固定施設順による攻略手順の提供
- 勝利を保証する戦略の提供

---

# 3. ユニット自然回復

## 3.1 対象と判定時点

- 対象は生存中の警察・州兵とする。
- ゾンビは回復しない。
- 前回のプレイヤーターン開始から蓄積した行動履歴を使う。
- 次のプレイヤーターン開始時、行動権・攻撃権をリセットする前に1回だけ判定する。
- 判定時点でユニットの現在位置が補給圏内でなければ回復しない。
- 判定前のゾンビターンで死亡したユニットは回復しない。
- 回復後HPは最大HPを超えない。

プレイヤーがEndTurnした直後、ゾンビターンより前には回復しない。

## 3.2 戦闘・治安活動回復

次のいずれかを1回でも行ったユニットは、補給圏内なら最大HPの10%を回復する。

- 通常攻撃
- 反撃
- 迎撃
- 感染鎮圧

移動後に攻撃または鎮圧した場合も10%とする。

## 3.3 休養回復

通常攻撃、反撃、迎撃、感染鎮圧を行わなかったユニットは、補給圏内なら最大HPの20%を回復する。

次を含む。

- 移動のみ
- `Wait`のみ
- 移動後の`Wait`
- 完全未行動

「移動したか」ではなく、「戦闘または感染鎮圧を行ったか」で10%と20%を区別する。複数区分に該当する場合は10%を優先する。

## 3.4 端数と標準回復量

- 10%と20%の両方で現行の端数方式を使う。
- 標準端数方式は切り上げとする。
- 戦闘回復率、休養回復率、端数方式をConfig化する。

| ユニット | 最大HP | 10%標準回復 | 20%標準回復 |
|---|---:|---:|---:|
| 警察 | 25 | 3 | 5 |
| 州兵 | 50 | 5 | 10 |

## 3.5 補給網変化

- Observation時点の回復情報は条件付き予測とする。
- EndTurn後に検問所が荒廃して補給圏外になった場合、次回開始時は回復しない。
- EndTurn後の自動鎮圧で荒廃検問所が復旧し、次回判定時に補給圏内となった場合は回復できる。
- 将来のゾンビ行動や補給網変化を確定結果として公開しない。

## 3.6 Event

実際の回復HPが1以上なら`unit_recovered` Eventを記録する。最低限、次を含む。

- Unit ID、Unit Type
- 回復前HP、基礎回復量、実回復量、回復後HP
- `combat`または`rest`の回復区分
- 適用率
- 判定時の補給状態

HPが最大で実回復0の場合は回復Eventを生成しない。

---

# 4. 感染拡大阻止と自動鎮圧

## 4.1 駐留による感染拡大阻止

- 感染中の通常施設、荒廃施設、検問所関連地点に警察または州兵が駐留していれば、攻撃回数の残量にかかわらず、その感染フェーズの内部感染増加を止める。
- 通常攻撃、反撃、迎撃を済ませたユニットでも、駐留しているだけで増加を止める。
- 駐留による拡大阻止は攻撃回数を消費しない。

## 4.2 ターン終了時の自動鎮圧

感染フェーズ開始時に次をすべて満たす場合、GameEngineが自動鎮圧する。

- 警察または州兵が対象ヘックスへ駐留している。
- 対象に感染者が1人以上いる。
- ユニットに攻撃回数が残っている。
- そのユニットが通常攻撃、反撃、迎撃で攻撃回数を消費していない。

移動だけで感染地点へ到着したユニット、`Wait`したユニット、完全未行動ユニットも、攻撃回数が残っていれば鎮圧する。

- 警察は現行の鎮圧量5を適用する。
- 州兵は現行の鎮圧量10と、`ceil(Attack × 0.5)`の民間人被害を適用する。
- 鎮圧は攻撃回数を消費し、行動履歴へ`suppressed`を記録する。
- 鎮圧したユニットの次回自然回復区分は10%となる。

## 4.3 `SuppressInfection`公開Actionの廃止

現行実装に残る即時`SuppressInfection`経路は、現行仕様の自動処理と処理順が異なるため廃止する。

- 公開GameActionから除外する。
- `getLegalActions()`へ返さない現状を維持するだけでなく、直接`step()`へ渡しても理由付きで拒否する。
- Browser Bridge入力Schemaから除外する。
- UIの即時鎮圧ボタンを除外する。
- MetricsのAction種別、AgentのAction Key、サンプルから除外する。
- 感染鎮圧はGameEngine内部の決定的な感染フェーズ処理だけとする。

v1.2.5以前のReplay／Artifactは非互換とし、旧Actionを新ルールへ読み替えない。

---

# 5. 生産施設の労働者上限

## 5.1 標準上限

次の全生産施設タイプで、標準`workerCapacity`を25人から30人へ変更する。

- Farm
- Civilian Factory
- Military Factory
- Refinery
- Power Plant

州都100、地方都市50のソフトキャップは変更しない。検問所の審査Capacityも変更しない。

## 5.2 生産

- 1労働者あたりの入力、出力、発電量を変更しない。
- 26～30人目にも1～25人目と同じ生産式を適用する。
- 30人配置時の理論最大生産・発電量は25人時より20%増える。
- 人口1人あたりの食料・民需品消費は従来どおり増える。
- 電力、燃料、入力資源不足による部分稼働と優先順位は変更しない。

## 5.3 Configと正データ

- 標準Configの5生産施設タイプを30へ更新する。
- 固定マップ、Facility Definition、GameState、UI、Observation、合法手は同じConfig由来Capacityを使用する。
- 重複した固定値25を残さない。
- v1.2.6では施設タイプごとのCapacity overrideを引き続き許可する。

## 5.4 陥落時感染者下限

現行式を変更しない。

```text
fallBackInfected = max(currentInfected, ceil(workerCapacity × 50%))
```

標準生産施設では、新たな陥落時の下限が13人から15人になる。都市と検問所の計算は変更しない。

---

# 6. AI向けコンテキストの原則

## 6.1 提供する情報

AI向けコンテキストは、人間がUI、ヘルプ、ルール説明、経験から把握できる公開情報を明示する。

- ルールの操作条件
- 数値、処理時点、公開中の状態
- ユニットや施設が持つ役割と交換関係
- 現在局面で成立する回復、鎮圧、生産、電力予測

## 6.2 提供しない情報

- 特定Seedの攻略手順
- 特定Turnの固定Action
- 必ず確保すべき施設の固定順
- 勝利を保証する戦略
- 将来乱数、PRNG状態、未発生イベント
- private GameState、デバッグ専用値
- 外部AIの文章上の思考過程

AIへ「発電所を必ず最優先」「警察は戦闘禁止」「厳格が常に正解」といった絶対命令を与えない。

## 6.3 正本と配置

- ゲームルールの唯一の正本は現行仕様とする。
- 静的な機械可読ルール情報は共通の自己説明生成元から返す。
- 現在局面の事実はObservationを正とする。
- 現在合法な操作はLegal Actionsを正とする。
- 説明資料は同じ正データから確認し、独自ルールを追加しない。

---

# 7. Portable AI Packageと説明資料

## 7.1 既存Workflow

リモート`main`に追加済みの`.github/workflows/ai-portable.yml`を継続利用する。

- Pages用`CI and GitHub Pages`成功後に別Workflowとして実行する。
- Pages Artifact、Pagesデプロイ先、公開サイトを変更しない。
- Linux x64 Node.js 22、locked dependencies、ソース、AIガイドを含むZIPを生成する。
- ZIPはCommit SHA、App Version、Node Versionを`BUILD_INFO.txt`へ記録する。
- 手動実行も可能とする。
- Bundled Nodeを使った1ゲームSmoke Testを維持する。

## 7.2 `PLAY_WITH_AI.md`

既存のリポジトリ直下`PLAY_WITH_AI.md`を、Portable ZIPを渡された外部AIの人間可読な主要入口とする。

- 英語を正本とする。
- ZIPトップレベルと`game/`内へ現行Workflowどおり同梱する。
- AgentGameの起動、公開メソッド、Fair Play境界、Artifact取得を説明する。
- v1.2.6の回復、鎮圧、射程、審査方針、発電所、Capacityの戦術的意味を説明する。
- 特定攻略手順を記載しない。
- 推奨プロンプトは簡潔な理由要約を許可するが、非公開Chain of Thoughtを要求しない。

## 7.3 その他の説明先

- `public/agent-api.html`をAgent / Observation / Bridge `1.2.0`へ更新する。
- READMEのVersion、API、Portable Package、テスト手順を更新する。
- ゲーム内ヘルプ、Tips、無効理由は日本語・英語の両方を更新する。
- `PLAY_WITH_AI.md`と`public/agent-api.html`は英語とする。
- APIの識別子と理由コードは言語非依存、短い自己説明文は英語とする。

---

# 8. AgentGame / Browser Bridge自己説明

## 8.1 共通自己説明

AgentGameへ自己説明取得メソッド`getApiInfo()`を追加する。Browser Bridgeの既存`getApiInfo()`も同じ正データからJSON互換コピーを返す。

最低限、次を含む。

- 各VersionとBuild ID
- 公開メソッド、引数、戻り値、推奨呼び出し順
- Game Overまで1回に1Actionを渡す原則
- Fair Play境界と禁止事項
- 回復区分、率、端数、判定時点、補給条件
- 感染拡大阻止、自動鎮圧条件、ユニット別鎮圧量、州兵の民間被害
- 基本Range、実効Range、軍需不足の影響
- 検問所3方針の審査時間、合格率、感染発生率、発生時感染人数率
- 生産、電力Capacity、発電所の役割
- 最小実行例

## 8.2 メソッド境界

AgentGameの公開メソッドは最低限次とする。

```ts
interface AgentGame {
  getApiInfo(): AgentApiInfo;
  reset(options?: AgentResetOptions): AgentObservation;
  getObservation(): AgentObservation;
  getLegalActions(): GameAction[];
  step(action: GameAction): AgentStepResult;
  isGameOver(): boolean;
  getResult(): AgentGameResult | null;
  getRunArtifact(): AgentRunArtifact;
}
```

Browser Bridgeの公開メソッド名は現行集合を維持する。`getState`、`LoadSnapshot`、ファイル操作、Batch実行、通常UI保存領域は公開しない。

---

# 9. Agent Observation

## 9.1 Unit

各公開人間ユニットで最低限、次を返す。

- 現在HP、最大HP
- Attack、Move
- `baseRange`
- `effectiveRange`
- `rangeModifierReason`: `null`または`military_supply_shortage`
- 現在位置と補給圏内／外
- `recoveryClassIfTurnEndsNow`: `combat` / `rest` / `outOfSupply`
- `recoveryRateIfTurnEndsNow`: `0` / `0.1` / `0.2`またはConfig値
- `recoveryBaseAmountIfTurnEndsNow`
- `recoveryTiming`: `nextPlayerTurnStart`
- 生存と次回判定時の補給が必要であることを示す条件
- `infectionContainmentCapable`
- `suppressionPower`
- `suppressionCivilianDamage`
- `suppressionAvailableIfTurnEndsNow`
- `suppressionTargetId`または`null`

現行の`recoveryAvailable`と`unit_already_acted`だけによる表現は廃止または新Schemaへ置換する。攻撃後でも10%、`Wait`後でも20%となることを正しく表現する。

自動鎮圧がEndTurn時に予定されているユニットは、現在`suppressed`履歴が未設定でも回復予測を`combat`の10%とする。

`effectiveRange`はLegal Actionsと一致させる。軍需品が1でも不足する場合、州兵は`baseRange: 2`、`effectiveRange: 1`となる。Attackは変更しない。

## 9.2 Facility

各施設で最低限、次を返す。

- 所有、状態、稼働状態、補給状態
- 現在健常人口、感染人口、人口上限、上限種別
- 1労働者あたり入力資源
- 1労働者あたり出力資源
- 稼働に電力が必要か
- 稼働時の要求電力Capacity
- 発電所の1労働者あたり発電Capacity
- 現在の推定入力消費量、出力量、発電量
- 停止理由
- 感染・陥落で失われる現在の推定生産量・発電量
- `infectionContained`
- `containingUnitId`または`null`
- `projectedSuppression`
- `projectedCivilianDamage`

発電所へ固定の「最優先」評価を付与しない。AIは公開中の電力不足予測、各施設の電力依存、現在発電量から波及を判断する。

## 9.3 Checkpoint

現在のLifecycle、方針、審査中方針、`waiting`、`screening`、`approved`、感染者、残り審査時間、補給提供状態を維持して返す。

感染中の検問所関連地点では、Facilityと同等の次を返す。

- `infectionContained`
- `containingUnitId`
- `projectedSuppression`
- `projectedCivilianDamage`

3方針の静的な率と時間は自己説明へ置き、各Checkpoint Observationへ重複させない。

## 9.4 公開範囲と決定性

- ObservationはJSON互換コピーとする。
- 取得でGameStateを変更しない。
- 配列順を決定的にする。
- 返却値変更で内部Stateを変更できない。
- PRNG状態、将来乱数、未発生感染、未出現Horde規模を含めない。
- 回復、鎮圧、生産損失は現在情報から導出する条件付き予測として明示する。

---

# 10. Human UI

## 10.1 Unit Bottom Sheet

- 補給圏内／外を表示する。
- 今EndTurnした場合の10%／20%／0%区分を表示する。
- 次のプレイヤーターン開始時に回復することを表示する。
- 基礎回復量を表示する。
- 通常攻撃、反撃、迎撃、鎮圧で20%から10%になることを説明する。
- 軍需不足時の州兵は「実効射程1 / 基本射程2」のように理由付き表示する。
- 感染地点では、駐留による拡大阻止とEndTurn時の自動鎮圧見込みを表示する。
- 即時`SuppressInfection`ボタンは表示しない。

## 10.2 Facility / Checkpoint

- 生産施設の上限30を表示し、入力、スライダー、合法手と一致させる。
- 現在生産、電力要求、発電量、停止理由を表示する。
- 感染が駐留で抑止されているか、自動鎮圧量、州兵の民間被害見込みを表示する。
- 検問所方針は人口増加と感染リスクの交換関係を日英で説明する。

## 10.3 ヘルプ

最低限、次を日英で説明する。

- 回復は次のプレイヤーターン開始時である。
- 戦闘・鎮圧は10%、移動・待機・未行動は20%、補給圏外は0%。
- 駐留だけで感染増加を止め、攻撃回数があれば自動鎮圧する。
- 警察は鎮圧時の民間被害がなく、州兵は鎮圧力が高いが民間被害がある。
- 州兵の射程2と軍需不足時の実効射程1。
- 発電所停止が他施設へ波及し得る。
- 厳格は安全だが合格率50%で、常に通常の上位ではない。

---

# 11. 組み込みAgent

## 11.1 Agent構成

- 新しい`ruleBased` Agent IDは追加しない。
- 現行のルールベース組み込み戦略は`balanced`とする。
- `random`は共通APIへ追随するが、選択アルゴリズムを変更しない。
- Balancedは説明文を読み込まず、ObservationとLegal Actionsだけを使用する。

## 11.2 Balanced Agentの判断領域

最低限、次を評価する。

- 州兵の`effectiveRange`を使った安全な接触拒否
- 軍需不足によるRange低下
- 負傷部隊の補給圏への後退
- 目前の敗北回避と、10%戦闘継続／20%休養の比較
- 駐留による感染拡大阻止と自動鎮圧
- 警察鎮圧と州兵の民間被害
- 発電所停止による電力・生産波及
- 人口、生産、感染、対応部隊、防衛状況に応じた検問所方針
- 有益なActionがない場合のEndTurn

固定Action列ではなく意図カテゴリで試験する。合理的な代替Actionを許容し、特定施設や方針を無条件に選ばせない。

---

# 12. Save移行と互換性

## 12.1 対象

- v1.2.5、Game Rules / GameState / Config `1.2.0`、Save Format 2のSave CodeとJSONを移行対象とする。
- v1.2以前の保存は引き続き非互換とする。
- v1.2.5以前のReplay／Run Artifact／Failure Artifactは非互換とする。
- Save Format番号は2を維持する。

## 12.2 移行手順

旧データのFormat、Checksum、Game Version、Config、State、不変条件を先に検証し、呼び出し元と共有しないコピーへ次を適用する。

- App対象をv1.2.6へ更新する。
- GameState / Config Versionを`1.2.1`へ更新する。
- 各生産施設タイプの旧`workerCapacity`へ5を加える。
- 都市Capacityと検問所Capacityは変更しない。
- 旧`naturalRecovery.rate`を新`combatRate`へ引き継ぐ。
- `restRate = min(1, oldRate × 2)`とする。
- 旧`rounding`を引き継ぐ。
- HP、人口、感染者、資源、RNG、Turn、道路予定、検問所状態、Action履歴は変更しない。

移行後にv1.2.6のConfig検証、Map検証、不変条件をすべて通した場合だけLoadする。

## 12.3 既存荒廃施設

- 移行時点ですでに荒廃しており感染者13人の生産施設を15人へ増やさない。
- 移行済みの荒廃施設は現在感染者数のまま合法とする。
- v1.2.6移行後に新たに陥落した施設から、新Capacity基準の下限15を適用する。
- 移行だけで人口台帳へ感染者を追加しない。

## 12.4 安全性

- 移行元Saveを自動削除、変換保存、上書きしない。
- 移行失敗時は現在のゲーム状態、RNG、保存領域を変更しない。
- 移行後にユーザーがActionを確定またはターン終了した後は、現行の自動保存規則でv1.2.6 Saveとして保存できる。
- 拒否と移行成功を日本語・英語で明示する。

---

# 13. Version境界

| 対象 | v1.2.6 Version |
|---|---|
| App / Release | `1.2.6` |
| Game Rules / GameState / Config | `1.2.1` |
| Save Format | `2` |
| Agent API | `1.2.0` |
| Observation API | `1.2.0` |
| Browser Bridge API | `1.2.0` |
| Artifact Schema | `1.2.0` |
| Balanced Agent | `2.2.0` |
| Random Agent | `1.1.0` |

- Random Agentの選択アルゴリズムは変更しないためVersionを維持する。
- Build IDの扱いは現行仕様を維持する。
- Build IDは乱数とゲーム結果へ影響させない。
- 日本語UIでもタイトルは`Nowhere Left to Hide`に統一する。

---

# 14. Metrics・Artifact

## 14.1 Unit

- Unit Type別の初期隊数、完成隊数、損失隊数、最終生存隊数
- Unit Type別生存率
  - `最終生存隊数 ÷ (初期隊数 + 完成した編成隊数)`
- 撃破直前位置が補給圏外だった人間ユニット損失数
- Unit Type別・回復区分別の実回復HP合計と回復回数
- 10%と20%の選択回数

## 14.2 Population / Production

- 現行の最大人口、感染損失、資源不足損失
- 単一生産施設で観測した最大労働者数
- 全生産施設合計の最大労働者数
- 26～30人を配置した施設Turn数
- 発電所停止Turn数と電力不足Turn数

## 14.3 Checkpoint Policy

方針利用率を次の2種類で記録する。

- 稼働検問所の方針別`branch-turn`比率
- 各方針で実際に審査した人数比率

現行のHorde interception数定義は維持する。

## 14.4 出力

- ゲーム単位Artifactと集約JSONへ全項目を含める。
- 主要な平坦値を固定列CSVへ追加する。
- Balanced Traceへ回復、後退、鎮圧、射程、電力、方針の理由コードを追加する。
- v1.2.6 Replayは新Observation Trace、Action列、Result、Metricsを再現する。

---

# 15. 必須テスト

## 15.1 自然回復

- 補給圏内＋通常攻撃 → 次回開始時10%
- 補給圏内＋反撃 → 10%
- 補給圏内＋迎撃 → 10%
- 補給圏内＋自動鎮圧 → 10%
- 補給圏内＋移動のみ → 20%
- 補給圏内＋`Wait`のみ → 20%
- 補給圏内＋完全未行動 → 20%
- 移動後攻撃／鎮圧 → 10%
- 補給圏外の全区分 → 0%
- EndTurn直後、ゾンビターン前には回復しない。
- 次回判定前に補給喪失した場合は回復しない。
- 最大HPを超えず、1プレイヤーターンに1回だけ回復する。
- 警察3／5、州兵5／10の標準切り上げ値となる。
- ゾンビは回復しない。
- EventとObservation予測が共通判定と一致する。

## 15.2 感染

- 攻撃回数なしの駐留でも内部感染増加を止める。
- 攻撃回数ありの駐留で感染フェーズに自動鎮圧する。
- 移動のみ、`Wait`、未行動から自動鎮圧できる。
- 通常攻撃、反撃、迎撃後は増加を止めるが鎮圧しない。
- 警察と州兵の鎮圧量、州兵の民間被害を維持する。
- 施設と全Checkpoint Lifecycleで同じ境界を適用する。
- `SuppressInfection`をLegal Actionsへ返さず、直接入力も状態変更なしで拒否する。
- UIとBrowser Bridgeから即時Actionを実行できない。

## 15.3 Capacity

- 5生産施設タイプすべてで30人まで配置できる。
- 31人以上を拒否する。
- 26～30人目に既存生産式を適用する。
- UI、Config、Map、GameState、Observation、Legal Actionsの上限が一致する。
- 新規陥落した標準生産施設の感染者下限が15となる。

## 15.4 Observation / API

- `baseRange`、`effectiveRange`、軍需不足理由とLegal Actionsが一致する。
- 回復区分、率、基礎量、時点、条件を正しく返す。
- EndTurn時に自動鎮圧予定なら回復区分を10%として予測する。
- 駐留による感染抑止、鎮圧量、民間被害を正しく返す。
- 施設の入力、出力、電力要求、発電、損失見込みを正しく返す。
- `getApiInfo()`がAgentGameとBrowser Bridgeで同じルール情報を返す。
- 返却値はJSON互換、非共有、決定的で、取得時にStateを変更しない。
- 非公開情報を含めない。

## 15.5 Save移行

- 標準v1.2.5 Saveをv1.2.6へ移行できる。
- カスタムCapacityへ+5を適用する。
- カスタムRecoveryをCombatへ引き継ぎ、Restを2倍・上限100%とする。
- 既存荒廃施設の感染者を増やさない。
- HP、人口、資源、RNG、道路予定、検問所状態を保持する。
- 移行元を上書きしない。
- 不正・破損・移行不能データで現在Stateを変更しない。
- v1.2以前のSaveとv1.2.5以前のReplay／Artifactを理由付き拒否する。
- v1.2.6 Saveの往復とReplay再現が成功する。

## 15.6 Agent固定シナリオ

完全なAction列ではなく、次の意図カテゴリまたは合理的代替を検証する。

- 州兵が安全な射程2攻撃を評価する。
- 軍需不足時に射程1として判断する。
- 負傷部隊が補給圏へ後退する。
- 安全な局面で10%戦闘継続と20%休養を比較する。
- 警察の感染拡大阻止・鎮圧を評価する。
- 州兵鎮圧の民間被害を考慮する。
- 発電所停止の州全体波及を評価する。
- 人口不足時と感染危機時で検問所方針を比較する。
- 不要なActionを反復せずEndTurnする。

---

# 16. Simulationと外部AI E2E

## 16.1 CI

- 標準Config、固定Seed 1～100でRandom／Balancedを技術的失敗なく完遂する。
- 既存Unit、Invariant、Save、Replay、Browser Bridge、Production Build試験を含む。
- Game内敗北は技術的失敗に数えない。

## 16.2 リリース前300 Seed

- 標準Config、固定Seed 1～300でBalancedを実行する。
- 可能な限り同じSeed集合のv1.2.5結果と比較する。
- Seed 1の勝敗だけを合否条件にしない。
- 勝率、平均／中央生存Turn、Unit損失、Unit Type別生存率、感染損失、資源不足損失、最大人口、最大労働者、Horde interception、補給圏外損失、回復、方針利用率を比較する。
- 事前の固定勝率閾値は設けない。
- 州兵が実質的に不死身、経済が恒常的に飽和、特定方針が無条件支配的等の異常をレビューする。

州兵の生存率上昇そのものは失敗としない。射程、補給維持、後退判断の結果として生存率が上がることは目的に含む。

## 16.3 Portable Package Smoke

- `AI Portable Package` WorkflowがPages Workflow成功後に独立して成功する。
- 最新`PLAY_WITH_AI.md`、ソース、依存、Linux x64 Node、Build InfoをZIPへ含める。
- Bundled Nodeだけで1ゲームのRandom Smokeを実行できる。
- Pages Artifactとデプロイ結果へ影響しない。

## 16.4 ChatGPT手動E2E

- 最新GitHub Actions生成のPortable ZIPを使用する。
- ChatGPTの新規Sol mediumセッションを使用する。
- ZIPと`PLAY_WITH_AI.md`の標準依頼だけを渡し、追加の口頭攻略説明を行わない。
- 最低1ゲームをGame Overまで実行する。
- 実際に遭遇した局面で、回復、鎮圧、射程、方針、電力の理解をActionと最終報告から確認する。
- 遭遇しなかった項目は不合格にせず、自動固定シナリオで担保する。
- 勝利は合格条件にしない。
- ResultとRun Artifactを取得し、Replayできることを確認する。

---

# 17. 実装順序

## Phase 1: Version・Config・Save移行

- Version定数を分離更新する。
- Recovery ConfigをCombat / Restへ変更する。
- Capacity 30とv1.2.5 Save移行を実装する。
- 移行・非互換・不変条件試験を先に整備する。

## Phase 2: Recovery / Suppression Core

- 共通の回復区分・回復量導出関数を実装する。
- 回復Eventを追加する。
- 自動鎮圧境界を回帰確認する。
- 即時`SuppressInfection`公開Actionを除去・拒否する。

## Phase 3: Observation / API

- Unit、Facility、Checkpoint Observationを更新する。
- AgentGameとBrowser Bridgeの共通`getApiInfo()`を実装する。
- Schema、コピー、決定性、非公開境界を試験する。

## Phase 4: Human UI / Documents

- 回復、実効Range、感染抑止・鎮圧、生産・電力表示を更新する。
- 日英ヘルプを更新する。
- `PLAY_WITH_AI.md`、`public/agent-api.html`、READMEを更新する。
- Portable Workflowの同梱・Smokeを更新する。

## Phase 5: Agent / Metrics

- Balanced Agent `2.2.0`を新Observationへ対応する。
- Random Agentを共通APIへ追随させる。
- Metrics、CSV、Trace、Artifactを更新する。

## Phase 6: 統合検証

- 全Unit、Invariant、Save、Replay、Agent、Browser、Build試験を実行する。
- CI 100 Seedとリリース前300 Seedを実行する。
- Portable ZIPを生成し、ChatGPT Sol mediumの新規セッションで手動E2Eを行う。
- 合格後に本書を現行仕様へ反映する。

---

# 18. 成果物

- 10%／20%自然回復と共通予測関数
- 感染拡大阻止・自動鎮圧へ統一したGame Core
- 生産施設Capacity 30
- v1.2.5 Save移行
- Human UIの日英表示・ヘルプ
- Agent API / Observation / Browser Bridge `1.2.0`
- Balanced Agent `2.2.0`
- Artifact Schema `1.2.0`と追加Metrics
- 更新済み`PLAY_WITH_AI.md`、`public/agent-api.html`、README
- 更新済みPortable AI Package
- 固定シナリオ、100 Seed CI、300 Seed比較、外部AI E2E結果

---

# 19. v1.2.6完了条件

次をすべて満たした時点でv1.2.6を完了とする。

1. 自然回復が次のプレイヤーターン開始時に1回だけ発生する。
2. 戦闘・鎮圧10%、移動・待機・未行動20%、補給圏外0%を正しく分類する。
3. 両回復率で標準切り上げを適用し、最大HPを超えない。
4. 駐留だけで感染増加を止め、攻撃回数が残れば感染フェーズで自動鎮圧する。
5. 即時`SuppressInfection`公開Actionを除去・拒否する。
6. 5生産施設タイプの標準上限が30となり、26～30人目へ既存生産式を適用する。
7. 新たな生産施設陥落時の標準感染者下限が15となる。
8. Human UIが回復、実効Range、感染抑止・鎮圧、生産・電力を日英で説明する。
9. Agent Observationが現在局面の回復、鎮圧、射程、生産、電力を機械可読に返す。
10. AgentGameとBrowser Bridgeが同じ自己説明を返す。
11. `PLAY_WITH_AI.md`とPortable ZIPが追加の口頭攻略説明なしで利用できる。
12. Balanced Agentが固定攻略手順ではなくObservationとLegal Actionsから新ルールを判断する。
13. v1.2.5 Save Format 2を決定的に移行し、移行元を上書きしない。
14. v1.2.5以前のReplay／Artifactとv1.2以前のSaveを理由付き拒否する。
15. 新Metrics、JSON、CSV、Trace、Artifact、Replayが新Versionで整合する。
16. 固定Seed 1～100のRandom／Balancedが技術的失敗なく完遂する。
17. 固定Seed 1～300のBalanced結果をレビューし、重大なバランス異常がない。
18. Portable Package SmokeとChatGPT Sol mediumの手動E2Eが成功する。
19. 勝利自体や特定勝率を合格条件にしない。
20. 実装、テスト、動作確認後、本書を現行仕様へ反映し、Version、Save、Human UI、AI資料を整合させる。

---

# 20. 実装後に観測する問い

- 10%戦闘回復と20%休養の選択が実際に発生するか。
- 補給圏への後退が有効でありながら、州兵を実質不死身にしていないか。
- 警察が感染対応能力として維持・利用されるか。
- 発電所喪失の波及をHumanと外部AIが同じ公開情報から判断できるか。
- Strict固定以外の方針選択が合理的に発生するか。
- Capacity 30で人口を生産へ転換しやすくなり、経済を恒常的に飽和させていないか。
- Portable Packageの説明だけで外部AIが公開API境界を守って完遂できるか。

これらはv1.2.6実装中のConfig調整と、後続アップデートの判断材料にする。本書のスコープ外となる新システムは追加しない。
