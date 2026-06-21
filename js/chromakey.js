// chromakey.js — グリーンバック（緑単色背景）を WebGL で抜くレンダラ
//
// 担当: 描画ロジック。DOM は触らない。window.BSMM.chromakey に公開する。
//
// ━━━ 契約（インターフェース）━━━━━━━━━━━━━━━━━━━━━━━━━━
//   const ck = window.BSMM.chromakey.createRenderer(canvas);
//     canvas: 出力先 <canvas>（透明背景。緑が抜けた映像がアルファ付きで描かれる）
//
//   ck.draw(srcVideo, {
//     keyColor:   [r,g,b],  // 0..1 抜く色（既定: 緑 [0,1,0]）
//     similarity: number,   // 0..1 大きいほど広い範囲を抜く（既定 0.40）
//     smoothness: number,   // 0..1 縁のぼかし幅（既定 0.10）
//     spill:      number    // 0..1 緑かぶり除去の強さ（既定 0.15・0で無効）
//   });
//     srcVideo: <video>（または drawImage 可能なソース）。毎フレーム呼ぶ。
//
//   ck.resize(w, h);   // 出力解像度を変更
//   ck.dispose();      // WebGL リソース解放
//
// 緑背景は c3-app 側で Color.green のベタ塗り（CastRecordingPagePresenter.cs:168）
// なので単色キーで十分。クロマキー合成シェーダは使わず距離しきい値方式。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(function () {
  'use strict';

  var VERT = [
    'attribute vec2 a_pos;',
    'varying vec2 v_uv;',
    'void main(){',
    '  v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);',
    '  gl_Position = vec4(a_pos, 0.0, 1.0);',
    '}'
  ].join('\n');

  // YCbCr の色差成分(UV)上の距離でキー判定する。輝度差に強い。
  // premultipliedAlpha:true なので rgb は alpha で前乗算して出力する。
  var FRAG = [
    'precision mediump float;',
    'uniform sampler2D u_tex;',
    'uniform vec3  u_key;',
    'uniform float u_similarity;',
    'uniform float u_smoothness;',
    'uniform float u_spill;',
    'varying vec2 v_uv;',
    'vec2 rgb2uv(vec3 c){',
    '  return vec2(-0.169*c.r - 0.331*c.g + 0.5*c.b, 0.5*c.r - 0.419*c.g - 0.081*c.b);',
    '}',
    'void main(){',
    '  vec4 col = texture2D(u_tex, v_uv);',
    '  float d = distance(rgb2uv(col.rgb), rgb2uv(u_key));',
    '  float alpha = smoothstep(u_similarity, u_similarity + u_smoothness, d);',
    '  if (u_spill > 0.0) {',
    '    float spillAmt = clamp(d / max(u_spill, 0.001), 0.0, 1.0);',
    '    float avg = (col.r + col.b) * 0.5;',
    '    col.g = mix(min(col.g, avg), col.g, spillAmt);',
    '  }',
    '  gl_FragColor = vec4(col.rgb * alpha, alpha);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('chromakey shader compile failed: ' + log);
    }
    return sh;
  }

  function createRenderer(canvas) {
    var gl = canvas.getContext('webgl', {
      premultipliedAlpha: true,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true // drawImage で取り出すフレームを安定させる
    });
    if (!gl) throw new Error('WebGL not supported');

    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('chromakey program link failed: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    var uKey = gl.getUniformLocation(prog, 'u_key');
    var uSim = gl.getUniformLocation(prog, 'u_similarity');
    var uSmo = gl.getUniformLocation(prog, 'u_smoothness');
    var uSpl = gl.getUniformLocation(prog, 'u_spill');

    function draw(srcVideo, params) {
      params = params || {};
      var key = params.keyColor || [0, 1, 0];
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.bindTexture(gl.TEXTURE_2D, tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcVideo);
      } catch (e) {
        // 動画フレーム未準備時など。描画スキップ。
        return;
      }
      gl.uniform3f(uKey, key[0], key[1], key[2]);
      gl.uniform1f(uSim, params.similarity != null ? params.similarity : 0.40);
      gl.uniform1f(uSmo, params.smoothness != null ? params.smoothness : 0.10);
      gl.uniform1f(uSpl, params.spill != null ? params.spill : 0.15);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function resize(w, h) {
      canvas.width = w;
      canvas.height = h;
    }

    function dispose() {
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    }

    return { draw: draw, resize: resize, dispose: dispose, gl: gl };
  }

  window.BSMM = window.BSMM || {};
  window.BSMM.chromakey = { createRenderer: createRenderer };
})();
