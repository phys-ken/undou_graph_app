'use strict';
// 実行: node --test tests/app.test.js
//
// App の純粋ロジック（presetDisplayOptions / _loadDisplayOptions /
// _rendererExtras / _clampFontSize）をテストする。
// DOM 操作系メソッド（_setupEditor / onXxxChange の再描画部分等）は
// drawXxx と同じくブラウザでのみ動作確認する。
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');
const vm = require('node:vm');

// app.js はトップレベルで document.addEventListener('DOMContentLoaded', ...) を
// 呼ぶため、最小限の document スタブを用意する（problems.test.js と同じ要領）。
// localStorage は _loadXxx/_saveXxx のラウンドトリップテスト用にメモリ実装を使う。
global.document = {
  createElement() { throw new Error('document.createElement is not supported in test stub'); },
  addEventListener() {},
};
const _store = new Map();
global.localStorage = {
  getItem(k)    { return _store.has(k) ? _store.get(k) : null; },
  setItem(k, v) { _store.set(k, String(v)); },
  removeItem(k) { _store.delete(k); },
  clear()       { _store.clear(); },
};

vm.runInThisContext(readFileSync(join(__dirname, '..', 'js', 'app.js'), 'utf8'));

/** displayOptions の既定値（全項目 true）を返すヘルパー */
function allTrueOptions() {
  const obj = {};
  App.DISPLAY_OPTION_KEYS.forEach(k => { obj[k] = true; });
  return obj;
}

// ── presetDisplayOptions ───────────────────────────────────────────────
describe('App.presetDisplayOptions', () => {
  it('11個の表示項目キーが定義されている', () => {
    assert.equal(App.DISPLAY_OPTION_KEYS.length, 11);
  });

  it("'all' は全項目 true", () => {
    assert.deepEqual(App.presetDisplayOptions('all'), allTrueOptions());
  });

  it("'qualitative' はグリッド・目盛り・単位・凡例 OFF、軸・ラベル・y=0線・?マーカー ON", () => {
    assert.deepEqual(App.presetDisplayOptions('qualitative'), {
      showGrid: false, showAxes: true,
      showTicksX: false, showTicksY: false,
      showUnitX: false, showUnitY: false,
      showAxisLabelX: true, showAxisLabelY: true,
      showZeroLine: true, showLegend: false, showUndefinedMark: true,
    });
  });

  it("'qualitative-grid' は 'qualitative' + グリッド ON", () => {
    const q  = App.presetDisplayOptions('qualitative');
    const qg = App.presetDisplayOptions('qualitative-grid');
    assert.deepEqual(qg, Object.assign({}, q, { showGrid: true }));
  });

  it("'shape-only' は軸ラベルも OFF（物理量を特定できる情報を全て隠す）", () => {
    assert.deepEqual(App.presetDisplayOptions('shape-only'), {
      showGrid: false, showAxes: true,
      showTicksX: false, showTicksY: false,
      showUnitX: false, showUnitY: false,
      showAxisLabelX: false, showAxisLabelY: false,
      showZeroLine: true, showLegend: false, showUndefinedMark: true,
    });
  });

  it('全プリセットで showUndefinedMark は true（曖昧さを非表示にしない原則）', () => {
    ['all', 'qualitative', 'qualitative-grid', 'shape-only'].forEach(p => {
      assert.equal(App.presetDisplayOptions(p).showUndefinedMark, true, p);
    });
  });

  it('不明なプリセット名は null を返す', () => {
    assert.equal(App.presetDisplayOptions('nope'), null);
  });

  it('返り値はコピーで、書き換えても次回の呼び出しに影響しない', () => {
    const a = App.presetDisplayOptions('all');
    a.showGrid = false;
    assert.equal(App.presetDisplayOptions('all').showGrid, true);
  });
});

// ── _loadDisplayOptions / _saveDisplayOptions ──────────────────────────
describe('App displayOptions の永続化', () => {
  beforeEach(() => {
    localStorage.clear();
    App.displayOptions = allTrueOptions();
  });

  it('保存 → 読み込みでラウンドトリップする', () => {
    App.displayOptions = App.presetDisplayOptions('shape-only');
    App._saveDisplayOptions();
    App.displayOptions = allTrueOptions();
    App._loadDisplayOptions();
    assert.deepEqual(App.displayOptions, App.presetDisplayOptions('shape-only'));
  });

  it('古い保存ブロブに無い新キーは既定 true で補完される（前方互換）', () => {
    // showAxisLabelX/Y 追加前の 9 キー構成のブロブを模擬
    localStorage.setItem(App._KEYS.displayOptions, JSON.stringify({
      showGrid: false, showAxes: true,
      showTicksX: false, showTicksY: false,
      showUnitX: false, showUnitY: false,
      showZeroLine: true, showLegend: false, showUndefinedMark: true,
    }));
    App._loadDisplayOptions();
    assert.equal(App.displayOptions.showAxisLabelX, true);
    assert.equal(App.displayOptions.showAxisLabelY, true);
    assert.equal(App.displayOptions.showGrid, false); // 保存値は反映される
  });

  it('boolean 以外の値・壊れた JSON は無視して既定値を保つ', () => {
    localStorage.setItem(App._KEYS.displayOptions, JSON.stringify({ showGrid: 'no' }));
    App._loadDisplayOptions();
    assert.equal(App.displayOptions.showGrid, true);

    localStorage.setItem(App._KEYS.displayOptions, '{broken');
    App._loadDisplayOptions();
    assert.deepEqual(App.displayOptions, allTrueOptions());
  });
});

// ── _clampFontSize / fontSize の永続化 ─────────────────────────────────
describe('App fontSize', () => {
  beforeEach(() => {
    localStorage.clear();
    App.fontSize = 12;
  });

  it('_clampFontSize は 8〜24 にクランプ、NaN は 12', () => {
    assert.equal(App._clampFontSize(16), 16);
    assert.equal(App._clampFontSize(4), 8);
    assert.equal(App._clampFontSize(99), 24);
    assert.equal(App._clampFontSize('18'), 18);
    assert.equal(App._clampFontSize('abc'), 12);
  });

  it('保存 → 読み込みでラウンドトリップする', () => {
    App.fontSize = 20;
    App._saveFontSize();
    App.fontSize = 12;
    App._loadFontSize();
    assert.equal(App.fontSize, 20);
  });

  it('保存値が範囲外でも読み込み時にクランプされる', () => {
    localStorage.setItem(App._KEYS.fontSize, '100');
    App._loadFontSize();
    assert.equal(App.fontSize, 24);
  });
});

// ── _rendererExtras ────────────────────────────────────────────────────
describe('App._rendererExtras', () => {
  it('fontSize と displayOptions の全キーをまとめて返す', () => {
    App.fontSize = 18;
    App.displayOptions = App.presetDisplayOptions('qualitative');
    const extras = App._rendererExtras();
    assert.equal(extras.fontSize, 18);
    assert.deepEqual(
      Object.fromEntries(App.DISPLAY_OPTION_KEYS.map(k => [k, extras[k]])),
      App.presetDisplayOptions('qualitative')
    );
  });

  it('_editorGridConfig に extras がマージされる', () => {
    App.fontSize = 14;
    App.displayOptions = App.presetDisplayOptions('shape-only');
    App.gridConfig = { tMin: 0, tMax: 10, valMin: -2, valMax: 2 };
    const gc = App._editorGridConfig();
    assert.equal(gc.xMin, 0);
    assert.equal(gc.xMax, 10);
    assert.equal(gc.fontSize, 14);
    assert.equal(gc.showAxisLabelX, false);
    assert.equal(gc.showUndefinedMark, true);
  });
});
