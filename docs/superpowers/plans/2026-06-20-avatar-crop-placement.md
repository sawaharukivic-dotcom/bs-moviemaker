# アバターのトリミング＆自由配置＋音声ガイド Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ソース動画を自由に切り抜いて録画マークを除外し、切り抜き結果を 9:16 キャンバス内に比率維持で自由配置できるようにする。あわせて画面録画のマイク ON を促すガイドと無音素材の警告を出す。

**Architecture:** `compositor.js` に純データの `setAvatarTransform({crop, place})` を追加し、`drawAvatar` の keyCanvas→出力転写を crop(ソース部分矩形)＋place(出力配置先)指定の `drawImage` に変える。ドラッグ操作 UI は CLAUDE.md 方針どおり `front/index.html` のインライン JS に「再利用可能な正規化矩形エディタ」として実装し、crop と placement の 2 か所で使う。音声判定は `audiomixer.probeAudio()`（要素フラグのみのベストエフォート）として追加。

**Tech Stack:** 素 HTML + バニラ JS（ビルド・外部ライブラリなし）、2D canvas、WebGL（既存 chromakey）、Pointer Events。

## テスト方針（このコードベースへの適応）

bs-moviemaker は**自動テストハーネスを持たない**（vanilla・no build・「外部ライブラリを足さない」方針）。captureStream/WebGL/canvas/タッチ操作はブラウザ実行が前提で、MVP 合格条件も実機・ブラウザ観察ベース（`docs/spec.md`）。したがって本計画の検証ステップは **`http://localhost:8080/front/index.html` をブラウザで開いて具体的な操作を行い、観察結果を確認する手動検証**とする。ローカルサーバは `python -m http.server 8080`（`web/bs-moviemaker/` 直下、Python 3.13 導入済み）。確認は PC ブラウザの devtools で行い、最終的な iOS/Android 実機確認は人間側担当。

## Global Constraints

- 外部ライブラリ・バンドラを足さない（WebGL シェーダ等も JS 内直書き）。
- `js/*.js` モジュールは DOM/イベントを触らない。UI 結線は `front/index.html` のインライン JS のみ。
- 依存方向: `ui → (timeline, compositor, audiomixer, recorder, presets)`、`compositor → chromakey`。循環禁止。
- 座標 `rect` は正規化(0..1)。出力解像度（既定 `OUT_W=720, OUT_H=1280` = 9:16）を変えても崩れないこと。
- `window.BSMM.<name>` 公開規約を踏襲。後方互換: 既存挙動（crop/place 未設定時は従来の contain 表示）を壊さない。
- 出力 MIME / iOS 音声合流 / 音声トラック検出の信頼度はコードから断定しない（実機検証事項）。
- コミットはユーザー承認時のみ（環境方針）。各タスクの「Commit」ステップはユーザーに確認してから実行する。

---

### Task 1: compositor に setAvatarTransform と crop/place 描画を追加

**Files:**
- Modify: `js/compositor.js`（state 追加・`drawAvatar` 改修・export 追加。対象は 50-104, 158-166 行付近）

**Interfaces:**
- Produces:
  - `comp.setAvatarTransform({ crop, place })` — `crop`/`place` は `{x,y,w,h}`（正規化 0..1）または `null`。`crop`=ソース部分矩形、`place`=出力配置先。どちらも `null` 可（その軸は既定挙動）。
  - 既定挙動（`crop==null`）= ソース全体。`place==null` = 切り抜き結果を出力に contain フィット（=従来挙動）。

- [ ] **Step 1: state にアバター変換を追加**

`js/compositor.js` の `state` 定義（51-57 行）に `avatar` を足す:

```javascript
    var state = {
      video: null,
      keyParams: {},
      background: { type: 'color', color: '#000000' },
      overlays: [],
      texts: [],
      avatar: { crop: null, place: null }   // crop:ソース部分矩形 place:出力配置先（正規化/null）
    };
```

- [ ] **Step 2: setAvatarTransform を実装**

`setTexts`（63 行）の直後に追加:

```javascript
    function setAvatarTransform(t) {
      t = t || {};
      state.avatar = {
        crop: t.crop || null,
        place: t.place || null
      };
    }
```

- [ ] **Step 3: drawAvatar を crop/place 対応に改修**

`drawAvatar`（93-104 行）を差し替え:

```javascript
    function drawAvatar() {
      if (!state.video) return;
      var W = outCanvas.width, H = outCanvas.height;
      var s = mediaSize(state.video);
      ensureKeySize(s[0], s[1]);
      // 緑抜きを動画アスペクトのまま keyCanvas へ
      renderer.draw(state.video, state.keyParams);

      // ソース部分矩形（crop）。未設定なら keyCanvas 全体。
      var c = state.avatar.crop;
      var sx = c ? c.x * keyW : 0;
      var sy = c ? c.y * keyH : 0;
      var sw = c ? c.w * keyW : keyW;
      var sh = c ? c.h * keyH : keyH;
      if (sw <= 0 || sh <= 0) return;

      // 出力配置先（place）。未設定なら crop 部分を contain フィット。
      var p = state.avatar.place;
      var d;
      if (p) {
        d = { x: p.x * W, y: p.y * H, w: p.w * W, h: p.h * H };
      } else {
        d = containRect(sw, sh, W, H);
      }
      try { ctx.drawImage(keyCanvas, sx, sy, sw, sh, d.x, d.y, d.w, d.h); }
      catch (e) { /* フレーム未準備 */ }
    }
```

- [ ] **Step 4: export に setAvatarTransform を追加**

`return { ... }`（158-166 行）に追加:

```javascript
      setTexts: setTexts,
      setAvatarTransform: setAvatarTransform,
      renderFrame: renderFrame,
```

- [ ] **Step 5: 後方互換（無回帰）をブラウザで確認**

サーバ起動: `python -m http.server 8080`（`web/bs-moviemaker/` で）。`http://localhost:8080/front/index.html` を開き、緑背景動画を選択。
Expected: アバターが**従来どおり 9:16 中央に contain 表示**される（crop/place 未設定なので見た目に変化なし）。devtools Console にエラーが出ない。

- [ ] **Step 6: crop/place 経路を一時コードで確認**

`front/index.html` の `els.srcVideo.onloadedmetadata` 内、`startRender();`（302 行付近）の直後に**一時的に**追加:

```javascript
      comp.setAvatarTransform({ crop: { x: 0, y: 0.15, w: 1, h: 0.7 }, place: { x: 0.1, y: 0.2, w: 0.8, h: 0.6 } });
```

ページ再読込→動画選択。
Expected: アバターの**上下が切り取られ**、**枠の中央やや小さめの位置**に表示される（crop と place が効いている）。確認後、この一時行を**削除**する。

- [ ] **Step 7: Commit（ユーザー承認後）**

```bash
git add js/compositor.js
git commit -m "feat(compositor): add setAvatarTransform for source crop and free placement"
```

---

### Task 2: audiomixer に probeAudio（無音検知・ベストエフォート）を追加

**Files:**
- Modify: `js/audiomixer.js`（module 末尾の公開部 122-124 行付近に module 関数を追加）

**Interfaces:**
- Produces:
  - `window.BSMM.audiomixer.probeAudio(videoEl)` → `Promise<'yes'|'no'|'unknown'>`。要素フラグのみで判定し、**`createMediaElementSource` は呼ばない**（既存 `connectVoice` が要素ごとに 1 回しか作れないため、ここで作ると録画の声取り込みが壊れる）。

- [ ] **Step 1: probeAudio を実装**

`js/audiomixer.js` の `window.BSMM.audiomixer = { create: create };`（123 行）を以下に差し替え:

```javascript
  // 音声トラックの有無をベストエフォートで判定（createMediaElementSource は使わない）。
  // 確実な単一手段が無いため 'yes' / 'no' / 'unknown' を返す。再生中に呼ぶと精度が上がる。
  function probeAudio(el) {
    return new Promise(function (resolve) {
      if (!el) { resolve('unknown'); return; }
      // 1) 明示フラグ（対応ブラウザ）
      if (typeof el.mozHasAudio === 'boolean') { resolve(el.mozHasAudio ? 'yes' : 'no'); return; }
      if (el.audioTracks && typeof el.audioTracks.length === 'number') {
        resolve(el.audioTracks.length > 0 ? 'yes' : 'no'); return;
      }
      // 2) webkitAudioDecodedByteCount: 再生が進むと音声ありで増える
      if (typeof el.webkitAudioDecodedByteCount === 'number') {
        if (el.webkitAudioDecodedByteCount > 0) { resolve('yes'); return; }
        var start = el.webkitAudioDecodedByteCount;
        // 少し再生を進めてから再評価（プレビューは自動再生中の想定）
        setTimeout(function () {
          resolve(el.webkitAudioDecodedByteCount > start ? 'yes' : 'no');
        }, 800);
        return;
      }
      // 3) 判定手段なし
      resolve('unknown');
    });
  }

  window.BSMM = window.BSMM || {};
  window.BSMM.audiomixer = { create: create, probeAudio: probeAudio };
```

- [ ] **Step 2: 音声ありの動画で確認**

`http://localhost:8080/front/index.html` を開き、**音声入りの動画**を選択（プレビュー再生開始後）、devtools Console で:

```javascript
window.BSMM.audiomixer.probeAudio(document.getElementById('srcVideo')).then(console.log)
```

Expected: `'yes'`（または対応外ブラウザで `'unknown'`）がログされる。

- [ ] **Step 3: 無音の動画で確認**

**音声なしの動画**を選択し、同じ Console コマンドを実行。
Expected: `'no'`（Chrome 系）または `'unknown'`。`'yes'` にはならない。

- [ ] **Step 4: Commit（ユーザー承認後）**

```bash
git add js/audiomixer.js
git commit -m "feat(audiomixer): add best-effort probeAudio for silent-clip detection"
```

---

### Task 3: 再利用可能な正規化矩形エディタ（index.html インライン）

**Files:**
- Modify: `front/index.html`（インライン `<script>` 内に `createRectEditor` を追加。`var OUT_W...` 宣言の後、`var els = {...}` の前あたり）
- Modify: `front/style.css`（矩形・ハンドルのスタイル追加）

**Interfaces:**
- Produces:
  - `createRectEditor(hostEl, opts)` → `{ getRect(), setRect(r), setAspect(a), show(), hide(), destroy() }`
    - `hostEl`: `position:relative` な親。矩形は host の clientWidth/Height に対する正規化座標。
    - `opts`: `{ initial:{x,y,w,h}, aspect:(number|null), minSize:(number, 既定0.1), onChange:(rect)=>void }`
    - `aspect` は「host CSS ピクセルでの幅/高さ比」。`null` で自由。リサイズ時に維持。
    - `getRect()` は正規化 `{x,y,w,h}`。`onChange` は move/resize 中に正規化 rect を返す。

- [ ] **Step 1: CSS を追加**

`front/style.css` の末尾に追加:

```css
/* 矩形エディタ（crop / placement 共通） */
.rect-editor { position: absolute; inset: 0; touch-action: none; z-index: 5; }
.rect-editor.hidden { display: none; }
.rect-box {
  position: absolute; box-sizing: border-box;
  border: 2px solid #ffe14d; background: rgba(255,225,77,0.08);
  cursor: move;
}
.rect-box .handle {
  position: absolute; width: 28px; height: 28px; margin: -14px;
  border-radius: 50%; background: #ffe14d; border: 2px solid #222;
  touch-action: none;
}
.rect-box .h-nw { left: 0; top: 0; cursor: nwse-resize; }
.rect-box .h-ne { right: 0; top: 0; margin: -14px -14px -14px auto; cursor: nesw-resize; }
.rect-box .h-sw { left: 0; bottom: 0; margin: auto -14px -14px -14px; cursor: nesw-resize; }
.rect-box .h-se { right: 0; bottom: 0; margin: auto -14px -14px auto; cursor: nwse-resize; }
```

- [ ] **Step 2: createRectEditor を実装**

`front/index.html` のインライン `<script>`、`var OUT_W = 720, OUT_H = 1280;`（111 行）の直後に追加:

```javascript
  // 正規化矩形をドラッグ編集する再利用部品。hostEl(position:relative) に重ねる。
  function createRectEditor(hostEl, opts) {
    opts = opts || {};
    var minSize = opts.minSize != null ? opts.minSize : 0.1;
    var aspect = opts.aspect != null ? opts.aspect : null; // host CSS px の w/h 比
    var onChange = opts.onChange || function () {};
    var rect = opts.initial || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

    var root = document.createElement('div');
    root.className = 'rect-editor';
    var box = document.createElement('div');
    box.className = 'rect-box';
    root.appendChild(box);
    ['nw', 'ne', 'sw', 'se'].forEach(function (k) {
      var h = document.createElement('div');
      h.className = 'handle h-' + k;
      h.dataset.k = k;
      box.appendChild(h);
    });
    hostEl.appendChild(root);

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function layout() {
      box.style.left = (rect.x * 100) + '%';
      box.style.top = (rect.y * 100) + '%';
      box.style.width = (rect.w * 100) + '%';
      box.style.height = (rect.h * 100) + '%';
    }
    layout();

    function hostSize() { return { w: hostEl.clientWidth || 1, h: hostEl.clientHeight || 1 }; }

    // aspect(=cssW/cssH) を正規化空間の w/h 比に変換: (w*hostW)/(h*hostH)=aspect
    function normAspect() {
      if (aspect == null) return null;
      var hs = hostSize();
      return aspect * (hs.h / hs.w); // w_norm / h_norm
    }

    var drag = null; // {mode:'move'|'nw'|..., startX,startY, orig:{...}}
    function toNorm(ev) {
      var b = hostEl.getBoundingClientRect();
      return { x: (ev.clientX - b.left) / b.width, y: (ev.clientY - b.top) / b.height };
    }

    function onDown(ev, mode) {
      ev.preventDefault();
      drag = { mode: mode, start: toNorm(ev), orig: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
      try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    }

    function onMove(ev) {
      if (!drag) return;
      var p = toNorm(ev);
      var dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      var o = drag.orig;
      if (drag.mode === 'move') {
        rect.x = clamp(o.x + dx, 0, 1 - o.w);
        rect.y = clamp(o.y + dy, 0, 1 - o.h);
      } else {
        var na = normAspect();
        var left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h;
        if (drag.mode.indexOf('w') >= 0) left = clamp(o.x + dx, 0, right - minSize);
        if (drag.mode.indexOf('e') >= 0) right = clamp(o.x + o.w + dx, left + minSize, 1);
        if (drag.mode.indexOf('n') >= 0) top = clamp(o.y + dy, 0, bottom - minSize);
        if (drag.mode.indexOf('s') >= 0) bottom = clamp(o.y + o.h + dy, top + minSize, 1);
        var w = right - left, h = bottom - top;
        if (na != null) {
          // アスペクト維持: 高さ基準で幅を合わせ、はみ出しを抑える
          w = h * na;
          if (drag.mode.indexOf('w') >= 0) left = right - w; else right = left + w;
          if (left < 0) { left = 0; w = right; h = w / na; if (drag.mode.indexOf('n') >= 0) top = bottom - h; else bottom = top + h; }
          if (right > 1) { right = 1; w = right - left; h = w / na; if (drag.mode.indexOf('n') >= 0) top = bottom - h; else bottom = top + h; }
        }
        rect.x = left; rect.y = top; rect.w = right - left; rect.h = bottom - top;
      }
      layout();
      onChange({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }

    function onUp(ev) { drag = null; }

    box.addEventListener('pointerdown', function (ev) {
      if (ev.target.classList.contains('handle')) onDown(ev, ev.target.dataset.k);
      else onDown(ev, 'move');
    });
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);

    return {
      getRect: function () { return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }; },
      setRect: function (r) { rect = { x: r.x, y: r.y, w: r.w, h: r.h }; layout(); },
      setAspect: function (a) { aspect = (a != null ? a : null); },
      show: function () { root.classList.remove('hidden'); },
      hide: function () { root.classList.add('hidden'); },
      destroy: function () { try { hostEl.removeChild(root); } catch (e) {} }
    };
  }
```

- [ ] **Step 3: エディタ単体をブラウザで確認（一時ハーネス）**

`preview-wrap`（42-45 行）は `position` 未指定。`front/style.css` の `.preview-wrap` に `position: relative;` が無ければ追加する（Task 5 でも必要）。
`els.srcVideo.onloadedmetadata` 内 `startRender();` の直後に**一時的に**追加:

```javascript
      var __ed = createRectEditor(document.querySelector('.preview-wrap'), {
        initial: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, aspect: null,
        onChange: function (r) { console.log('rect', r); }
      });
```

ページ再読込→動画選択。
Expected: プレビュー上に黄色い枠＋四隅の丸ハンドルが出る。**枠内ドラッグで移動**、**ハンドルドラッグで拡縮**でき、Console に正規化 rect（各値 0..1）がログされる。host 外へはみ出さない。確認後、この一時ブロックを**削除**する。

- [ ] **Step 4: Commit（ユーザー承認後）**

```bash
git add front/index.html front/style.css
git commit -m "feat(ui): add reusable normalized rect editor (pointer drag/resize)"
```

---

### Task 4: 切り抜き UI を compositor に結線

**Files:**
- Modify: `front/index.html`（HTML に切り抜きパネル追加・インライン JS に結線。`els` 追記、`createRectEditor` 利用）
- Modify: `front/style.css`（cropStage のスタイル）

**Interfaces:**
- Consumes: `comp.setAvatarTransform`（Task 1）、`createRectEditor`（Task 3）
- Produces: モジュールスコープ変数 `avatarCrop`（正規化 `{x,y,w,h}` または `null`）と関数 `applyAvatarTransform()`（crop と place をまとめて `comp.setAvatarTransform` に渡す）。`avatarPlace` は Task 5 で使用（本タスクでは `null` 既定）。

- [ ] **Step 1: 切り抜きパネルの HTML を追加**

`front/index.html`、STEP 1 トリミング（`<details class="advanced">` クロマキー、70 行）の**直前**に追加:

```html
    <details class="advanced" id="cropPanel">
      <summary>切り抜き（録画マーク・余白を消す）</summary>
      <div class="crop-wrap" id="cropWrap">
        <canvas id="cropStage" class="crop-stage"></canvas>
      </div>
      <div class="hint">枠をドラッグして、使いたい範囲だけを囲みます（録画中マークは枠の外へ）。</div>
      <button type="button" class="ghost-btn" id="cropReset">切り抜きをリセット</button>
    </details>
```

- [ ] **Step 2: cropStage の CSS を追加**

`front/style.css` 末尾に追加:

```css
.crop-wrap { position: relative; width: 100%; margin: 8px 0; background: #111; }
.crop-stage { display: block; width: 100%; height: auto; }
```

- [ ] **Step 3: els に要素を追加**

`var els = { ... srcVideo: ... };`（141 行）の `srcVideo` 行の後に追記:

```javascript
    srcVideo: document.getElementById('srcVideo'),
    cropPanel: document.getElementById('cropPanel'),
    cropWrap: document.getElementById('cropWrap'),
    cropStage: document.getElementById('cropStage'),
    cropReset: document.getElementById('cropReset')
```

（直前行の末尾カンマ追加に注意）

- [ ] **Step 4: crop 状態と適用関数を追加**

`var rendering = false, recording = false;`（154 行）の直後に追加:

```javascript
  var avatarCrop = null;   // ソース部分矩形（正規化）/ null=全体
  var avatarPlace = null;  // 出力配置先（正規化）/ null=contain（Task 5 で設定）
  var cropEditor = null, cropRAF = null;

  function applyAvatarTransform() {
    comp.setAvatarTransform({ crop: avatarCrop, place: avatarPlace });
  }
```

- [ ] **Step 5: 切り抜きエディタの初期化を追加**

同じく `applyAvatarTransform` の直後に追加:

```javascript
  // cropStage をソースアスペクトに合わせ、srcVideo を毎フレーム描く＋矩形エディタを重ねる
  function setupCropEditor() {
    var vw = els.srcVideo.videoWidth || 9, vh = els.srcVideo.videoHeight || 16;
    els.cropStage.width = vw; els.cropStage.height = vh;     // 実寸=ソースアスペクト
    var cctx = els.cropStage.getContext('2d');
    if (cropRAF) cancelAnimationFrame(cropRAF);
    (function drawCrop() {
      try { cctx.drawImage(els.srcVideo, 0, 0, vw, vh); } catch (e) {}
      cropRAF = requestAnimationFrame(drawCrop);
    })();
    if (cropEditor) cropEditor.destroy();
    cropEditor = createRectEditor(els.cropWrap, {
      initial: avatarCrop || { x: 0, y: 0, w: 1, h: 1 },
      aspect: null,
      onChange: function (r) { avatarCrop = r; applyAvatarTransform(); }
    });
  }

  els.cropReset.onclick = function () {
    avatarCrop = null;
    if (cropEditor) cropEditor.setRect({ x: 0, y: 0, w: 1, h: 1 });
    applyAvatarTransform();
  };
```

- [ ] **Step 6: 動画ロード時に切り抜きエディタを準備**

`els.srcVideo.onloadedmetadata` 内、`startRender();`（302 行付近）の直後に追加:

```javascript
      avatarCrop = null; avatarPlace = null;
      applyAvatarTransform();
      setupCropEditor();
```

- [ ] **Step 7: ブラウザで切り抜きを確認**

`http://localhost:8080/front/index.html` で動画選択 →「切り抜き（録画マーク・余白を消す）」を開く。
Expected:
1. cropStage にソース動画がアスペクトそのまま表示され、黄色い枠が全体を囲む。
2. 枠の**上辺ハンドルを下げる**と、上の帯（録画マーク相当）が枠外になり、**プレビュー（9:16）のアバター上部が消える**。
3. 「切り抜きをリセット」で枠が全体に戻り、プレビューも元に戻る。
Console にエラーが出ない。

- [ ] **Step 8: Commit（ユーザー承認後）**

```bash
git add front/index.html front/style.css
git commit -m "feat(ui): source crop tool wired to compositor"
```

---

### Task 5: 配置 UI（9:16 内で比率維持の自由配置）を結線

**Files:**
- Modify: `front/index.html`（プレビューに配置トグル＋placement エディタ。crop 変更時の place 既定再計算）
- Modify: `front/style.css`（`.preview-wrap { position: relative }` と配置トグルボタン）

**Interfaces:**
- Consumes: `comp.setAvatarTransform`（Task 1）、`createRectEditor`（Task 3）、`avatarCrop`/`avatarPlace`/`applyAvatarTransform`（Task 4）
- Produces: 関数 `defaultPlaceFromCrop(crop)`（crop 正規化→出力 contain の place 正規化）、`updatePlaceEditorAspect()`、placement エディタのトグル UI。

- [ ] **Step 1: preview-wrap を position:relative に＋トグルボタン CSS**

`front/style.css` の `.preview-wrap` に `position: relative;` を追加（無ければ）。末尾に追加:

```css
.place-toggle {
  position: absolute; right: 8px; bottom: 8px; z-index: 6;
  padding: 6px 12px; border-radius: 999px; border: none;
  background: rgba(0,0,0,0.6); color: #ffe14d; font-weight: 700; cursor: pointer;
}
```

- [ ] **Step 2: 配置トグルボタンの HTML を追加**

`front/index.html`、`preview-wrap`（42-45 行）内 `preview-badge` の後に追加:

```html
      <button type="button" class="place-toggle" id="placeToggle">配置を調整</button>
```

- [ ] **Step 3: els に placeToggle を追加**

Task 4 で足した `cropReset` の後に追記（直前行カンマ注意）:

```javascript
    cropReset: document.getElementById('cropReset'),
    placeToggle: document.getElementById('placeToggle')
```

- [ ] **Step 4: place 既定計算とエディタ初期化を追加**

Task 4 の `els.cropReset.onclick = ...` ブロックの直後に追加:

```javascript
  var placeEditor = null, placeOn = false;

  // crop 正規化 → 出力(9:16)に contain した place 正規化（比率維持）
  function defaultPlaceFromCrop(crop) {
    var vw = els.srcVideo.videoWidth || OUT_W, vh = els.srcVideo.videoHeight || OUT_H;
    var c = crop || { x: 0, y: 0, w: 1, h: 1 };
    var cw = c.w * vw, ch = c.h * vh;          // 切り抜き後ソース px
    var ar = (ch > 0) ? cw / ch : (OUT_W / OUT_H);
    var outAr = OUT_W / OUT_H;
    var w, h;
    if (ar > outAr) { w = 1; h = (OUT_W / ar) / OUT_H; }   // 横長→幅フィット
    else { h = 1; w = (OUT_H * ar) / OUT_W; }              // 縦長→高さフィット
    return { x: (1 - w) / 2, y: (1 - h) / 2, w: w, h: h };
  }

  // placement エディタの aspect(=host CSS px の w/h 比)= 切り抜き後ソースの px 比
  function croppedCssAspect() {
    var vw = els.srcVideo.videoWidth || OUT_W, vh = els.srcVideo.videoHeight || OUT_H;
    var c = avatarCrop || { x: 0, y: 0, w: 1, h: 1 };
    var cw = c.w * vw, ch = c.h * vh;
    return (ch > 0) ? cw / ch : (OUT_W / OUT_H);
  }

  function setupPlaceEditor() {
    if (placeEditor) placeEditor.destroy();
    if (!avatarPlace) avatarPlace = defaultPlaceFromCrop(avatarCrop);
    placeEditor = createRectEditor(document.querySelector('.preview-wrap'), {
      initial: avatarPlace,
      aspect: croppedCssAspect(),
      onChange: function (r) { avatarPlace = r; applyAvatarTransform(); }
    });
    if (!placeOn) placeEditor.hide();
  }

  els.placeToggle.onclick = function () {
    placeOn = !placeOn;
    if (placeEditor) { placeOn ? placeEditor.show() : placeEditor.hide(); }
    els.placeToggle.textContent = placeOn ? '配置を確定' : '配置を調整';
  };
```

- [ ] **Step 5: crop 変更時に place 既定とアスペクトを更新**

Task 4 Step 5 の `onChange`（`avatarCrop = r; applyAvatarTransform();`）を以下に差し替え:

```javascript
      onChange: function (r) {
        avatarCrop = r;
        avatarPlace = defaultPlaceFromCrop(r);   // 切り抜き比率が変わるので配置を再フィット
        if (placeEditor) { placeEditor.setAspect(croppedCssAspect()); placeEditor.setRect(avatarPlace); }
        applyAvatarTransform();
      }
```

同様に `els.cropReset.onclick` 内の `applyAvatarTransform();` の前に追加:

```javascript
    avatarPlace = defaultPlaceFromCrop(null);
    if (placeEditor) { placeEditor.setAspect(croppedCssAspect()); placeEditor.setRect(avatarPlace); }
```

- [ ] **Step 6: 動画ロード時に place エディタを準備**

Task 4 Step 6 で追加したブロックを以下に差し替え:

```javascript
      avatarCrop = null;
      avatarPlace = defaultPlaceFromCrop(null);
      applyAvatarTransform();
      setupCropEditor();
      setupPlaceEditor();
```

- [ ] **Step 7: ブラウザで配置を確認**

動画選択後、プレビュー右下「配置を調整」を押す。
Expected:
1. 既定では crop 結果が 9:16 に contain フィット（縦長ソースなら左右に黒帯）して中央表示。
2. 「配置を調整」で枠が出て、**ドラッグでアバターを移動**、**ハンドルで拡縮**できる。拡縮しても**アバターが歪まない**（比率維持）。
3. 拡大して枠いっぱいに広げると黒帯が消える。
4. 切り抜きを変えると配置が自動で中央フィットに戻り、歪まない。
Console にエラーが出ない。

- [ ] **Step 8: 書き出しに配置が反映されるか確認**

「配置を確定」して「この内容で動画を作成」。短い尺で作成し、結果動画を再生。
Expected: プレビューで見えた**切り抜き・配置どおり**に 9:16 動画が書き出される（プレビュー＝出力一致）。

- [ ] **Step 9: Commit（ユーザー承認後）**

```bash
git add front/index.html front/style.css
git commit -m "feat(ui): free avatar placement in 9:16 frame (aspect-locked)"
```

---

### Task 6: マイク ON ガイド＋無音警告バナー

**Files:**
- Modify: `front/index.html`（アップロード card にガイド文・editor に警告バナー・probeAudio 結線）
- Modify: `front/style.css`（バナーのスタイル）

**Interfaces:**
- Consumes: `window.BSMM.audiomixer.probeAudio`（Task 2）
- Produces: 関数 `checkAudioPresence()`（probeAudio 結果で警告バナー表示/非表示）。

- [ ] **Step 1: ガイド文を追加**

`front/index.html` の uploadCard 内 `hint`（37 行）を以下に差し替え:

```html
    <div class="hint">アプリ →「動作確認（収録）」→ 背景切替で緑にした画面を画面録画した動画を選んでください。</div>
    <div class="hint mic-tip">🎤 <b>声を入れるには</b>：iPhone は画面録画ボタンを<b>長押し → マイクを ON</b>にしてから録ってください（既定は OFF で無音になります）。</div>
```

- [ ] **Step 2: 警告バナーの HTML を追加**

`front/index.html`、editor セクションの `preview-wrap`（42 行）の**直前**に追加:

```html
    <div class="warn-banner hidden" id="audioWarn">
      ⚠️ この動画から音声が検出できませんでした。録画時にマイクを ON にしましたか？（このまま作成も可能です）
    </div>
```

- [ ] **Step 3: バナー＋ヒントの CSS を追加**

`front/style.css` 末尾に追加:

```css
.mic-tip { margin-top: 6px; color: #cfe3ff; }
.warn-banner {
  margin: 8px 0; padding: 10px 12px; border-radius: 10px;
  background: rgba(255,180,0,0.14); border: 1px solid rgba(255,180,0,0.5);
  color: #ffd57a; font-size: 13px; line-height: 1.5;
}
.warn-banner.hidden { display: none; }
```

- [ ] **Step 4: els に audioWarn を追加**

Task 5 で足した `placeToggle` の後に追記（カンマ注意）:

```javascript
    placeToggle: document.getElementById('placeToggle'),
    audioWarn: document.getElementById('audioWarn')
```

- [ ] **Step 5: 無音チェック関数を追加して結線**

`applyAvatarTransform` 定義の直後あたりに追加:

```javascript
  function checkAudioPresence() {
    els.audioWarn.classList.add('hidden');
    window.BSMM.audiomixer.probeAudio(els.srcVideo).then(function (res) {
      if (res === 'no') els.audioWarn.classList.remove('hidden');
      // 'yes' / 'unknown' は警告しない（誤検知でブロックしないため）
    });
  }
```

`els.srcVideo.onloadedmetadata` 内、Task 5 Step 6 のブロックの直後に追加:

```javascript
      checkAudioPresence();
```

- [ ] **Step 6: ブラウザで確認**

`http://localhost:8080/front/index.html`。
Expected:
1. アップロード画面に「🎤 声を入れるには…マイクを ON」のヒントが常時表示。
2. **無音の動画**を選ぶと、プレビュー上に黄色の警告バナーが出る。「作成」ボタンは押せる（ブロックしない）。
3. **音声入りの動画**を選ぶとバナーは出ない。
4. 対応外ブラウザ（probeAudio が 'unknown'）でもバナーは出ない。

- [ ] **Step 7: Commit（ユーザー承認後）**

```bash
git add front/index.html front/style.css
git commit -m "feat(ui): mic-on guide and best-effort silent-clip warning"
```

---

## Self-Review メモ

- **Spec coverage**: 機能1（crop=Task1/4, place=Task1/5, 比率維持=Task5, WYSIWYG=Task5 Step8, compositor DOM非依存=Task1, UI は index.html=Task3-6）／機能2（ガイド=Task6, 無音検知=Task2/6, audiomixer に probeAudio=Task2, ブロックしない=Task6 Step5）すべてタスクに対応。
- **probeAudio が createMediaElementSource を使わない**点を Task2 で明記（既存 connectVoice 競合回避）。
- **型整合**: `setAvatarTransform({crop, place})`、`createRectEditor` の戻り（getRect/setRect/setAspect/show/hide/destroy）、`avatarCrop`/`avatarPlace`/`applyAvatarTransform` をタスク間で一貫使用。
- **一時コードの撤去**: Task1 Step6・Task3 Step3 の一時行は各 Step 内で削除を指示済み。
- **要確認の前提**: `.preview-wrap { position: relative }` を Task3 Step3 / Task5 Step1 で担保。`els` への追記はいずれも直前行のカンマ追加が必要（各 Step に注記）。
