'use strict';

// MotionGraphRenderer.DEFAULT_PADDING と同じ値を既定として使う
// （state.gridConfig は描画ヘルパーにそのまま渡されるため、未指定項目を
//   ここで埋めておく必要がある — legacy の GRID_DEFAULTS と同じ役割）。
const GRID_DEFAULTS = {
  xMin: 0, xMax: 10, yMin: -2, yMax: 2,
  paddingLeft: 52, paddingRight: 52, paddingTop: 32, paddingBottom: 44,
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
  return {
    gridConfig: grid,
    styleConfig: resolveStyle(spec.style, sandbox.STYLE_PRESETS),
    cellSize: spec.cellSize || { w: null, h: null },
  };
}

/** spec のグラフ JSON を MotionGraph インスタンスに変換する */
function buildGraph(json, sandbox) {
  if (!json) return null;
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

  const sourceKind = spec.sourceKind || source.kind;
  if (sourceKind !== source.kind) source.kind = sourceKind;
  if (sourceKind === 'vt') {
    source.x0 = (spec.x0 !== undefined) ? spec.x0 : (source.x0 ?? 0);
  }

  const derived = (sourceKind === 'vt')
    ? sandbox.Kinematics.deriveFromVT(source)
    : sandbox.Kinematics.deriveFromXT(source);

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
