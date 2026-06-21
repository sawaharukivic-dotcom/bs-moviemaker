// compositor.js — 1フレームの合成（背景 → 緑抜き映像 → オーバーレイ → テキスト）
//
// 担当: 描画レイヤ統合。chromakey に依存。DOM イベントは触らない。
//
// ━━━ 契約（インターフェース）━━━━━━━━━━━━━━━━━━━━━━━━━━
//   const comp = window.BSMM.compositor.create(outCanvas);
//     outCanvas: 出力 <canvas>（9:16 推奨。例 1080x1920）
//
//   comp.setVideo(videoEl);                 // 緑抜き対象のソース動画
//   comp.setKeyParams({similarity, smoothness, spill});
//   comp.setBackground({type:'image'|'video'|'color', el?, color?});
//   comp.setOverlays([{ el, rect:{x,y,w,h}, opacity }]);   // 座標は 0..1 正規化
//   comp.setTexts([{ text, rect:{x,y,w,h}, style:{font,size,color,stroke,weight,align} }]);
//   comp.renderFrame();                     // 現在の状態で outCanvas に1枚描く
//   comp.dispose();
//
// 座標はすべて正規化(0..1)。背景は cover、アバター映像は contain（見切れ防止）。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(function () {
  'use strict';

  // src を dst 矩形に「cover」（はみ出しトリミング）で収める描画範囲を計算
  function coverRect(sw, sh, dw, dh) {
    var scale = Math.max(dw / sw, dh / sh);
    var w = sw * scale, h = sh * scale;
    return { x: (dw - w) / 2, y: (dh - h) / 2, w: w, h: h };
  }
  // 「contain」（全体が収まる）
  function containRect(sw, sh, dw, dh) {
    var scale = Math.min(dw / sw, dh / sh);
    var w = sw * scale, h = sh * scale;
    return { x: (dw - w) / 2, y: (dh - h) / 2, w: w, h: h };
  }

  function mediaSize(el) {
    if (el.videoWidth) return [el.videoWidth, el.videoHeight];
    if (el.naturalWidth) return [el.naturalWidth, el.naturalHeight];
    return [el.width || 1, el.height || 1];
  }

  function create(outCanvas) {
    var ctx = outCanvas.getContext('2d');

    // 緑抜き用オフスクリーン WebGL canvas（出力と同サイズ）
    var keyCanvas = document.createElement('canvas');
    keyCanvas.width = outCanvas.width;
    keyCanvas.height = outCanvas.height;
    var renderer = window.BSMM.chromakey.createRenderer(keyCanvas);

    var state = {
      video: null,
      keyParams: {},
      background: { type: 'color', color: '#000000' },
      overlays: [],
      texts: [],
      avatar: { crop: null, place: null }   // crop:ソース部分矩形 place:出力配置先（正規化/null）
    };

    function setVideo(v) { state.video = v; }
    function setKeyParams(p) { state.keyParams = p || {}; }
    function setBackground(bg) { state.background = bg || { type: 'color', color: '#000000' }; }
    function setOverlays(list) { state.overlays = list || []; }
    function setTexts(list) { state.texts = list || []; }

    function setAvatarTransform(t) {
      t = t || {};
      state.avatar = {
        crop: t.crop || null,
        place: t.place || null
      };
    }

    function drawBackground() {
      var W = outCanvas.width, H = outCanvas.height;
      var bg = state.background;
      if (bg.type === 'color' || !bg.el) {
        ctx.fillStyle = bg.color || '#000000';
        ctx.fillRect(0, 0, W, H);
        return;
      }
      var s = mediaSize(bg.el);
      var r = coverRect(s[0], s[1], W, H);
      try { ctx.drawImage(bg.el, r.x, r.y, r.w, r.h); }
      catch (e) { ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H); }
    }

    var keyW = 0, keyH = 0;
    function ensureKeySize(sw, sh) {
      // 緑抜き canvas は「動画の実アスペクト」に合わせる。
      // （出力サイズに合わせて貼ると動画が歪み、contain と二重にズレるため）
      var max = 1280;
      var scale = Math.min(1, max / Math.max(sw, sh));
      var w = Math.max(1, Math.round(sw * scale));
      var h = Math.max(1, Math.round(sh * scale));
      if (w !== keyW || h !== keyH) {
        keyCanvas.width = w; keyCanvas.height = h;
        keyW = w; keyH = h;
      }
    }

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

    function drawOverlays() {
      var W = outCanvas.width, H = outCanvas.height;
      for (var i = 0; i < state.overlays.length; i++) {
        var ov = state.overlays[i];
        if (!ov || !ov.el) continue;
        var rc = ov.rect || { x: 0, y: 0, w: 1, h: 1 };
        var bx = rc.x * W, by = rc.y * H, bw = rc.w * W, bh = rc.h * H;
        if (bw <= 0 || bh <= 0) continue;
        var s = mediaSize(ov.el);
        // ソース部分矩形（crop / 正規化）。未設定なら画像全体。
        var cr = ov.crop;
        var sx = cr ? cr.x * s[0] : 0;
        var sy = cr ? cr.y * s[1] : 0;
        var sw = cr ? cr.w * s[0] : s[0];
        var sh = cr ? cr.h * s[1] : s[1];
        if (sw <= 0 || sh <= 0) continue;
        // crop 部分を配置枠 rect へ転写（rect は crop の縦横比で作るので既定はつぶれない）
        ctx.save();
        ctx.globalAlpha = ov.opacity != null ? ov.opacity : 1;
        try { ctx.drawImage(ov.el, sx, sy, sw, sh, bx, by, bw, bh); } catch (e) {}
        ctx.restore();
      }
    }

    function drawTexts() {
      var W = outCanvas.width, H = outCanvas.height;
      for (var i = 0; i < state.texts.length; i++) {
        var t = state.texts[i];
        if (!t || !t.text) continue;
        var st = t.style || {};
        var rc = t.rect || { x: 0.1, y: 0.8, w: 0.8, h: 0.1 };
        var px = Math.round((st.size || 0.06) * H);
        ctx.save();
        ctx.font = (st.weight || '700') + ' ' + px + 'px "' + (st.font || 'Noto Sans JP') + '", sans-serif';
        ctx.textAlign = st.align || 'center';
        ctx.textBaseline = 'middle';
        var cx = (rc.x + rc.w / 2) * W;
        if (ctx.textAlign === 'left') cx = rc.x * W;
        if (ctx.textAlign === 'right') cx = (rc.x + rc.w) * W;
        var cy = (rc.y + rc.h / 2) * H;
        if (st.stroke) {
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(2, px * 0.12);
          ctx.strokeStyle = st.stroke;
          ctx.strokeText(t.text, cx, cy);
        }
        ctx.fillStyle = st.color || '#ffffff';
        ctx.fillText(t.text, cx, cy);
        ctx.restore();
      }
    }

    function renderFrame() {
      drawBackground();
      drawAvatar();
      drawOverlays();
      drawTexts();
    }

    function dispose() {
      renderer.dispose();
    }

    return {
      setVideo: setVideo,
      setKeyParams: setKeyParams,
      setBackground: setBackground,
      setOverlays: setOverlays,
      setTexts: setTexts,
      setAvatarTransform: setAvatarTransform,
      renderFrame: renderFrame,
      dispose: dispose
    };
  }

  window.BSMM = window.BSMM || {};
  window.BSMM.compositor = { create: create };
})();
