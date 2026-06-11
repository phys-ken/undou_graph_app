'use strict';
// 実行: node --test tests/kinematics.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');
const vm = require('node:vm');

vm.runInThisContext(readFileSync(join(__dirname, '..', 'js', 'motion.js'), 'utf8'));
vm.runInThisContext(readFileSync(join(__dirname, '..', 'js', 'kinematics.js'), 'utf8'));
vm.runInThisContext(readFileSync(join(__dirname, '..', 'js', 'step-motion.js'), 'utf8'));

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

function makeStepGraph(tStart, values, x0 = 0) {
  const g = new StepMotionGraph();
  g.tStart = tStart;
  g.values = [...values];
  g.x0 = x0;
  return g;
}

function segAt(curve, t) {
  return curve.segments.find(s => t >= s.t0 && t <= s.t1);
}

function evalSeg(seg, t) {
  const dt = t - seg.t0;
  return seg.c0 + seg.c1 * dt + seg.c2 * dt * dt;
}

// ── curveFromGraph ─────────────────────────────────────────────────────
describe('Kinematics.curveFromGraph', () => {
  it('空グラフは空セグメントを返す', () => {
    const g = makeGraph([], 'vt');
    const c = Kinematics.curveFromGraph(g);
    assert.equal(c.kind, 'vt');
    assert.deepEqual(c.segments, []);
    assert.deepEqual(c.discontinuities, []);
  });

  it('単一点は前後1マスの端部ランプにより2セグメントの三角形になる', () => {
    // points=[(0,1)] → ランプ込み: (-1,0)-(0,1)-(1,0)
    const g = makeGraph([[0, 1]], 'vt');
    const c = Kinematics.curveFromGraph(g);
    assert.equal(c.segments.length, 2);
    close(c.segments[0].t0, -1); close(c.segments[0].t1, 0);
    close(c.segments[0].c0, 0); close(c.segments[0].c1, 1);
    close(c.segments[1].t0, 0); close(c.segments[1].t1, 1);
    close(c.segments[1].c0, 1); close(c.segments[1].c1, -1);
  });

  it('2点の直線セグメントを正しく生成する（端部ランプを含む3セグメント）', () => {
    // (0,0)-(4,2): 傾き 0.5 ＋ 前後の端部ランプ
    const g = makeGraph([[0, 0], [4, 2]], 'vt');
    const c = Kinematics.curveFromGraph(g);
    assert.equal(c.segments.length, 3);
    const s = segAt(c, 2); // 描いた区間 [0,4]
    close(s.t0, 0); close(s.t1, 4);
    close(s.c0, 0); close(s.c1, 0.5); close(s.c2, 0);
  });

  it('連続な手描きグラフには不連続点がない（端部ランプ含む4セグメント）', () => {
    const g = makeGraph([[0, 0], [2, 4], [5, 1]], 'xt');
    const c = Kinematics.curveFromGraph(g);
    assert.equal(c.segments.length, 4);
    assert.deepEqual(c.discontinuities, []);
    assert.deepEqual(c.undefinedInstants, []);
  });
});

// ── deriveFromVT: 等速 ─────────────────────────────────────────────────
describe('Kinematics.deriveFromVT - 等速 (v=2, t=0..5, x0=0)', () => {
  const g = makeGraph([[0, 2], [5, 2]], 'vt', 0);
  const { vt, xt, at } = Kinematics.deriveFromVT(g);

  it('vt の描いた区間は v=2 の定数直線（端部ランプを含め3セグメント）', () => {
    assert.equal(vt.segments.length, 3);
    const s = segAt(vt, 2); // 描いた区間 [0,5]
    close(s.c0, 2);
    close(s.c1, 0); // 傾き0 = 等速
  });

  it('at の描いた区間は定数 0、境界 t=0,5 と端部ランプ境界 t=-1,6 に不連続が記録される', () => {
    assert.equal(at.segments.length, 3);
    const s = segAt(at, 2);
    close(s.c0, 0);
    close(s.c1, 0);
    close(s.c2, 0);
    assert.deepEqual(at.discontinuities, [-1, 0, 5, 6]);
  });

  it('xt の描いた区間は直線（c0=1, c1=2, c2=0）、x0 はランプ起点での位置', () => {
    assert.equal(xt.segments.length, 3);
    const s = segAt(xt, 2); // 描いた区間 [0,5]
    close(s.c0, 1);
    close(s.c1, 2);
    close(s.c2, 0);
    // 数値検証: t=3 → x=7, t=5 → x=11
    close(evalSeg(s, 3), 7);
    close(evalSeg(s, 5), 11);
  });
});

// ── deriveFromVT: 加速 ─────────────────────────────────────────────────
describe('Kinematics.deriveFromVT - 加速 (v: 0→4, t=0..2, x0=0)', () => {
  const g = makeGraph([[0, 0], [2, 4]], 'vt', 0);
  const { vt, xt, at } = Kinematics.deriveFromVT(g);

  it('vt の傾き m = (4-0)/(2-0) = 2（描いた区間）', () => {
    close(segAt(vt, 1).c1, 2);
  });

  it('at の描いた区間は定数 2（加速度一定）、境界 t=0,2 と端部ランプ境界 t=3 に不連続', () => {
    assert.equal(at.segments.length, 3);
    const s = segAt(at, 1);
    close(s.c0, 2);
    close(s.c1, 0);
    assert.deepEqual(at.discontinuities, [0, 2, 3]);
  });

  it('xt の描いた区間は放物線 x = t^2 （c0=0, c1=0, c2=1）', () => {
    assert.equal(xt.segments.length, 3);
    const s = segAt(xt, 1); // 描いた区間 [0,2]
    close(s.c0, 0);   // x_start
    close(s.c1, 0);   // v0
    close(s.c2, 1);   // m/2 = 2/2 = 1
    // 数値検証: x(t) = 0 + 0*t + 1*t^2 = t^2
    close(evalSeg(s, 0), 0);
    close(evalSeg(s, 1), 1);
    close(evalSeg(s, 2), 4);
  });
});

// ── deriveFromVT: 2区間で傾きが異なる ──────────────────────────────────
describe('Kinematics.deriveFromVT - 2区間（傾きが異なる）', () => {
  // (0,0)-(2,4): 傾き 2  /  (2,4)-(5,4): 傾き 0
  const g = makeGraph([[0, 0], [2, 4], [5, 4]], 'vt', 1);
  const { vt, xt, at } = Kinematics.deriveFromVT(g);

  it('at に境界 t=0,2,5 と端部ランプ境界 t=6 で不連続が記録される', () => {
    assert.deepEqual(at.discontinuities, [0, 2, 5, 6]);
  });

  it('at の各セグメント値を検証する（左:2, 右:0）', () => {
    const left  = segAt(at, 1);
    const right = segAt(at, 3);
    close(left.c0, 2);
    close(right.c0, 0);
  });

  it('xt は連続（x_start が引き継がれる、端部ランプ含む4セグメント）', () => {
    assert.equal(xt.segments.length, 4);
    // セグメント1: x(t) = 1 + 0*t + (2/2)*t^2 = 1 + t^2  (t∈[0,2])
    // x(2) = 1 + 4 = 5
    // セグメント2: x(t) = 5 + 4*(t-2) + 0  (t∈[2,5])
    const s0 = segAt(xt, 1); // [0,2]
    const s1 = segAt(xt, 3); // [2,5]
    close(s0.c0, 1);
    close(evalSeg(s0, 2), 5);
    close(s1.c0, 5);
    close(s1.c1, 4);
    close(s1.c2, 0);
    close(evalSeg(s1, 5), 5 + 4 * 3); // = 17
    assert.deepEqual(xt.discontinuities, []);
    assert.deepEqual(xt.undefinedInstants, []);
  });
});

// ── deriveFromVT: エッジケース ─────────────────────────────────────────
describe('Kinematics.deriveFromVT - エッジケース', () => {
  it('空グラフは空セグメントの曲線を返す', () => {
    const g = makeGraph([], 'vt');
    const { vt, xt, at } = Kinematics.deriveFromVT(g);
    assert.deepEqual(vt.segments, []);
    assert.deepEqual(xt.segments, []);
    assert.deepEqual(at.segments, []);
  });

  it('単一点グラフは端部ランプにより2セグメントの三角形になる', () => {
    const g = makeGraph([[3, 1]], 'vt');
    const { vt, xt, at } = Kinematics.deriveFromVT(g);
    assert.equal(vt.segments.length, 2);
    close(vt.segments[0].t0, 2); close(vt.segments[0].t1, 3);
    close(vt.segments[0].c0, 0); close(vt.segments[0].c1, 1);
    close(vt.segments[1].t0, 3); close(vt.segments[1].t1, 4);
    close(vt.segments[1].c0, 1); close(vt.segments[1].c1, -1);

    assert.equal(at.segments.length, 2);
    assert.deepEqual(at.discontinuities, [2, 3, 4]);

    assert.equal(xt.segments.length, 2);
  });

  it('内部に角がなくても端部ランプとの境界 t=0,3 と、その外側 t=-1,4 でも不連続が記録される', () => {
    const g = makeGraph([[0, 1], [3, 3]], 'vt', 0);
    const { at } = Kinematics.deriveFromVT(g);
    assert.deepEqual(at.discontinuities, [-1, 0, 3, 4]);
  });
});

// ── deriveFromXT: 角を含む区分直線 ─────────────────────────────────────
describe('Kinematics.deriveFromXT - 平坦から上昇への角 (静止 → 一定速度)', () => {
  // (0,0)-(2,0): 静止 (傾き0)  /  (2,0)-(5,6): 傾き 2
  const g = makeGraph([[0, 0], [2, 0], [5, 6]], 'xt');
  const { xt, vt, at } = Kinematics.deriveFromXT(g);

  it('xt は端部ランプを含む4セグメント、描いた区間の傾きは元のまま', () => {
    assert.equal(xt.segments.length, 4);
    close(segAt(xt, 1).c1, 0);  // 描いた区間 [0,2]
    close(segAt(xt, 3).c1, 2);  // 描いた区間 [2,5]
  });

  it('vt は区分定数で、角 t=2 と端部ランプ境界 t=5,6 に不連続を持つ', () => {
    assert.deepEqual(vt.discontinuities, [2, 5, 6]);
    const left  = segAt(vt, 1);
    const right = segAt(vt, 3);
    close(left.c0, 0);   // 静止区間の速度 = 0
    close(right.c0, 2);  // (6-0)/(5-2) = 2
  });

  it('at は t=2, t=5, t=6 を discontinuities と undefinedInstants の両方に持つ', () => {
    assert.deepEqual(at.discontinuities, [2, 5, 6]);
    assert.deepEqual(at.undefinedInstants, [2, 5, 6]);
  });

  it('at は各セグメント内で 0', () => {
    const left  = segAt(at, 1);
    const right = segAt(at, 3);
    close(left.c0, 0);
    close(right.c0, 0);
  });
});

describe('Kinematics.deriveFromXT - 3区間（2つの角）', () => {
  // (0,0)-(2,4): 傾き2 / (2,4)-(4,4): 傾き0 / (4,4)-(6,0): 傾き-2
  const g = makeGraph([[0, 0], [2, 4], [4, 4], [6, 0]], 'xt');
  const { xt, vt, at } = Kinematics.deriveFromXT(g);

  it('vt は2つの角と端部ランプ境界を含め t=0,2,4,6 に不連続を持つ', () => {
    assert.deepEqual(vt.discontinuities, [0, 2, 4, 6]);
  });

  it('vt の各区間の速度を検証する', () => {
    close(segAt(vt, 1).c0, 2);   // (4-0)/(2-0)
    close(segAt(vt, 3).c0, 0);   // (4-4)/(4-2)
    close(segAt(vt, 5).c0, -2);  // (0-4)/(6-4)
  });

  it('at は端部ランプ境界を含め t=0,2,4,6 を discontinuities / undefinedInstants に持つ', () => {
    assert.deepEqual(at.discontinuities, [0, 2, 4, 6]);
    assert.deepEqual(at.undefinedInstants, [0, 2, 4, 6]);
  });

  it('at は全区間で 0', () => {
    for (const seg of at.segments) {
      close(seg.c0, 0);
    }
  });
});

// ── deriveFromXT: エッジケース ─────────────────────────────────────────
describe('Kinematics.deriveFromXT - エッジケース', () => {
  it('空グラフは空セグメントの曲線を返す', () => {
    const g = makeGraph([], 'xt');
    const { xt, vt, at } = Kinematics.deriveFromXT(g);
    assert.deepEqual(xt.segments, []);
    assert.deepEqual(vt.segments, []);
    assert.deepEqual(at.segments, []);
  });

  it('単一点グラフは端部ランプにより2セグメントの三角形になる', () => {
    const g = makeGraph([[2, 5]], 'xt');
    const { xt, vt, at } = Kinematics.deriveFromXT(g);
    assert.equal(xt.segments.length, 2);
    assert.equal(vt.segments.length, 2);
    assert.equal(at.segments.length, 2);
    close(segAt(vt, 1.5).c0, 5);
    close(segAt(vt, 2.5).c0, -5);
    assert.deepEqual(vt.discontinuities, [1, 2, 3]);
    assert.deepEqual(at.discontinuities, [1, 2, 3]);
    assert.deepEqual(at.undefinedInstants, [1, 2, 3]);
  });

  it('描いた区間自体には内部の角はないが、端部ランプ境界 t=0,4 とその外側 t=5 に不連続が記録される', () => {
    const g = makeGraph([[0, 0], [4, 8]], 'xt');
    const { vt, at } = Kinematics.deriveFromXT(g);
    assert.deepEqual(vt.discontinuities, [0, 4, 5]);
    assert.deepEqual(at.discontinuities, [0, 4, 5]);
    assert.deepEqual(at.undefinedInstants, [0, 4, 5]);
    close(segAt(vt, 2).c0, 2); // (8-0)/(4-0)
  });

  it('端部ランプにより最初/最後の点 t=0,6 にも不連続が記録される（内部の角 t=3 も含む）', () => {
    const g = makeGraph([[0, 0], [3, 3], [6, 0]], 'xt');
    const { vt, at } = Kinematics.deriveFromXT(g);
    assert.deepEqual(vt.discontinuities, [0, 3, 6]);
    assert.deepEqual(at.undefinedInstants, [0, 3, 6]);
  });
});

// ── curveFromStepGraph ─────────────────────────────────────────────────
describe('Kinematics.curveFromStepGraph', () => {
  it('空グラフは空セグメントの曲線を返す', () => {
    const g = new StepMotionGraph();
    const c = Kinematics.curveFromStepGraph(g);
    assert.equal(c.kind, 'vt');
    assert.deepEqual(c.segments, []);
    assert.deepEqual(c.discontinuities, []);
    assert.deepEqual(c.undefinedInstants, []);
  });

  it('区間ごとに定数セグメントを生成する', () => {
    const g = makeStepGraph(2, [1, 3, -2]);
    const c = Kinematics.curveFromStepGraph(g);
    assert.equal(c.segments.length, 3);

    close(c.segments[0].t0, 2); close(c.segments[0].t1, 3);
    close(c.segments[0].c0, 1); close(c.segments[0].c1, 0); close(c.segments[0].c2, 0);

    close(c.segments[1].t0, 3); close(c.segments[1].t1, 4);
    close(c.segments[1].c0, 3);

    close(c.segments[2].t0, 4); close(c.segments[2].t1, 5);
    close(c.segments[2].c0, -2);
  });

  it('値が変化する境界にのみ不連続を記録する（等しい境界には記録しない）', () => {
    // [1, 1, 3, 3, 3, -1] : 境界 t=1(変化なし), t=2(1→3 変化), t=3,4(変化なし), t=5(3→-1 変化)
    const g = makeStepGraph(0, [1, 1, 3, 3, 3, -1]);
    const c = Kinematics.curveFromStepGraph(g);
    assert.deepEqual(c.discontinuities, [2, 5]);
  });

  it('全区間で値が同じなら不連続なし', () => {
    const g = makeStepGraph(0, [2, 2, 2]);
    const c = Kinematics.curveFromStepGraph(g);
    assert.deepEqual(c.discontinuities, []);
  });

  it('全境界で値が変わるなら全境界に不連続を記録する', () => {
    const g = makeStepGraph(0, [1, -1, 1, -1]);
    const c = Kinematics.curveFromStepGraph(g);
    assert.deepEqual(c.discontinuities, [1, 2, 3]);
  });
});

// ── deriveFromVTStep ───────────────────────────────────────────────────
describe('Kinematics.deriveFromVTStep - 空グラフ', () => {
  it('空セグメントの曲線を3つ返す', () => {
    const g = new StepMotionGraph();
    const { vt, xt, at } = Kinematics.deriveFromVTStep(g);
    assert.deepEqual(vt.segments, []);
    assert.deepEqual(xt.segments, []);
    assert.deepEqual(at.segments, []);
  });
});

describe('Kinematics.deriveFromVTStep - vt は curveFromStepGraph と一致する', () => {
  it('セグメント・不連続が同じ', () => {
    const g = makeStepGraph(0, [1, 1, 3, -1], 0);
    const expected = Kinematics.curveFromStepGraph(g);
    const { vt } = Kinematics.deriveFromVTStep(g);
    assert.deepEqual(vt, expected);
  });
});

describe('Kinematics.deriveFromVTStep - 全区間で値が同じ（不連続なし）', () => {
  const g = makeStepGraph(0, [2, 2, 2], 0);
  const { vt, xt, at } = Kinematics.deriveFromVTStep(g);

  it('vt に不連続がない', () => {
    assert.deepEqual(vt.discontinuities, []);
  });

  it('at は全区間で 0、不連続・未定義点もなし', () => {
    assert.equal(at.segments.length, 3);
    for (const seg of at.segments) {
      close(seg.c0, 0); close(seg.c1, 0); close(seg.c2, 0);
    }
    assert.deepEqual(at.discontinuities, []);
    assert.deepEqual(at.undefinedInstants, []);
  });

  it('xt は連続な直線で x0 から始まる（速度一定なので傾き2の直線）', () => {
    assert.equal(xt.segments.length, 3);
    close(xt.segments[0].c0, 0); // x0
    close(xt.segments[0].c1, 2);
    close(evalSeg(xt.segments[0], 1), 2);
    close(xt.segments[1].c0, 2);
    close(evalSeg(xt.segments[1], 2), 4);
    close(xt.segments[2].c0, 4);
    close(evalSeg(xt.segments[2], 3), 6);
    assert.deepEqual(xt.discontinuities, []);
    assert.deepEqual(xt.undefinedInstants, []);
  });
});

describe('Kinematics.deriveFromVTStep - 交互に値が変わる（全境界でジャンプ）', () => {
  // [1, -1, 1] : tStart=0 → 境界 t=1, t=2 で共にジャンプ
  const g = makeStepGraph(0, [1, -1, 1], 10);
  const { vt, xt, at } = Kinematics.deriveFromVTStep(g);

  it('vt の不連続は両方の境界に記録される', () => {
    assert.deepEqual(vt.discontinuities, [1, 2]);
  });

  it('at は両方の境界を discontinuities と undefinedInstants の両方に持つ', () => {
    assert.deepEqual(at.discontinuities, [1, 2]);
    assert.deepEqual(at.undefinedInstants, [1, 2]);
  });

  it('at は各区間内で 0', () => {
    for (const seg of at.segments) {
      close(seg.c0, 0);
    }
  });

  it('xt は連続（x0=10 から積分、傾きは各区間の速度）', () => {
    // セグメント0: x = 10 + 1*(t-0), t∈[0,1] → x(1) = 11
    // セグメント1: x = 11 + (-1)*(t-1), t∈[1,2] → x(2) = 10
    // セグメント2: x = 10 + 1*(t-2), t∈[2,3] → x(3) = 11
    const s0 = xt.segments[0];
    const s1 = xt.segments[1];
    const s2 = xt.segments[2];
    close(s0.c0, 10); close(s0.c1, 1);
    close(evalSeg(s0, 1), 11);
    close(s1.c0, 11); close(s1.c1, -1);
    close(evalSeg(s1, 2), 10);
    close(s2.c0, 10); close(s2.c1, 1);
    close(evalSeg(s2, 3), 11);
    // 連続性: 各セグメントの開始値が前セグメントの終端評価値と一致
    close(s1.c0, evalSeg(s0, s0.t1));
    close(s2.c0, evalSeg(s1, s1.t1));
    assert.deepEqual(xt.discontinuities, []);
    assert.deepEqual(xt.undefinedInstants, []);
  });
});

describe('Kinematics.deriveFromVTStep - 一部の境界のみジャンプ（混在）', () => {
  // [2, 2, 5, 5, -1] : tStart=3 → 境界 t=4(同じ), t=5(2→5 ジャンプ),
  //                    t=6(同じ), t=7(5→-1 ジャンプ)
  const g = makeStepGraph(3, [2, 2, 5, 5, -1], 0);
  const { vt, xt, at } = Kinematics.deriveFromVTStep(g);

  it('vt の不連続はジャンプする境界のみ', () => {
    assert.deepEqual(vt.discontinuities, [5, 7]);
  });

  it('at の discontinuities / undefinedInstants はジャンプ境界のみ、同じ値', () => {
    assert.deepEqual(at.discontinuities, [5, 7]);
    assert.deepEqual(at.undefinedInstants, [5, 7]);
    assert.deepEqual(at.discontinuities, at.undefinedInstants);
  });

  it('値が変わらない境界 t=4, t=6 は記録されない', () => {
    assert.ok(!at.discontinuities.includes(4));
    assert.ok(!at.discontinuities.includes(6));
    assert.ok(!at.undefinedInstants.includes(4));
    assert.ok(!at.undefinedInstants.includes(6));
  });

  it('xt は連続で x0=0 から始まる', () => {
    for (let i = 0; i < xt.segments.length - 1; i++) {
      close(xt.segments[i + 1].c0, evalSeg(xt.segments[i], xt.segments[i].t1),
        `セグメント${i}と${i + 1}の接続点で x が連続`);
    }
    close(xt.segments[0].c0, 0); // x0
    assert.deepEqual(xt.discontinuities, []);
    assert.deepEqual(xt.undefinedInstants, []);
  });
});
