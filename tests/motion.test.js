'use strict';
// 実行: node --test tests/motion.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');
const vm = require('node:vm');

// motion.js をロード（DOM 非依存のため Node.js でそのまま評価できる）
// strict mode 下では eval がスコープに漏れないため vm.runInThisContext を使用
vm.runInThisContext(readFileSync(join(__dirname, '..', 'js', 'motion.js'), 'utf8'));

// ── ヘルパー ───────────────────────────────────────────────────────────
function makeGraph(points = [], kind = 'vt', x0 = 0) {
  const g = new MotionGraph();
  g.kind = kind;
  g.x0 = x0;
  points.forEach(([t, value]) => g.setPoint(t, value));
  return g;
}

// ── setPoint ───────────────────────────────────────────────────────────
describe('MotionGraph.setPoint', () => {
  it('t を整数に丸める', () => {
    const g = makeGraph();
    g.setPoint(3.7, 0);
    assert.equal(g.points[0].t, 4);
  });

  it('value を 0.5 刻みに丸める', () => {
    const g = makeGraph();
    g.setPoint(1, 1.3);
    assert.equal(g.points[0].value, 1.5);
    g.setPoint(2, -0.7);
    assert.equal(g.getPoint(2), -0.5);
  });

  it('同じ t への再セットで value を更新し点数が増えない', () => {
    const g = makeGraph();
    g.setPoint(3, 1);
    g.setPoint(3, 2);
    assert.equal(g.points.length, 1);
    assert.equal(g.getPoint(3), 2);
  });

  it('複数点を t 昇順で保持する', () => {
    const g = makeGraph([[5, 1], [2, 0.5], [8, -1]]);
    const ts = g.points.map(p => p.t);
    assert.deepEqual(ts, [2, 5, 8]);
  });
});

// ── getPoint ───────────────────────────────────────────────────────────
describe('MotionGraph.getPoint', () => {
  it('存在する t は value を返す', () => {
    const g = makeGraph([[4, 1.5]]);
    assert.equal(g.getPoint(4), 1.5);
  });

  it('存在しない t は null を返す', () => {
    const g = makeGraph([[4, 1.5]]);
    assert.equal(g.getPoint(7), null);
  });

  it('小数 t は丸めて検索する', () => {
    const g = makeGraph([[4, 1.5]]);
    assert.equal(g.getPoint(4.2), 1.5);
  });
});

// ── removePoint ────────────────────────────────────────────────────────
describe('MotionGraph.removePoint', () => {
  it('指定 t の点を削除する', () => {
    const g = makeGraph([[3, 1], [5, 2]]);
    g.removePoint(3);
    assert.equal(g.points.length, 1);
    assert.equal(g.points[0].t, 5);
  });

  it('存在しない t でも例外を出さない', () => {
    const g = makeGraph([[3, 1]]);
    assert.doesNotThrow(() => g.removePoint(99));
    assert.equal(g.points.length, 1);
  });
});

// ── valueAt ────────────────────────────────────────────────────────────
describe('MotionGraph.valueAt', () => {
  it('点なしは 0 を返す', () => {
    assert.equal(makeGraph().valueAt(5), 0);
  });

  it('範囲外（左）は 0', () => {
    const g = makeGraph([[3, 1], [6, 1]]);
    assert.equal(g.valueAt(1), 0);
  });

  it('範囲外（右）は 0', () => {
    const g = makeGraph([[3, 1], [6, 1]]);
    assert.equal(g.valueAt(9), 0);
  });

  it('左端の点を正確に返す', () => {
    const g = makeGraph([[2, 1.5], [6, -1]]);
    assert.equal(g.valueAt(2), 1.5);
  });

  it('右端の点を正確に返す', () => {
    const g = makeGraph([[2, 1.5], [6, -1]]);
    assert.equal(g.valueAt(6), -1);
  });

  it('中間の点を正確に返す', () => {
    const g = makeGraph([[1, 0], [3, 2], [5, 0]]);
    assert.equal(g.valueAt(3), 2);
  });

  it('2点間を線形補間する（中点）', () => {
    const g = makeGraph([[2, 0], [4, 2]]);
    assert.equal(g.valueAt(3), 1);
  });

  it('三角波形の斜面を正確に補間する', () => {
    const g = makeGraph([[0, 0], [4, 2], [8, 0]]);
    assert.equal(g.valueAt(2), 1);
    assert.equal(g.valueAt(6), 1);
  });

  // ── 端部ランプ（Wave.getY と同じ挙動を踏襲）────────────────────────
  it('左端ランプ: [first.t-1, first.t) で 0→first.value に線形補間する', () => {
    const g = makeGraph([[2, 2], [4, 0]]);
    assert.equal(g.valueAt(1),   0);
    assert.equal(g.valueAt(1.5), 1);
    assert.equal(g.valueAt(2),   2);
  });

  it('右端ランプ: (last.t, last.t+1] で last.value→0 に線形補間する', () => {
    const g = makeGraph([[2, 0], [4, 2]]);
    assert.equal(g.valueAt(4),   2);
    assert.equal(g.valueAt(4.5), 1);
    assert.equal(g.valueAt(5),   0);
  });

  it('ランプ範囲外はまだ 0 を返す', () => {
    const g = makeGraph([[3, 1], [6, 1]]);
    assert.equal(g.valueAt(1), 0);
    assert.equal(g.valueAt(9), 0);
  });
});

// ── getSnapshot ────────────────────────────────────────────────────────
describe('MotionGraph.getSnapshot', () => {
  it('範囲内の整数 t を全て含む', () => {
    const g = makeGraph([[0, 0], [4, 1], [8, 0]]);
    const snap = g.getSnapshot(0, 8);
    const ts = snap.map(p => p.t);
    for (let t = 0; t <= 8; t++) {
      assert.ok(ts.includes(t), `t=${t} が含まれていない`);
    }
  });

  it('頂点位置（折れ点）を含む', () => {
    const g = makeGraph([[2, 0], [5, 2], [9, 0]]);
    const snap = g.getSnapshot(0, 10);
    const ts = snap.map(p => p.t);
    assert.ok(ts.includes(5), '頂点位置 t=5 が含まれていない');
  });

  it('tMin より小さい点は含まない', () => {
    const g = makeGraph([[0, 0], [10, 0]]);
    const snap = g.getSnapshot(3, 7);
    assert.ok(snap.every(p => p.t >= 3));
  });

  it('tMax より大きい点は含まない', () => {
    const g = makeGraph([[0, 0], [10, 0]]);
    const snap = g.getSnapshot(3, 7);
    assert.ok(snap.every(p => p.t <= 7));
  });

  it('t 昇順にソートされている', () => {
    const g = makeGraph([[0, 0], [4, 2], [8, 0]]);
    const snap = g.getSnapshot(0, 8);
    for (let i = 1; i < snap.length; i++) {
      assert.ok(snap[i].t >= snap[i - 1].t);
    }
  });

  it('value が valueAt と一致している', () => {
    const g = makeGraph([[1, 0], [4, 1.5], [7, 0]]);
    const snap = g.getSnapshot(0, 10);
    for (const p of snap) {
      assert.equal(p.value, g.valueAt(p.t));
    }
  });

  it('波の伝播を持たない（時刻引数を取らない）ため tMin/tMax のみで決まる', () => {
    const g = makeGraph([[2, 1], [6, -1]]);
    const snap1 = g.getSnapshot(0, 8);
    const snap2 = g.getSnapshot(0, 8);
    assert.deepEqual(snap1, snap2);
  });
});

// ── clear / isEmpty ────────────────────────────────────────────────────
describe('MotionGraph.clear', () => {
  it('クリア後は点なし', () => {
    const g = makeGraph([[1, 1], [3, 2], [5, 0]]);
    g.clear();
    assert.equal(g.points.length, 0);
    assert.equal(g.valueAt(3), 0);
  });
});

describe('MotionGraph.isEmpty', () => {
  it('点なしは true', () => {
    assert.ok(new MotionGraph().isEmpty());
  });

  it('点が 1 つあれば false', () => {
    assert.ok(!makeGraph([[3, 1]]).isEmpty());
  });

  it('clear() 後は再び true になる', () => {
    const g = makeGraph([[3, 1]]);
    g.clear();
    assert.ok(g.isEmpty());
  });
});

// ── getMaxAbsValue ─────────────────────────────────────────────────────
describe('MotionGraph.getMaxAbsValue', () => {
  it('点なしは 0', () => {
    assert.equal(new MotionGraph().getMaxAbsValue(), 0);
  });

  it('複数点の最大 |value|', () => {
    const g = makeGraph([[1, 0.5], [3, -2], [5, 1.5]]);
    assert.equal(g.getMaxAbsValue(), 2);
  });

  it('全て負の値でも絶対値で評価する', () => {
    const g = makeGraph([[1, -0.5], [3, -3]]);
    assert.equal(g.getMaxAbsValue(), 3);
  });
});

// ── toJSON / fromJSON ──────────────────────────────────────────────────
describe('MotionGraph.toJSON / fromJSON', () => {
  it('ラウンドトリップでデータが復元される（v-t）', () => {
    const g = makeGraph([[0, 0], [4, 2], [7, 0]], 'vt', 3);
    g.label = 'B';
    const json = g.toJSON();
    const g2 = new MotionGraph().fromJSON(json);

    assert.deepEqual(g2.points, g.points);
    assert.equal(g2.kind,  'vt');
    assert.equal(g2.x0,    3);
    assert.equal(g2.label, 'B');
  });

  it('ラウンドトリップでデータが復元される（x-t）', () => {
    const g = makeGraph([[0, 1], [5, 4]], 'xt');
    const json = g.toJSON();
    const g2 = new MotionGraph().fromJSON(json);
    assert.equal(g2.kind, 'xt');
    assert.deepEqual(g2.points, g.points);
  });

  it('空の points でもエラーなし', () => {
    const g  = new MotionGraph();
    const g2 = new MotionGraph().fromJSON(g.toJSON());
    assert.deepEqual(g2.points, []);
  });

  it('fromJSON でデフォルト値が補完される', () => {
    const g = new MotionGraph().fromJSON({});
    assert.equal(g.kind,  'vt');
    assert.equal(g.x0,    0);
    assert.equal(g.label, 'A');
    assert.deepEqual(g.points, []);
  });

  it('toJSON に kind が含まれる', () => {
    const g = makeGraph([[1, 0], [3, 1]], 'xt');
    assert.equal(g.toJSON().kind, 'xt');
  });

  it('kind フィールドなしの古いデータも fromJSON で復元できる（後方互換）', () => {
    const old = { points: [{ t: 1, value: 0.5 }], x0: 2, label: 'B' };
    const g = new MotionGraph().fromJSON(old);
    assert.deepEqual(g.points, [{ t: 1, value: 0.5 }]);
    assert.equal(g.kind, 'vt');
    assert.equal(g.x0, 2);
  });
});
