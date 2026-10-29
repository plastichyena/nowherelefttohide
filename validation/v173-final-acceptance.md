# v1.7.3 最終ローカル受入記録

2026-10-29。作業branch `codex/nlth-v1-7-3-security`、基点 `d0b08ccaf5969c00f8d021a2e0c2ff3d880121f3`。

最新のユーザー承認は、未公開v1.7.2スコアと必要セキュリティ修正をv1.7.3として既存origin/mainのPages経路へ公開すること。保存表示の限定修正を元担当が完了した後、公開再開の指示を受領した。元担当threadのcompleted・activeRunIdなし・pending 0を読み取り確認し、並行writerを作らず限定patchを取り込んだ。独自モデル・subagentの起動はない。

この記録は修正後の必要なローカル確認の結果である。[修正前受入記録](v173-acceptance.md)、[元引継ぎ](v173-score-save-status-handoff.md)、[元v1.7.2結果](v172-acceptance.md)は履歴として変更せず保存した。remote到達・公開サイト反映・CI結果はそれぞれ別の事実として扱う。

## 限定修正と入力

- 元patch `validation/v172-save-status-fix.patch` のSHA256は `280e63b239ac6e4a391f340d387fe87b4626d9a099dbd1447fca5fd3754b7ee7`。隣の報告書・新規test・実失敗ログを確認し、専用treeにコピーして証跡を保持。元treeへ書込み・stage・commitはしていない。
- 既存Controllerが修正前hash `1c1e1622146b9726e53a004738b3171c81a89fb9da747f23baccb3cc565096cb` と一致し、新testが未存在であることを確認。`git apply --check` 成功後にpatch全体を適用した。手修正・版合わせのための期待値変更はない。
- 修正後Controller SHA256 `7759ac1dc29879a120845609fbd53edcb7e651bce748e8fa1ac29814dfd8dbe2`。new testのCRLF適用後hash `1e5020d3453ce4bf5f2a6ed00b3a9701a83bfe4ae838861b56a0ac91c7bde495` は元担当のpatch検証結果と一致。LF正規化内容も原本と同一。
- `updateHud`から共通の保存状態表示更新を呼び、その更新がメニューボタン・開いたメニューにも同じlabel/pending状態を反映する。保存処理順序・保存State・結果・スコア・GameActionは変えない。
- 修正前の471入力との相違はController 1件のみ。新testを加えた現在の472入力は[最終入力manifest](v173-final-inputs.json)、hash・ログ・件数は[機械可読検証記録](v173-final-verification.json)に固定した。

## 試験の対応関係

| 入力と確認 | 結果 |
| --- | --- |
| 元担当の修正前・同じ6ケース | 実際に6失敗、0成功、0skip、exit1。保存表示の不一致で失敗した元ログを保持。ここでは重複再実行していない |
| 修正後の統合版Controller 2ファイル | 既存49＋新規6＝55成功、0失敗、0skip、exit0、19.40秒 |
| 修正後型検査 | `npm run typecheck` 成功 |
| 修正後production build | `npm run build -- --outDir output/v173-security/save-status-fix/dist --emptyOutDir false` 成功。既存のchunkサイズ/static-dynamic import警告は残る |
| 修正後静的Bridge smoke | `npm run test:browser-bridge -- --dist=output/v173-security/save-status-fix/dist` 成功、3 JS bundleと公開API HTML。実ブラウザ試験とは別 |
| 修正後portable CLI build | 成功。既検証CLIとSHA256が一致、下記参照 |
| 修正前統合版の通常Vitest回帰 | 149ファイル、1304成功・11skip・0失敗。**今回の表示修正を含む全体結果ではない**。旧入力・ログ・[結果](v173-verification.json)を保持 |
| 変更のないrelease/security Node試験 | 以前の15成功、0skipを利用。source-map-jsの旧版実失敗と修正版成功、Node下限・Vite境界の記録も保持 |

追加変更は表示更新とそのtestだけなので、全体回帰の反復はせず関連回帰・型・build・実ブラウザを実施した。30seed/seed198は通常ゲートの除外対象、200ゲーム・512MiB制約も未完走。既存11skipを成功数に含めない。元v1.7.2の初回6ファイル/8test失敗、後続限定176成功、npm ci EUSAGE、未完走30seedも保持する。

## 修正後の実ブラウザ

T3所有incognito、production preview `127.0.0.1:4175`、1280×800/390×844。[ブラウザ記録](v173-final-browser-checks.json)、[モバイル結果画面](v173-final-save-status-ja-mobile.png)。元のユーザーデータを使わず、既存の同一Coreから生成したfixtureを使用した。

- JSON won取込の自動保存後、メニュー・結果が「保存済み · 最終保存ターン 2」に揃いpending=false。実書込時点は「保存中…」/pending=true。
- 異なる旧保存（敗北Turn1、-1657301）を作成してから書込失敗を注入しwonを取込むと、表示中の結果は+17951、メニュー・結果表示は保存失敗/最終保存Turn1で揃う。旧保存bytesは変わらない。
- 手動再試行で保存成功後、メニュー・保存modal・再表示した結果が保存済みTurn2に揃う。保存State hash `6496d0fa574db6852225e5fb69948c67731f0991e5f13befb78745cfcb046e5f` と保存bytes hashは最初の成功時と一致し、結果・スコアも不変。
- 英語でv1.7.1終了JSONを読むだけでは未計測結果・Unsaved changesのまま、新保存枠と書込回数を変えない。旧autosave読込と明示保存の境界は新規回帰testでも確認した。390pxで横はみ出しなし。物理端末・screen readerの試験ではない。
- 保存modalの閉じるselectorが2要素に一致した操作エラーと、そのため次操作がtimeoutした記録は保持。正しいbutton指定で解消した。製品試験失敗には読み替えない。

localStorageの障害注入hookは復元した。所有tabをclose、所有server session 90845へCtrl+Cを送り終了（終了操作によるexit1）。読み取りprocess照合で対象Viteの残存なし、preview_statusもavailable=false。未知のプロセスは操作していない。

## Security・clean install・portable

影響条件・修正版・直接の公式URL・緊急度・互換性・rollbackは[評価計画](<../Doc/Nowhere Left to Hide PoC v1.7.3 セキュリティ更新計画.md>)に記録。通常保守更新、到達可能な旧開発サーバーを使う環境では優先適用。Vite6.4.5、source-map-js1.2.2、loopback既定、Node22.23.4/24.22.1/26.12.1各系統の最低版検査を採用した。

修復lock SHA256 `fe8fe99da792a4819b4f387dbfd836504e7f60aa34100edfebf3a68709cbcc59` はclean install成功時から不変。Vite/source-map-js以外は不要更新せず、lzma・sourcemap-codec・es-module-lexerの記載version不整合3件を実tarballに合わせた。基点と同じpackage/lockの新品コピーは今回のWindowsおよびLinux指定依存解決で成功したが、元checkoutそのものを再installしておらず以前のEUSAGEの原因確定・再現には至っていない。Linux指定はLinux実行試験ではない。npmの既存esbuild postinstall承認警告は保持し、端末全体の設定・Nodeは変えていない。

残るaudit指摘対象は開発系の`@vitest/mocker`・`vitest`・`tinypool`（moderate1/critical2、production0）。公開mocker/API設定や先行prototype pollutionなどの成立条件があり、現構成の通常実行で該当入口を確認していないが、安全・悪用不能を保証するものではない。メジャー更新を無条件で入れず、計画書に継続課題を残す。

再buildしたportable CLI SHA256 `f94085d7e1c743f4ad62e1f3692835a1025bcd93a40e48164b52341d56e7b88f` は先にsmokeした19ファイルのPlayer packageとバイト同一。91入力のclosureにControllerは含まれず、UIを配布する形式ではない。既存の10コマンド、Seeds1/7各15/16 Decisions、Compact/Result replay一致と、別試験preview-batch成功の証拠を利用できる。初回preview-batch harnessが解放済みlock履歴の追加を誤って拒否した失敗も保持した。

同梱Node22.23.4実行体SHA256は公式SHASUMSと一致する `dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f`。過去の未commit buildId ZIPは保存し、最終commit後に別名でWindows package/ZIPを組み立て、identityとlauncherを限定確認する。生成結果・commit・ZIP hashは実行後の専用tree `output/v173-security/publication-receipt.json` に記録する。portable文書の今回の受入記録リンクはリポジトリを参照し、packageへの証跡全体同梱を意味しない。

## 保全・公開手順・未確認

元担当完了後を基準に、main626ファイル/未追跡2件と元v1.7.2の658ファイル/変更73件の内容hash・HEAD・branch・statusがすべて一致。原本・既存証跡・未追跡物は保全された。途中の原本変更検出は元担当再開時の履歴として残し、この新基準と混同しない。

実在originは `https://github.com/plastichyena/nowherelefttohide.git`、既存Pages設定はworkflow/main。確認済みmain基点に変更がないことを再照合し、必要ファイルだけを明示stage・commit後、専用branchと`origin/main`へ通常fast-forward pushする。main作業treeは未追跡物保全のため切替・reset・mergeせず、専用treeからremote mainを更新する。実施後のSHA・到達確認は別receiptと最終報告に残す。stage準備では承認済み取込manifestと必要追加ファイルの91件に限定し、想定外差分0、472入力のhash再照合成功、現在の5文書のローカルリンク49件存在確認成功。stage前のgit diff --checkは成功した。

stage後の全対象`git diff --cached --check`はexit2。元v1.7.2要件原本の3〜5行にあるMarkdown改行用の末尾2スペース3件を検出した。ユーザーの原本保全指示に従って内容hashを維持し、これを除く全対象の同検査はexit0。原本に新しく加えた空白ではなく、ゲームコード・test・今回の文書に同エラーはない。失敗ログと限定確認結果を保持した。Gitの既存改行変換・ignore読取警告も残る。

GitHub Actions/CIの結果待機・監視・poll、release/tag作成、portable配布公開、権限設定変更は行わない。push後の公開HTML確認は1回に限り、反映を確認できなければプレイ可能とは断定しない。Linux native portable/Node24・26/長時間専用試験/全seed・custom/実機mobileは未検証のままである。rollbackは計画書のとおり旧保存枠を保持した通常revert等を検討し、force pushや保存データの強制downgradeを行わない。
