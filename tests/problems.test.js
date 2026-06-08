'use strict';
// 実行: node --test tests/problems.test.js
//
// KinematicsProblemGenerator の純粋ロジック（Canvas/DOM 非依存の static メソッド・
// ヘルパー関数）をテストする。Canvas 描画系（_renderGraphCanvas 等）は
// drawXxx と同じくブラウザでのみ動作確認する（legacy_nami_app/tests と同じ方針）。
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');
const vm = require('node:vm');

// _renderGraphCanvas 等の Canvas 描画系メソッド（generateGraphConversion /
// generateGraphChoice / generateNumeric から内部的に呼ばれる）は document.createElement('canvas')
// と MotionGraphRenderer に依存する。node:test 環境には DOM がないため、
// api/sandbox-stubs.js と同じ要領で `canvas` パッケージ（node-canvas）を使い
// 最小限の document スタブを用意し、スモークテスト（例外を投げないことの確認）を可能にする。
const { createCanvas } = require('canvas');
global.document = {
  createElement(tag) {
    const t = String(tag).toLowerCase();
    if (t === 'canvas') {
      const c = createCanvas(1, 1);
      if (!c.style) c.style = {};
      return c;
    }
    throw new Error(`document.createElement('${tag}') is not supported in test stub`);
  },
  addEventListener() {},
};

const load = (file) => vm.runInThisContext(readFileSync(join(__dirname, '..', 'js', file), 'utf8'));
load('random.js');
load('motion.js');
load('step-motion.js');
load('kinematics.js');
load('renderer.js');
load('problems.js');

function makeStepGraph(tStart, values, x0 = 0) {
  const g = new StepMotionGraph();
  g.tStart = tStart;
  g.values = [...values];
  g.x0 = x0;
  return g;
}

// generator インスタンス生成の共通ヘルパー（_splitIntervalBySegments のテストと同じスタブ設定）
function makeGenerator() {
  return new KinematicsProblemGenerator({
    gridConfig: { xMin: 0, xMax: 10, yMin: -2, yMax: 2 },
    styleConfig: STYLE_PRESETS_STUB(),
  });
}

const EPS = 1e-9;
function close(a, b, msg) {
  assert.ok(Math.abs(a - b) < EPS, `${msg ?? ''} 期待値=${b} 実際=${a}`);
}

function makeGraph(points, kind, x0 = 0) {
  const g = new MotionGraph();
  g.kind = kind;
  g.x0 = x0;
  points.forEach(([t, value]) => g.setPoint(t, value));
  return g;
}

// ── _segmentAt / _segmentValueAt ───────────────────────────────────────
describe('KinematicsProblemGenerator._segmentValueAt', () => {
  it('区分一次カーブの途中の値を正しく評価する', () => {
    // v-t: (0,0) -> (4,2) -> (8,2) : 傾き 0.5 の加速区間 + 等速区間
    const g = makeGraph([[0, 0], [4, 2], [8, 2]], 'vt', 0);
    const { vt } = Kinematics.deriveFromVT(g);
    close(KinematicsProblemGenerator._segmentValueAt(vt, 2), 1);   // 加速区間の中間
    close(KinematicsProblemGenerator._segmentValueAt(vt, 4), 2);   // 接続点
    close(KinematicsProblemGenerator._segmentValueAt(vt, 6), 2);   // 等速区間
  });

  it('カーブが空なら 0 を返す', () => {
    const empty = { kind: 'vt', segments: [], discontinuities: [], undefinedInstants: [] };
    close(KinematicsProblemGenerator._segmentValueAt(empty, 3), 0);
  });
});

// ── pickInterval ───────────────────────────────────────────────────────
describe('KinematicsProblemGenerator.pickInterval', () => {
  const g = makeGraph([[0, 0], [2, 2], [5, 2], [8, -1]], 'vt', 0);
  const { vt } = Kinematics.deriveFromVT(g);

  it('params.interval が指定されていればそれをそのまま返す', () => {
    const iv = KinematicsProblemGenerator.pickInterval(vt, { interval: { t0: 1, t1: 3 } }, 12345);
    assert.deepEqual(iv, { t0: 1, t1: 3 });
  });

  it('未指定時はシード値に対して決定論的に同じ区間を返す', () => {
    const a = KinematicsProblemGenerator.pickInterval(vt, {}, 777);
    const b = KinematicsProblemGenerator.pickInterval(vt, {}, 777);
    assert.deepEqual(a, b);
  });

  it('返す区間は必ずカーブのセグメント境界と一致する', () => {
    const iv = KinematicsProblemGenerator.pickInterval(vt, {}, 42);
    const matches = vt.segments.some(s => s.t0 === iv.t0 && s.t1 === iv.t1);
    assert.ok(matches, `区間 ${JSON.stringify(iv)} がどのセグメントとも一致しない`);
  });

  it('空カーブには null を返す', () => {
    const empty = { kind: 'vt', segments: [], discontinuities: [], undefinedInstants: [] };
    assert.equal(KinematicsProblemGenerator.pickInterval(empty, {}, 1), null);
  });
});

// ── buildSeed ──────────────────────────────────────────────────────────
describe('KinematicsProblemGenerator.buildSeed', () => {
  it('同じグラフ・同じ条件なら同じシードになる（再現性）', () => {
    const g1 = makeGraph([[0, 0], [4, 2]], 'vt', 0);
    const g2 = makeGraph([[0, 0], [4, 2]], 'vt', 0);
    assert.equal(
      KinematicsProblemGenerator.buildSeed(g1, 'acceleration', '{}'),
      KinematicsProblemGenerator.buildSeed(g2, 'acceleration', '{}')
    );
  });

  it('グラフが異なれば（基本的に）シードも変わる', () => {
    const g1 = makeGraph([[0, 0], [4, 2]], 'vt', 0);
    const g2 = makeGraph([[0, 0], [4, 3]], 'vt', 0);
    assert.notEqual(
      KinematicsProblemGenerator.buildSeed(g1, 'acceleration', '{}'),
      KinematicsProblemGenerator.buildSeed(g2, 'acceleration', '{}')
    );
  });

  it('サブタイプが異なれば（基本的に）シードも変わる', () => {
    const g = makeGraph([[0, 0], [4, 2]], 'vt', 0);
    assert.notEqual(
      KinematicsProblemGenerator.buildSeed(g, 'acceleration', '{}'),
      KinematicsProblemGenerator.buildSeed(g, 'describe', '{}')
    );
  });
});

// ── findNegativeIntervals ──────────────────────────────────────────────
describe('KinematicsProblemGenerator.findNegativeIntervals', () => {
  it('全区間で v >= 0 のときは空配列を返す', () => {
    const g = makeGraph([[0, 1], [4, 2], [8, 0]], 'vt', 0);
    const { vt } = Kinematics.deriveFromVT(g);
    assert.deepEqual(KinematicsProblemGenerator.findNegativeIntervals(vt), []);
  });

  it('セグメント全体が負のとき、その区間をそのまま返す', () => {
    const g = makeGraph([[0, -2], [4, -2], [8, -1]], 'vt', 0);
    const { vt } = Kinematics.deriveFromVT(g);
    const ivs = KinematicsProblemGenerator.findNegativeIntervals(vt);
    assert.equal(ivs.length, 1);
    close(ivs[0].t0, 0);
    close(ivs[0].t1, 8);
  });

  it('符号が反転するセグメントはゼロクロス時刻で正しく分割する', () => {
    // (0,2) -> (4,-2): 傾き -1、t=2 で v=0 をまたぐ
    const g = makeGraph([[0, 2], [4, -2]], 'vt', 0);
    const { vt } = Kinematics.deriveFromVT(g);
    const ivs = KinematicsProblemGenerator.findNegativeIntervals(vt);
    assert.equal(ivs.length, 1);
    close(ivs[0].t0, 2);
    close(ivs[0].t1, 4);
  });

  it('複数の負区間が隣接していれば結合する', () => {
    // (0,-1)-(2,-1)-(4,-1): 連続する2セグメントとも全負 → 1区間に結合
    const g = makeGraph([[0, -1], [2, -1], [4, -1]], 'vt', 0);
    const { vt } = Kinematics.deriveFromVT(g);
    const ivs = KinematicsProblemGenerator.findNegativeIntervals(vt);
    assert.equal(ivs.length, 1);
    close(ivs[0].t0, 0);
    close(ivs[0].t1, 4);
  });
});

// ── _integrateSegmentArea ──────────────────────────────────────────────
describe('KinematicsProblemGenerator._integrateSegmentArea', () => {
  it('等速区間（定数カーブ）の面積 = 速度 × 時間', () => {
    const g = makeGraph([[0, 3], [5, 3]], 'vt', 0);
    const { vt } = Kinematics.deriveFromVT(g);
    close(KinematicsProblemGenerator._integrateSegmentArea(vt, 0, 5), 15);
  });

  it('一定加速度区間（直線カーブ）の面積 = 台形の面積', () => {
    // v: 0 → 4 (t: 0→4)。台形面積 = (0+4)/2 * 4 = 8
    const g = makeGraph([[0, 0], [4, 4]], 'vt', 0);
    const { vt } = Kinematics.deriveFromVT(g);
    close(KinematicsProblemGenerator._integrateSegmentArea(vt, 0, 4), 8);
  });

  it('負の値の区間は負の面積（符号付き）を返す', () => {
    const g = makeGraph([[0, -2], [4, -2]], 'vt', 0);
    const { vt } = Kinematics.deriveFromVT(g);
    close(KinematicsProblemGenerator._integrateSegmentArea(vt, 0, 4), -8);
  });
});

// ── _fmt ───────────────────────────────────────────────────────────────
describe('KinematicsProblemGenerator._fmt', () => {
  it('整数はそのまま文字列化する', () => {
    assert.equal(KinematicsProblemGenerator._fmt(3), '3');
    assert.equal(KinematicsProblemGenerator._fmt(-2), '-2');
  });
  it('小数は小数第2位までに丸めて誤差を消す', () => {
    assert.equal(KinematicsProblemGenerator._fmt(0.1 + 0.2), '0.3');
    assert.equal(KinematicsProblemGenerator._fmt(1.005), '1');
  });
});

// ── describeMotion ─────────────────────────────────────────────────────
describe('KinematicsProblemGenerator.describeMotion', () => {
  it('速度 0・加速度 0 のとき静止と説明する', () => {
    const text = KinematicsProblemGenerator.describeMotion(0, 0, 0, 0, 2);
    assert.match(text, /静止/);
  });

  it('加速度 0・速度一定のとき等速直線運動と説明する', () => {
    const text = KinematicsProblemGenerator.describeMotion(2, 2, 0, 0, 4);
    assert.match(text, /等速直線運動/);
    assert.match(text, /正の向き/);
  });

  it('速さが増加するとき加速の説明をする', () => {
    const text = KinematicsProblemGenerator.describeMotion(1, 3, 0.5, 0, 4);
    assert.match(text, /速さを増しながら/);
  });

  it('速さが減少するとき減速の説明をする', () => {
    const text = KinematicsProblemGenerator.describeMotion(3, 1, -0.5, 0, 4);
    assert.match(text, /速さを減らしながら/);
  });

  it('速度の符号が反転するとき向きの反転を説明する', () => {
    const text = KinematicsProblemGenerator.describeMotion(2, -2, -1, 0, 4);
    assert.match(text, /反転/);
    assert.match(text, /一旦停止/);
  });

  it('負の向きの等速直線運動も正しく説明する', () => {
    const text = KinematicsProblemGenerator.describeMotion(-2, -2, 0, 0, 4);
    assert.match(text, /負の向き/);
    assert.match(text, /等速直線運動/);
  });
});

// ── _splitIntervalBySegments（変位計算の内部分割ロジック） ────────────
describe('KinematicsProblemGenerator (instance)._splitIntervalBySegments', () => {
  const gen = new KinematicsProblemGenerator({
    gridConfig: { xMin: 0, xMax: 10, yMin: -2, yMax: 2 },
    styleConfig: STYLE_PRESETS_STUB(),
  });

  it('区間内にセグメント境界がなければ分割しない', () => {
    const curve = { segments: [{ t0: 0, t1: 10, c0: 1, c1: 0, c2: 0 }] };
    const parts = gen._splitIntervalBySegments(curve, { t0: 0, t1: 10 });
    assert.equal(parts.length, 1);
    assert.deepEqual(parts[0], { t0: 0, t1: 10 });
  });

  it('区間内にセグメント境界があれば境界で分割する', () => {
    const curve = {
      segments: [
        { t0: 0, t1: 4, c0: 1, c1: 0, c2: 0 },
        { t0: 4, t1: 8, c0: -1, c1: 0, c2: 0 },
      ],
    };
    const parts = gen._splitIntervalBySegments(curve, { t0: 0, t1: 8 });
    assert.equal(parts.length, 2);
    close(parts[0].t0, 0); close(parts[0].t1, 4);
    close(parts[1].t0, 4); close(parts[1].t1, 8);
  });
});

// ── _shuffleChoices（グラフ選択肢問題のシャッフル純粋ロジック） ──────
describe('KinematicsProblemGenerator._shuffleChoices', () => {
  // ダミーアイテム: 先頭が正答、という _buildChoices と同じ前提で並べる
  const items = [
    { id: 'correct', isCorrect: true },
    { id: 'd1', isCorrect: false },
    { id: 'd2', isCorrect: false },
    { id: 'd3', isCorrect: false },
  ];

  it('同じシードなら常に同じ並び・同じ correctIndex になる（決定論性）', () => {
    const a = KinematicsProblemGenerator._shuffleChoices(items, 12345);
    const b = KinematicsProblemGenerator._shuffleChoices(items, 12345);
    assert.deepEqual(a.indices, b.indices);
    assert.equal(a.correctIndex, b.correctIndex);
    assert.deepEqual(a.ordered.map(i => i.id), b.ordered.map(i => i.id));
  });

  it('シードが異なれば（基本的に）並びも変わる', () => {
    const a = KinematicsProblemGenerator._shuffleChoices(items, 1);
    const b = KinematicsProblemGenerator._shuffleChoices(items, 2);
    assert.notDeepEqual(a.indices, b.indices);
  });

  it('correctIndex は ordered 配列中の正答の位置と一致する', () => {
    for (const seed of [1, 42, 999, 123456]) {
      const { ordered, correctIndex } = KinematicsProblemGenerator._shuffleChoices(items, seed);
      assert.ok(correctIndex >= 0 && correctIndex < ordered.length, `correctIndex=${correctIndex} が範囲外`);
      assert.equal(ordered[correctIndex].isCorrect, true);
      assert.equal(ordered[correctIndex].id, 'correct');
    }
  });

  it('シャッフル後も全アイテム（正答+誤答）がすべて含まれる', () => {
    const { ordered } = KinematicsProblemGenerator._shuffleChoices(items, 777);
    const ids = ordered.map(i => i.id).sort();
    assert.deepEqual(ids, ['correct', 'd1', 'd2', 'd3']);
  });

  it('単一要素（正答のみ・誤答なし）でも破綻しない', () => {
    const single = [{ id: 'only', isCorrect: true }];
    const { ordered, correctIndex } = KinematicsProblemGenerator._shuffleChoices(single, 5);
    assert.equal(ordered.length, 1);
    assert.equal(correctIndex, 0);
  });
});

// ── buildGraphChoiceSeed ───────────────────────────────────────────────
describe('KinematicsProblemGenerator.buildGraphChoiceSeed', () => {
  const source = makeGraph([[0, 0], [4, 2], [8, 2]], 'vt', 0);
  const distractors = [
    { points: [[0, 0], [4, 1], [8, 1]], kind: 'xt', x0: 0, label: 'B' },
  ];

  it('同じ入力なら同じシードになる（再現性）', () => {
    const s1 = KinematicsProblemGenerator.buildGraphChoiceSeed(source, 'vt', 'xt', distractors, 0);
    const s2 = KinematicsProblemGenerator.buildGraphChoiceSeed(source, 'vt', 'xt', distractors, 0);
    assert.equal(s1, s2);
  });

  it('askFor が異なれば（基本的に）シードも変わる', () => {
    const s1 = KinematicsProblemGenerator.buildGraphChoiceSeed(source, 'vt', 'xt', distractors, 0);
    const s2 = KinematicsProblemGenerator.buildGraphChoiceSeed(source, 'vt', 'at', distractors, 0);
    assert.notEqual(s1, s2);
  });

  it('distractors の内容が異なれば（基本的に）シードも変わる', () => {
    const other = [{ points: [[0, 0], [4, 5], [8, 5]], kind: 'xt', x0: 0, label: 'B' }];
    const s1 = KinematicsProblemGenerator.buildGraphChoiceSeed(source, 'vt', 'xt', distractors, 0);
    const s2 = KinematicsProblemGenerator.buildGraphChoiceSeed(source, 'vt', 'xt', other, 0);
    assert.notEqual(s1, s2);
  });

  it('x0 が異なれば（基本的に）シードも変わる', () => {
    const s1 = KinematicsProblemGenerator.buildGraphChoiceSeed(source, 'vt', 'xt', distractors, 0);
    const s2 = KinematicsProblemGenerator.buildGraphChoiceSeed(source, 'vt', 'xt', distractors, 5);
    assert.notEqual(s1, s2);
  });
});

// ── _kindLabel ─────────────────────────────────────────────────────────
describe('KinematicsProblemGenerator._kindLabel', () => {
  it('xt/vt/at をそれぞれ日本語ラベルに変換する', () => {
    assert.equal(KinematicsProblemGenerator._kindLabel('xt'), 'x-t（位置-時間）');
    assert.equal(KinematicsProblemGenerator._kindLabel('vt'), 'v-t（速度-時間）');
    assert.equal(KinematicsProblemGenerator._kindLabel('at'), 'a-t（加速度-時間）');
  });
});

// ── CIRCLED_DIGITS ─────────────────────────────────────────────────────
describe('KinematicsProblemGenerator.CIRCLED_DIGITS', () => {
  it('① から始まる丸数字配列を返す（legacy api/serialize.js と同じ規約）', () => {
    const digits = KinematicsProblemGenerator.CIRCLED_DIGITS;
    assert.equal(digits[0], '①');
    assert.equal(digits[1], '②');
    assert.ok(digits.length >= 10);
  });
});

// problems.js は STYLE_PRESETS（styles.js）を直接参照しないため、
// インスタンス化に必要な最小限のスタブを用意する
function STYLE_PRESETS_STUB() {
  return { grid: {}, xt: {}, vt: {}, at: {}, riser: {}, undefinedMark: {}, fill: {} };
}

// ── _deriveForSource（sourceKind に応じた導出ディスパッチの共通ヘルパー） ─
describe('KinematicsProblemGenerator._deriveForSource', () => {
  it("sourceKind='vt' のとき deriveFromVT と同じ結果を返す", () => {
    const g1 = makeGraph([[0, 0], [4, 2], [8, 2]], 'vt', 0);
    const g2 = makeGraph([[0, 0], [4, 2], [8, 2]], 'vt', 0);
    const expected = Kinematics.deriveFromVT(g1);
    const actual = KinematicsProblemGenerator._deriveForSource(g2, 'vt', 0);
    assert.deepEqual(actual.vt.segments, expected.vt.segments);
    assert.deepEqual(actual.xt.segments, expected.xt.segments);
    assert.deepEqual(actual.at.segments, expected.at.segments);
  });

  it("sourceKind='xt' のとき deriveFromXT と同じ結果を返す", () => {
    const g1 = makeGraph([[0, 0], [4, 4], [8, 0]], 'xt', 0);
    const g2 = makeGraph([[0, 0], [4, 4], [8, 0]], 'xt', 0);
    const expected = Kinematics.deriveFromXT(g1);
    const actual = KinematicsProblemGenerator._deriveForSource(g2, 'xt');
    assert.deepEqual(actual.vt.segments, expected.vt.segments);
    assert.deepEqual(actual.xt.segments, expected.xt.segments);
    assert.deepEqual(actual.at.segments, expected.at.segments);
  });

  it("sourceKind='vt-step' のとき deriveFromVTStep と同じ結果を返す", () => {
    const g1 = makeStepGraph(0, [1, 1, 3, -1], 0);
    const g2 = makeStepGraph(0, [1, 1, 3, -1], 0);
    const expected = Kinematics.deriveFromVTStep(g1);
    const actual = KinematicsProblemGenerator._deriveForSource(g2, 'vt-step', 0);
    assert.deepEqual(actual.vt.segments, expected.vt.segments);
    assert.deepEqual(actual.xt.segments, expected.xt.segments);
    assert.deepEqual(actual.at.segments, expected.at.segments);
    assert.deepEqual(actual.at.undefinedInstants, expected.at.undefinedInstants);
  });

  it("sourceKind='vt-step' では source.kind を上書きしない（StepMotionGraph.kind は固定）", () => {
    const g = makeStepGraph(0, [1, 2, 2], 0);
    KinematicsProblemGenerator._deriveForSource(g, 'vt-step', 0);
    assert.equal(g.kind, 'vt-step');
  });

  it("sourceKind='vt-step' のとき x0 を渡すと source.x0 に反映される", () => {
    const g = makeStepGraph(0, [1, 2, 2], 0);
    const derived = KinematicsProblemGenerator._deriveForSource(g, 'vt-step', 5);
    assert.equal(g.x0, 5);
    close(derived.xt.segments[0].c0, 5);
  });

  it("sourceKind='vt' で source.kind が異なれば揃える", () => {
    const g = makeGraph([[0, 0], [4, 2]], 'xt', 0);
    g.kind = 'xt';
    KinematicsProblemGenerator._deriveForSource(g, 'vt', 0);
    assert.equal(g.kind, 'vt');
  });
});

// ── 階段状 v-t（StepMotionGraph）を sourceKind='vt-step' として扱う設問生成 ─
describe('KinematicsProblemGenerator with vt-step source', () => {
  // 0〜1: 1 m/s, 1〜2: 1 m/s（連続）, 2〜3: 3 m/s（不連続ジャンプ）, 3〜4: -1 m/s（不連続ジャンプ）
  const stepSource = () => makeStepGraph(0, [1, 1, 3, -1], 0);

  it('generateGraphConversion: 例外を投げず、deriveFromVTStep と同じ導出結果に基づく canvas を返す', () => {
    const gen = makeGenerator();
    const source = stepSource();
    const expected = Kinematics.deriveFromVTStep(makeStepGraph(0, [1, 1, 3, -1], 0));

    const result = gen.generateGraphConversion({ source, sourceKind: 'vt-step', askFor: ['xt', 'at'], x0: 0 });

    assert.equal(result.question.canvases.length, 3); // 元グラフ + 空欄2つ
    assert.equal(result.answer.canvases.length, 2);
    result.question.canvases.forEach(c => assert.ok(c && typeof c.getContext === 'function'));
    result.answer.canvases.forEach(c => assert.ok(c && typeof c.getContext === 'function'));

    assert.match(result.question.text, /v-t（速度-時間）/);
    assert.match(result.answer.text, /撃力的に変化する/); // a-t に未定義瞬間（ジャンプ境界）がある場合の注記

    // a-t に未定義瞬間（ジャンプ境界）が含まれることの確認（直接 Kinematics で検証）
    assert.ok(expected.at.undefinedInstants.length > 0);
  });

  it('generateNumeric (acceleration): 区分定数カーブの区間で例外を投げず加速度を計算する', () => {
    const gen = makeGenerator();
    const source = stepSource();
    const result = gen.generateNumeric({ source, sourceKind: 'vt-step', subtype: 'acceleration', params: { interval: { t0: 0, t1: 1 } } });

    assert.match(result.question.text, /v-t/);
    assert.match(result.answer.text, /a = /);
    // [0,1] 区間は値が一定（1 m/s）→ 加速度は 0
    assert.match(result.answer.text, /a = 0 m\/s/);
    result.question.canvases.forEach(c => assert.ok(c && typeof c.getContext === 'function'));
  });

  it('generateNumeric (displacement): 区分定数カーブの面積（変位）を計算する', () => {
    const gen = makeGenerator();
    const source = stepSource();
    const result = gen.generateNumeric({ source, sourceKind: 'vt-step', subtype: 'displacement', params: { interval: { t0: 0, t1: 4 } } });

    // 変位 = (1*1) + (1*1) + (3*1) + (-1*1) = 4
    assert.match(result.answer.text, /変位 = 4 m/);
    assert.equal(result.answer.canvases.length, 1);
    assert.ok(result.answer.canvases[0] && typeof result.answer.canvases[0].getContext === 'function');
  });

  it('generateNumeric (direction): 速度が負になる区間（階段の最後の段）を検出する', () => {
    const gen = makeGenerator();
    const source = stepSource();
    const result = gen.generateNumeric({ source, sourceKind: 'vt-step', subtype: 'direction' });

    assert.match(result.answer.text, /t = 3 〜 4/);
  });

  it('generateNumeric (describe): 区間の運動の様子を説明するテキストを生成する', () => {
    const gen = makeGenerator();
    const source = stepSource();
    const result = gen.generateNumeric({ source, sourceKind: 'vt-step', subtype: 'describe', params: { interval: { t0: 0, t1: 1 } } });

    assert.match(result.answer.text, /等速直線運動|静止/);
  });

  it('generateGraphChoice: 例外を投げず choices/correctIndex/seed を返す', () => {
    const gen = makeGenerator();
    const source = stepSource();
    const distractors = [
      { points: [[0, 0], [4, 1], [8, 1]], kind: 'xt', x0: 0, label: 'B' },
    ];
    const result = gen.generateGraphChoice({
      source, sourceKind: 'vt-step', askFor: 'xt', distractors, x0: 0,
    });

    assert.equal(result.choices.length, 2);
    assert.ok(result.correctIndex === 0 || result.correctIndex === 1);
    assert.ok(Number.isFinite(result.seed));
    assert.match(result.question.text, /v-t（速度-時間）/);
    result.question.canvases.forEach(c => assert.ok(c && typeof c.getContext === 'function'));
    result.choices.forEach(ch => assert.ok(ch.canvas && typeof ch.canvas.getContext === 'function'));
  });

  it('_renderGraphCanvas: 階段状グラフ（StepMotionGraph）を例外なく描画する', () => {
    const gen = makeGenerator();
    const source = stepSource();
    const canvas = gen._renderGraphCanvas({ graph: source, kind: 'vt-step' });
    assert.ok(canvas && typeof canvas.getContext === 'function');
  });

  it('_renderGraphCanvas: 空の StepMotionGraph でも例外を投げない', () => {
    const gen = makeGenerator();
    const empty = new StepMotionGraph();
    const canvas = gen._renderGraphCanvas({ graph: empty, kind: 'vt-step' });
    assert.ok(canvas && typeof canvas.getContext === 'function');
  });
});
