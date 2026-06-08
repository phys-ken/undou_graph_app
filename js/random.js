/**
 * SeededRandom - シード値による再現可能な乱数 + ハッシュ + シャッフル
 *
 * 用途: 選択肢問題のシャッフル順を「問題波形 + パラメータ + 選択肢数」
 *       から決定論的に決める。同じ条件で再生成すれば同じ順序になる。
 *
 * - hashString  : djb2 ハッシュ（文字列 → 32bit 符号なし整数）
 * - mulberry32  : シード可能な PRNG（軽量・周期 2^32）
 * - seededShuffle: Fisher-Yates シャッフル（シード値で再現可能）
 */
const SeededRandom = {
  /**
   * djb2 文字列ハッシュ（32bit 符号なし整数を返す）
   * 同じ文字列に対しては常に同じ値を返す。
   */
  hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash >>> 0; // 32bit unsigned に強制
    }
    return hash;
  },

  /**
   * mulberry32: 32bit シード可能 PRNG。
   * 戻り値は [0, 1) の浮動小数を返す関数。
   */
  mulberry32(seed) {
    let state = seed >>> 0;
    return function() {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  /**
   * Fisher-Yates シャッフル（シード値で再現可能）
   * 入力配列は変更せず、新しい配列を返す。
   */
  seededShuffle(arr, seed) {
    const result = arr.slice();
    const rng = SeededRandom.mulberry32(seed);
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  },

  /**
   * シャッフル後のインデックスマップを返す
   * 返り値[i] = シャッフル後 i 番目の元の位置
   * 例: [2, 0, 1] → 元の0番目が新しい1番目、1番目が2番目、2番目が0番目
   */
  seededShuffleIndices(length, seed) {
    const indices = [];
    for (let i = 0; i < length; i++) indices.push(i);
    return SeededRandom.seededShuffle(indices, seed);
  },
};
