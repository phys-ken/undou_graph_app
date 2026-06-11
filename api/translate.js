'use strict';

// MotionGraphRenderer.DEFAULT_PADDING と同じ値を既定として使う
// （state.gridConfig は描画ヘルパーにそのまま渡されるため、未指定項目を
//   ここで埋めておく必要がある — legacy の GRID_DEFAULTS と同じ役割）。
const GRID_DEFAULTS = {
  xMin: 0, xMax: 10, yMin: -2, yMax: 2,
  paddingLeft: 52, paddingRight: 68, paddingTop: 32, paddingBottom: 44,
};

function resolveStyle(style, STYLE_PRESETS) {
  if (!style) return STYLE_PRESETS.bw;
  if (typeof style === 'string') {
    if (!STYLE_PRESETS[style]) {
      throw new Error(`Unknown style preset: '${style}'. Available: ${Object.keys(STYLE_PRESETS).join(', ')}`);
    }
    return STYLE_PRESETS[style];
  }
  return style;
}

function buildState(spec, sandbox) {
  const grid = { ...GRID_DEFAULTS, ...(spec.grid || {}) };

  // 表示項目: displayPreset（js/styles.js の DISPLAY_PRESETS）を先に適用し、
  // spec.display の個別キーで上書きする（UI の「プリセットボタン →
  // チェックボックス個別変更」と同じメンタルモデル）。どちらも未指定なら
  // showXxx キー自体を gridConfig に入れない（renderer は showXxx !== false
  // 判定なので、欠落＝全表示の従来動作のまま）。
  if (spec.displayPreset) {
    const preset = sandbox.DISPLAY_PRESETS && sandbox.DISPLAY_PRESETS[spec.displayPreset];
    if (!preset) {
      throw new Error(`Unknown displayPreset: '${spec.displayPreset}'. Available: ${Object.keys(sandbox.DISPLAY_PRESETS || {}).join(', ')}`);
    }
    Object.assign(grid, preset);
  }
  if (spec.display) Object.assign(grid, spec.display);

  // 文字サイズ。fontSize > 12 のときは MotionGraphRenderer のコンストラクタ／
  // computeCanvasSize と同じ padScale 式で既定 padding も拡大する
  // （GRID_DEFAULTS の固定 52/32/44 が renderer 側のスケール済み既定値を
  //   上書きしてしまい、Canvas サイズ計算と描画位置がズレるのを防ぐ）。
  // 呼び出し側が spec.grid で padding を明示した場合はそちらを尊重する。
  if (spec.fontSize !== undefined) {
    grid.fontSize = spec.fontSize;
    const padScale = Math.max(1, spec.fontSize / 12);
    if (padScale > 1) {
      const explicit = spec.grid || {};
      if (explicit.paddingLeft   === undefined) grid.paddingLeft   = Math.round(GRID_DEFAULTS.paddingLeft   * padScale);
      if (explicit.paddingRight  === undefined) grid.paddingRight  = Math.round(GRID_DEFAULTS.paddingRight  * padScale);
      if (explicit.paddingTop    === undefined) grid.paddingTop    = Math.round(GRID_DEFAULTS.paddingTop    * padScale);
      if (explicit.paddingBottom === undefined) grid.paddingBottom = Math.round(GRID_DEFAULTS.paddingBottom * padScale);
    }
  }

  return {
    gridConfig: grid,
    styleConfig: resolveStyle(spec.style, sandbox.STYLE_PRESETS),
    cellSize: spec.cellSize || { w: null, h: null },
  };
}

/**
 * spec のグラフ JSON を MotionGraph または StepMotionGraph インスタンスに変換する。
 * kind === 'vt-step' のときだけ StepMotionGraph を構築する
 * （StepMotionGraph.kind は固定でコンストラクタが設定するため、
 *   fromJSON 相当のフィールド代入を個別に行う — kind 自体は上書きしない）。
 */
function buildGraph(json, sandbox) {
  if (!json) return null;
  if (json.kind === 'vt-step') {
    const g = new sandbox.StepMotionGraph();
    g.tStart = json.tStart;
    g.values = [...json.values];
    g.x0 = json.x0 ?? 0;
    g.label = json.label ?? 'A';
    return g;
  }
  return new sandbox.MotionGraph().fromJSON(json);
}

/** askFor を必ず配列形式に正規化する（graphConversion は複数可、他は単一） */
function normalizeAskFor(askFor) {
  return Array.isArray(askFor) ? askFor : [askFor];
}

/**
 * spec をディスパッチして KinematicsProblemGenerator のメソッドを呼び出す。
 * legacy の callGenerator() に相当（タイプによって生成メソッドを振り分ける）。
 */
function callGenerator(gen, spec, sandbox) {
  const source = buildGraph(spec.source, sandbox);
  // sourceKind / x0 は MotionGraph 自身のフィールドを上書きする形で渡す
  // （KinematicsProblemGenerator の各メソッドが行う source.kind 上書きと整合）
  const sourceKind = spec.sourceKind || source.kind;
  const x0 = spec.x0 !== undefined ? spec.x0 : source.x0;

  switch (spec.type) {
    case 'graphConversion':
      return gen.generateGraphConversion({
        source, sourceKind,
        askFor: normalizeAskFor(spec.askFor),
        x0,
      });

    case 'numeric':
      return gen.generateNumeric({
        source, sourceKind,
        subtype: spec.subtype,
        params: spec.params || {},
      });

    case 'graphChoice': {
      const distractors = (spec.choices?.distractors || []);
      return gen.generateGraphChoice({
        source, sourceKind,
        askFor: Array.isArray(spec.askFor) ? spec.askFor[0] : spec.askFor,
        distractors,
        x0,
        shuffle: spec.choices?.shuffle !== false,
      });
    }

    default:
      throw new Error(`Unknown problem type: ${spec.type}`);
  }
}

/**
 * y 軸範囲を自動調整する。
 * spec.grid に yMin / yMax が明示されていない場合のみ実行し、
 * 手描きグラフ（および導出後の x-t / a-t）の最大絶対値 + 1 を
 * 対称な上下限として state.gridConfig を上書きする。
 *
 * legacy の autoAdjustYRange（合成波の最大振幅を走査）に相当するが、
 * このアプリでは「導出済みカーブの値域」が既に Kinematics 側で
 * 解析的に求まる（区分多項式の頂点・端点を見れば良い）ため、
 * サンプリングではなく Curve のセグメント端点を走査して最大絶対値を求める。
 */
function autoAdjustYRange(spec, state, sandbox) {
  // yMin または yMax が明示指定されていたらスキップ
  if (spec.grid && (spec.grid.yMin !== undefined || spec.grid.yMax !== undefined)) return;

  const source = buildGraph(spec.source, sandbox);
  if (!source || source.isEmpty()) return;

  // KinematicsProblemGenerator._deriveForSource（js/problems.js）と同じ分岐に揃える。
  // StepMotionGraph.kind は固定（'vt-step'）のため、その場合は kind の上書きをしない。
  const sourceKind = spec.sourceKind || source.kind;
  let derived;
  if (sourceKind === 'vt-step') {
    if (spec.x0 !== undefined) source.x0 = spec.x0;
    derived = sandbox.Kinematics.deriveFromVTStep(source);
  } else {
    if (sourceKind !== source.kind) source.kind = sourceKind;
    if (sourceKind === 'vt') {
      source.x0 = (spec.x0 !== undefined) ? spec.x0 : (source.x0 ?? 0);
    }
    derived = (sourceKind === 'vt')
      ? sandbox.Kinematics.deriveFromVT(source)
      : sandbox.Kinematics.deriveFromXT(source);
  }

  let maxAbs = source.getMaxAbsValue();
  for (const kind of ['xt', 'vt', 'at']) {
    const curve = derived[kind];
    if (!curve || !curve.segments) continue;
    curve.segments.forEach(seg => {
      const dt = seg.t1 - seg.t0;
      const v0 = seg.c0;
      const v1 = seg.c0 + seg.c1 * dt + seg.c2 * dt * dt;
      // 二次区間（c2 != 0）の極値も考慮する（放物線の頂点が端点より大きい場合がある）
      let vMid = null;
      if (Math.abs(seg.c2) > 1e-12) {
        const dtVertex = -seg.c1 / (2 * seg.c2);
        if (dtVertex > 0 && dtVertex < dt) {
          vMid = seg.c0 + seg.c1 * dtVertex + seg.c2 * dtVertex * dtVertex;
        }
      }
      [v0, v1, vMid].forEach(v => {
        if (v !== null && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
      });
    });
  }

  if (maxAbs === 0) return;
  const newBound = Math.ceil(maxAbs) + 1;
  state.gridConfig.yMin = -newBound;
  state.gridConfig.yMax =  newBound;
}

module.exports = {
  GRID_DEFAULTS,
  resolveStyle,
  buildState,
  buildGraph,
  normalizeAskFor,
  callGenerator,
  autoAdjustYRange,
};
