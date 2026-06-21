// audiomixer.js — キャストの声(録画) と BGM を WebAudio でミックス
//
// 担当: 音声処理。window.BSMM.audiomixer に公開。
//
// ━━━ 契約（インターフェース）━━━━━━━━━━━━━━━━━━━━━━━━━━
//   const mix = window.BSMM.audiomixer.create();
//   await mix.resume();                 // ユーザー操作ハンドラ内で呼ぶ（iOS制約）
//   mix.connectVoice(videoEl);          // 録画動画の音声を取り込む（要素ごとに1回）
//   await mix.setBgm(url);              // BGM を読み込む（null でクリア）
//   mix.setBalance(voiceVol, bgmVol);   // 0..1 の音量
//   mix.setMonitor(true|false);         // プレビュー中にスピーカーへ出すか
//   mix.startBgm(); mix.stopBgm();      // BGM 再生制御（録画開始/終了に合わせる）
//   const track = mix.getOutputTrack(); // 録画用 MediaStreamTrack(audio)
//   mix.dispose();
//
// MediaElementSource は要素から音声を奪うため、プレビューで聞かせたい時は
// monitor=true でスピーカー(ctx.destination)にも接続する。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(function () {
  'use strict';

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = new AC();

    var streamDest = ctx.createMediaStreamDestination();

    var voiceNormGain = ctx.createGain(); // ノーマライズ用の固定ゲイン（音量スライダーとは別段）
    var voiceGain = ctx.createGain();     // ユーザーの声音量
    var bgmGain = ctx.createGain();
    voiceNormGain.gain.value = 1.0;
    voiceGain.gain.value = 1.0;
    bgmGain.gain.value = 0.3;

    // 声: src → voiceNormGain → voiceGain → 出力
    voiceNormGain.connect(voiceGain);

    // ミックス出力（録画用）へは常時接続
    voiceGain.connect(streamDest);
    bgmGain.connect(streamDest);

    // ノーマライズ用ゲインを設定（>0 のみ。録音レベルが低い動画を持ち上げる用途）
    function setVoiceNorm(g) {
      if (g != null && isFinite(g) && g > 0) voiceNormGain.gain.value = g;
    }

    var monitorOn = false;
    function setMonitor(on) {
      // 二重接続を避けるため都度 disconnect→必要なら connect
      try { voiceGain.disconnect(ctx.destination); } catch (e) {}
      try { bgmGain.disconnect(ctx.destination); } catch (e) {}
      monitorOn = !!on;
      if (monitorOn) {
        voiceGain.connect(ctx.destination);
        bgmGain.connect(ctx.destination);
      }
    }

    var voiceConnected = false;
    function connectVoice(videoEl) {
      if (voiceConnected) return;
      try {
        var src = ctx.createMediaElementSource(videoEl);
        src.connect(voiceNormGain);
        voiceConnected = true;
      } catch (e) {
        // 同一要素で2回呼ぶと例外。無視。
        console.warn('[audiomixer] connectVoice failed:', e && e.message);
      }
    }

    var bgmEl = null, bgmSrc = null;
    function setBgm(url) {
      return new Promise(function (resolve) {
        stopBgm();
        if (bgmSrc) { try { bgmSrc.disconnect(); } catch (e) {} bgmSrc = null; }
        if (!url) { bgmEl = null; resolve(); return; }
        bgmEl = new Audio();
        bgmEl.crossOrigin = 'anonymous';
        bgmEl.loop = true;
        bgmEl.preload = 'auto';
        bgmEl.src = url;
        bgmEl.addEventListener('canplaythrough', function () { resolve(); }, { once: true });
        bgmEl.addEventListener('error', function () { resolve(); }, { once: true });
        try {
          bgmSrc = ctx.createMediaElementSource(bgmEl);
          bgmSrc.connect(bgmGain);
        } catch (e) {
          console.warn('[audiomixer] BGM source failed:', e && e.message);
          resolve();
        }
        // 念のためロード打ち切り
        setTimeout(resolve, 4000);
      });
    }

    function startBgm() {
      if (!bgmEl) return;
      try { bgmEl.currentTime = 0; } catch (e) {} // 未ロード時の currentTime 設定を保護
      var p = bgmEl.play(); if (p && p.catch) p.catch(function () {});
    }
    // 現在位置のまま再生（位置は seekBgm で別途指定する用）
    function resumeBgm() {
      if (bgmEl) { var p = bgmEl.play(); if (p && p.catch) p.catch(function () {}); }
    }
    function stopBgm() {
      if (bgmEl) { try { bgmEl.pause(); } catch (e) {} }
    }
    // BGM 再生位置を sec に合わせる（ループ長で剰余）。映像のシーク/範囲ループ追従用。
    function seekBgm(sec) {
      if (!bgmEl) return;
      var t = sec || 0;
      var d = bgmEl.duration;
      if (d && isFinite(d) && d > 0) { t = t % d; if (t < 0) t += d; }
      try { bgmEl.currentTime = Math.max(0, t); } catch (e) {}
    }

    function setBalance(voiceVol, bgmVol) {
      if (voiceVol != null) voiceGain.gain.value = voiceVol;
      if (bgmVol != null) {
        try { bgmGain.gain.cancelScheduledValues(ctx.currentTime); } catch (e) {} // フェード予約を解除
        bgmGain.gain.value = bgmVol;
      }
    }
    // BGM音量を seconds 秒かけて0へ（エンドカードでのフェードアウト用）
    function fadeOutBgm(seconds) {
      try {
        var now = ctx.currentTime;
        bgmGain.gain.cancelScheduledValues(now);
        bgmGain.gain.setValueAtTime(bgmGain.gain.value, now);
        bgmGain.gain.linearRampToValueAtTime(0, now + (seconds || 1));
      } catch (e) {}
    }

    function resume() { return ctx.resume(); }
    function getOutputTrack() { return streamDest.stream.getAudioTracks()[0]; }

    function dispose() {
      stopBgm();
      try { ctx.close(); } catch (e) {}
    }

    return {
      resume: resume,
      connectVoice: connectVoice,
      setVoiceNorm: setVoiceNorm,
      setBgm: setBgm,
      startBgm: startBgm,
      resumeBgm: resumeBgm,
      stopBgm: stopBgm,
      seekBgm: seekBgm,
      setBalance: setBalance,
      fadeOutBgm: fadeOutBgm,
      setMonitor: setMonitor,
      getOutputTrack: getOutputTrack,
      dispose: dispose,
      ctx: ctx
    };
  }

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
        // 停止中はデコードが進まず判定できない → 'no' と断定せず unknown（誤警告防止）
        if (el.paused) { resolve('unknown'); return; }
        var start = el.webkitAudioDecodedByteCount;
        // 少し再生を進めてから再評価（再生中のみ正確）
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
})();
