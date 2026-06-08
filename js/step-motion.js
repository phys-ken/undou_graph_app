/**
 * StepMotionGraph - 階段状（ガウス記号 / 床関数）v-t グラフの物理モデル
 *
 * MotionGraph（頂点を直線で結ぶ連続な折れ線モデル）とは根本的に異なり、
 * 「単位時間幅 1 の区間ごとに一定の速度を持ち、区間境界では意図的に
 * 不連続にジャンプする」階段関数を表現する。例えば自由落下を「1秒ごとに
 * 速度が一段ずつ増える」階段で近似するような設問に使う。
 *
 * 連続な折れ線では本質的に表現できない「意図的な不連続」を扱うため、
 * MotionGraph とは別クラスとして新設する（頂点モデルを無理に拡張すると
 * 「頂点間は直線で結ぶ」という前提と矛盾し、描画/導出の整合性が崩れる）。
 *
 * 設計上の制約（MotionGraph.valueAt の「描いていない区間に勝手な値を
 * 補わない」という方針を踏襲）:
 *   - 各区間の幅は常に 1（単位時間）に固定し、整数 tStart を起点に
 *     [tStart, tStart+1), [tStart+1, tStart+2), ... と並べる。
 *     幅を可変にすると「境界がどこか」が曖昧になり、ガウス記号
 *     ⌊t⌋ に対応する素直な階段を描けなくなる。
 *   - 区間は必ず連続（隙間なし）でなければならない。隙間を許すと
 *     「描いていない区間」が生まれ、そこでの値が未定義になる。
 *     MotionGraph は「未定義区間は null を返して描画もしない」という
 *     方針だったが、StepMotionGraph はそもそも積分（x-t 導出）の
 *     対象区間が常に「描かれた範囲全体」であることを保証したいため、
 *     隙間の発生自体を禁止する（編集操作は端からの伸縮のみ許可する）。
 *   - 値は MotionGraph.setPoint と同じく 0.5 刻みに丸める。
 */
class StepMotionGraph {
  constructor() {
    this.kind = 'vt-step';
    this.tStart = null; // 最初の区間 [tStart, tStart+1) の開始時刻（整数）。null = 空（未描画）
    this.values = [];   // values[i] = 区間 [tStart+i, tStart+i+1) における一定速度
    this.x0 = 0;        // x-t 積分の初期位置（MotionGraph.x0 と同じ役割）
    this.label = 'A';
  }

  /**
   * 区間に値を塗る（クリック&ドラッグでの描画操作に対応）
   *
   * t は実数で渡されうるが、所属する区間のインデックス i = floor(t) に
   * 丸めてから処理する（区間は [tStart+i, tStart+i+1) の半開区間）。
   *
   * 隙間が生まれる位置への塗りは「未定義区間を作る」ことになるため、
   * 何もしない（no-op）。これにより this.values は常に隙間のない
   * 連続した区間列であることが保証される。
   *
   * @param {number} t     塗る位置（実数可、floor して区間インデックスに変換）
   * @param {number} value 区間に設定する値（0.5 刻みに丸める）
   */
  paintInterval(t, value) {
    const i = Math.floor(t);
    value = Math.round(value * 2) / 2; // 0.5刻みに丸める

    if (this.isEmpty()) {
      // 空の状態から最初の区間を作る
      this.tStart = i;
      this.values = [value];
      return;
    }

    if (i === this.tStart - 1) {
      // 前方に1区間延長（先頭に追加）
      this.tStart -= 1;
      this.values.unshift(value);
      return;
    }

    if (i === this.tStart + this.values.length) {
      // 後方に1区間延長（末尾に追加）
      this.values.push(value);
      return;
    }

    if (i >= this.tStart && i < this.tStart + this.values.length) {
      // 既存区間の値を更新
      this.values[i - this.tStart] = value;
      return;
    }

    // それ以外（非隣接 = 隙間ができる位置）は無視する
  }

  /**
   * 端の区間を削除する（先頭または末尾のみ縮小可能）
   *
   * 内部の区間を削除すると隙間ができてしまうため no-op とする。
   * 「端から伸縮する」操作だけを許すことで、values は常に
   * 隙間のない連続区間列という不変条件を保つ。
   *
   * 唯一の区間を削除した場合は空状態（tStart = null, values = []）に戻す。
   *
   * @param {number} t 削除したい区間内の時刻（floor して区間インデックスに変換）
   */
  removeEdgeInterval(t) {
    if (this.isEmpty()) return;

    const i = Math.floor(t);
    const lastIndex = this.tStart + this.values.length - 1;

    if (i === this.tStart) {
      // 先頭区間を削除
      if (this.values.length === 1) {
        this.clear();
        return;
      }
      this.tStart += 1;
      this.values.shift();
      return;
    }

    if (i === lastIndex) {
      // 末尾区間を削除
      if (this.values.length === 1) {
        this.clear();
        return;
      }
      this.values.pop();
      return;
    }

    // 内部の区間は削除しない（隙間ができてしまうため no-op）
  }

  /**
   * 時刻 t における値（区間定数）
   *
   * 区間は半開区間 [tStart+i, tStart+i+1) として扱う。これは
   * 「ある時刻がどちらの区間に属するか」を一意に決めるための慣習であり、
   * 階段関数（ガウス記号 ⌊t⌋）の定義とも自然に一致する。
   *
   * 右端ちょうど（t === tStart + values.length）では、その時刻は
   * 「描かれた範囲のすぐ外側」であり、MotionGraph.valueAt が頂点の
   * 外側を null とするのと同じ「描いていない区間に勝手な値を
   * 補わない」という方針に従って null を返す。
   *
   * @param {number} t
   * @returns {number|null} 範囲外・空グラフなら null
   */
  valueAt(t) {
    if (this.isEmpty()) return null;

    const tEnd = this.tStart + this.values.length;
    if (!(t >= this.tStart && t < tEnd)) return null;

    const i = Math.floor(t) - this.tStart;
    return this.values[i];
  }

  /**
   * 区間が一つもないか
   * @returns {boolean}
   */
  isEmpty() {
    return this.tStart === null || this.values.length === 0;
  }

  /**
   * 値の絶対値の最大（MotionGraph.getMaxAbsValue と同じ役割）
   * @returns {number}
   */
  getMaxAbsValue() {
    if (this.values.length === 0) return 0;
    return Math.max(...this.values.map(v => Math.abs(v)));
  }

  /**
   * グラフをクリアする（空状態に戻す）
   */
  clear() {
    this.tStart = null;
    this.values = [];
  }

  /**
   * JSON シリアライズ
   */
  toJSON() {
    return {
      kind: this.kind,
      tStart: this.tStart,
      values: [...this.values],
      x0: this.x0,
      label: this.label,
    };
  }

  /**
   * JSON デシリアライズ（フィールド欠損時はデフォルト値で補完）
   */
  fromJSON(data) {
    this.kind = data.kind ?? 'vt-step';
    this.tStart = data.tStart ?? null;
    this.values = data.values ? [...data.values] : [];
    this.x0 = data.x0 ?? 0;
    this.label = data.label ?? 'A';
    return this;
  }
}
