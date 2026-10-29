# 保存メニュー表示の修正引継ぎ

2026-10-29、ユーザー決定: **管理側から元v1.7.2担当へ戻し、今回の公開を保留する**。対象担当 `mcp:77447112-45c9-47af-8787-1b07f3c60681`。本担当から別モデル/agentを起動せず、元担当へメッセージも送っていない。本担当は元worktreeを編集・stage・commitしていない。

後続状況: 22:44 JSTに元担当のordinal2 runningを確認し、同時刻の原本hash照合で元`src/ui/controller.ts`だけが初回から変化していた。この更新は統合treeへ取り込んでいない。統合treeのControllerは下記の修正前hashを保ち、今回の検証記録はその入力に対する結果である。元担当の進行中成果に上書きや追加修正を加えず、管理側へ引き継ぐ。

## 確認済みの事象

統合tree `codex-nlth-v1-7-3-security` のproduction buildで、JSON読込に続く自動保存が成功しても、メニューボタンの`aria-label`と`data-pending`が未保存の状態で残る。結果画面の保存状態とlocalStorageは正しい。スコア・保存の破損はこの再現では発生していない。

1. incognitoのproduction previewでApp1.7.3、UNA、random Seed7を新規開始。
2. EndTurn確認を承認しTurn2へ進む。autosave枠`nowhere-left-to-hide:auto-save:v28:v173`へ保存、reload→ContinueでTurn2の復元を確認。
3. タイトルのLoadから、現在コードで生成した`output/v173-security/browser-fixtures/won.json`をImport JSON。
4. 終了結果は+17951。「保存済み · 最終保存ターン 2」に対して、メニューaria-labelは「メニュー · 未保存の変更あり · 最終保存ターン 2」。黄色のpending表示も残る。
5. 同枠のgzip/Base64URLを復号するとstateSecuredと+17951を持つ保存が存在する。自動保存成功なのにメニューだけが古い。

英語敗北fixtureの取込でも同じ表示更新経路を通る。旧v1.7.1終了Saveは「未計測」「未保存」と表示され新枠を上書きせず、この制御を壊してはならない。

証跡: [ブラウザ確認JSON](v173-browser-checks.json)、[モバイル勝利画面](v173-won-ja-mobile.png)、[統合受入記録](v173-acceptance.md)。fixtureは専用tree内に保持し、ユーザー実データを使っていない。

## 原因と最小修正候補

`src/ui/controller.ts` の元v1.7.2変更により、`loadState`は以前の成功枠のTurnを保持し、`hasUnsavedChanges=true`、`saveStatus='none'`として`renderGame()`を行い、通常Saveなら`autosave()`を実行する。これは「取込だけを保存成功と誤認させない」ための正しい意図である。

その後`saveState()`は内部状態を成功/失敗に更新して`refreshSaveStatusUi()`を呼ぶ。同関数は`[data-bind="save-status"]`と`[data-terminal-save-status]`だけを更新し、メニューボタンの`aria-label`/`data-pending`を同期しない。メニュー側の同期は`updateView`内にあるため、render後の保存完了で古い属性が残る。

元worktreeと統合treeのControllerのSHA256はともに`1c1e1622146b9726e53a004738b3171c81a89fb9da747f23baccb3cc565096cb`で、内容が完全一致する（22:34 JST照合、`output/v173-security/controller-origin-check.json`）。

修正候補は、共通の保存状態更新でメニュー属性も同じ状態に同期させること。renderGameの全面再実行やGameAction追加、結果再採点、保存スロット変更は必要ない。`loadState`を以前の「取込直後に保存済み扱い」へ戻すと保存失敗時の保証を失うため避ける。

## 必要な受入確認

- 通常JSON/Continueの保存成功後、結果画面・メニューaria-label・pending表示が一致する。
- 書込失敗時は直前の成功枠とTurnを維持し、メニューと結果画面の双方が失敗を表示する。再試行成功後に双方が成功へ切り替わる。
- 保存中、未保存、旧v1.7.1移行後の未保存状態も一致し、取込のみで旧枠/新枠を意図せず上書きしない。
- 終了後スコア・RNG・Turnは表示更新や言語切替・再試行で変化しない。
- focused Controller/保存回帰、型検査、production buildと上記実画面再現で修正を確認する。

元担当の修正完了後は変更ファイル・内容hash・試験入力と結果を管理側から受け取り、専用統合treeへ限定して取り込む。元v1.7.2のpackage/版定数/lockを統合版へ全面上書きしない。本統合版の既存回帰結果は入力manifestと照合して、影響外の成功を無駄に重複実行しない。今回の公開保留を解除する際は最新のユーザー承認・writer状態・remote mainを再確認する。
