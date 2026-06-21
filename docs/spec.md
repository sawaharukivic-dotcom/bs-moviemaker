# bs-moviemaker 実装スペック

## 目的
BackStage キャストが、アプリ「動作確認（収録）」のグリーンバック録画をアップロードするだけで
宣伝用の縦型ショート動画（9:16）を作れるブラウザツール。スマホ中心・URL公開。

## 入力 → 出力
- 入力: 緑単色背景 + アバターの画面録画動画（mp4/mov 等）。
  - 緑は c3-app 側で `Color.green` のベタ塗り（`CastRecordingPagePresenter.cs:164-177`）。クロマキーしやすい。
- 出力: 9:16 動画（既定 720×1280）。背景 / 盛り上げ素材 / テキスト / BGM を合成、声 + BGM をミックス。

## 方式（クライアント完結 = MVP）
hidden `<video>` を再生 → 毎フレーム:
1. `chromakey`（WebGL）で緑を抜きオフスクリーンへ（アルファ付き・前乗算）
2. `compositor`（2D canvas）で 背景(cover) → 緑抜き映像(contain) → オーバーレイ → テキスト を合成
3. `canvas.captureStream(30)` の video トラック + `audiomixer` の audio トラックを 1 ストリームに
4. `recorder`（MediaRecorder）で録って Blob 出力

採用しなかった案: ffmpeg.wasm（スマホでメモリ/クラッシュ/COOP-COEP リスク → 将来PCオプション）、
サーバー変換（確実だがバックエンド要 → 互換性不足時の次の一手）。

## モジュール契約
- `chromakey.createRenderer(canvas)` → `{ draw(video, {keyColor,similarity,smoothness,spill}), resize, dispose }`
- `compositor.create(outCanvas)` → `{ setVideo, setKeyParams, setBackground, setOverlays, setTexts, renderFrame, dispose }`
- `audiomixer.create()` → `{ resume, connectVoice(el), setBgm(url), startBgm, stopBgm, setBalance(v,b), setMonitor, getOutputTrack, dispose }`
- `recorder.create({canvas,audioTrack,fps})` → `{ start, stop():Promise<{blob,ext,mime}>, mime }`
- `timeline.create(videoEl)` → `{ duration, setTrim, trimmedDuration, onFrame, onEnd, play, pause, seek, playRange }`
- `presets.load()` → `{ backgrounds, bgms, overlays, textTemplates }`

依存方向: `ui → (timeline, compositor, audiomixer, recorder, presets)`、`compositor → chromakey`（循環なし）。

## データ（素材プリセット）
`data/presets.json`（マスタ）→ `gen-presets-js.js` → `presets.public.json`（http配信）/ `presets.js`（file://フォールバック）。
座標 `rect` は正規化(0..1)。テキストスロットは name / catch / cta。

## iOS / 互換性メモ（要実機検証・コードからは確定不可）
- `AudioContext` はユーザー操作後に `resume()`（「作成」ボタン内で実行）。
- `MediaRecorder` 出力コンテナは端末依存。`recorder.pickMime()` が mp4 → webm(vp9) → webm の順で選択し、
  実際の `Blob.type` から拡張子決定。
- webm 出力時の各 SNS アップロード可否は**実機でしか確定できない**。

## MVP 合格条件
スマホ実機で「動画選択 → 緑抜き合成プレビュー表示 → 作成 → 9:16 動画が端末に保存/共有できる」。

## 拡張余地
背景動画 / オーバーレイ複数同時 / テキストアニメ・フェード / BGM 自動ダッキング /
サーバー側 mp4 変換 / PC での ffmpeg.wasm 高品質書き出し / サムネ生成。
