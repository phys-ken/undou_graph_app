'use strict';
// 実行: node --test tests/api.test.js
// API バックエンド（validate.js + bridge.js）の堅牢性・安全性テスト
// legacy_nami_app/tests/api.test.js の構成・規約をフォーク（type が文字列ベースに
// 変わった点、choices の形が generateGraphChoice 由来の「シャッフル済み」配列で
// 返る点を除き、テスト方針は同じ — 同期版 bridge.generate() を呼ぶため
// DOCX/Bundle ZIP 生成はテスト対象外）。

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateRequest } = require('../api/validate');
const { Bridge } = require('../api/bridge');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-api-test-'));

// Shared bridge instance (lazy-initialized once by before())
let bridge;

// ── ヘルパー: グラフ仕様 ────────────────────────────────────────────────
const SOURCE_VT = {
  kind: 'vt',
  x0: 0,
  points: [
    { t: 0, value: 0 },
    { t: 4, value: 2 },
    { t: 8, value: 2 },
    { t: 10, value: 0 },
  ],
  label: 'A',
};

const SOURCE_XT = {
  kind: 'xt',
  points: [
    { t: 0, value: 0 },
    { t: 4, value: 4 },
    { t: 8, value: 4 },
  ],
  label: 'A',
};

const TWO_DISTRACTORS = [
  { kind: 'xt', points: [{ t: 0, value: 0 }, { t: 4, value: 4 }, { t: 8, value: 12 }, { t: 10, value: 12 }] },
  { kind: 'xt', points: [{ t: 0, value: 0 }, { t: 4, value: 8 }, { t: 8, value: 8 }, { t: 10, value: 0 }] },
];

function outputDir(name) {
  const d = path.join(TMP_DIR, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function gen(spec, name) {
  return bridge.generate({ outputDir: outputDir(name), filenamePrefix: 'q', ...spec });
}

// ═══════════════════════════════════════════════════════════════════════
// 1. バリデーション（validate.js）
// ═══════════════════════════════════════════════════════════════════════
describe('validate.js — バリデーション', () => {
  it('正常な graphConversion リクエストを受け入れる', () => {
    const r = validateRequest({ type: 'graphConversion', source: SOURCE_VT, askFor: ['xt', 'at'] });
    assert.ok(r.success);
  });

  it('type が未指定なら失敗', () => {
    const r = validateRequest({ source: SOURCE_VT, askFor: 'xt' });
    assert.ok(!r.success);
  });

  it("type='unknown' は失敗", () => {
    const r = validateRequest({ type: 'unknown', source: SOURCE_VT, askFor: 'xt' });
    assert.ok(!r.success);
  });

  it('graphConversion で askFor 未指定なら失敗', () => {
    const r = validateRequest({ type: 'graphConversion', source: SOURCE_VT });
    assert.ok(!r.success);
    const msgs = JSON.stringify(r.error.format());
    assert.ok(msgs.includes('askFor'));
  });

  it('numeric で subtype 未指定なら失敗', () => {
    const r = validateRequest({ type: 'numeric', source: SOURCE_VT });
    assert.ok(!r.success);
    const msgs = JSON.stringify(r.error.format());
    assert.ok(msgs.includes('subtype'));
  });

  it("numeric で subtype='unknown' なら失敗", () => {
    const r = validateRequest({ type: 'numeric', source: SOURCE_VT, subtype: 'unknown' });
    assert.ok(!r.success);
  });

  it('graphChoice で choices.enabled が無いと失敗', () => {
    const r = validateRequest({ type: 'graphChoice', source: SOURCE_VT, askFor: 'xt' });
    assert.ok(!r.success);
    const msgs = JSON.stringify(r.error.format());
    assert.ok(msgs.includes('choices'));
  });

  it('graphChoice で askFor が配列だと失敗（単一のみ許可）', () => {
    const r = validateRequest({
      type: 'graphChoice', source: SOURCE_VT, askFor: ['xt', 'at'],
      choices: { enabled: true, count: 3, distractors: TWO_DISTRACTORS },
    });
    assert.ok(!r.success);
  });

  it('distractors.length !== count-1 なら失敗', () => {
    const r = validateRequest({
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: true, count: 4, distractors: [TWO_DISTRACTORS[0]] }, // 1 != 3
    });
    assert.ok(!r.success);
    const msgs = JSON.stringify(r.error.format());
    assert.ok(msgs.includes('distractors'));
  });

  it('graphConversion に choices を付けると失敗（graphChoice のみ対応）', () => {
    const r = validateRequest({
      type: 'graphConversion', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: true, count: 3, distractors: TWO_DISTRACTORS },
    });
    assert.ok(!r.success);
  });

  it('value が 0.5 刻みでない点は失敗', () => {
    const r = validateRequest({
      type: 'graphConversion',
      source: { kind: 'vt', points: [{ t: 0, value: 0 }, { t: 2, value: 0.3 }, { t: 4, value: 0 }] },
      askFor: 'xt',
    });
    assert.ok(!r.success);
  });

  it('points が1点だけなら失敗', () => {
    const r = validateRequest({
      type: 'graphConversion',
      source: { kind: 'vt', points: [{ t: 0, value: 0 }] },
      askFor: 'xt',
    });
    assert.ok(!r.success);
  });

  it('cellSize.w が 15未満なら失敗', () => {
    const r = validateRequest({
      type: 'graphConversion', source: SOURCE_VT, askFor: 'xt',
      cellSize: { w: 10 },
    });
    assert.ok(!r.success);
  });

  it('grid.xMin >= xMax なら失敗', () => {
    const r = validateRequest({
      type: 'graphConversion', source: SOURCE_VT, askFor: 'xt',
      grid: { xMin: 10, xMax: 10 },
    });
    assert.ok(!r.success);
  });

  it('filenamePrefix が 64文字超なら失敗', () => {
    const r = validateRequest({
      type: 'graphConversion', source: SOURCE_VT, askFor: 'xt',
      filenamePrefix: 'a'.repeat(65),
    });
    assert.ok(!r.success);
  });

  it('numeric で interval は t0 < t1 を要求する', () => {
    const r = validateRequest({
      type: 'numeric', source: SOURCE_VT, subtype: 'displacement',
      params: { interval: { t0: 5, t1: 2 } },
    });
    assert.ok(!r.success);
  });

  it('choices.enabled = false なら distractors の長さチェックをスキップ', () => {
    const r = validateRequest({
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: false, count: 4, distractors: [] },
    });
    // choices.enabled=false のままだと graphChoice 必須チェックで弾かれる
    assert.ok(!r.success);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Bridge — 初期化
// ═══════════════════════════════════════════════════════════════════════
describe('Bridge — 初期化', () => {
  before(() => {
    bridge = new Bridge({ projectRoot: PROJECT_ROOT, defaultOutputDir: TMP_DIR });
    bridge.init();
  });

  it('sandbox に MotionGraph が公開される', () => {
    assert.ok(typeof bridge.sandbox.MotionGraph === 'function' || typeof bridge.sandbox.MotionGraph === 'object');
  });

  it('sandbox に SeededRandom が公開される', () => {
    assert.ok(bridge.sandbox.SeededRandom);
  });

  it('sandbox に Kinematics が公開される', () => {
    assert.ok(bridge.sandbox.Kinematics);
  });

  it('sandbox に MotionGraphRenderer が公開される', () => {
    assert.ok(bridge.sandbox.MotionGraphRenderer);
  });

  it('sandbox に KinematicsProblemGenerator が公開される', () => {
    assert.ok(bridge.sandbox.KinematicsProblemGenerator);
  });

  it('sandbox に STYLE_PRESETS が公開される', () => {
    assert.ok(bridge.sandbox.STYLE_PRESETS && bridge.sandbox.STYLE_PRESETS.bw);
  });

  it('init() を2回呼んでも例外なし（冪等）', () => {
    assert.doesNotThrow(() => bridge.init());
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Bridge.generate — graphConversion
// ═══════════════════════════════════════════════════════════════════════
describe('Bridge.generate — graphConversion（v-t から x-t/a-t を導出）', () => {
  it('success:true を返す', () => {
    const r = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: ['xt', 'at'] }, 'gc1');
    assert.ok(r.success);
  });

  it('question PNG が（手描きグラフ + 解答欄の数だけ）生成される', () => {
    const r = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: ['xt', 'at'] }, 'gc2');
    assert.equal(r.files.question.length, 3); // [source, blank xt, blank at]
    r.files.question.forEach(f => assert.ok(fs.existsSync(f.path)));
  });

  it('answer PNG が askFor の数だけ生成される', () => {
    const r = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: ['xt', 'at'] }, 'gc3');
    assert.equal(r.files.answer.length, 2);
    r.files.answer.forEach(f => assert.ok(fs.existsSync(f.path)));
  });

  it('単一 askFor（文字列）でも動作する', () => {
    const r = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt' }, 'gc4');
    assert.ok(r.success);
    assert.equal(r.files.answer.length, 1);
  });

  it('x-t グラフ（手描き）を入力にしても動作する（x-t は直線のみ）', () => {
    const r = gen({ type: 'graphConversion', source: SOURCE_XT, sourceKind: 'xt', askFor: ['vt', 'at'] }, 'gc5');
    assert.ok(r.success);
    assert.equal(r.files.answer.length, 2);
  });

  it('manifest.json が保存され request/response を含む', () => {
    const r = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt' }, 'gc6');
    assert.ok(fs.existsSync(r.files.manifest));
    const m = JSON.parse(fs.readFileSync(r.files.manifest, 'utf8'));
    assert.ok(m.request);
    assert.ok(m.response);
  });

  it('questionText / answerText が文字列で返る', () => {
    const r = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt' }, 'gc7');
    assert.equal(typeof r.questionText, 'string');
    assert.equal(typeof r.answerText, 'string');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Bridge.generate — numeric（自由記述・選択肢化しない）
// ═══════════════════════════════════════════════════════════════════════
describe('Bridge.generate — numeric（数値・記述問題）', () => {
  it('acceleration: success:true、choices は付かない', () => {
    const r = gen({ type: 'numeric', source: SOURCE_VT, subtype: 'acceleration' }, 'num1');
    assert.ok(r.success);
    assert.equal(r.files.choices, null);
  });

  it('displacement: answerText に "変位" を含む', () => {
    const r = gen({ type: 'numeric', source: SOURCE_VT, subtype: 'displacement' }, 'num2');
    assert.ok(r.success);
    assert.ok(r.answerText.includes('変位'));
  });

  it('displacement: 面積塗りつぶし入りの answer canvas が生成される', () => {
    const r = gen({ type: 'numeric', source: SOURCE_VT, subtype: 'displacement' }, 'num3');
    assert.ok(r.files.answer.length > 0);
    assert.ok(fs.existsSync(r.files.answer[0].path));
  });

  it('direction: success:true を返す', () => {
    const r = gen({ type: 'numeric', source: SOURCE_VT, subtype: 'direction' }, 'num4');
    assert.ok(r.success);
  });

  it('describe: 模範解答テキストが返る', () => {
    const r = gen({ type: 'numeric', source: SOURCE_VT, subtype: 'describe' }, 'num5');
    assert.ok(r.success);
    assert.ok(r.answerText.length > 0);
  });

  it('params.interval を指定した区間がそのまま使われる', () => {
    const r = gen({
      type: 'numeric', source: SOURCE_VT, subtype: 'acceleration',
      params: { interval: { t0: 0, t1: 4 } },
    }, 'num6');
    assert.ok(r.success);
    assert.ok(r.questionText.includes('0') && r.questionText.includes('4'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Bridge.generate — graphChoice（API 専用・選択肢シャッフル決定論性）
// ═══════════════════════════════════════════════════════════════════════
describe('Bridge.generate — graphChoice（グラフ選択肢問題）', () => {
  it('success:true、choices が count 個返る', () => {
    const r = gen({
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: true, count: 3, distractors: TWO_DISTRACTORS },
    }, 'gch1');
    assert.ok(r.success);
    assert.equal(r.files.choices.length, 3);
  });

  it('正答はちょうど1つ（isCorrect:true）', () => {
    const r = gen({
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: true, count: 3, distractors: TWO_DISTRACTORS },
    }, 'gch2');
    const correct = r.files.choices.filter(c => c.isCorrect);
    assert.equal(correct.length, 1);
  });

  it('correctIndex が isCorrect:true の選択肢の位置と一致する', () => {
    const r = gen({
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: true, count: 3, distractors: TWO_DISTRACTORS },
    }, 'gch3');
    assert.equal(r.files.choices[r.correctIndex].isCorrect, true);
  });

  it('同じ spec から再生成すると同じシード・同じシャッフル順になる（決定論性）', () => {
    const spec = {
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: true, count: 3, distractors: TWO_DISTRACTORS },
    };
    const r1 = gen(spec, 'gch4a');
    const r2 = gen(spec, 'gch4b');
    assert.equal(r1.shuffleSeed, r2.shuffleSeed);
    assert.equal(r1.correctIndex, r2.correctIndex);
    assert.deepEqual(
      r1.files.choices.map(c => c.isCorrect),
      r2.files.choices.map(c => c.isCorrect)
    );
  });

  it('distractors を変えるとシードが変わる', () => {
    const r1 = gen({
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: true, count: 3, distractors: TWO_DISTRACTORS },
    }, 'gch5a');
    const altDistractors = [TWO_DISTRACTORS[0], { kind: 'xt', points: [{ t: 0, value: 1 }, { t: 10, value: 1 }] }];
    const r2 = gen({
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: true, count: 3, distractors: altDistractors },
    }, 'gch5b');
    assert.notEqual(r1.shuffleSeed, r2.shuffleSeed);
  });

  it('shuffle:false なら正答が先頭（インデックス0）に来る', () => {
    const r = gen({
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: true, count: 3, shuffle: false, distractors: TWO_DISTRACTORS },
    }, 'gch6');
    assert.equal(r.correctIndex, 0);
    assert.equal(r.files.choices[0].isCorrect, true);
  });

  it('選択肢ラベルは丸数字 ①②③ の形式', () => {
    const r = gen({
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt',
      choices: { enabled: true, count: 3, distractors: TWO_DISTRACTORS },
    }, 'gch7');
    // vm サンドボックス（別レルム）由来の文字列は assert.deepEqual の参照比較で
    // 「構造は同じだが reference-equal でない」と報告されることがあるため、
    // 値そのもの（プリミティブ string の同値性）を一つずつ比較する。
    const labels = r.files.choices.map(c => c.label);
    assert.equal(labels.length, 3);
    assert.equal(labels[0], '①');
    assert.equal(labels[1], '②');
    assert.equal(labels[2], '③');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. inline モード
// ═══════════════════════════════════════════════════════════════════════
describe('Bridge.generate — inline モード', () => {
  it('inline:true では dataUrl を返し、ファイルを書き出さない', () => {
    const r = bridge.generate({
      type: 'graphConversion', source: SOURCE_VT, askFor: 'xt', inline: true,
    });
    assert.ok(r.success);
    assert.equal(r.outputDir, null);
    assert.ok(r.files.question[0].dataUrl.startsWith('data:image/png'));
    assert.ok(r.files.answer[0].dataUrl.startsWith('data:image/png'));
    assert.equal(r.files.manifest, undefined);
  });

  it('inline:true で graphChoice の choices も dataUrl を返す', () => {
    const r = bridge.generate({
      type: 'graphChoice', source: SOURCE_VT, askFor: 'xt', inline: true,
      choices: { enabled: true, count: 3, distractors: TWO_DISTRACTORS },
    });
    assert.ok(r.success);
    r.files.choices.forEach(c => assert.ok(c.dataUrl.startsWith('data:image/png')));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. グリッド・スタイル・y軸自動調整
// ═══════════════════════════════════════════════════════════════════════
describe('Bridge.generate — グリッド・スタイル・y軸自動調整', () => {
  it('style="bw"（既定）で生成できる', () => {
    const r = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt', style: 'bw' }, 'style1');
    assert.ok(r.success);
  });

  it('style="color" で生成できる', () => {
    const r = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt', style: 'color' }, 'style2');
    assert.ok(r.success);
  });

  it("style='gray' は未知のプリセットとしてエラーになる（このアプリに gray はない）", () => {
    assert.throws(() => gen({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt', style: 'gray' }, 'style3'));
  });

  it('yMin/yMax 未指定だと手描きグラフの値域に応じて自動調整される', () => {
    const r = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt' }, 'autoy1');
    assert.ok(r.success);
    // SOURCE_VT の v は最大2、x-t の最大変位は v-t の面積から ~14 程度になるはずなので、
    // yMin/yMax は ±2 のデフォルトより広く調整されているはず
    assert.ok(r.gridConfig.yMax > 2);
    assert.equal(r.gridConfig.yMin, -r.gridConfig.yMax);
  });

  it('yMin/yMax を明示すれば自動調整をスキップする', () => {
    const r = gen({
      type: 'graphConversion', source: SOURCE_VT, askFor: 'xt',
      grid: { yMin: -100, yMax: 100 },
    }, 'autoy2');
    assert.equal(r.gridConfig.yMin, -100);
    assert.equal(r.gridConfig.yMax, 100);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. パストラバーサル防御 / 並行安全性
// ═══════════════════════════════════════════════════════════════════════
describe('セッション・出力の安全性', () => {
  it('同じ outputDir を共有しても filenamePrefix が異なれば衝突しない', () => {
    const dir = outputDir('shared');
    const r1 = bridge.generate({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt', outputDir: dir, filenamePrefix: 'p1' });
    const r2 = bridge.generate({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt', outputDir: dir, filenamePrefix: 'p2' });
    assert.ok(fs.existsSync(r1.files.question[0].path));
    assert.ok(fs.existsSync(r2.files.question[0].path));
    assert.notEqual(r1.files.question[0].path, r2.files.question[0].path);
  });

  it('セッションIDは毎回異なる（衝突しない）', () => {
    const r1 = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt' }, 'sess1');
    const r2 = gen({ type: 'graphConversion', source: SOURCE_VT, askFor: 'xt' }, 'sess2');
    assert.notEqual(r1.sessionId, r2.sessionId);
  });
});
