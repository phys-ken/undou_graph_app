/**
 * STYLE_PRESETS - 運動グラフ描画スタイルプリセット定義
 *
 * bw    : 白黒印刷最適（アプリのデフォルト）。グリッドは薄灰色の破線、
 *         x-t/v-t/a-t の3曲線は線幅・破線パターンを変えて区別する。
 * color : ブラウザ閲覧・カラー印刷向け。日本の物理教科書の慣習に倣い
 *         x-t=青／v-t=緑／a-t=赤 で色分けする（legacy の未使用 gray を置換）。
 *
 * 各カーブ要素のフィールド（drawCurve / drawPolyline 共通）:
 *   color       : CSS 色文字列
 *   lineWidth   : 線幅（論理ピクセル）
 *   dashed      : true=破線, false=実線
 *   dashPattern : [実部, 空部, ...] — dashed=true のときのみ参照
 *
 * riser（不連続点の段差を表す垂直線）:
 *   color, lineWidth, dashed, dashPattern を持つ。drawDiscontinuity が使用。
 *
 * undefined（微分不能点 = 「未定義の瞬間」マーカー）:
 *   color       : 線・円・ラベルの色
 *   lineWidth   : ガイド線・円の線幅
 *   dashPattern : ガイド線の破線パターン
 *   radius      : 円マーカーの半径（論理ピクセル）
 *   font        : ラベル（"?"）のフォント指定
 * drawUndefinedMarker が使用。教師が「この瞬間は加速度が定義できない」と
 * 一目で気づけるよう、通常の線とは明確に異なる見た目にする。
 *
 * fill（v-t グラフ等での「面積=変位」を示す塗りつぶし領域）:
 *   fill.positive / fill.negative の2種類を持つ。各々:
 *     pattern : 'solid' | 'diagonal' | 'cross' | 'dots'
 *               'solid' は半透明単色塗り。それ以外はハッチングパターンで、
 *               白黒印刷でも正負の領域が視覚的に区別できるようにする。
 *     color   : 塗り・パターン線の色
 *     alpha   : 不透明度 (0〜1)
 *     spacing : ハッチングの線/点の間隔（論理ピクセル、pattern!=='solid' のみ参照）
 *     lineWidth: ハッチング線の太さ（pattern が 'diagonal'/'cross' のとき参照）
 *     dotRadius: 'dots' パターンの点の半径
 * drawFilledArea が使用。
 */
const STYLE_PRESETS = {
  bw: {
    grid: { color: '#999999', lineWidth: 0.8, dashed: true, dashPattern: [2, 3] },

    xt: { color: '#000000', lineWidth: 3,   dashed: false, dashPattern: [] },
    vt: { color: '#000000', lineWidth: 2,   dashed: true,  dashPattern: [10, 4] },
    at: { color: '#000000', lineWidth: 1.5, dashed: true,  dashPattern: [3, 3] },

    riser: { color: '#666666', lineWidth: 1, dashed: true, dashPattern: [4, 3] },

    undefinedMark: {
      color: '#000000',
      lineWidth: 1.2,
      dashPattern: [3, 2],
      radius: 9,
      font: 'bold 12px serif',
    },

    fill: {
      positive: { pattern: 'diagonal', color: '#000000', alpha: 0.35, spacing: 7, lineWidth: 1 },
      negative: { pattern: 'cross',    color: '#000000', alpha: 0.35, spacing: 7, lineWidth: 1 },
    },
  },

  color: {
    grid: { color: '#cccccc', lineWidth: 0.5, dashed: false, dashPattern: [4, 4] },

    xt: { color: '#1f5fbf', lineWidth: 2.5, dashed: false, dashPattern: [] }, // 青
    vt: { color: '#1f9e4c', lineWidth: 2.5, dashed: false, dashPattern: [] }, // 緑
    at: { color: '#d6332f', lineWidth: 2.5, dashed: false, dashPattern: [] }, // 赤

    riser: { color: '#888888', lineWidth: 1.2, dashed: true, dashPattern: [5, 3] },

    undefinedMark: {
      color: '#d6332f',
      lineWidth: 1.4,
      dashPattern: [3, 2],
      radius: 9,
      font: 'bold 12px serif',
    },

    fill: {
      positive: { pattern: 'solid', color: '#1f9e4c', alpha: 0.25 },
      negative: { pattern: 'solid', color: '#d6332f', alpha: 0.25 },
    },
  },
};

/** プリセットをディープコピーして返す（直接変更防止） */
function cloneStylePreset(preset) {
  return JSON.parse(JSON.stringify(preset));
}

/**
 * グラフ表示項目トグルのキー一覧（MotionGraphRenderer の config.showXxx に対応）
 *
 * showUndefinedMark は「未定義 "?" マーカー」と「面積塗りつぶし」の統合トグル
 * （drawUndefinedMarker / drawFilledArea の両方が同じキーを参照する）。
 * showZeroLine は showAxes=false のときだけ意味を持つ（通常は t 軸が y=0 線を兼ねる）。
 *
 * UI（App.displayOptions / index.html のチェックボックス）と
 * REST API（spec.display / spec.displayPreset）の両方から参照される
 * 単一情報源としてここに置く（app.js は API サンドボックスに読み込まれないため）。
 */
const DISPLAY_OPTION_KEYS = [
  'showGrid', 'showAxes',
  'showTicksX', 'showTicksY',
  'showUnitX', 'showUnitY',
  'showAxisLabelX', 'showAxisLabelY',
  'showZeroLine', 'showLegend', 'showUndefinedMark',
];

/**
 * 表示項目プリセット定義
 *
 * - all              : 標準（全項目 ON）
 * - qualitative      : 定性的（軸・軸ラベル・y=0線・"?"マーカーのみ）
 * - qualitative-grid : 定性的 + グリッド
 * - shape-only       : 概形のみ（軸ラベル・単位・目盛・凡例など、どの物理量の
 *                      グラフかを特定できる情報を全て隠す — グラフ概形選択問題用）
 *
 * showUndefinedMark は全プリセットで ON（「曖昧さを非表示にしない」原則。
 * 手動トグル／API の display 個別指定でのみ OFF にできる）。
 */
const DISPLAY_PRESETS = {
  'all': {
    showGrid: true, showAxes: true,
    showTicksX: true, showTicksY: true,
    showUnitX: true, showUnitY: true,
    showAxisLabelX: true, showAxisLabelY: true,
    showZeroLine: true, showLegend: true, showUndefinedMark: true,
  },
  'qualitative': {
    showGrid: false, showAxes: true,
    showTicksX: false, showTicksY: false,
    showUnitX: false, showUnitY: false,
    showAxisLabelX: true, showAxisLabelY: true,
    showZeroLine: true, showLegend: false, showUndefinedMark: true,
  },
  'qualitative-grid': {
    showGrid: true, showAxes: true,
    showTicksX: false, showTicksY: false,
    showUnitX: false, showUnitY: false,
    showAxisLabelX: true, showAxisLabelY: true,
    showZeroLine: true, showLegend: false, showUndefinedMark: true,
  },
  'shape-only': {
    showGrid: false, showAxes: true,
    showTicksX: false, showTicksY: false,
    showUnitX: false, showUnitY: false,
    showAxisLabelX: false, showAxisLabelY: false,
    showZeroLine: true, showLegend: false, showUndefinedMark: true,
  },
};
