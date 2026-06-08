'use strict';
// 実行: node --test tests/step-motion.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');
const vm = require('node:vm');

vm.runInThisContext(readFileSync(join(__dirname, '..', 'js', 'step-motion.js'), 'utf8'));

// ── 空グラフ ───────────────────────────────────────────────────────────
describe('StepMotionGraph - 空グラフ', () => {
  it('isEmpty は true を返す', () => {
    const g = new StepMotionGraph();
    assert.equal(g.isEmpty(), true);
  });

  it('valueAt は常に null を返す', () => {
    const g = new StepMotionGraph();
    assert.equal(g.valueAt(0), null);
    assert.equal(g.valueAt(3.5), null);
    assert.equal(g.valueAt(-1), null);
  });

  it('getMaxAbsValue は 0 を返す', () => {
    const g = new StepMotionGraph();
    assert.equal(g.getMaxAbsValue(), 0);
  });

  it('toJSON / fromJSON のラウンドトリップ', () => {
    const g = new StepMotionGraph();
    const json = g.toJSON();
    assert.deepEqual(json, { kind: 'vt-step', tStart: null, values: [], x0: 0, label: 'A' });

    const g2 = new StepMotionGraph().fromJSON(json);
    assert.equal(g2.isEmpty(), true);
    assert.equal(g2.tStart, null);
    assert.deepEqual(g2.values, []);
  });
});

// ── paintInterval ──────────────────────────────────────────────────────
describe('StepMotionGraph.paintInterval', () => {
  it('空の状態から最初の区間を作る', () => {
    const g = new StepMotionGraph();
    g.paintInterval(2, 1);
    assert.equal(g.tStart, 2);
    assert.deepEqual(g.values, [1]);
    assert.equal(g.isEmpty(), false);
  });

  it('実数 t は floor して区間インデックスにする', () => {
    const g = new StepMotionGraph();
    g.paintInterval(2.7, 1);
    assert.equal(g.tStart, 2);
    assert.deepEqual(g.values, [1]);
  });

  it('末尾に隣接する区間を追加（append）', () => {
    const g = new StepMotionGraph();
    g.paintInterval(2, 1);
    g.paintInterval(3, 2);
    assert.equal(g.tStart, 2);
    assert.deepEqual(g.values, [1, 2]);
  });

  it('先頭に隣接する区間を追加（prepend）', () => {
    const g = new StepMotionGraph();
    g.paintInterval(2, 1);
    g.paintInterval(1, 0.5);
    assert.equal(g.tStart, 1);
    assert.deepEqual(g.values, [0.5, 1]);
  });

  it('既存区間の値を更新する', () => {
    const g = new StepMotionGraph();
    g.paintInterval(2, 1);
    g.paintInterval(3, 2);
    g.paintInterval(2.5, 5); // floor(2.5) = 2 → 既存区間
    assert.deepEqual(g.values, [5, 2]);
    assert.equal(g.tStart, 2);
  });

  it('隙間ができる位置への塗りは無視する（no-op）', () => {
    const g = new StepMotionGraph();
    g.paintInterval(2, 1);
    g.paintInterval(5, 9); // tStart+values.length=3 から離れている
    assert.equal(g.tStart, 2);
    assert.deepEqual(g.values, [1]);
  });

  it('遠い位置への最初の塗りでも開始できる', () => {
    const g = new StepMotionGraph();
    g.paintInterval(10, 3);
    assert.equal(g.tStart, 10);
    assert.deepEqual(g.values, [3]);
  });

  it('値を 0.5 刻みに丸める', () => {
    const g = new StepMotionGraph();
    g.paintInterval(0, 1.3);
    assert.equal(g.values[0], 1.5);
    g.paintInterval(1, -0.7);
    assert.equal(g.values[1], -0.5);
  });
});

// ── removeEdgeInterval ─────────────────────────────────────────────────
describe('StepMotionGraph.removeEdgeInterval', () => {
  function makeStep(tStart, values) {
    const g = new StepMotionGraph();
    g.tStart = tStart;
    g.values = [...values];
    return g;
  }

  it('先頭区間を削除する', () => {
    const g = makeStep(0, [1, 2, 3]);
    g.removeEdgeInterval(0);
    assert.equal(g.tStart, 1);
    assert.deepEqual(g.values, [2, 3]);
  });

  it('末尾区間を削除する', () => {
    const g = makeStep(0, [1, 2, 3]);
    g.removeEdgeInterval(2.5); // floor → 区間インデックス 2（末尾）
    assert.equal(g.tStart, 0);
    assert.deepEqual(g.values, [1, 2]);
  });

  it('内部の区間は削除しない（no-op）', () => {
    const g = makeStep(0, [1, 2, 3]);
    g.removeEdgeInterval(1.5); // floor → 区間インデックス 1（内部）
    assert.equal(g.tStart, 0);
    assert.deepEqual(g.values, [1, 2, 3]);
  });

  it('唯一の区間を削除すると空状態に戻る', () => {
    const g = makeStep(5, [4]);
    g.removeEdgeInterval(5);
    assert.equal(g.isEmpty(), true);
    assert.equal(g.tStart, null);
    assert.deepEqual(g.values, []);
  });

  it('空グラフでは何もしない', () => {
    const g = new StepMotionGraph();
    g.removeEdgeInterval(0);
    assert.equal(g.isEmpty(), true);
  });
});

// ── valueAt: 半開区間の境界 ────────────────────────────────────────────
describe('StepMotionGraph.valueAt - 半開区間 [tStart+i, tStart+i+1)', () => {
  function makeStep(tStart, values) {
    const g = new StepMotionGraph();
    g.tStart = tStart;
    g.values = [...values];
    return g;
  }

  it('各区間内の値を返す', () => {
    const g = makeStep(2, [1, 3, -2]);
    assert.equal(g.valueAt(2), 1);
    assert.equal(g.valueAt(2.5), 1);
    assert.equal(g.valueAt(3), 3);
    assert.equal(g.valueAt(3.9), 3);
    assert.equal(g.valueAt(4), -2);
    assert.equal(g.valueAt(4.5), -2);
  });

  it('左端 t0 はその区間の値を返す', () => {
    const g = makeStep(0, [5]);
    assert.equal(g.valueAt(0), 5);
  });

  it('最後の区間の右端ちょうどは null（半開区間の外側）', () => {
    const g = makeStep(0, [5, 7]);
    assert.equal(g.valueAt(2), null); // tStart + values.length = 2
  });

  it('描画範囲より前後は null', () => {
    const g = makeStep(2, [1, 3]);
    assert.equal(g.valueAt(1), null);
    assert.equal(g.valueAt(1.99), null);
    assert.equal(g.valueAt(4), null);
    assert.equal(g.valueAt(10), null);
  });
});

// ── getMaxAbsValue ─────────────────────────────────────────────────────
describe('StepMotionGraph.getMaxAbsValue', () => {
  it('値の絶対値の最大を返す', () => {
    const g = new StepMotionGraph();
    g.tStart = 0;
    g.values = [1, -3, 2.5];
    assert.equal(g.getMaxAbsValue(), 3);
  });
});

// ── clear ──────────────────────────────────────────────────────────────
describe('StepMotionGraph.clear', () => {
  it('空状態に戻す', () => {
    const g = new StepMotionGraph();
    g.paintInterval(0, 1);
    g.paintInterval(1, 2);
    g.clear();
    assert.equal(g.isEmpty(), true);
    assert.equal(g.tStart, null);
    assert.deepEqual(g.values, []);
  });
});

// ── toJSON / fromJSON ──────────────────────────────────────────────────
describe('StepMotionGraph.toJSON / fromJSON', () => {
  it('非空グラフのラウンドトリップ', () => {
    const g = new StepMotionGraph();
    g.paintInterval(2, 1);
    g.paintInterval(3, -1.5);
    g.x0 = 4;
    g.label = 'B';

    const json = g.toJSON();
    assert.deepEqual(json, { kind: 'vt-step', tStart: 2, values: [1, -1.5], x0: 4, label: 'B' });

    const g2 = new StepMotionGraph().fromJSON(json);
    assert.equal(g2.tStart, 2);
    assert.deepEqual(g2.values, [1, -1.5]);
    assert.equal(g2.x0, 4);
    assert.equal(g2.label, 'B');
  });

  it('toJSON が返す values は独立した配列（参照共有しない）', () => {
    const g = new StepMotionGraph();
    g.paintInterval(0, 1);
    const json = g.toJSON();
    json.values.push(99);
    assert.deepEqual(g.values, [1]);
  });

  it('fromJSON はフィールド欠損時にデフォルト値で補完する', () => {
    const g = new StepMotionGraph().fromJSON({});
    assert.equal(g.kind, 'vt-step');
    assert.equal(g.tStart, null);
    assert.deepEqual(g.values, []);
    assert.equal(g.x0, 0);
    assert.equal(g.label, 'A');
  });

  it('fromJSON は this を返す（チェーン可能）', () => {
    const g = new StepMotionGraph();
    assert.equal(g.fromJSON({}), g);
  });
});
