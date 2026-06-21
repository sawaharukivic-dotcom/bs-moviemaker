// presets.js — 素材プリセット（背景・BGM・オーバーレイ・テキストテンプレ）の読込
//
// 担当: データ供給。window.BSMM.presets に公開。
//
// ━━━ 契約（インターフェース）━━━━━━━━━━━━━━━━━━━━━━━━━━
//   const data = await window.BSMM.presets.load();
//     → { backgrounds, bgms, overlays, textTemplates }
//
//   http 配信時: data/presets.public.json を fetch。
//   file:// 直開き時: data/presets.js が定義する window.BSMM_PRESETS にフォールバック。
//   （otoku-charge の pricing 方式を踏襲）
//
//   座標 rect は正規化(0..1)。src は bs-moviemaker/ からの相対パス。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(function () {
  'use strict';

  var EMPTY = { backgrounds: [], bgms: [], overlays: [], textTemplates: [] };

  function load() {
    return fetch('../data/presets.public.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function () {
        // file:// 直開き or 取得失敗 → フォールバック
        if (window.BSMM_PRESETS) return window.BSMM_PRESETS;
        console.warn('[presets] 取得失敗。空のプリセットで起動します。');
        return EMPTY;
      });
  }

  window.BSMM = window.BSMM || {};
  window.BSMM.presets = { load: load };
})();
