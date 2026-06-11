/**
 * MotionGraphRenderer - HTML5 Canvas への運動グラフ（x-t / v-t / a-t）描画
 *
 * legacy_nami_app の WaveRenderer をフォークしたもの。
 * pixelRatio: 1 = 画面表示用、2 = 印刷・PDF 出力用（2x 高解像度）
 * 白黒印刷対応（実線・破線・太線で区別）
 *
 * WaveRenderer との主な違い:
 *   - drawWave(points:{x,y}) → drawPolyline(points:{t,value})（フィールド名を運動グラフに合わせて一般化）
 *   - drawCurve / drawDiscontinuity / drawUndefinedMarker / drawFilledArea を新規追加
 *     （Kinematics が生成する区分多項式 Curve を描画するため）
 *   - 反射波専用の drawBeyondMediumRegion / drawBoundaryLine は移植しない
 *   - drawTimeLabel / renderFull は意図的に移植しない:
 *     波アプリは「時刻 t のスナップショット」を主軸にしていたが、運動グラフの
 *     設問は基本的に固定された x-t/v-t/a-t のグラフそのものを表示・読み取らせる
 *     形式が中心になる見込みで、「時刻ラベルを右上に出す」UI は本質的ではない。
 *     呼び出し側（ProblemGenerator 等）が drawGrid/drawAxes/drawCurve/drawLegend
 *     等を組み合わせて描画フローを構成する方が、運動グラフ特有の要素
 *     （riser・undefined マーカー・面積塗りつぶし）を含む複雑な合成に対して
 *     柔軟である。必要になれば legacy の実装をそのまま移植できる。
 */
class MotionGraphRenderer {
  // ── デフォルト定数（cellSize 未指定時の Canvas 寸法）─────────────────
  static DEFAULT_DISP_W = 580;
  static DEFAULT_DISP_H = 200;
  // right はこのアプリの長い x 軸ラベル「時刻 t [s]」（12px で約 58px 必要）が
  // 収まる幅にする。legacy/nami の 52 ではラベル末尾の "]" がクリップされる
  // （nami のラベル 'x [cm]' は約 38px で 52 に収まっていた — このアプリ固有の問題）。
  static DEFAULT_PADDING = { left: 52, right: 68, top: 32, bottom: 44 };
  // cellSize の許容範囲（極端値で文字が重なるのを防ぐ）
  static CELL_PX_MIN = 15;
  static CELL_PX_MAX = 120;

  /**
   * gridConfig と cellSize から Canvas の論理寸法を計算する
   *
   * cellSize.w / cellSize.h が null/undefined/0 のとき → デフォルト寸法を返す
   * 指定があるときは (range * cellPx + padding) で算出
   *
   * gridConfig.fontSize が 12 を超えるときは、長くなる軸ラベル・目盛り数値が
   * クリッピングしないよう padding を fontSize/12 倍に拡大する
   * （プロット領域のサイズは保ち、余白だけ広げる。nami アプリと同じ方式）。
   *
   * @param {Object} gridConfig { xMin, xMax, yMin, yMax, [fontSize] }
   * @param {Object} [cellSize] { w, h } 各々 null=自動
   * @param {Object} [padding]  { left, right, top, bottom } 省略時は DEFAULT_PADDING
   * @returns {{ width: number, height: number }} 論理ピクセル
   */
  static computeCanvasSize(gridConfig, cellSize, padding) {
    const cs  = cellSize || {};
    const fontSize = gridConfig.fontSize || 12;
    const padScale = Math.max(1, fontSize / 12);
    const basePad  = padding || MotionGraphRenderer.DEFAULT_PADDING;
    const pad = {
      left:   Math.round(basePad.left   * padScale),
      right:  Math.round(basePad.right  * padScale),
      top:    Math.round(basePad.top    * padScale),
      bottom: Math.round(basePad.bottom * padScale),
    };
    const xRange = gridConfig.xMax - gridConfig.xMin;
    const yRange = gridConfig.yMax - gridConfig.yMin;

    const width  = (cs.w && cs.w > 0)
      ? Math.round(xRange * cs.w + pad.left + pad.right)
      : (MotionGraphRenderer.DEFAULT_DISP_W - basePad.left - basePad.right)
        + pad.left + pad.right;
    const height = (cs.h && cs.h > 0)
      ? Math.round(yRange * cs.h + pad.top + pad.bottom)
      : (MotionGraphRenderer.DEFAULT_DISP_H - basePad.top - basePad.bottom)
        + pad.top + pad.bottom;

    return { width, height };
  }

  /**
   * 軸範囲に対して見やすい目盛り間隔（1, 2, 5 の10進倍数）を計算する
   * 値の範囲が大きいとき（例: 位置 0〜30m）に整数ごとの目盛りでは
   * ラベルが重なって判読不能になるため、おおよそ maxTicks 本に収まる
   * 「きりのいい」間隔を選ぶ。
   *
   * @param {number} range    軸の範囲（max - min）
   * @param {number} [maxTicks=10] 目安とする目盛り本数の上限
   * @returns {number} 目盛り間隔（>0）
   */
  static computeTickStep(range, maxTicks = 10) {
    if (!(range > 0)) return 1;
    const rough = range / maxTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const candidates = [1, 2, 5, 10];
    for (const c of candidates) {
      const step = c * mag;
      if (range / step <= maxTicks) return step;
    }
    return 10 * mag;
  }

  /**
   * フォントサイズに応じた目盛り本数の上限を返す
   *
   * 目盛り数値の文字が大きくなるほど1ラベルが占める高さ/幅も増えるのに、
   * computeTickStep が値域だけで間隔を決めると、プロット領域のピクセル数は
   * 変わらない（padScale は余白だけ広げる設計）ため、フォント拡大時に
   * ラベル同士が重なって判読不能になる。フォントサイズに反比例して
   * 本数上限を絞ることで、目盛り間隔のピクセル数／文字高さの比を
   * 既定（12px・10本）と同等以上に保つ。
   *
   * 12px 以下では base のまま（従来挙動と完全互換）。
   * 例: base=10 のとき 12px→10本, 16px→7本, 20px→6本, 24px→5本。
   *
   * @param {number} fontSize グラフ内テキストのフォントサイズ（px）
   * @param {number} [base=10] 12px 時の本数上限
   * @returns {number} 目盛り本数の上限（最低 3）
   */
  static computeFontAwareMaxTicks(fontSize, base = 10) {
    const fs = fontSize || 12;
    return Math.max(3, Math.floor(base * 12 / Math.max(12, fs)));
  }

  /** config の fontSize を考慮した x/y 目盛り間隔を返す（drawGrid / drawAxes 共用） */
  _tickSteps() {
    const c = this.config;
    const maxTicks = MotionGraphRenderer.computeFontAwareMaxTicks(c.fontSize);
    return {
      xStep: MotionGraphRenderer.computeTickStep(c.xMax - c.xMin, maxTicks),
      yStep: MotionGraphRenderer.computeTickStep(c.yMax - c.yMin, maxTicks),
    };
  }

  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    const pr = config.pixelRatio || 1;
    this.pixelRatio    = pr;
    this.logicalWidth  = canvas.width  / pr;
    this.logicalHeight = canvas.height / pr;

    if (pr !== 1) {
      this.ctx.scale(pr, pr);
    }

    // fontSize > 12 のときは computeCanvasSize と同じ比率で既定 padding を拡大
    // （呼び出し側が明示的に paddingXxx を渡した場合はそちらを優先）
    const fontSize = config.fontSize || 12;
    const padScale = Math.max(1, fontSize / 12);
    const dp = MotionGraphRenderer.DEFAULT_PADDING;
    this.config = Object.assign({
      xMin: 0,  xMax: 10,
      yMin: -2, yMax: 2,
      paddingLeft:   Math.round(dp.left   * padScale),
      paddingRight:  Math.round(dp.right  * padScale),
      paddingTop:    Math.round(dp.top    * padScale),
      paddingBottom: Math.round(dp.bottom * padScale),
    }, config);
  }

  updateConfig(config) {
    Object.assign(this.config, config);
    this.logicalWidth  = this.canvas.width  / this.pixelRatio;
    this.logicalHeight = this.canvas.height / this.pixelRatio;
  }

  /** ワールド座標 (t, value) → 論理ピクセル */
  toPixel(t, value) {
    const c = this.config;
    const W = this.logicalWidth  - c.paddingLeft - c.paddingRight;
    const H = this.logicalHeight - c.paddingTop  - c.paddingBottom;
    return {
      px: c.paddingLeft + (t - c.xMin) / (c.xMax - c.xMin) * W,
      py: c.paddingTop  + (c.yMax - value) / (c.yMax - c.yMin) * H,
    };
  }

  /** 論理ピクセル → ワールド座標 (t, value) */
  toWorld(px, py) {
    const c = this.config;
    const W = this.logicalWidth  - c.paddingLeft - c.paddingRight;
    const H = this.logicalHeight - c.paddingTop  - c.paddingBottom;
    return {
      t:     c.xMin + (px - c.paddingLeft) / W * (c.xMax - c.xMin),
      value: c.yMax - (py - c.paddingTop)  / H * (c.yMax - c.yMin),
    };
  }

  clear() {
    this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
  }

  drawGrid() {
    const c = this.config;
    if (c.showGrid === false) return;
    const ctx = this.ctx;
    // gridStyle が未指定のときは bw プリセット相当をフォールバック
    const gs  = c.gridStyle || { color: '#999999', lineWidth: 0.8, dashed: true, dashPattern: [2, 3] };
    ctx.save();
    ctx.strokeStyle = gs.color;
    ctx.lineWidth   = gs.lineWidth;
    ctx.setLineDash(gs.dashed ? (gs.dashPattern || [4, 4]) : []);

    const { py: yTop }    = this.toPixel(0, c.yMax);
    const { py: yBottom } = this.toPixel(0, c.yMin);
    const { px: xLeft }   = this.toPixel(c.xMin, 0);
    const { px: xRight }  = this.toPixel(c.xMax, 0);

    const { xStep, yStep } = this._tickSteps();

    for (let x = Math.ceil(c.xMin / xStep) * xStep; x <= c.xMax + 1e-9; x += xStep) {
      const { px } = this.toPixel(x, 0);
      ctx.beginPath(); ctx.moveTo(px, yTop); ctx.lineTo(px, yBottom); ctx.stroke();
    }
    for (let y = Math.ceil(c.yMin / yStep) * yStep; y <= c.yMax + 1e-9; y += yStep) {
      const { py } = this.toPixel(0, y);
      ctx.beginPath(); ctx.moveTo(xLeft, py); ctx.lineTo(xRight, py); ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 軸・ラベル・目盛り描画
   *
   * 運動グラフでは軸ラベルが日本語の物理記法（例: '時刻 t [s]'・'位置 x [m]'・
   * '速度 v [m/s]'・'加速度 a [m/s²]'）になり、legacy の 'x [cm]' 等より
   * 文字列が長くなる。そのため左右の余白に収まるよう x 軸ラベルは
   * グラフ右端から少し離した位置に描画し、フォントは標準の 12px を維持
   * しつつ textAlign/textBaseline で位置調整することでクリッピングを防ぐ
   * （DEFAULT_PADDING も legacy と同じ余白を確保しているため、通常の
   * ラベル長であれば追加調整なしで収まる）。
   *
   * @param {Object} options { xLabel, yLabel } 呼び出し側が運動の種類
   *   （x-t / v-t / a-t）に応じた日本語ラベルを渡す
   */
  drawAxes(options = {}) {
    const ctx = this.ctx;
    const c   = this.config;
    // 表示項目トグル（config.showXxx === false のときのみ非表示。
    // キー欠落時は従来どおり全て表示＝後方互換）
    // showUnitX/Y=false: ラベルから単位部分 "[s]" 等だけ除去（ラベル本体は残す）
    let xLabel = options.xLabel || '時刻 t [s]';
    let yLabel = options.yLabel || '値';
    if (c.showUnitX === false) xLabel = xLabel.replace(/\s*\[.*?\]/g, '');
    if (c.showUnitY === false) yLabel = yLabel.replace(/\s*\[.*?\]/g, '');

    const baseSize = c.fontSize || 12;
    const padScale = Math.max(1, baseSize / 12);

    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.fillStyle   = '#000000';
    ctx.lineWidth   = 2;
    ctx.setLineDash([]);

    const { px: xLeft }   = this.toPixel(c.xMin, 0);
    const { px: xRight }  = this.toPixel(c.xMax, 0);
    const { py: yAxis }   = this.toPixel(0, 0);
    const { py: yTop }    = this.toPixel(0, c.yMax);
    const { py: yBottom } = this.toPixel(0, c.yMin);
    // xMin > 0 のとき x=0 が画面外になるので、y軸をグラフ左端に描く
    const xAxis = c.xMin >= 0 ? Math.max(xLeft, this.toPixel(0, 0).px) : this.toPixel(0, 0).px;

    if (c.showAxes !== false) {
      // t 軸（横軸）
      ctx.beginPath();
      ctx.moveTo(xLeft, yAxis);
      ctx.lineTo(xRight + 14, yAxis);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xRight + 14, yAxis);
      ctx.lineTo(xRight + 6,  yAxis - 4);
      ctx.lineTo(xRight + 6,  yAxis + 4);
      ctx.closePath();
      ctx.fill();

      // 値の軸（縦軸）
      ctx.beginPath();
      ctx.moveTo(xAxis, yBottom);
      ctx.lineTo(xAxis, yTop - 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xAxis,     yTop - 14);
      ctx.lineTo(xAxis - 4, yTop - 6);
      ctx.lineTo(xAxis + 4, yTop - 6);
      ctx.closePath();
      ctx.fill();
    } else if (c.showZeroLine !== false) {
      // 軸非表示時のみの y=0 基準線。通常（showAxes=true）は t 軸そのものが
      // y=0 の線を兼ねるため、showZeroLine は showAxes=false のときだけ
      // 意味を持つ（nami と異なり軸と基準線が同一直線のため）。
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(xLeft, yAxis);
      ctx.lineTo(xRight, yAxis);
      ctx.stroke();
      ctx.restore();
    }

    // 軸ラベル（日本語の長いラベルでもクリッピングしないよう右端から
    // 余白方向にはみ出して描画する。textAlign='left' なのでラベル開始位置
    // を基準に右へ伸びる。paddingRight 内に収まる長さを想定。）
    // showAxisLabelX/Y=false でラベル全体を非表示（概形選択問題用 —
    // ラベルがあるとどの物理量のグラフか分かってしまうため）。
    ctx.font = `${baseSize}px sans-serif`;
    if (c.showAxisLabelX !== false) {
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      // ラベルが Canvas 右端からはみ出さないよう実測幅でクランプする
      // （paddingRight は既定ラベルが収まる幅にしてあるが、カスタムの長い
      //   ラベルや明示指定の狭い padding でもクリップだけは防ぐ保険）。
      const labelW  = ctx.measureText(xLabel).width;
      const labelX  = Math.min(
        xRight + Math.round(8 * padScale),
        this.logicalWidth - 2 - labelW
      );
      ctx.fillText(xLabel, Math.max(labelX, xRight + 2), yAxis + 4);
    }
    if (c.showAxisLabelY !== false) {
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(yLabel, xAxis, yTop - 16);
    }

    // t 軸目盛り（範囲が広いとき・フォントが大きいときはラベル重複を
    // 避けるため間隔を自動選択 — drawGrid と同じ _tickSteps() を共有）
    const { xStep, yStep } = this._tickSteps();
    const fmtTick = (v, step) => (step < 1 ? v.toFixed(1) : String(Math.round(v)));

    ctx.lineWidth = 1;
    ctx.font = `${Math.round(baseSize * 11 / 12)}px sans-serif`;
    if (c.showTicksX !== false) {
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      for (let x = Math.ceil(c.xMin / xStep) * xStep; x <= c.xMax + 1e-9; x += xStep) {
        if (Math.abs(x) < 1e-9) continue;
        const { px } = this.toPixel(x, 0);
        ctx.beginPath(); ctx.moveTo(px, yAxis - 3); ctx.lineTo(px, yAxis + 3); ctx.stroke();
        ctx.fillText(fmtTick(x, xStep), px, yAxis + 5);
      }
    }

    // 値の軸目盛り
    if (c.showTicksY !== false) {
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'middle';
      for (let y = Math.ceil(c.yMin / yStep) * yStep; y <= c.yMax + 1e-9; y += yStep) {
        if (Math.abs(y) < 1e-9) continue;
        const { py } = this.toPixel(0, y);
        ctx.beginPath(); ctx.moveTo(xAxis - 3, py); ctx.lineTo(xAxis + 3, py); ctx.stroke();
        ctx.fillText(fmtTick(y, yStep), xAxis - 5, py);
      }
    }

    // 原点 O（軸も目盛りも非表示なら原点表記も意味がないので消す）
    //
    // 既定位置は慣習どおり軸交点の左下 (xAxis - oOff, yAxis + oOff)。
    // ただし y 目盛り数値も軸の左に右揃えで並ぶため、yMin < 0 でフォントが
    // 大きい（= 1目盛りのピクセル間隔に対して文字が高い）と、軸直下の
    // 負の目盛り数値と「O」が同じ列で縦に重なる（nami 波アプリにもある問題）。
    // O のボックスと目盛り数値のボックスの交差を実測で検知し、重なる場合のみ
    // O を目盛り数値列のさらに左へ退避させる（目盛り数値は1つも隠さない）。
    if (c.showAxes !== false || c.showTicksX !== false || c.showTicksY !== false) {
      const oOff = Math.round(3 * padScale);
      const oTop = yAxis + oOff;
      let oX = xAxis - oOff;

      if (c.showTicksY !== false) {
        const tickFontPx = Math.round(baseSize * 11 / 12);
        for (let y = Math.ceil(c.yMin / yStep) * yStep; y <= c.yMax + 1e-9; y += yStep) {
          if (Math.abs(y) < 1e-9 || y > 0) continue; // 衝突しうるのは負側のみ
          const { py } = this.toPixel(0, y);
          const tickTop = py - tickFontPx / 2;
          const tickBottom = py + tickFontPx / 2;
          if (tickTop < oTop + baseSize && tickBottom > oTop) {
            // 重なる目盛り数値の実測幅ぶんだけ左へ退避
            const w = ctx.measureText(fmtTick(y, yStep)).width;
            oX = xAxis - 5 - w - Math.round(4 * padScale);
            break;
          }
        }
      }

      ctx.font = `${baseSize}px sans-serif`;
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('O', oX, oTop);
    }

    ctx.restore();
  }

  /**
   * 折れ線描画（手描き MotionGraph のスナップショット用）
   * @param {Array}  points  [{t, value}, ...]
   * @param {Object} style   { lineWidth, dashed, dashPattern, color }
   */
  drawPolyline(points, style = {}) {
    if (!points || points.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = style.color || '#000000';
    ctx.lineWidth   = style.lineWidth ?? 2.5;
    ctx.setLineDash(style.dashed ? (style.dashPattern || [8, 5]) : []);
    ctx.lineJoin = 'round';

    ctx.beginPath();
    const first = this.toPixel(points[0].t, points[0].value);
    ctx.moveTo(first.px, first.py);
    for (let i = 1; i < points.length; i++) {
      const p = this.toPixel(points[i].t, points[i].value);
      ctx.lineTo(p.px, p.py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Curve（Kinematics が生成する区分多項式表現）を描画する
   *
   * 各セグメントを [tMin, tMax] にクリップしながら密にサンプリングし
   * （目安: 1時間単位あたり約20点）、value(t) = c0 + c1*dt + c2*dt^2
   * で評価して折れ線として描く。c2 = 0（直線）でも c2 ≠ 0（放物線）でも
   * 同じサンプリング＋ポリライン描画で正しい見た目になる。
   *
   * @param {Curve}  curve
   * @param {Object} style { lineWidth, dashed, dashPattern, color }
   * @param {number} tMin
   * @param {number} tMax
   */
  drawCurve(curve, style = {}, tMin, tMax) {
    if (!curve || !curve.segments || curve.segments.length === 0) return;
    const SAMPLES_PER_UNIT = 20;

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = style.color || '#000000';
    ctx.lineWidth   = style.lineWidth ?? 2.5;
    ctx.setLineDash(style.dashed ? (style.dashPattern || [8, 5]) : []);
    ctx.lineJoin = 'round';

    curve.segments.forEach(seg => {
      const segT0 = Math.max(seg.t0, tMin);
      const segT1 = Math.min(seg.t1, tMax);
      if (segT1 <= segT0) return;

      const span = segT1 - segT0;
      const n = Math.max(1, Math.ceil(span * SAMPLES_PER_UNIT));

      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= n; i++) {
        const t = segT0 + (span * i) / n;
        const dt = t - seg.t0;
        const value = seg.c0 + seg.c1 * dt + seg.c2 * dt * dt;
        const { px, py } = this.toPixel(t, value);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    });

    ctx.restore();
  }

  /**
   * 不連続点（段差）の「リサー」を描画する
   * 値が valueBefore → valueAfter へ瞬間的に飛ぶ箇所を、時刻 t における
   * 縦線（破線等）で結んで視覚的に表す（階段状グラフの段差表現）。
   *
   * @param {number} t            不連続が起きる時刻
   * @param {number} valueBefore  直前のセグメントの終端値
   * @param {number} valueAfter   直後のセグメントの始端値
   * @param {Object} style        { color, lineWidth, dashed, dashPattern }
   */
  drawDiscontinuity(t, valueBefore, valueAfter, style = {}) {
    if (valueBefore === valueAfter) return;
    const ctx = this.ctx;
    const a = this.toPixel(t, valueBefore);
    const b = this.toPixel(t, valueAfter);
    ctx.save();
    ctx.strokeStyle = style.color || '#666666';
    ctx.lineWidth   = style.lineWidth ?? 1;
    ctx.setLineDash(style.dashed === false ? [] : (style.dashPattern || [4, 3]));
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 「未定義の瞬間」マーカーを描画する
   * 微分が物理的に定義できない時刻（例: x-t グラフの角での加速度）に、
   * 縦の破線ガイド＋破線円のアウトライン＋"?" ラベルを重ねて表示する。
   * 通常の曲線とは明確に異なる見た目にすることで、教師が一目で
   * 「この瞬間は議論できない／曖昧である」と認識できるようにする。
   *
   * @param {number} t      未定義となる時刻
   * @param {Object} style  { color, lineWidth, dashPattern, radius, font }
   */
  drawUndefinedMarker(t, style = {}) {
    const c = this.config;
    // showUndefinedMark は "?" マーカーと面積塗りつぶし（drawFilledArea）の統合トグル
    if (c.showUndefinedMark === false) return;
    const ctx = this.ctx;
    const color   = style.color || '#000000';
    const lw      = style.lineWidth ?? 1.2;
    const dash    = style.dashPattern || [3, 2];
    const radius  = style.radius ?? 9;
    const font    = style.font || `bold ${c.fontSize || 12}px serif`;

    const { px }       = this.toPixel(t, 0);
    const { py: yTop } = this.toPixel(0, c.yMax);
    const { py: yBot } = this.toPixel(0, c.yMin);
    const { py: yMid } = this.toPixel(0, (c.yMax + c.yMin) / 2);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineWidth   = lw;

    // 縦の破線ガイド
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(px, yTop);
    ctx.lineTo(px, yBot);
    ctx.stroke();

    // 破線の円アウトライン（グラフ中央の高さに配置）
    ctx.beginPath();
    ctx.arc(px, yMid, radius, 0, Math.PI * 2);
    ctx.stroke();

    // "?" ラベル
    ctx.setLineDash([]);
    ctx.font = font;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', px, yMid);

    ctx.restore();
  }

  /**
   * カーブと value=0 の基準線で囲まれた領域（面積）を塗りつぶす
   * v-t グラフにおける「変位 = 面積」を可視化する用途を想定。
   *
   * @param {Curve} curve       塗りつぶし対象のカーブ
   * @param {Array} intervals   [{t0, t1}, ...] 塗りつぶす時間区間（呼び出し側が選択）
   * @param {Object} fillStyles { positive, negative } 各区間の値の符号で使い分ける
   *   各 fillStyle: { pattern: 'solid'|'diagonal'|'cross'|'dots', color, alpha,
   *                   spacing, lineWidth, dotRadius }
   */
  drawFilledArea(curve, intervals, fillStyles = {}) {
    // showUndefinedMark は "?" マーカー（drawUndefinedMarker）との統合トグル
    if (this.config.showUndefinedMark === false) return;
    if (!curve || !curve.segments || curve.segments.length === 0) return;
    if (!intervals || intervals.length === 0) return;
    const SAMPLES_PER_UNIT = 20;
    const ctx = this.ctx;

    intervals.forEach(({ t0, t1 }) => {
      if (t1 <= t0) return;

      // この区間内のサンプル点を集める（区間と重なる全セグメントを横断）
      const samples = [];
      curve.segments.forEach(seg => {
        const segT0 = Math.max(seg.t0, t0);
        const segT1 = Math.min(seg.t1, t1);
        if (segT1 <= segT0) return;
        const span = segT1 - segT0;
        const n = Math.max(1, Math.ceil(span * SAMPLES_PER_UNIT));
        for (let i = 0; i <= n; i++) {
          const t = segT0 + (span * i) / n;
          const dt = t - seg.t0;
          const value = seg.c0 + seg.c1 * dt + seg.c2 * dt * dt;
          // セグメント境界の重複点を避ける
          if (samples.length > 0) {
            const last = samples[samples.length - 1];
            if (Math.abs(last.t - t) < 1e-9) return;
          }
          samples.push({ t, value });
        }
      });
      if (samples.length < 2) return;

      // 区間の符号判定（平均値で正負を決める）
      const avg = samples.reduce((s, p) => s + p.value, 0) / samples.length;
      const fillStyle = (avg < 0) ? fillStyles.negative : fillStyles.positive;
      if (!fillStyle) return;

      // 閉じたポリゴン: カーブ点列 → 終点での基準線 → 始点での基準線 → 閉路
      const polygon = samples.map(p => this.toPixel(p.t, p.value));
      const baselineEnd   = this.toPixel(samples[samples.length - 1].t, 0);
      const baselineStart = this.toPixel(samples[0].t, 0);
      polygon.push(baselineEnd, baselineStart);

      this._fillPolygon(polygon, fillStyle);
    });
  }

  /**
   * 閉路ポリゴンを指定スタイルで塗りつぶす内部ヘルパー
   * pattern が 'solid'（または未指定）なら半透明単色塗り、それ以外は
   * クリッピングしてからハッチングパターン（斜線・クロス・ドット）を描く。
   * @param {Array} polygon [{px, py}, ...]
   * @param {Object} fillStyle { pattern, color, alpha, spacing, lineWidth, dotRadius }
   */
  _fillPolygon(polygon, fillStyle) {
    if (!polygon || polygon.length < 3) return;
    const ctx = this.ctx;
    const pattern = fillStyle.pattern || 'solid';
    const color   = fillStyle.color || '#000000';
    const alpha   = fillStyle.alpha ?? 0.3;

    const buildPath = () => {
      ctx.beginPath();
      ctx.moveTo(polygon[0].px, polygon[0].py);
      for (let i = 1; i < polygon.length; i++) {
        ctx.lineTo(polygon[i].px, polygon[i].py);
      }
      ctx.closePath();
    };

    if (pattern === 'solid') {
      ctx.save();
      buildPath();
      ctx.fillStyle = this._withAlpha(color, alpha);
      ctx.fill();
      ctx.restore();
      return;
    }

    // ハッチング: クリップしてからパターンをバウンディングボックス全体に描く
    const xs = polygon.map(p => p.px);
    const ys = polygon.map(p => p.py);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    ctx.save();
    buildPath();
    ctx.clip();

    ctx.strokeStyle = this._withAlpha(color, alpha);
    ctx.fillStyle   = this._withAlpha(color, alpha);
    ctx.lineWidth   = fillStyle.lineWidth ?? 1;

    const spacing = fillStyle.spacing ?? 6;

    if (pattern === 'diagonal' || pattern === 'cross') {
      this._drawHatchLines(minX, minY, maxX, maxY, spacing, 1);
      if (pattern === 'cross') {
        this._drawHatchLines(minX, minY, maxX, maxY, spacing, -1);
      }
    } else if (pattern === 'dots') {
      const r = fillStyle.dotRadius ?? 1.4;
      for (let y = minY; y <= maxY; y += spacing) {
        for (let x = minX; x <= maxX; x += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  /**
   * 45°（または-45°）方向の平行斜線群をバウンディングボックス全体に描画する
   * @param {number} minX,minY,maxX,maxY バウンディングボックス
   * @param {number} spacing 線の間隔
   * @param {number} dir +1 = 左下→右上 ( / )、-1 = 左上→右下 ( \ )
   */
  _drawHatchLines(minX, minY, maxX, maxY, spacing, dir) {
    const ctx = this.ctx;
    const w = maxX - minX;
    const h = maxY - minY;
    const diag = w + h;
    // 対角線方向にずらしながら、ボックスを十分覆う本数の線を引く
    for (let offset = -diag; offset <= diag; offset += spacing) {
      ctx.beginPath();
      if (dir > 0) {
        // y = -(x) + offset 方向 ( / )
        ctx.moveTo(minX, maxY - offset);
        ctx.lineTo(minX + diag, maxY - offset - diag);
      } else {
        // y = x + offset 方向 ( \ )
        ctx.moveTo(minX, minY + offset);
        ctx.lineTo(minX + diag, minY + offset + diag);
      }
      ctx.stroke();
    }
  }

  /** CSS 色文字列に alpha を適用した rgba() 文字列を返す内部ヘルパー */
  _withAlpha(color, alpha) {
    // #rrggbb 形式を rgba に変換。それ以外（既に rgba 等）はそのまま alpha を無視して返す
    if (typeof color === 'string' && color[0] === '#' && color.length === 7) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  }

  /** ホバーハイライト（半透明の青丸） */
  drawHighlight(t, value) {
    const ctx = this.ctx;
    const { px, py } = this.toPixel(t, value);
    ctx.save();
    ctx.fillStyle = 'rgba(30, 120, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 頂点マーカー（黒丸） */
  drawVertex(t, value) {
    const ctx = this.ctx;
    const { px, py } = this.toPixel(t, value);
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 凡例を「グラフ下の余白」に描画（曲線と被らない）
   * @param {Array} items [{label, dashed, dashPattern, lineWidth}]
   */
  drawLegend(items) {
    const c = this.config;
    if (c.showLegend === false) return;
    const ctx = this.ctx;
    ctx.save();

    // 下余白の中央ライン
    const legendY = this.logicalHeight - c.paddingBottom / 2 + 4;
    const { px: xLeft } = this.toPixel(c.xMin, 0);

    ctx.font         = `${Math.round((c.fontSize || 12) * 11 / 12)}px serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'left';

    let ox = xLeft;
    for (const item of items) {
      const lw = item.lineWidth || 2;
      ctx.strokeStyle = item.color || '#000';
      ctx.lineWidth   = lw;
      ctx.setLineDash(item.dashed ? (item.dashPattern || [6, 4]) : []);
      ctx.beginPath();
      ctx.moveTo(ox, legendY);
      ctx.lineTo(ox + 22, legendY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#000';
      ctx.fillText(item.label, ox + 26, legendY);
      ox += 26 + ctx.measureText(item.label).width + 16;
    }
    ctx.restore();
  }
}
