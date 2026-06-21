# BackStage 宣伝動画メーカー（bs-moviemaker）

キャストがアプリの「動作確認（収録）」画面のグリーンバック映像を録画 → ブラウザだけで
**緑を抜いて背景・盛り上げ素材・テキスト・BGM を合成し、縦型ショート(9:16)動画を書き出す**ツール。
スマホ（iOS Safari / Android Chrome）中心。ビルド不要の素 HTML + バニラ JS。

## つかいかた（キャスト向け）
1. アプリ →「動作確認（収録）」→ 背景切替で**緑背景**にした画面を**画面録画**する。
2. このツールを開き、録画動画を選ぶ。
3. 背景・盛り上げ素材・テキスト・BGM を選び、長さを調整。
4. 「この内容で動画を作成」→ 端末に保存 or 共有して各SNSへ。

> 作成は**実時間**で進みます（30秒の動画＝約30秒）。作成中は画面を消さないでください。

## 技術構成
クライアント完結の「再生しながら録画」方式:
hidden `<video>` → WebGL で緑抜き → 2D canvas で合成 → `canvas.captureStream()` +
WebAudio でミックスした音声 → `MediaRecorder` で録って書き出し。

| モジュール | 役割 |
|---|---|
| `js/chromakey.js` | WebGL シェーダで緑単色を抜く |
| `js/compositor.js` | 背景→緑抜き映像→オーバーレイ→テキストを1フレ合成 |
| `js/audiomixer.js` | 声 + BGM を WebAudio でミックス |
| `js/recorder.js` | MediaRecorder 録画・出力 MIME 自動選択 |
| `js/timeline.js` | トリミング・再生・フレーム駆動 |
| `js/presets.js` + `data/presets.*` | 素材プリセット |
| `front/index.html` | UI（各モジュールを束ねる） |

各モジュールは `window.BSMM.<name>` に公開（otoku-charge の `window.BSPayment` 流儀）。

## 素材の追加
`data/presets.json` を編集 →（Node 環境で）`node data/gen-presets-js.js` で
`presets.public.json` と `presets.js` を再生成する。素材ファイルは:
- 背景: `assets/backgrounds/*.jpg`
- BGM: `assets/bgm/*.m4a`
- オーバーレイ: `assets/overlays/*.png`（`BackStageEvo_MovieMaker/sozai.zip` 由来を展開済み）

座標 `rect` は正規化(0..1)。9:16・解像度非依存。

## ローカル確認（PC）
`captureStream` / WebGL は https か localhost が必要なため、ファイル直開きではなく簡易サーバ経由で:
```
cd web/bs-moviemaker
python -m http.server 8080   # → http://localhost:8080/front/index.html
```

## デプロイ（Firebase Hosting）
`firebase.json` / `.firebaserc`（project: `backstage-moviemaker`）を同梱。手動デプロイ:
```
firebase deploy --only hosting
```
`.github/workflows/` の 3 段 CI（preview/staging/production）は **otoku-charge と同じく、
このフォルダを独立 GitHub リポジトリにし、Secret `FIREBASE_SERVICE_ACCOUNT_BACKSTAGE_MOVIEMAKER`
を登録した場合に発火**する。親リポ（Claude_forBackStage）に内包したままでは CI は発火しないため、
当面は上記の手動デプロイを使う。

## 既知の注意点（実機検証が必要）
- **出力フォーマットは端末依存**（iOS=mp4 寄り / Android=webm 一般）。webm が SNS に
  アップロードできるかは実機での確認が必要。互換性不足なら将来サーバー側 mp4 変換を追加。
- 作成は実時間。長尺・発熱・録画中のバックグラウンド化に注意。
- 詳細は `docs/spec.md`。
