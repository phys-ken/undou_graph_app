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
   * graph.getRampedPoints()（最初/最後の頂点の前後1マスで y=0 へ近づく
   * 端部ランプを加えた頂点列）を使うため、頂点が1つしかない場合でも
   * 前後の端部ランプにより2セグメントの三角形（0→value→0）になる。
   * これにより MotionGraph の表示（valueAt/getSnapshot）と導出対象の
   * 区間が常に一致する。
   *
   * @param {MotionGraph} graph
   * @returns {Curve}
   */
  curveFromGraph(graph) {
    const curve = this._emptyCurve(graph.kind);
    const pts = graph.getRampedPoints();
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
   * - vt: 手描き＋端部ランプ（getRampedPoints、最初/最後の頂点の前後1マスで
   *       y=0 へ近づく区間）を含む連続な区分一次。
   * - at: 各 v-t セグメントの傾き m = (v1-v0)/(t1-t0) を一定値として持つ
   *       区分定数。隣接セグメントの傾きが異なる接続点では a-t は階段状に
   *       不連続になるため discontinuities に記録する。端部ランプの傾きが
   *       実際に描いた最初/最後のセグメントと異なる場合は、その境界
   *       （= 最初/最後の頂点そのもの）にも記録される。
   * - xt: v(t) を graph.x0 から区分積分して連続な x(t) を構成する。
   *       セグメント内 v(t) = v0 + m*(t-t0) のとき
   *       x(t) = x_start + v0*(t-t0) + (m/2)*(t-t0)^2
   *       となるセグメント { t0, t1, c0: x_start, c1: v0, c2: m/2 } を作り、
   *       x_start を連続的に引き継ぐ（位置は連続 → 不連続点・未定義点なし）。
   *       先頭セグメントは端部ランプ（t = 最初の頂点.t - 1 から開始）なので、
   *       graph.x0 は「最初の頂点の1マス手前での位置」を表すことになる。
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
    // ランプ済み曲線の外側（最初の頂点の1マス手前より前／最後の頂点の1マス先より後）
    // は v=0（静止）とみなす＝a=0 が続いているとみなす。これにより、ランプ境界
    // そのもの（最初/最後のセグメントの端）でも内部の角と同じ基準で不連続を
    // 判定でき、「y=0 の端点を明示的に描いたかどうか」で a-t の見た目が
    // 変わらなくなる。
    let prevSlope = 0;

    vt.segments.forEach((seg) => {
      const m = seg.c1; // セグメントの傾き (= 加速度)
      const v0 = seg.c0;

      // a-t: 定数セグメント
      at.segments.push({ t0: seg.t0, t1: seg.t1, c0: m, c1: 0, c2: 0 });
      if (prevSlope !== m) {
        at.discontinuities.push(seg.t0);
      }
      prevSlope = m;

      // x-t: 区分積分（連続）
      xt.segments.push({ t0: seg.t0, t1: seg.t1, c0: xStart, c1: v0, c2: m / 2 });
      const dt = seg.t1 - seg.t0;
      xStart = xStart + v0 * dt + (m / 2) * dt * dt;
    });

    // 曲線の終端より外側も a=0（静止）とみなすため、最後のセグメントの傾きが
    // 0 でなければ終端にも不連続を記録する。
    if (prevSlope !== 0) {
      at.discontinuities.push(vt.segments[vt.segments.length - 1].t1);
    }

    return { vt, xt, at };
  },

  /**
   * x-t グラフ（手描き・区分一次のみ）から { xt, vt, at } を導出する。
   *
   * - xt: 手描き＋端部ランプ（getRampedPoints、最初/最後の頂点の前後1マスで
   *       位置 0 へ近づく区間）を含む連続な区分一次。
   * - vt: 各 x-t セグメントの傾き m = (x1-x0)/(t1-t0) を一定値として持つ
   *       区分定数。隣接セグメントの傾きが変わる接続点（端部ランプとの
   *       境界、すなわち最初/最後の頂点そのものを含む）では速度が
   *       不連続にジャンプするため discontinuities に記録する。
   * - at: 各セグメント内では加速度 0（直線運動なので）。
   *       速度が不連続になる接続点の時刻は、加速度が撃力的（インパルス的）
   *       であり物理的に定義できないため、discontinuities と
   *       undefinedInstants の両方に記録する（描画側で破線/グレー表示等の
   *       特別扱いができるように）。
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

    // ランプ済み曲線の外側（最初の頂点の1マス手前より前／最後の頂点の1マス先より後）
    // は v=0（静止）とみなす。これにより、ランプ境界そのもの（最初/最後の
    // セグメントの端）でも内部の角と同じ基準で不連続を判定でき、「x=0 の
    // 端点を明示的に描いたかどうか」で v-t/a-t の見た目が変わらなくなる。
    let prevSlope = 0;

    xt.segments.forEach((seg) => {
      const m = seg.c1; // セグメントの傾き (= 速度)

      // v-t: 定数セグメント
      vt.segments.push({ t0: seg.t0, t1: seg.t1, c0: m, c1: 0, c2: 0 });

      // a-t: 各セグメント内は 0
      at.segments.push({ t0: seg.t0, t1: seg.t1, c0: 0, c1: 0, c2: 0 });

      // 角（前セグメント、または曲線の外側＝静止とみなした基準との接続点）
      if (prevSlope !== m) {
        const cornerT = seg.t0;
        vt.discontinuities.push(cornerT);
        at.discontinuities.push(cornerT);
        at.undefinedInstants.push(cornerT);
      }
      prevSlope = m;
    });

    // 曲線の終端より外側も v=0（静止）とみなすため、最後のセグメントの速度が
    // 0 でなければ終端にも不連続を記録する。
    if (prevSlope !== 0) {
      const cornerT = xt.segments[xt.segments.length - 1].t1;
      vt.discontinuities.push(cornerT);
      at.discontinuities.push(cornerT);
      at.undefinedInstants.push(cornerT);
    }

    return { xt, vt, at };
  },

  /**
   * StepMotionGraph（階段状 v-t）を Curve（vt）に変換する。
   *
   * 各区間 [tStart+i, tStart+i+1) はそのまま定数セグメント
   * { t0, t1, c0: values[i], c1: 0, c2: 0 } になる。
   * 隣接する区間の値が異なる内部境界では速度が意図的に不連続へ
   * ジャンプするため、その時刻を discontinuities に記録する
   * （値が等しい境界では「見た目には繋がっている」ため記録しない）。
   *
   * @param {StepMotionGraph} stepGraph
   * @returns {Curve}
   */
  curveFromStepGraph(stepGraph) {
    const curve = this._emptyCurve('vt');
    if (stepGraph.isEmpty()) return curve;

    const { tStart, values } = stepGraph;
    values.forEach((v, i) => {
      curve.segments.push({ t0: tStart + i, t1: tStart + i + 1, c0: v, c1: 0, c2: 0 });
      if (i < values.length - 1 && values[i] !== values[i + 1]) {
        curve.discontinuities.push(tStart + i + 1);
      }
    });

    return curve;
  },

  /**
   * 階段状 v-t グラフ（StepMotionGraph）から { vt, xt, at } を導出する。
   *
   * - vt: curveFromStepGraph そのもの（区分定数、区間境界に意図的な不連続）。
   * - at: 各区間内では加速度 0 の定数セグメント。vt が不連続にジャンプする
   *       境界では、速度が一瞬で変化する＝加速度が撃力的（インパルス的）で
   *       あり物理的に定義できないため、deriveFromXT の角の扱いと全く同じ
   *       ロジックで discontinuities と undefinedInstants の両方に
   *       同じ時刻を記録する（描画側で破線/グレー表示等の特別扱いができる
   *       ように）。値が変化しない境界（discontinuities に含まれない境界）
   *       では加速度はそのまま 0 で連続なので、何も記録しない。
   * - xt: 各区間内で v(t) = values[i]（一定）を積分するため、
   *       deriveFromVT の m=0 の場合に相当する単純な直線になる：
   *       x(t) = xStart + values[i]*(t - t0) 、
   *       セグメントは { t0, t1, c0: xStart, c1: values[i], c2: 0 }。
   *       xStart は deriveFromVT と同じ式 xStart + v0*dt + (m/2)*dt*dt
   *       （m=0 なので xStart + values[i]*dt）で連続的に引き継ぐ。
   *       位置は常に連続なので discontinuities・undefinedInstants は
   *       空のまま（角があっても deriveFromVT 同様 x-t 側では未定義扱いしない）。
   *
   * @param {StepMotionGraph} stepGraph
   * @returns {{ vt: Curve, xt: Curve, at: Curve }}
   */
  deriveFromVTStep(stepGraph) {
    const vt = this.curveFromStepGraph(stepGraph);
    const at = this._emptyCurve('at');
    const xt = this._emptyCurve('xt');

    if (vt.segments.length === 0) {
      return { vt, xt, at };
    }

    let xStart = stepGraph.x0 ?? 0;
    const discontinuitySet = new Set(vt.discontinuities);

    vt.segments.forEach((seg) => {
      const v0 = seg.c0;
      const dt = seg.t1 - seg.t0;

      // a-t: 各区間内は定数 0
      at.segments.push({ t0: seg.t0, t1: seg.t1, c0: 0, c1: 0, c2: 0 });
      if (discontinuitySet.has(seg.t0)) {
        at.discontinuities.push(seg.t0);
        at.undefinedInstants.push(seg.t0);
      }

      // x-t: 区分積分（連続）。m=0 なので x(t) = xStart + v0*(t-t0)
      xt.segments.push({ t0: seg.t0, t1: seg.t1, c0: xStart, c1: v0, c2: 0 });
      xStart = xStart + v0 * dt;
    });

    return { vt, xt, at };
  },
};
