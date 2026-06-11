/**
 * MotionGraph - 手描き運動グラフ（v-t または x-t）の物理モデル
 * 点リスト（格子点）を保持し、時刻 t での値を線形補間で計算する。
 * legacy_nami_app の Wave クラス（頂点ベースの折れ線モデル）をフォークしたもの。
 * 波の伝播（speed/direction/反射）は運動グラフに存在しないため移植しない。
 */
class MotionGraph {
  constructor() {
    this.points = []; // [{t: int, value: 0.5刻み}, ...] t 昇順ソート済み
    this.kind = 'vt'; // 'vt' (速度-時間) | 'xt' (位置-時間)
    this.x0 = 0;      // v-t グラフの初期位置（積分の開始値として使用）
    this.label = 'A';
  }

  /**
   * 点を追加または更新する
   * 同じ t の点が存在する場合は value を更新
   */
  setPoint(t, value) {
    t = Math.round(t);
    value = Math.round(value * 2) / 2; // 0.5刻みに丸める
    const idx = this.points.findIndex(p => p.t === t);
    if (idx !== -1) {
      this.points[idx].value = value;
    } else {
      this.points.push({ t, value });
      this.points.sort((a, b) => a.t - b.t);
    }
  }

  /**
   * 点を削除する
   */
  removePoint(t) {
    t = Math.round(t);
    const idx = this.points.findIndex(p => p.t === t);
    if (idx !== -1) this.points.splice(idx, 1);
  }

  /**
   * 指定 t の点の value を返す（なければ null）
   */
  getPoint(t) {
    const p = this.points.find(p => p.t === Math.round(t));
    return p ? p.value : null;
  }

  /**
   * 頂点リストの前後に、y=0（基準線）へ向かう「端部ランプ」の仮想頂点を
   * 加えたものを返す（legacy_nami_app の Wave.getY の端部ランプを移植）。
   *
   * 例: points = [{t:3, value:4}] のとき
   *   → [{t:2, value:0}, {t:3, value:4}, {t:4, value:0}]
   * （最初/最後の頂点の前後1マスで y=0 へ直線的に近づく）
   *
   * valueAt/getSnapshot（表示）と Kinematics.curveFromGraph（導出）の
   * 両方がこの配列を参照することで、「エディタが表示する区間」と
   * 「導出エンジンが対象とする区間」を一致させたまま端部ランプを持たせる。
   *
   * @returns {{t:number, value:number}[]} 頂点が無ければ空配列
   */
  getRampedPoints() {
    if (this.points.length === 0) return [];
    const first = this.points[0];
    const last  = this.points[this.points.length - 1];
    return [
      { t: first.t - 1, value: 0 },
      ...this.points,
      { t: last.t + 1, value: 0 },
    ];
  }

  /**
   * 時刻 t における値（線形補間）
   *
   * 最初/最後の頂点そのものの外側は、getRampedPoints() が加える端部
   * ランプにより前後1マスで y=0（基準線）へ線形に近づく。それより
   * さらに外側は「未定義（描かれていない）」として null を返す。
   *
   * @returns {number|null} 範囲外なら null
   */
  valueAt(t) {
    const pts = this.getRampedPoints();
    if (pts.length === 0) return null;

    const first = pts[0];
    const last  = pts[pts.length - 1];

    if (t < first.t || t > last.t) return null;
    if (t === first.t) return first.value;
    if (t === last.t)  return last.value;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (t >= a.t && t <= b.t) {
        const ratio = (t - a.t) / (b.t - a.t);
        return a.value + ratio * (b.value - a.value);
      }
    }
    return null;
  }

  /**
   * [tMin, tMax] の描画用点列を返す（頂点＋端部ランプが描かれている区間のみ）
   * 整数格子点と実際の頂点位置を含めて折れ線を正確に描画できるようにする。
   * 最初/最後の頂点の前後1マスは getRampedPoints() の端部ランプにより
   * y=0 へのセグメントとして含まれ、それより外側は valueAt が null を
   * 返すため自然に除外される（= Kinematics の導出対象と完全に一致する）。
   */
  getSnapshot(tMin, tMax) {
    const tSet = new Set();
    for (let t = Math.floor(tMin); t <= Math.ceil(tMax); t++) {
      tSet.add(t);
    }
    this.points.forEach(p => tSet.add(p.t));

    return [...tSet]
      .sort((a, b) => a - b)
      .filter(t => t >= tMin && t <= tMax)
      .map(t => ({ t, value: this.valueAt(t) }))
      .filter(p => p.value !== null);
  }

  /**
   * グラフをクリアする
   */
  clear() {
    this.points = [];
  }

  /**
   * 点が一つもないか
   * @returns {boolean}
   */
  isEmpty() {
    return this.points.length === 0;
  }

  /**
   * 値の絶対値の最大（Wave.getMaxAmplitude のフォーク）
   * @returns {number}
   */
  getMaxAbsValue() {
    if (this.points.length === 0) return 0;
    return Math.max(...this.points.map(p => Math.abs(p.value)));
  }

  /**
   * JSON シリアライズ
   */
  toJSON() {
    return {
      kind: this.kind,
      points: this.points.map(p => ({ t: p.t, value: p.value })),
      x0: this.x0,
      label: this.label,
    };
  }

  /**
   * JSON デシリアライズ（フィールド欠損時はデフォルト値で補完）
   */
  fromJSON(data) {
    this.points = (data.points || []).map(p => ({ t: p.t, value: p.value }));
    this.kind = data.kind ?? 'vt';
    this.x0 = data.x0 ?? 0;
    this.label = data.label ?? 'A';
    return this;
  }
}
