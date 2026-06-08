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
   * 時刻 t における値（線形補間）
   *
   * 端部の扱い: Wave.getY の「端部ランプ」（最初/最後の点の外側で 0 へ
   * 線形に近づくランプ）は移植しない。波の場合は媒質が静止状態（y=0）
   * へ戻る物理的描写として自然だったが、運動グラフでは「描いていない
   * 区間」に勝手な値（0 への直線的な変化）を補って見せると、教員が
   * 描いた覚えのない運動を示してしまい誤解を招く。また Kinematics の
   * 導出（curveFromGraph）は頂点間の区間しか扱わないため、ランプ付きの
   * 表示と導出結果が食い違う問題もあった。
   *
   * そのため、最初の点より前・最後の点より後は「未定義（描かれていない）」
   * として null を返す。範囲内は頂点間の線形補間。
   *
   * @returns {number|null} 範囲外なら null
   */
  valueAt(t) {
    if (this.points.length === 0) return null;

    const first = this.points[0];
    const last  = this.points[this.points.length - 1];

    if (t < first.t || t > last.t) return null;
    if (t === first.t) return first.value;
    if (t === last.t)  return last.value;

    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      if (t >= a.t && t <= b.t) {
        const ratio = (t - a.t) / (b.t - a.t);
        return a.value + ratio * (b.value - a.value);
      }
    }
    return null;
  }

  /**
   * [tMin, tMax] の描画用点列を返す（頂点が描かれている区間のみ）
   * 整数格子点と実際の頂点位置を含めて折れ線を正確に描画できるようにする。
   * 最初/最後の頂点より外側は valueAt が null を返すため自然に除外され、
   * 「描いた区間だけが折れ線として表示される」（= Kinematics の導出対象と
   * 完全に一致する）。
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
