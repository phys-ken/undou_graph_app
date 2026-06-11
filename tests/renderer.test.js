'use strict';
// 実行: node --test tests/renderer.test.js
//
// MotionGraphRenderer の純粋ロジック（computeCanvasSize 等）をテストする。
// drawXxx 系は Canvas API に依存するため対象外
// （legacy_nami_app/tests/renderer.test.js と同じ方針）。
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');
const vm = require('node:vm');

// renderer.js は document に依存するメソッドを含むが、
// クラス定義 + 静的メソッドの評価はブラウザAPI非依存で可能。
// constructor は Canvas を要求するため使用しない。
vm.runInThisContext(readFileSync(join(__dirname, '..', 'js', 'renderer.js'), 'utf8'));

// ── 定数の存在確認 ─────────────────────────────────────────────────────
describe('MotionGraphRenderer 定数', () => {
  it('DEFAULT_DISP_W = 580', () => {
    assert.equal(MotionGraphRenderer.DEFAULT_DISP_W, 580);
  });
  it('DEFAULT_DISP_H = 200', () => {
    assert.equal(MotionGraphRenderer.DEFAULT_DISP_H, 200);
  });
  it('DEFAULT_PADDING の値（right はラベル「時刻 t [s]」が収まる 68）', () => {
    assert.deepEqual(MotionGraphRenderer.DEFAULT_PADDING, {
      left: 52, right: 68, top: 32, bottom: 44,
    });
  });
  it('CELL_PX_MIN / CELL_PX_MAX の範囲', () => {
    assert.equal(MotionGraphRenderer.CELL_PX_MIN, 15);
    assert.equal(MotionGraphRenderer.CELL_PX_MAX, 120);
  });
});

// ── computeCanvasSize ──────────────────────────────────────────────────
describe('MotionGraphRenderer.computeCanvasSize', () => {
  const grid = { xMin: 0, xMax: 10, yMin: -2, yMax: 2 };

  it('cellSize 未指定 → デフォルト 580×200', () => {
    const s = MotionGraphRenderer.computeCanvasSize(grid);
    assert.deepEqual(s, { width: 580, height: 200 });
  });

  it('cellSize = {} → デフォルト 580×200', () => {
    const s = MotionGraphRenderer.computeCanvasSize(grid, {});
    assert.deepEqual(s, { width: 580, height: 200 });
  });

  it('cellSize = { w: null, h: null } → デフォルト', () => {
    const s = MotionGraphRenderer.computeCanvasSize(grid, { w: null, h: null });
    assert.deepEqual(s, { width: 580, height: 200 });
  });

  it('cellSize.w = 0 → デフォルト幅にフォールバック（w のみ）', () => {
    const s = MotionGraphRenderer.computeCanvasSize(grid, { w: 0, h: null });
    assert.equal(s.width, 580);
  });

  it('cellSize.w = 30 → 10*30 + 52+68 = 420', () => {
    const s = MotionGraphRenderer.computeCanvasSize(grid, { w: 30, h: null });
    assert.equal(s.width, 420);
    assert.equal(s.height, 200);  // h は自動のまま
  });

  it('cellSize.h = 50 → 4*50 + 32+44 = 276', () => {
    const s = MotionGraphRenderer.computeCanvasSize(grid, { w: null, h: 50 });
    assert.equal(s.width, 580);   // w は自動のまま
    assert.equal(s.height, 276);
  });

  it('cellSize.w = 30, h = 50 → 両方反映', () => {
    const s = MotionGraphRenderer.computeCanvasSize(grid, { w: 30, h: 50 });
    assert.equal(s.width,  10 * 30 + 120);  // 420
    assert.equal(s.height, 4  * 50 + 76);   // 276
  });

  it('xMax-xMin = 20 のグリッドで cellW=30 → 20*30 + 120 = 720', () => {
    const big = { xMin: 0, xMax: 20, yMin: -2, yMax: 2 };
    const s = MotionGraphRenderer.computeCanvasSize(big, { w: 30, h: null });
    assert.equal(s.width, 720);
  });

  it('yMin が負の場合の高さ計算（範囲は yMax-yMin）', () => {
    const g = { xMin: 0, xMax: 10, yMin: -3, yMax: 3 };
    const s = MotionGraphRenderer.computeCanvasSize(g, { w: null, h: 25 });
    assert.equal(s.height, 6 * 25 + 76);  // 226
  });

  it('カスタムパディングを反映する', () => {
    const s = MotionGraphRenderer.computeCanvasSize(
      grid,
      { w: 30, h: 50 },
      { left: 10, right: 10, top: 10, bottom: 10 }
    );
    assert.equal(s.width,  10 * 30 + 20);  // 320
    assert.equal(s.height, 4  * 50 + 20);  // 220
  });

  it('小数を含む cellSize は丸める', () => {
    const s = MotionGraphRenderer.computeCanvasSize(grid, { w: 30.4, h: null });
    // 10 * 30.4 + 120 = 424 → Math.round で 424
    assert.equal(s.width, 424);
  });

  it('cellSize.w 指定でも h を指定しなければ h はデフォルト 200', () => {
    const s = MotionGraphRenderer.computeCanvasSize(grid, { w: 60 });
    assert.equal(s.width, 10 * 60 + 120);  // 720
    assert.equal(s.height, 200);
  });
});

// ── computeCanvasSize × fontSize（padding スケーリング） ────────────────
describe('MotionGraphRenderer.computeCanvasSize - fontSize', () => {
  const grid = { xMin: 0, xMax: 10, yMin: -2, yMax: 2 };

  it('fontSize 省略 → 従来どおり 580×200（後方互換）', () => {
    const s = MotionGraphRenderer.computeCanvasSize(grid);
    assert.deepEqual(s, { width: 580, height: 200 });
  });

  it('fontSize = 12 → padScale=1 でデフォルトと同じ', () => {
    const s = MotionGraphRenderer.computeCanvasSize({ ...grid, fontSize: 12 });
    assert.deepEqual(s, { width: 580, height: 200 });
  });

  it('fontSize = 8 → padScale は 1 未満にならない（padding は縮小しない）', () => {
    const s = MotionGraphRenderer.computeCanvasSize({ ...grid, fontSize: 8 });
    assert.deepEqual(s, { width: 580, height: 200 });
  });

  it('fontSize = 24 → padScale=2、プロット領域は維持し余白だけ拡大', () => {
    // pad = {left:104, right:136, top:64, bottom:88}
    // width  = (580-52-68) + 104+136 = 460 + 240 = 700
    // height = (200-32-44) + 64+88   = 124 + 152 = 276
    const s = MotionGraphRenderer.computeCanvasSize({ ...grid, fontSize: 24 });
    assert.deepEqual(s, { width: 700, height: 276 });
  });

  it('fontSize = 18 → padScale=1.5、丸め後の padding で算出', () => {
    // pad = {left:78, right:102, top:48, bottom:66}
    // width  = 460 + 78+102 = 640
    // height = 124 + 48+66  = 238
    const s = MotionGraphRenderer.computeCanvasSize({ ...grid, fontSize: 18 });
    assert.deepEqual(s, { width: 640, height: 238 });
  });

  it('cellSize 指定時は xRange*cellPx 項は不変で padding 項のみ拡大', () => {
    // fontSize=24: width = 10*30 + 104+136 = 540, height = 4*50 + 64+88 = 352
    const s = MotionGraphRenderer.computeCanvasSize({ ...grid, fontSize: 24 }, { w: 30, h: 50 });
    assert.equal(s.width,  10 * 30 + 104 + 136);  // 540
    assert.equal(s.height, 4  * 50 + 64  + 88);   // 352
  });

  it('カスタムパディングにも padScale が適用される', () => {
    // base {10,10,10,10} × 2 = {20,20,20,20}
    const s = MotionGraphRenderer.computeCanvasSize(
      { ...grid, fontSize: 24 },
      { w: 30, h: 50 },
      { left: 10, right: 10, top: 10, bottom: 10 }
    );
    assert.equal(s.width,  10 * 30 + 40);  // 340
    assert.equal(s.height, 4  * 50 + 40);  // 240
  });
});

// ── computeFontAwareMaxTicks（フォント拡大時の目盛り間引き） ────────────
describe('MotionGraphRenderer.computeFontAwareMaxTicks', () => {
  it('fontSize 12 以下では base のまま（従来挙動と互換）', () => {
    assert.equal(MotionGraphRenderer.computeFontAwareMaxTicks(12), 10);
    assert.equal(MotionGraphRenderer.computeFontAwareMaxTicks(8), 10);
    assert.equal(MotionGraphRenderer.computeFontAwareMaxTicks(undefined), 10);
  });

  it('fontSize に反比例して本数上限が減る', () => {
    assert.equal(MotionGraphRenderer.computeFontAwareMaxTicks(16), 7);  // floor(10*12/16)
    assert.equal(MotionGraphRenderer.computeFontAwareMaxTicks(20), 6);  // floor(10*12/20)
    assert.equal(MotionGraphRenderer.computeFontAwareMaxTicks(24), 5);  // floor(10*12/24)
  });

  it('下限は 3（極端な base/fontSize でも目盛りが消えない）', () => {
    assert.equal(MotionGraphRenderer.computeFontAwareMaxTicks(24, 4), 3); // floor(4*12/24)=2 → 3
  });

  it('computeTickStep と組み合わせると大フォントで間隔が粗くなる', () => {
    // 値域 19（例: -4〜15）: 12px では step=2、20px では maxTicks=6 → step=5
    const range = 19;
    const stepAt12 = MotionGraphRenderer.computeTickStep(range, MotionGraphRenderer.computeFontAwareMaxTicks(12));
    const stepAt20 = MotionGraphRenderer.computeTickStep(range, MotionGraphRenderer.computeFontAwareMaxTicks(20));
    assert.equal(stepAt12, 2);
    assert.equal(stepAt20, 5);
  });
});
