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
   * 時刻 t における値（線形補間、範囲外は 0）
   *
   * 端部の扱い: Wave.getY の「端部ランプ」（最初/最後の点の外側で 0 へ
   * 線形に近づくランプ）をそのまま踏襲する。エディタのスナップショット
   * 表示（getSnapshot）と値が完全に一致する方が、急激な値の変化（断絶）
   * を防げて視覚的に自然なため、運動グラフでも同じ挙動を採用する。
   */
  valueAt(t) {
    if (this.points.length === 0) return 0;

    const first = this.points[0];
    const last  = this.points[this.points.length - 1];

    // 端部ランプ: [first.t-1, first.t) で 0→first.value、(last.t, last.t+1] で last.value→0
    if (t < first.t - 1 || t > last.t + 1) return 0;
    if (t < first.t) return (t - (first.t - 1)) * first.value;
    if (t > last.t)  return (last.t + 1 - t)    * last.value;

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
    return 0;
  }

  /**
   * [tMin, tMax] の描画用点列を返す
   * 整数格子点と実際の頂点位置を含めて折れ線を正確に描画できるようにする。
   * Wave.getSnapshot と異なり、波の伝播（時間シフト）は存在しないため、
   * 単純に「整数格子点 ∪ 頂点の t」を集めて value を評価するだけでよい。
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
      .map(t => ({ t, value: this.valueAt(t) }));
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
