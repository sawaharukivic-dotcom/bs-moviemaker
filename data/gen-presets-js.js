// gen-presets-js.js — presets.json から配信用ファイルを生成する
//   生成物:
//     data/presets.public.json  … http 配信で fetch される正データ（_note を除去）
//     data/presets.js           … file:// 直開き用フォールバック（window.BSMM_PRESETS）
//
//   使い方:  node data/gen-presets-js.js
//   （otoku-charge の data/gen-pricing-js.js と同じ流儀）

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const master = JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8'));
delete master._note;

const json = JSON.stringify(master, null, 2);
fs.writeFileSync(path.join(dir, 'presets.public.json'), json + '\n', 'utf8');

const js =
  '// 自動生成ファイル — 直接編集しないこと（再生成: node data/gen-presets-js.js）\n' +
  '// file:// 直開き用フォールバック。http 配信時は presets.public.json が優先される。\n' +
  'window.BSMM_PRESETS = ' + json + ';\n';
fs.writeFileSync(path.join(dir, 'presets.js'), js, 'utf8');

console.log('generated presets.public.json and presets.js');
