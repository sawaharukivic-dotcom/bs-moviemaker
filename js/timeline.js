// timeline.js — 尺管理（トリミング in/out・再生・フレーム駆動）
//
// 担当: 再生制御。window.BSMM.timeline に公開。
//
// ━━━ 契約（インターフェース）━━━━━━━━━━━━━━━━━━━━━━━━━━
//   const tl = window.BSMM.timeline.create(videoEl);
//   tl.duration;                 // 動画の総尺(秒)。loadedmetadata 後に有効
//   tl.setTrim(inSec, outSec);   // 書き出し範囲
//   tl.onFrame(cb);              // 再生中、毎フレーム cb(currentTime) を呼ぶ
//   tl.onEnd(cb);                // out に到達して停止したら呼ぶ
//   tl.play();   tl.pause();   tl.seek(sec);
//   tl.playRange();              // in へシークして in→out を再生（書き出し用）
//   tl.trimmedDuration();        // out-in
//
// rAF で駆動。UI 側は onFrame 内で compositor.renderFrame() を呼ぶ。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(function () {
  'use strict';

  function create(videoEl) {
    var trimIn = 0, trimOut = 0;
    var frameCb = null, endCb = null;
    var rafId = null, running = false;

    videoEl.addEventListener('loadedmetadata', function () {
      if (!trimOut) trimOut = videoEl.duration || 0;
    });

    function loop() {
      if (!running) return;
      if (frameCb) frameCb(videoEl.currentTime);
      if (trimOut && videoEl.currentTime >= trimOut) {
        pause();
        if (endCb) endCb();
        return;
      }
      rafId = requestAnimationFrame(loop);
    }

    function play() {
      if (running) return;
      running = true;
      var p = videoEl.play();
      if (p && p.catch) p.catch(function () {});
      rafId = requestAnimationFrame(loop);
    }

    function pause() {
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      try { videoEl.pause(); } catch (e) {}
    }

    function seek(sec) {
      try { videoEl.currentTime = sec; } catch (e) {}
      // 一時停止中でも1枚描き直せるよう通知
      if (!running && frameCb) {
        videoEl.addEventListener('seeked', function once() {
          videoEl.removeEventListener('seeked', once);
          frameCb(videoEl.currentTime);
        });
      }
    }

    function playRange() {
      var started = false;
      var go = function () { if (started) return; started = true; play(); };
      var once = function () { videoEl.removeEventListener('seeked', once); go(); };
      videoEl.addEventListener('seeked', once);
      try { videoEl.currentTime = trimIn; } catch (e) {}
      // 既に trimIn 位置にいて seeked が発火しない場合のフォールバック
      setTimeout(go, 150);
    }

    return {
      get duration() { return videoEl.duration || 0; },
      setTrim: function (i, o) { trimIn = i || 0; trimOut = o || videoEl.duration || 0; },
      get trimIn() { return trimIn; },
      get trimOut() { return trimOut; },
      trimmedDuration: function () { return Math.max(0, trimOut - trimIn); },
      onFrame: function (cb) { frameCb = cb; },
      onEnd: function (cb) { endCb = cb; },
      play: play,
      pause: pause,
      seek: seek,
      playRange: playRange
    };
  }

  window.BSMM = window.BSMM || {};
  window.BSMM.timeline = { create: create };
})();
