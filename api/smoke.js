'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { buildSandbox } = require('./sandbox-stubs');
const { loadAllJsModules } = require('./loader');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(PROJECT_ROOT, 'js');

console.log('[smoke] Project root:', PROJECT_ROOT);
console.log('[smoke] Loading js/ modules into sandbox...');

const sandbox = buildSandbox();
loadAllJsModules(sandbox, JS_DIR);

const required = [
  'MotionGraph', 'SeededRandom', 'STYLE_PRESETS',
  'Kinematics', 'MotionGraphRenderer', 'KinematicsProblemGenerator',
];
for (const name of required) {
  if (!sandbox[name]) {
    console.error(`[smoke] MISSING global: ${name}`);
    process.exit(1);
  }
  console.log(`[smoke] OK ${name} (${typeof sandbox[name]})`);
}

const { MotionGraph, KinematicsProblemGenerator, STYLE_PRESETS } = sandbox;

const outDir = path.join(PROJECT_ROOT, 'api_output', 'smoke');
fs.mkdirSync(outDir, { recursive: true });

const sourceVT = new MotionGraph().fromJSON({
  kind: 'vt',
  x0: 0,
  points: [
    { t: 0, value: 0 },
    { t: 4, value: 2 },
    { t: 8, value: 2 },
    { t: 10, value: 0 },
  ],
  label: 'A',
});

const gen = new KinematicsProblemGenerator({
  gridConfig: {
    xMin: 0, xMax: 10, yMin: -4, yMax: 4,
    paddingLeft: 52, paddingRight: 52, paddingTop: 32, paddingBottom: 44,
  },
  styleConfig: STYLE_PRESETS.bw,
  cellSize: { w: null, h: null },
});

console.log('\n[smoke] Building a graphConversion problem (vt -> xt, at)...');
const r1 = gen.generateGraphConversion({ source: sourceVT, sourceKind: 'vt', askFor: ['xt', 'at'], x0: 0 });
console.log('[smoke] questionText:', r1.question.text.split('\n')[0]);
console.log('[smoke] question canvases:', r1.question.canvases.length, ' answer canvases:', r1.answer.canvases.length);
fs.writeFileSync(path.join(outDir, 'conversion_question_1.png'), r1.question.canvases[0].toBuffer('image/png'));
fs.writeFileSync(path.join(outDir, 'conversion_answer_1.png'), r1.answer.canvases[0].toBuffer('image/png'));
console.log('[smoke] Wrote conversion_question_1.png / conversion_answer_1.png');

console.log('\n[smoke] Building a numeric (displacement) problem...');
const r2 = gen.generateNumeric({ source: sourceVT, sourceKind: 'vt', subtype: 'displacement', params: {} });
console.log('[smoke] questionText:', r2.question.text.split('\n')[1]);
console.log('[smoke] answerText:', r2.answer.text.split('\n')[0]);
fs.writeFileSync(path.join(outDir, 'numeric_answer_1.png'), r2.answer.canvases[0].toBuffer('image/png'));
console.log('[smoke] Wrote numeric_answer_1.png');

console.log('\n[smoke] Building a graphChoice problem (vt -> xt, with 2 distractors)...');
const distractors = [
  { kind: 'xt', points: [{ t: 0, value: 0 }, { t: 4, value: 4 }, { t: 8, value: 12 }, { t: 10, value: 12 }] },
  { kind: 'xt', points: [{ t: 0, value: 0 }, { t: 4, value: 8 }, { t: 8, value: 8 }, { t: 10, value: 0 }] },
];
const r3 = gen.generateGraphChoice({ source: sourceVT, sourceKind: 'vt', askFor: 'xt', distractors, x0: 0 });
console.log('[smoke] choices:', r3.choices.length, ' correctIndex:', r3.correctIndex, ' seed:', r3.seed);
r3.choices.forEach((c, i) => {
  fs.writeFileSync(path.join(outDir, `choice_${i + 1}${c.isCorrect ? '_correct' : ''}.png`), c.canvas.toBuffer('image/png'));
});
console.log('[smoke] Wrote choice_*.png');

console.log('\n[smoke] All checks passed.');
