# v1.7.1 受入記録

2026-10-04。Windows 11 Home、Node 22.14.0、npm 11.19.1、Chromium 154。単独作業。

状態: 実装・ローカル必須受入検証完了。現行仕様へ反映済み。GitHub Actionsの結果・配布物・Pagesは未確認。

## 範囲と版

変更目標は[確定要件](<../Doc/Nowhere Left to Hide PoC v1.7.1 アップデート要件 確定版.md>)。文書整理を先に `62dd8e7` へコミットした。その後の実装では `Doc/archive/` を根拠にせず、変更していない。

App / package は1.7.1。Rules / State / Config 20、Save27、Agent / Observation / Bridge25、Artifact24、Session / Checkpoint21、Action4、Query1.7、AiSession1.5等は維持した。ルールとデータ構造を変更していないためである。1.7.0以前はApp / Descriptor / Session identity等の照合で理由付き拒否し、通常自動保存は `nowhere-left-to-hide:auto-save:v27:v171` を使う。旧v27以下を移行・上書きしない。1.7.1以降の互換性は努力目標であり、将来版の無条件受入ではない。

## 終了済みSession

原因は、検証済みSnapshotからCoreを復元した直後に、重複して `LoadSnapshot` をゲーム操作として送っていたこと。終局後の `step()` は `game_over` を返すため、読取・exportも止まっていた。CoreのSnapshotコンストラクターによる版・不変条件検証を維持し、二重の操作だけを外した。通常UIの復元も同じ検証境界に揃えた。

`src/testing/v171-session-fixture.ts` の限定fixtureを実Coreと公式Session factoryで実行。勝利は最終Waveの最後の敵を攻撃で撃破、敗北は州都への占領をEndTurnで確定する。拒否Wait → 受理Wait → 終局Actionの3決定を保持する。

- 同じfixture・公式CLI出力経路で、修正前は勝利・敗北とも `game_over`、修正後は両方成功。最初の比較は版更新前に行い、版不一致試験へのすり替えを防いだ。App更新後も1.7.1で再生成・再検証した。
- 途中export後の継続と、終了後の別Node processからの `node scripts/run-session.mjs artifact` が成功。
- `SessionService.readArtifact` と `ReplayPackage.open()`、先頭・中間・最終seek、受理／拒否理由・順序、公開Resultと集計が一致。
- 別Core engineで全stepのprivate state digestとEventを照合し、公式実行Replayも一致。Reader・Core再実行・GUIの成功を別に確認した。
- export前後の保存ファイルhashと内容が一致。既存出力の上書き拒否後もZIPとSessionが不変。終局後のMove・Attack・EndTurnは拒否され、State / RNG / Turnが不変。不正Snapshotの復元も原子的に拒否する。
- hash・Payload・未知版の拒否と公開／非公開境界は既存のSession / Artifact / Replay試験も実行。1.7.0 AppのSave、Session、Checkpoint、実行Replayの拒否試験を追加・更新した。公開ZIPも実際の出力のManifestを1.7.0／未知版99.0.0へ変えてhashを再署名し、破損hashではなく版非対応による拒否と入力・保存元不変を検証した。全体実行でこのファイルが完了した後に拒否assertを追加したため、追加後の `src/replay/package.test.ts` を別途実行して1/1成功（47.83秒）。

再現: `npx vite-node --script scripts/v171-acceptance-fixtures.ts`。出力先は時刻付きの `output/playwright/v171-terminal-*`、最新のZIPパスとSHA256は `output/playwright/v171-fixtures-latest.json` に保存する。

元報告の1.7.0 Session・710決定は**対象外・未確認**。救済や旧データでの再現成功は主張しない。

## ブラウザ

通常画面・操作・例外表示の計606状態（198 + 258 + 108 + 36 + 砲撃確認6）を、390×844、360×740、1280×720の日英で確認した。[計測JSON](v171-ui-evidence.json)に状態一覧と結果を保存。実機スマートフォンの試験ではない。

| Viewport | 未選択の盤面高・比率 | 部隊標準の盤面高・比率 | 上部 |
| --- | --- | --- | --- |
| 390×844 | 604px / 71.56% | 472.23px / 55.95% | 132px、3段 |
| 360×740 | 500px / 67.57% | 368.23px / 49.76% | 132px、3段 |
| 1280×720 | 480px / 66.67% | 354.42px / 49.23% | 132px、3段 |

日英で同じ基準値。文字11px以上、操作域44px以上、横はみ出し・ブラウザ警告／エラー0。移動確認・ドローン指定と、シート展開中の砲撃確認の操作域を盤面・供給トグルと照合した。360×740でも確認ボタンを盤面内へ保持し、長い砲撃予測だけ内部スクロールにした。個別試験で判明したスライダー幅、移設キャンセル、Horde詳細の操作域不足を修正して再実行した。

- 部隊の折りたたみ／標準／展開、詳細の排他、移動の取消と確定、内政での非表示・選択復帰・途中操作破棄。
- 地上＋航空＋施設の順送り、施設＋可視ゾンビ、固定ヘッダーから地形。非公開の敵、搭乗中・破壊済み部隊は選択候補にしない。
- 初期の全28施設、労働者入力同期と実配分、移住予測・確認、給電・全編成拠点の入口と拒否理由、検問所方針と移設の取消。
- 5種の局所建設を実Coreで実行し、新施設を表示。有刺鉄線の建設、建設できないヘックスの理由。
- 感染・Critical・保存失敗・最終Wave進捗の同時表示。「ほかN件」の内訳数、重ね表示の排他・Escape、人口・Horde・保存メニュー。
- IFV搭乗、離陸、砲兵展開を確認画面／ボタンから実行。搭乗後の降車禁止理由、ドローン対象指定の取消も確認。
- 通常表示・詳細・警告・確認の生ID／既知の翻訳キー漏れを検査。表示用番号、座標、イベント名を使い、データのIDは保持。
- 通常セーブの終局状態を日英で画面からロード。不正コード拒否後のStateとlocalStorageが不変で、終局後に別の現行ゲームをロード可能。

Replayは公式CLIが出力した勝利・敗北ZIPを、3サイズ×日英の12通りで読込・前後移動・再生・終局表示。Liveは同じ6画面条件で実SessionのWaitを受理し、名前＋完全な公開ユニットID、原文コメント、非公開対象非表示、通常保存不変を確認。観戦レイアウト自体は刷新していない。

画像: [通常・日本語](v171-390-ja-unit.png)、[通常・英語](v171-390-en-unit.png)、[警告集約](v171-390-ja-warnings.png)、[勝利Replay](v171-replay-390-ja-won.png)。その他はローカル `output/playwright/v171-*.png`。

再実行は開発サーバーの `/scripts/v171-browser-harness.html` を隔離したPlaywright CLI profileで開き、`scripts/v171-{browser-acceptance,browser-inspect,edge-acceptance,tactical-acceptance,artillery-acceptance,replay-acceptance,live-acceptance,save-acceptance}.js` を `run-code --filename` へ渡す。harnessは実Controller / Coreに検証用Snapshotを渡すだけで、Core・保存対象をモックしない。QA用入口はproduction bundleへ含めない。

## 自動検証と限界

全体回帰は `npm.cmd test -- --pool=threads --maxWorkers=2 --exclude src/agent/balancedAgent.batch.test.ts --exclude src/agent/balancedAgent.seed198.test.ts`。要件8.3の長時間Random / Balanced専用試験は除外し、既存の日次専用skipと区別する。最終結果は **143ファイル成功、1,261テスト成功、失敗0、既存11 skip**。13:19:35開始、1,466.97秒（約24分27秒）。skipは既存の `session-v4.test.ts` の日次専用実行条件が無効の試験であり、成功には数えない。

最初の全体回帰は142ファイル成功・1ファイル失敗、1,260テスト成功・1失敗・既存11 skip。唯一の失敗は48回のMap構築と経路／視界を調べる既存 `v165.boundaries` の30秒タイムアウト（30.845秒）。単独では同じassertで19/19成功し対象試験は27.886秒だったため、この試験だけ上限を60秒へ変更した。Seed数・assert・期待値は変更せず、全体を再実行した。

最後の拒否assert追加後の単独型検査も成功。最終production build（型検査を含む）は成功、Vite buildは13.72秒。production Browser Bridge smokeは3 JS bundleで成功。buildの既存chunkサイズ・dynamic import警告は、ブラウザの警告／エラー0と区別する。航空／輸送の確認画面から一般ルールの長文を外した後も、関連36状態を再実行して違反0を確認した。

GitHub Actionsは今回のユーザー指示に従い起動確認まで。結果・配布物・Pages公開先の確認と監視は行わず、後日の依頼を待つ。起動を合格と扱わない。1.7.0の大量map生成、過去のAI勝率・大規模Sessionの実績を今回の成功へ流用しない。

文書の参照リンク40件と `git diff --check` を確認。文書整理コミット以降のarchive差分は0。v1.7.1確定要件はユーザーの追加指示に従い、比較と後日のWorkflow結果確認用にDoc直下に保持する。
