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

const load = (file) => vm.runInThisContext(readFileSync(join(__dirname, '..', 'js', file), 'utf8'));
load('random.js');
load('motion.js');
load('kinematics.js');
load('problems.js');

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

// problems.js は STYLE_PRESETS（styles.js）を直接参照しないため、
// インスタンス化に必要な最小限のスタブを用意する
function STYLE_PRESETS_STUB() {
  return { grid: {}, xt: {}, vt: {}, at: {}, riser: {}, undefinedMark: {}, fill: {} };
}
