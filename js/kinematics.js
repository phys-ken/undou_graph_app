/**
 * Kinematics - 運動グラフ（x-t / v-t / a-t）相互導出エンジン
 *
 * 純粋関数の集合（DOM 非依存・状態を持たない）。
 * 手描きの MotionGraph（折れ線）を Curve（区分多項式表現）に変換し、
 * v-t ⇄ x-t ⇄ a-t の相互導出を行う。
 *
 * Curve 形式（全ての導出済み/手描きグラフの統一表現）:
 *   {
 *     kind: 'xt' | 'vt' | 'at',
 *     segments: [ { t0, t1, c0, c1, c2 } ],
 *       // value(t) = c0 + c1*(t - t0) + c2*(t - t0)^2 , t ∈ [t0, t1]
 *     discontinuities: [ t, ... ],
 *       // 隣接セグメント間で値が飛ぶ時刻（「リサー」= 段差を描画する位置）
 *     undefinedInstants: [ t, ... ],
 *       // 微分が物理的に定義できない時刻（例: x-t の角での加速度）
 *   }
 */
const Kinematics = {
  /**
   * 空の Curve を生成する内部ヘルパー
   */
  _emptyCurve(kind) {
    return { kind, segments: [], discontinuities: [], undefinedInstants: [] };
  },

  /**
   * 手描き MotionGraph（vt または xt）をそのまま同種の Curve に変換する。
   * 手描きは単一の折れ線（ポリライン）であり連続なので、
   * セグメントは全て直線（c2=0）、不連続点は存在しない。
   *
   * @param {MotionGraph} graph
   * @returns {Curve}
   */
  curveFromGraph(graph) {
    const curve = this._emptyCurve(graph.kind);
    const pts = graph.points;
    if (pts.length < 2) return curve;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dt = b.t - a.t;
      const slope = dt === 0 ? 0 : (b.value - a.value) / dt;
      curve.segments.push({ t0: a.t, t1: b.t, c0: a.value, c1: slope, c2: 0 });
    }
    return curve;
  },

  /**
   * v-t グラフ（手描き）から { vt, xt, at } を導出する。
   *
   * - vt: 手描きそのもの（連続な区分一次）
   * - at: 各 v-t セグメントの傾き m = (v1-v0)/(t1-t0) を一定値として持つ
   *       区分定数。隣接セグメントの傾きが異なる接続点では a-t は階段状に
   *       不連続になるため discontinuities に記録する。
   * - xt: v(t) を graph.x0 から区分積分して連続な x(t) を構成する。
   *       セグメント内 v(t) = v0 + m*(t-t0) のとき
   *       x(t) = x_start + v0*(t-t0) + (m/2)*(t-t0)^2
   *       となるセグメント { t0, t1, c0: x_start, c1: v0, c2: m/2 } を作り、
   *       x_start を連続的に引き継ぐ（位置は連続 → 不連続点・未定義点なし）。
   *
   * @param {MotionGraph} graph  graph.kind === 'vt'
   * @returns {{ vt: Curve, xt: Curve, at: Curve }}
   */
  deriveFromVT(graph) {
    const vt = this.curveFromGraph(graph);
    const at = this._emptyCurve('at');
    const xt = this._emptyCurve('xt');

    if (vt.segments.length === 0) {
      return { vt, xt, at };
    }

    let xStart = graph.x0 ?? 0;
    let prevSlope = null;

    vt.segments.forEach((seg, i) => {
      const m = seg.c1; // セグメントの傾き (= 加速度)
      const v0 = seg.c0;

      // a-t: 定数セグメント
      at.segments.push({ t0: seg.t0, t1: seg.t1, c0: m, c1: 0, c2: 0 });
      if (i > 0 && prevSlope !== null && prevSlope !== m) {
        at.discontinuities.push(seg.t0);
      }
      prevSlope = m;

      // x-t: 区分積分（連続）
      xt.segments.push({ t0: seg.t0, t1: seg.t1, c0: xStart, c1: v0, c2: m / 2 });
      const dt = seg.t1 - seg.t0;
      xStart = xStart + v0 * dt + (m / 2) * dt * dt;
    });

    return { vt, xt, at };
  },

  /**
   * x-t グラフ（手描き・区分一次のみ）から { xt, vt, at } を導出する。
   *
   * - xt: 手描きそのもの
   * - vt: 各 x-t セグメントの傾き m = (x1-x0)/(t1-t0) を一定値として持つ
   *       区分定数。内部の頂点（角）で傾きが変わる箇所では速度が
   *       不連続にジャンプするため discontinuities に記録する。
   * - at: 各セグメント内では加速度 0（直線運動なので）。
   *       速度が不連続になる内部の角の時刻は、加速度が撃力的（インパルス的）
   *       であり物理的に定義できないため、discontinuities と
   *       undefinedInstants の両方に記録する（描画側で破線/グレー表示等の
   *       特別扱いができるように）。最初/最後の点は内部の角ではないため
   *       何も記録しない。
   *
   * @param {MotionGraph} graph  graph.kind === 'xt'
   * @returns {{ xt: Curve, vt: Curve, at: Curve }}
   */
  deriveFromXT(graph) {
    const xt = this.curveFromGraph(graph);
    const vt = this._emptyCurve('vt');
    const at = this._emptyCurve('at');

    if (xt.segments.length === 0) {
      return { xt, vt, at };
    }

    let prevSlope = null;

    xt.segments.forEach((seg, i) => {
      const m = seg.c1; // セグメントの傾き (= 速度)

      // v-t: 定数セグメント
      vt.segments.push({ t0: seg.t0, t1: seg.t1, c0: m, c1: 0, c2: 0 });

      // a-t: 各セグメント内は 0
      at.segments.push({ t0: seg.t0, t1: seg.t1, c0: 0, c1: 0, c2: 0 });

      // 内部の角（最初のセグメント以外の開始点 = 前セグメントとの接続点）でのみ判定
      if (i > 0 && prevSlope !== null && prevSlope !== m) {
        const cornerT = seg.t0;
        vt.discontinuities.push(cornerT);
        at.discontinuities.push(cornerT);
        at.undefinedInstants.push(cornerT);
      }
      prevSlope = m;
    });

    return { xt, vt, at };
  },
};
