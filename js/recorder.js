// recorder.js — canvas + 音声トラックを MediaRecorder で録って書き出す
//
// 担当: 書き出し。window.BSMM.recorder に公開。
//
// ━━━ 契約（インターフェース）━━━━━━━━━━━━━━━━━━━━━━━━━━
//   const rec = window.BSMM.recorder.create({ canvas, audioTrack, fps, bitrate });
//     canvas:     録画する <canvas>（毎フレーム描画済みであること）
//     audioTrack: MediaStreamTrack(audio)（audiomixer.getOutputTrack()）。省略可
//
//   rec.start();
//   const { blob, ext, mime } = await rec.stop();   // 停止して Blob を得る
//   rec.mime;                                        // 実際に採用された MIME
//
// 出力コンテナは端末依存（iOS=mp4寄り / Android=webm一般）。
// isTypeSupported で mp4 → webm(vp9) → webm の順に採用し、Blob.type から拡張子決定。
// ※ どのコンテナが出るか・SNS互換は実機検証が必須（コードでは確定不可）。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(function () {
  'use strict';

  var CANDIDATES = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  function pickMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < CANDIDATES.length; i++) {
      if (MediaRecorder.isTypeSupported(CANDIDATES[i])) return CANDIDATES[i];
    }
    return '';
  }

  function extFor(mime) {
    if (!mime) return 'webm';
    if (mime.indexOf('mp4') >= 0) return 'mp4';
    if (mime.indexOf('webm') >= 0) return 'webm';
    return 'webm';
  }

  function create(opts) {
    opts = opts || {};
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder 非対応の環境です');
    }
    var fps = opts.fps || 30;
    var stream = opts.canvas.captureStream(fps);
    if (opts.audioTrack) stream.addTrack(opts.audioTrack);

    var mime = pickMime();
    var recOpts = {};
    if (mime) recOpts.mimeType = mime;
    if (opts.bitrate) recOpts.videoBitsPerSecond = opts.bitrate;

    var mr = new MediaRecorder(stream, recOpts);
    // 実際に採用された MIME（指定が無視される端末もある）
    var actualMime = mr.mimeType || mime;
    var chunks = [];
    mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };

    function start() { chunks = []; mr.start(); }

    function stop() {
      return new Promise(function (resolve) {
        mr.onstop = function () {
          var type = (chunks[0] && chunks[0].type) || actualMime || 'video/webm';
          var blob = new Blob(chunks, { type: type });
          resolve({ blob: blob, ext: extFor(blob.type || type), mime: blob.type || type });
        };
        if (mr.state !== 'inactive') mr.stop();
        else mr.onstop();
      });
    }

    return { start: start, stop: stop, mime: actualMime, get state() { return mr.state; } };
  }

  window.BSMM = window.BSMM || {};
  window.BSMM.recorder = { create: create, pickMime: pickMime, extFor: extFor };
})();
