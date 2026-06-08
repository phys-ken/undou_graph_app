'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadIntoSandbox(sandbox, filePath, exposeNames) {
  const src = fs.readFileSync(filePath, 'utf8');
  const probes = exposeNames
    .map((n) => `try { globalThis.${n} = eval('${n}'); } catch (e) {}`)
    .join('\n');
  const wrapped = `${src}\n;(function(){\n${probes}\n}).call(globalThis);`;
  vm.runInContext(wrapped, sandbox, { filename: filePath, displayErrors: true });
}

// 読み込み順は依存関係に従う:
//   random   -> (誰にも依存しない)
//   styles   -> (誰にも依存しない)
//   motion   -> (誰にも依存しない: MotionGraph 単体)
//   kinematics -> MotionGraph を参照（curveFromGraph/deriveFromVT/XT）
//   renderer -> MotionGraphRenderer（描画。styles の値を受け取るが参照はしない）
//   problems -> 上記すべてを参照（MotionGraph/Kinematics/MotionGraphRenderer/SeededRandom）
const JS_FILES = [
  { file: 'random.js',     expose: ['SeededRandom'] },
  { file: 'styles.js',     expose: ['STYLE_PRESETS', 'cloneStylePreset'] },
  { file: 'motion.js',     expose: ['MotionGraph'] },
  { file: 'kinematics.js', expose: ['Kinematics'] },
  { file: 'renderer.js',   expose: ['MotionGraphRenderer'] },
  { file: 'problems.js',   expose: ['KinematicsProblemGenerator'] },
];

function loadAllJsModules(sandbox, jsDir) {
  for (const { file, expose } of JS_FILES) {
    loadIntoSandbox(sandbox, path.join(jsDir, file), expose);
  }
}

module.exports = { loadIntoSandbox, loadAllJsModules, JS_FILES };
