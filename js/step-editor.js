/**
 * StepGraphEditor - 階段状（ガウス記号 / 床関数）v-t グラフの区間クリック入力
 *
 * MotionGraphEditor（格子点＝頂点をクリック＆ドラッグする「列ロック」方式）を
 * 「単位時間幅 1 の区間」を塗る方式に拡張したもの。頂点モデルでは
 * 「クリックした t 列の値を固定して上下にドラッグ」だったが、StepMotionGraph
 * では値は区間（半開区間 [tStart+i, tStart+i+1)）ごとに一定であるため、
 * 「クリックした区間（floor(t) で決まるインデックス）をロックして
 * 上下ドラッグでその区間の値を連続調整する」という対応する操作系にする。
 *
 * 操作方法:
 *   左クリック: クリックした位置が属する区間を floor(t) で特定し、
 *               スナップした値で塗る（StepMotionGraph.paintInterval）。
 *               以後のドラッグ中はこの区間をロックする。
 *   左クリック＋上下ドラッグ: 区間（の開始時刻）を固定したまま、
 *               マウスの上下移動に応じてその区間の値を連続的に再設定する
 *               （MotionGraphEditor._onMouseMove の列ロックと同じ考え方）。
 *               paintInterval は既存区間に対しては値の更新として働くため、
 *               同じ区間に対する再描画はべき等で安全。
 *   右クリック: クリックした位置が属する区間を端（先頭/末尾）の場合のみ
 *               削除する（StepMotionGraph.removeEdgeInterval）。内部区間は
 *               隙間を防ぐため no-op になる仕様で、エディタ側で追加の
 *               判定は不要。
 *   タッチ操作: touchstart＝塗ってロック、touchmove＝ロックした区間の値を
 *               ドラッグで調整、touchend＝ロック解除。マウス操作と同じ
 *               「区間ロック」方式に統一する。
 *
 * スナップ:
 *   区間インデックスは Math.floor(t)（半開区間 [i, i+1) の慣習に合わせる）、
 *   値は 0.5 刻み（Math.round(v*2)/2）で MotionGraph 系と統一する。
 *
 * 階段状モードは常に v-t 専用（x-t・a-t は自動導出のみで手描き対象外）
 * のため、MotionGraphEditor._axisLabels() のような種類別の出し分けは不要で、
 * 軸ラベルは「時刻 t [s]」/「速度 v [m/s]」に固定する。
 */
class StepGraphEditor {
  constructor(canvas, graph, renderer, onUpdate) {
    this.canvas   = canvas;
    this.graph    = graph;
    this.renderer = renderer;
    this.onUpdate = onUpdate || (() => {});

    this.hoverInterval = null; // ホバー中の区間情報 {index, t0, t1, value}
    this.isDragging    = false;
    this.activeInterval = null; // ドラッグ中に固定する区間インデックス（= 区間開始時刻）

    this._bindEvents();
    this.render();
  }

  _bindEvents() {
    // ハンドラ参照を保持して destroy() で確実に削除できるようにする
    this._h = {
      mousemove:   e => this._onMouseMove(e),
      mousedown:   e => this._onMouseDown(e),
      mouseup:     ()  => this._onMouseUp(),
      mouseleave:  ()  => { this.hoverInterval = null; this.isDragging = false; this.activeInterval = null; this.render(); },
      contextmenu: e => { e.preventDefault(); this._onRightClick(e); },
      touchstart: e => {
        e.preventDefault();
        const t = e.touches[0];
        const { px, py } = this._getCanvasXY(t.clientX, t.clientY);
        const index = this._intervalIndexFromPixel(px);
        const value = this._snapValue(py, true);
        this.activeInterval = index;
        this.graph.paintInterval(index, value);
        this.onUpdate();
        this.render();
      },
      touchmove: e => {
        e.preventDefault();
        if (this.activeInterval === null) return;
        const t = e.touches[0];
        const { py } = this._getCanvasXY(t.clientX, t.clientY);
        const value = this._snapValue(py, true);
        this.graph.paintInterval(this.activeInterval, value);
        this.onUpdate();
        this.render();
      },
      touchend: () => { this.activeInterval = null; },
    };

    this.canvas.addEventListener('mousemove',  this._h.mousemove);
    this.canvas.addEventListener('mousedown',  this._h.mousedown);
    this.canvas.addEventListener('mouseup',    this._h.mouseup);
    this.canvas.addEventListener('mouseleave', this._h.mouseleave);
    this.canvas.addEventListener('contextmenu', this._h.contextmenu);
    this.canvas.addEventListener('touchstart', this._h.touchstart, { passive: false });
    this.canvas.addEventListener('touchmove',  this._h.touchmove,  { passive: false });
    this.canvas.addEventListener('touchend',   this._h.touchend);
  }

  /** canvas に追加したすべてのイベントリスナーを解除する */
  destroy() {
    if (!this._h) return;
    this.canvas.removeEventListener('mousemove',  this._h.mousemove);
    this.canvas.removeEventListener('mousedown',  this._h.mousedown);
    this.canvas.removeEventListener('mouseup',    this._h.mouseup);
    this.canvas.removeEventListener('mouseleave', this._h.mouseleave);
    this.canvas.removeEventListener('contextmenu', this._h.contextmenu);
    this.canvas.removeEventListener('touchstart', this._h.touchstart);
    this.canvas.removeEventListener('touchmove',  this._h.touchmove);
    this.canvas.removeEventListener('touchend',   this._h.touchend);
    this._h = null;
  }

  _getCanvasXY(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      px: (clientX - rect.left) * (this.canvas.width  / rect.width),
      py: (clientY - rect.top)  * (this.canvas.height / rect.height),
    };
  }

  /**
   * 論理ピクセル x 座標から所属する区間のインデックス（= 区間開始時刻）を求める
   *
   * 区間は [i, i+1) の半開区間なので、ワールド t 座標を Math.floor して
   * 求める。MotionGraphEditor._snapGrid が t を Math.round で頂点に
   * スナップするのに対し、こちらは「クリック位置が属する区間」を
   * 一意に決めるため Math.floor を使う。
   *
   * グリッド範囲ぎりぎり（右端付近）をクリックしても、その位置を含む
   * 区間として floor(xMax - ε) 相当を許容したいので、[xMin, xMax) の
   * 範囲でクランプする（xMax ちょうどは右端の区間外なので xMax-1 に丸める）。
   *
   * @param {number} px 論理ピクセル x 座標
   * @returns {number} 区間インデックス（整数）
   */
  _intervalIndexFromPixel(px) {
    const world = this.renderer.toWorld(px, 0);
    const c = this.renderer.config;
    const tClamped = Math.max(c.xMin, Math.min(c.xMax - 1e-9, world.t));
    return Math.floor(tClamped);
  }

  /**
   * 論理ピクセル y 座標から 0.5 刻みにスナップした値を求める
   * （MotionGraphEditor._snapValue と同じ考え方）
   *
   * @param {number} py        論理ピクセル y 座標
   * @param {boolean} [_unused] 互換のため引数を残しているが現状未使用
   * @returns {number} [yMin, yMax] にクランプし 0.5 刻みに丸めた値
   */
  _snapValue(py, _unused) {
    const world = this.renderer.toWorld(0, py);
    const c = this.renderer.config;
    return Math.max(c.yMin, Math.min(c.yMax, Math.round(world.value * 2) / 2));
  }

  /**
   * マウス位置から「ホバー中の区間」情報を組み立てる
   * @returns {{index:number, t0:number, t1:number, value:number}}
   */
  _intervalInfoFromClient(clientX, clientY) {
    const { px, py } = this._getCanvasXY(clientX, clientY);
    const index = this._intervalIndexFromPixel(px);
    const value = this._snapValue(py);
    return { index, t0: index, t1: index + 1, value };
  }

  _onMouseMove(e) {
    if (this.isDragging && this.activeInterval !== null) {
      // 区間は固定、value だけマウスに追従（列ロックと同じ考え方）
      const { py } = this._getCanvasXY(e.clientX, e.clientY);
      const value = this._snapValue(py);
      this.hoverInterval = { index: this.activeInterval, t0: this.activeInterval, t1: this.activeInterval + 1, value };
      this.graph.paintInterval(this.activeInterval, value);
      this.onUpdate();
    } else {
      this.hoverInterval = this._intervalInfoFromClient(e.clientX, e.clientY);
    }
    this.render();
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const info = this._intervalInfoFromClient(e.clientX, e.clientY);
    this.activeInterval = info.index;
    this.isDragging     = true;
    this.hoverInterval  = info;
    this.graph.paintInterval(info.index, info.value);
    this.onUpdate();
    this.render();
  }

  _onMouseUp() {
    this.isDragging     = false;
    this.activeInterval = null;
  }

  _onRightClick(e) {
    const info = this._intervalInfoFromClient(e.clientX, e.clientY);
    this.graph.removeEdgeInterval(info.index);
    this.onUpdate();
    this.render();
  }

  /**
   * 手描き入力中のカーブの描画スタイルを返す
   *
   * KinematicsProblemGenerator._handDrawnStyle() / MotionGraphEditor._curveStyle()
   * と全く同じ固定の実線オレンジを使う。理由も同じ：STYLE_PRESETS の
   * 種類別スタイル（破線等）は「複数カーブを並べて見せる自動導出表示」で
   * 意味を持つものであり、単一カーブの手描き編集画面に適用すると
   * 「v-t を選んだだけで破線になる」という紛らわしい見た目になる
   * （過去に二度同種のバグを生んだため、必ず固定スタイルを使うこと）。
   *
   * 階段グラフの段差（不連続ジャンプ）も例外ではない。手描きの段差は
   * 「教師が意図して描いた運動」であり、導出エンジンが角から逆算する
   * 「加速度が未定義になる曖昧な瞬間」（drawUndefinedMarker・グレー破線で
   * 表現する別概念）とは全く異なる。混同を避けるため、段差のリサーも
   * 必ずこの固定オレンジ実線で描く（グレー破線の STYLE_PRESETS は使わない）。
   *
   * @returns {{color: string, lineWidth: number}}
   */
  static _handDrawnStyle() {
    return { color: '#c9551a', lineWidth: 2.5 };
  }

  /** インスタンスメソッド版（render() 内で this. として呼べるように） */
  _handDrawnStyle() {
    return StepGraphEditor._handDrawnStyle();
  }

  render() {
    const r = this.renderer;
    const c = r.config;
    r.clear();
    r.drawGrid();

    // ドラッグ中 / ホバー中: アクティブ区間を1グリッドセル幅でハイライト
    // （MotionGraphEditor.render() の列ハイライトと同じ色・透明度。
    //  違いは「1点の列」ではなく「区間 [i, i+1] の幅全体」を塗ること）
    const highlightIndex = (this.isDragging && this.activeInterval !== null)
      ? this.activeInterval
      : (this.hoverInterval ? this.hoverInterval.index : null);

    if (highlightIndex !== null) {
      const ctx = r.ctx;
      const { px: xLeft }  = r.toPixel(highlightIndex, 0);
      const { px: xRight } = r.toPixel(highlightIndex + 1, 0);
      const { py: yTop }   = r.toPixel(0, c.yMax);
      const { py: yBot }   = r.toPixel(0, c.yMin);
      ctx.save();
      ctx.fillStyle = 'rgba(30, 120, 255, 0.10)';
      ctx.fillRect(xLeft, yTop, xRight - xLeft, yBot - yTop);
      ctx.restore();
    }

    // 階段状モードは常に v-t 専用なので軸ラベルは固定
    r.drawAxes({ xLabel: '時刻 t [s]', yLabel: '速度 v [m/s]' });

    // 手描き階段グラフ（区分定数カーブ＋段差リサー）
    if (!this.graph.isEmpty()) {
      const curve = Kinematics.curveFromStepGraph(this.graph);
      const style = this._handDrawnStyle();
      r.drawCurve(curve, style, c.xMin, c.xMax);

      curve.discontinuities.forEach(t => {
        const valueBefore = this.graph.values[t - this.graph.tStart - 1];
        const valueAfter  = this.graph.values[t - this.graph.tStart];
        r.drawDiscontinuity(t, valueBefore, valueAfter, {
          color: style.color,
          dashed: false,
          lineWidth: style.lineWidth,
        });
      });
    }

    // ホバー中の区間情報ラベル
    if (this.hoverInterval) {
      const { index, t0, t1, value } = this.hoverInterval;
      r.drawHighlight((t0 + t1) / 2, value);
      this._drawIntervalLabel(r, t0, t1, value);
    }
  }

  /**
   * ホバー中の区間を「(t0–t1, value)」の形式でラベル表示する
   *
   * MotionGraphEditor._drawCoordLabel（点の座標 "(t, value)" を表示）を
   * 区間表示に拡張したもの。位置決め（右端に近ければ左に出す等）の
   * 方針はそのまま踏襲する。
   *
   * @param {MotionGraphRenderer} r
   * @param {number} t0    区間開始時刻
   * @param {number} t1    区間終了時刻
   * @param {number} value 区間の値
   */
  _drawIntervalLabel(r, t0, t1, value) {
    const ctx = r.ctx;
    const { px, py } = r.toPixel((t0 + t1) / 2, value);
    ctx.save();
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const label = `(${t0}–${t1}, ${value})`;
    const tw = ctx.measureText(label).width;
    // 右端に近い場合は左に表示
    const lx = (px + tw + 12 > r.canvas.width) ? px - tw - 8 : px + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(lx - 2, py - 16, tw + 4, 14);
    ctx.fillStyle = '#c9551a';
    ctx.fillText(label, lx, py - 4);
    ctx.restore();
  }
}
