# bs-moviemaker（BackStage 宣伝動画メーカー）

キャスト向けのブラウザ動画作成ツール。緑背景録画 → クロマキー合成 → 9:16 ショート書き出し。
スマホ中心・素 HTML + バニラ JS・ビルド不要。詳細は `README.md` / `docs/spec.md`。

## 設計原則
- 各機能は `js/*.js` の独立モジュールで、`window.BSMM.<name>` に公開。DOM は触らず入出力契約で固定
  （otoku-charge の `window.BSPayment.checkout()` 流儀）。UI 結線は `front/index.html` のインライン JS のみ。
- 依存方向: `ui → (timeline, compositor, audiomixer, recorder, presets)`、`compositor → chromakey`。循環禁止。
- 外部ライブラリ・バンドラを足さない（WebGL シェーダは JS 内テンプレ文字列で直書き）。

## 編集時の注意
- 素材プリセットは `data/presets.json` がマスタ。編集後 `node data/gen-presets-js.js` で
  `presets.public.json` / `presets.js` を再生成（Node 必須。手書き同期する場合は3ファイルを必ず一致させる）。
- 座標 `rect` は正規化(0..1)。解像度を変えても崩れないこと。
- 出力 MIME / SNS 互換 / iOS 音声合流は**実機検証が必要**で、コードからは断定しない。

## ローカル確認
`captureStream`/WebGL は https/localhost 必須 → `python -m http.server` 経由で
`http://localhost:8080/front/index.html` を開く（file:// 直開きは presets フォールバックのみ動作）。
