# AIプレイ出力 容量削減の検討メモ（2026-09-25）

対象: `output/claude-playtest-20260924-v165-seed3`（v1.6.5、Seed 3、54ターン、462判断）
位置づけ: 調査メモ。現行仕様やアップデート要件ではない。コード・gitは変更していない。

追記（2026-09-25）: 案A・案Cは現行実装の依存確認を経て、[v1.6.6アップデート要件 確定版](Nowhere%20Left%20to%20Hide%20PoC%20v1.6.6%20アップデート要件%20確定版.md)第15章へ採用した。実装・容量実測は未実施。採用内容・例外・必須検証は確定版を正とし、本メモは比較用の調査記録として保持する。案B・案D・案Eは今回の追加範囲に含めない。下記の20〜25MB／ZIP約5MBという試算を案A＋Cだけの保証値とは扱わない。

## 1. 結論

削減の余地は大きい。ただし308MBの大半はゲームが出力したものではない。

| 区分 | ディスク上の容量 | 出力元 |
| --- | ---: | --- |
| `logs/transcript.jsonl` | 236MB（77%） | テストプレイ用に自作した `tools/bridge.cjs`。CLIの全応答を記録していた |
| `sessions/` | 40MB | ゲーム（Session Store） |
| `*.nlth-artifact/` と `*.nlth-artifact.zip` | 16MB + 15MB | ゲーム（`artifact` コマンド） |
| `tools/session-cli.mjs` ほか | 1.2MB | 自作ツールと、CLIのコピー |

ゲームが出力したのは約72MB。その中で以下の3つが目立つ。

1. ユニットごとの `fuelCostByLegalMove`（合法な移動先すべての燃料予測）。
2. 保存用の公開文書に含まれる `legalActions`（合法Action一覧）。
3. 同じ内容の重複保存（Artifactのディレクトリ版とZIP版、`trace.ndjson` と `public/decisions/`）。

試算では、ゲームの出力は約72MBから20〜25MB程度まで減らせる。観戦ZIPは15MBから5MB前後になる見込み。

## 2. 実測の内訳

### 2.1 transcript.jsonl（236MB、自作ツール）

| 応答の種類 | 件数 | 容量 |
| --- | ---: | ---: |
| `query` の結果 | 383 | 178.9MB |
| Actionの結果 | 462 | 45.5MB |
| Previewの結果 | 336 | 9.3MB |
| その他 | – | 約13MB |

- `query` 178.9MBのうち176.9MBは `target=units`（250回、1回あたり約700KB）。
- そのうち168.4MBが各ユニットの `fuelCostByLegalMove`。
  - 多目的ヘリ1機でも移動先2,597件、約327KBある。飛行ユニットは移動範囲がマップのほぼ全体になるため。
  - 1件は `{destination, fuelCost, projectedFuelAfterMove, movementMode, effectiveMovementCost}` で約125バイト。
- Actionの結果に毎回入る `observation` は1回あたり約100KBで、合計54MB。内訳は `visibleEnemies` 14MB、`facilities` 8MB、`units` 4.8MB、`forecastSummary` 4.2MBなど。

これはプレイヤー側（前回のテストプレイ）の運用の問題。一方で、`units` クエリが既定で全移動先を返すことは、LLMが読むトークン量にもそのまま効いている。

### 2.2 Session Store（`sessions/`、40MB）

| パス | ファイル数 | 実データ | ディスク上 |
| --- | ---: | ---: | ---: |
| `pool/public/chunks` | 1,050 | 14.2MB | 17.2MB |
| `pool/private/chunks` | 933 | 5.8MB | 8.3MB |
| `pool/public/refs` と `pool/private/refs` | 1,880 | 0.55MB | 3.4MB |
| `<session>/public/decisions` | 462 | 2.6MB | 3.6MB |
| `<session>/trace.ndjson` | 1 | 2.6MB | 2.6MB |
| `<session>/commits` | 463 | 0.54MB | 2.1MB |
| `<session>/.lock-history` | 1,239 | 0.15MB | 1.9MB |

- publicのchunkは既にgzip（レベル9）で圧縮済み。展開すると313MBになる。
  - diffの操作のうち、`legalActions` の置き換えが展開後145MBを占める。
  - Snapshotを分割したchunkが展開後140MB。これにも全 `legalActions` が入っている。
  - `observation/units/#/fuelCostByLegalMove` は展開後約11MB。
- `public-diff.ts` は、長さが変わった配列を先頭と末尾の一致部分を除いた `splice` で表す。1ユニットが動くだけで、合法Actionの並びの中央がまとめて入れ替わりやすい。
- Decision記録は `trace.ndjson` と `public/decisions/*.json` に同じ内容が二重にある。
- 小さいファイルが多く（Session全体で約7,700）、クラスタ単位の割り当てで実データの数倍の容量を使っている。
- `.lock-history` には解放済みのロックが `released-*` として毎回溜まり、削除されない。

### 2.3 Artifact（16MB + 15MB）

- `artifact` コマンドはディレクトリ版とZIP版（`replayZipPath`）を両方残す。中身は同じなので約15MBが重複している。
- Artifact内部のpayloadは462件。gzipで12.0MB、展開すると277MB。
- `src/replay/` は `legalActions` を参照していない（grepで確認）。

各payloadから項目を取り除いてgzip（レベル9）で再圧縮した試算:

| 条件 | 展開後 | gzip後 |
| --- | ---: | ---: |
| 現状 | 276.9MB | 12.03MB |
| `legalActions` を除く | 91.5MB | 4.26MB |
| さらに `fuelCostByLegalMove` を除く | 38.7MB | 2.06MB（上限寄りの推定） |

最後の行は、`units/#` 全体を置き換えるdiff操作も除外して数えたため、削減量をやや大きく見積もっている。

## 3. 削減案（効果の大きい順）

### 案A: `fuelCostByLegalMove` を既定の応答と保存から外す

- 変更内容
  - `units` クエリとObservationの既定では、合法な移動先の数（または到達範囲の要約）だけを返す。
  - 移動先ごとの燃料予測は、次のどちらかで取得する。
    - 既存の `route` クエリ（`moverUnitId`, `destination`）
    - `units` クエリの `unitId` 指定と、明示的なオプション（例: `includeMoveProjections`）
- 効果
  - `units` クエリの応答が1回約700KBから数十KBになる。LLMのトークン量も同じ割合で減る。
  - 保存・Artifactの展開後サイズからも数十MB単位で減る。
- 影響範囲
  - このフィールドは `src/agent/` の artillery-policy、aviation-policy、balancedAgent、metrics、route-query が使っている。内部ではCoreの `getUnitLegalMoveFuelProjections` を直接呼べば維持できる。
  - `history.ts` は既に先頭1件へ切り詰めているので、履歴側は影響しない。
- 仕様上の論点
  - Observation API Versionの更新が必要。
  - `PLAY_WITH_AI.md` の説明を変更する必要がある。

#### 軽量モデルがプレイする場合の検討

前提として、DeepSeekやQwenなどの軽量なオープンウェイトモデルもプレイすることを想定する。結論として、削っても支障はない。むしろ軽量モデルほど恩恵が大きいと考える。ただし、全件リストの代わりに以下の情報を返すことが前提になる。

- 現状の全件リストは、軽量モデルには実質的に使えない
  - `units` クエリ1回が約700KBで、概算20万トークン前後になる。コンテキストが128K程度のモデルでは、1回の応答すら収まらない。
  - 収まる場合でも、2,600件の数値の中から目的のマスを正確に拾うのは難しい。見落としや、似たエントリとの取り違えが起きやすい。
  - v1.6.5 seed3のテストプレイ（Opus 5.5）でも、このリストは直接読まず、スクリプトで必要な行だけを抜き出して使っていた。全件リストは、プログラムで絞り込める利用者向けのデータになっている。
- 燃料切れは部隊が動けなくなる致命的な失敗なので、代わりに以下の3つを必ず用意する
  1. ユニットごとの要約: 現在の燃料、1移動力あたりの消費、今の燃料で届くおおよその距離、補給範囲の外にいるか。多くの判断はこれで足りる。
  2. 行き先を1つ指定したときの正確な値: `route` クエリやMoveのPreviewで、燃料消費と移動後の残量を返す。`route-query.ts` に同じ計算が既にある。
  3. 却下時の理由と代替案: 例として「燃料不足。現在の燃料で届く最寄りは (q,r)」。軽量モデルは提案、却下、修正を繰り返して進むため、ここの分かりやすさが最も効く。
- 設計上の注意
  - 軽量モデルは、追加のクエリを投げるという発想自体を持ちにくい。要約の中に「正確な値は `route` で取得できる」と、次に取るべき手順を書いておく。
  - 範囲を絞った詳細版を任意で残してもよい。例: `unitId` を指定し、半径N以内、上限100件。
- 検証
  - 理想は、軽量モデルで同じSeedを現行形式と要約形式の両方でプレイさせ、却下率、燃料切れで動けなくなったユニットの数、1ターンあたりのトークン量を比べること。現時点ではオープンウェイトモデルを動かせる環境がないため、実施できない。
  - 代わりに、モデルなしで次の2点を確認できる。
    - 情報が欠けていないか: 全ユニットのすべての合法な移動先について、`route` またはPreviewの燃料値が、現行の `fuelCostByLegalMove` と一致することを自動テストで確認する。
    - 応答の大きさ: 各クエリの応答のバイト数と概算トークン数を、変更前後で記録する。上限を決めておくと、再び肥大化したときに気づける。
  - 小型の商用モデルを代わりに試す方法もあるが、オープンウェイトモデルと同じ結果になるとは限らない。

### 案B: 保存・Artifactの公開文書から `legalActions` 本体を外す

- 変更内容
  - `SessionPublicDocument` に保存するのは `legalActionsHash`（と件数）だけにする。
  - 一覧が必要なときは、復元済みのRuntimeから作り直す。
- 効果
  - Artifact内部payloadが12.0MBから約4.3MB（約65%減）になる。publicのpoolもほぼ同じ割合で減る。
  - 長いSessionほど効果が大きい。仕様書にある2,000 Action耐久試験のPackage 790MBも大きく減る見込み。
- 作り直しに必要な箇所
  - `query legal-actions` と `full-snapshot`（`service.ts:945`、`service.ts:947`）: Runtimeは既に `cacheRuntime` と `restoreAndVerify` で持っている。
  - Checkpoint復元の検証（`service.ts:1390`）: 一覧同士の比較をハッシュの比較に置き換える。
  - Replay一致: 再実行した側でハッシュを計算して比較する。
- 仕様上の論点
  - 公開文書のハッシュの定義が変わる。Session/Checkpoint Schema、Artifact Schemaの更新が必要。
  - 旧版を移行しない方針は現行と同じでよい。
  - 「Artifactだけで合法手一覧を読める」ことを外部監査などの要件にするかは、判断が必要。現状の観戦・Replayでは使っていない。

### 案C: Artifactの出力をZIPだけにする（ディレクトリは任意）

- 変更内容: `artifact` の既定をZIP単体にし、ディレクトリ版は `--keep-directory` などの指定があるときだけ残す。
- 効果: 今回の出力で約16MB減る。Artifactの容量がほぼ半分になる。
- 注意: 仕様書18章に「ZIPのNDJSONは非圧縮格納」とあり、ZIPの読み込みは既に単体で成り立っている。ディレクトリ版を内部で使っている箇所の確認は必要。

### 案D: Sessionの二重記録と、小さいファイルを整理する

1. Decision記録の二重化をやめる。
   - `trace.ndjson` か `public/decisions/` のどちらかを正にする。
   - 今回の実データで2.6MB、ディスク上で3〜6MB減る。
2. `.lock-history` の `released-*` を残さない。
   - 障害調査用に `stale-*` だけ残すか、最新の数件だけ残す。
   - 1,239ファイル、ディスク上で1.9MB減る。
3. refsと小さいchunkをまとめる。
   - 決定ごとの参照を1ファイルの索引（NDJSONなど）にまとめる。
   - ファイル数が約7,700から数百に減り、クラスタの無駄（今回で数MB）とWindowsでの操作の遅さも減る。
   - 影響範囲が大きい。案A〜Cより優先度は低い。

### 案E（プレイヤー側、コード変更なし）: 応答を丸ごと記録しない

- 今回の236MBは自作ブリッジが全応答を記録したことが原因。ゲームの修正は不要。
- 次回のテストプレイでは、送信したActionと要約だけを記録し、応答の全文は残さない。
- `PLAY_WITH_AI.md` に「大量の応答を記録しない。必要なら `query --out` で個別に保存する」と一文足すと、他のAIプレイヤーにも効く。

## 4. 削減しないほうがよいもの

- private側の `pool`（gzipで6MB）: 決定的な再開に必要な非公開状態。既に圧縮済みで、他と比べて小さい。
- Checkpoint、ハッシュチェーン、lossless diffの仕組み: 仕様上の中核。今回の肥大化は、仕組みではなく中身（`legalActions` と移動予測）が原因。
- `REPORT.md`、`DECISIONS.md`、`final-status.json` などの要約類: 合計で数百KB程度。

## 5. 今回の試算の限界

- 案Aと案Bの効果は、今回の実データからフィールドを取り除いて再圧縮した推定。実装後の実測ではない。
- 案Bの推定には、diffの並び順を改善する効果は含めていない。
- ディスク上の容量はWindows（NTFS）での `du` の値。ファイル数による無駄は環境で変わる。
