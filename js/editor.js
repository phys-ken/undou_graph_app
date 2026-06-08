/**
 * MotionGraphEditor - 格子点クリックによる運動グラフ（v-t / x-t）入力
 *
 * legacy_nami_app の WaveEditor（x/y フィールド）をフォークし、
 * MotionGraph（t/value フィールド）を操作するように書き換えたもの。
 *
 * 操作方法:
 *   左クリック: クリックした t 列の値を設定
 *   左クリック＋上下ドラッグ: t を固定したまま値を調整（列ロック）
 *   右クリック: その t 列の頂点を削除
 *   タッチ操作も同様（タップ＝設定、ドラッグ＝列ロックして値を調整）
 *
 * スナップ:
 *   t は整数（Math.round）、value は 0.5 刻み（Math.round(v*2)/2）
 *   — MotionGraph の頂点モデル仕様に合わせる。
 */
class MotionGraphEditor {
  constructor(canvas, graph, renderer, onUpdate) {
    this.canvas   = canvas;
    this.graph    = graph;
    this.renderer = renderer;
    this.onUpdate = onUpdate || (() => {});

    this.hoverPos   = null;  // マウスホバー位置（ワールド座標 {t, value}）
    this.isDragging = false;
    this.activeT    = null;  // ドラッグ中に固定する t 列

    this._bindEvents();
    this.render();
  }

  _bindEvents() {
    // ハンドラ参照を保持して destroy() で確実に削除できるようにする
    this._h = {
      mousemove:   e => this._onMouseMove(e),
      mousedown:   e => this._onMouseDown(e),
      mouseup:     ()  => this._onMouseUp(),
      mouseleave:  ()  => { this.hoverPos = null; this.isDragging = false; this.activeT = null; this.render(); },
      contextmenu: e => { e.preventDefault(); this._onRightClick(e); },
      touchstart: e => {
        e.preventDefault();
        const t = e.touches[0];
        const pos = this._snapGrid(t.clientX, t.clientY);
        this.activeT = pos.t;
        this.graph.setPoint(pos.t, pos.value);
        this.onUpdate();
        this.render();
      },
      touchmove: e => {
        e.preventDefault();
        if (this.activeT === null) return;
        const t = e.touches[0];
        const { py } = this._getCanvasXY(t.clientX, t.clientY);
        const world = this.renderer.toWorld(0, py);
        const c = this.renderer.config;
        const snappedValue = Math.max(c.yMin, Math.min(c.yMax, Math.round(world.value * 2) / 2));
        this.graph.setPoint(this.activeT, snappedValue);
        this.onUpdate();
        this.render();
      },
      touchend: () => { this.activeT = null; },
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

  /** マウス座標をグリッド格子点にスナップ（t=整数、value=0.5刻み） */
  _snapGrid(clientX, clientY) {
    const { px, py } = this._getCanvasXY(clientX, clientY);
    const world = this.renderer.toWorld(px, py);
    const c = this.renderer.config;
    return {
      t:     Math.max(c.xMin, Math.min(c.xMax, Math.round(world.t))),
      value: Math.max(c.yMin, Math.min(c.yMax, Math.round(world.value * 2) / 2)),
    };
  }

  /** ドラッグ中: t を固定して value だけ更新 */
  _snapValue(clientY) {
    const { py } = this._getCanvasXY(0, clientY);
    const world = this.renderer.toWorld(0, py);
    const c = this.renderer.config;
    return Math.max(c.yMin, Math.min(c.yMax, Math.round(world.value * 2) / 2));
  }

  _onMouseMove(e) {
    if (this.isDragging && this.activeT !== null) {
      // t は固定、value だけマウスに追従
      const value = this._snapValue(e.clientY);
      this.hoverPos = { t: this.activeT, value };
      this.graph.setPoint(this.activeT, value);
      this.onUpdate();
    } else {
      this.hoverPos = this._snapGrid(e.clientX, e.clientY);
    }
    this.render();
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const pos = this._snapGrid(e.clientX, e.clientY);
    this.activeT    = pos.t;
    this.isDragging = true;
    this.hoverPos   = pos;
    this.graph.setPoint(pos.t, pos.value);
    this.onUpdate();
    this.render();
  }

  _onMouseUp() {
    this.isDragging = false;
    this.activeT    = null;
  }

  _onRightClick(e) {
    const pos = this._snapGrid(e.clientX, e.clientY);
    this.graph.removePoint(pos.t);
    this.onUpdate();
    this.render();
  }

  /**
   * グラフ種類に応じた軸ラベルを返す
   * vt: 「時刻 t [s]」/「速度 v [m/s]」
   * xt: 「時刻 t [s]」/「位置 x [m]」
   */
  _axisLabels() {
    return this.graph.kind === 'xt'
      ? { xLabel: '時刻 t [s]', yLabel: '位置 x [m]' }
      : { xLabel: '時刻 t [s]', yLabel: '速度 v [m/s]' };
  }

  /**
   * 手描き入力中のカーブの描画スタイルを返す
   *
   * STYLE_PRESETS の vt/xt/at 別スタイル（実線・破線で区別）は、複数の
   * カーブが同一画面に並ぶ「自動導出グラフ」表示でこそ意味を持つ。
   * 単一カーブを描いている編集画面でそれを適用すると、v-t を選んだ
   * だけで常に破線表示になってしまい紛らわしい（ユーザー指摘）。
   * そのため編集画面では種類によらず固定の実線スタイルを使う
   * （legacy WaveEditor.render() の drawWave 呼び出しと同じ方針）。
   */
  _curveStyle() {
    return { color: '#c9551a', lineWidth: 2.5 };
  }

  render() {
    const r = this.renderer;
    const c = r.config;
    r.clear();
    r.drawGrid();

    // ドラッグ中: アクティブ列をハイライト
    if (this.isDragging && this.activeT !== null) {
      const ctx = r.ctx;
      const { px: colPx } = r.toPixel(this.activeT, 0);
      const { py: yTop }  = r.toPixel(0, c.yMax);
      const { py: yBot }  = r.toPixel(0, c.yMin);
      const colW = r.toPixel(1, 0).px - r.toPixel(0, 0).px;
      ctx.save();
      ctx.fillStyle = 'rgba(30, 120, 255, 0.10)';
      ctx.fillRect(colPx - colW / 2, yTop, colW, yBot - yTop);
      ctx.restore();
    }

    r.drawAxes(this._axisLabels());

    // 手描きグラフ（折れ線）
    if (!this.graph.isEmpty()) {
      const pts = this.graph.getSnapshot(c.xMin, c.xMax);
      r.drawPolyline(pts, this._curveStyle());
      this.graph.points.forEach(p => r.drawVertex(p.t, p.value));
    }

    // ホバー
    if (this.hoverPos) {
      r.drawHighlight(this.hoverPos.t, this.hoverPos.value);
      this._drawCoordLabel(r, this.hoverPos.t, this.hoverPos.value);
    }
  }

  _drawCoordLabel(r, t, value) {
    const ctx = r.ctx;
    const { px, py } = r.toPixel(t, value);
    ctx.save();
    ctx.font = '11px monospace';
    ctx.fillStyle = '#c9551a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const label = `(${t}, ${value})`;
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
