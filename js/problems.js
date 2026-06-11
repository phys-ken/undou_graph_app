/**
 * KinematicsProblemGenerator - 運動グラフ設問テンプレート生成
 *
 * legacy_nami_app の ProblemGenerator（波の重ね合わせ用）の構造をフォークし、
 * 運動グラフ（x-t / v-t / a-t）向けに作り直したもの。
 *
 * 設問は2系統:
 *   ① グラフ変換型  generateGraphConversion — 手描きグラフから別の運動グラフを導出させる
 *   ② 数値・記述型  generateNumeric         — 自由記述の数値・説明問題（選択肢化しない）
 *
 * 出力 Canvas は常に pixelRatio=2（印刷・PDF品質）。画面表示は style.width で
 * 論理サイズに縮小する（legacy と同じ方式）。
 *
 * 戻り値の形式は { question: { text, canvases }, answer: { text, canvases } }
 * に統一する（legacy の questionText/questionCanvases 形式とは異なるが、
 * 運動グラフは「問題1systemにつき多くて2〜3 Canvas」とシンプルなため、
 * ネストした方が呼び出し側の見通しが良いと判断した — 設計上の意図的な相違）。
 */
class KinematicsProblemGenerator {
  constructor(state) {
    this.state = state; // { gridConfig, styleConfig, cellSize? }
    this.PR    = 2;     // pixelRatio（印刷品質）
  }

  /** 選択肢ラベル用の丸数字（legacy_nami_app の api/serialize.js CIRCLED_DIGITS と同じ規約） */
  static get CIRCLED_DIGITS() {
    return ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
  }

  // ----------------------------------------------------------------
  // キャンバス・レンダラ生成ヘルパー
  // ----------------------------------------------------------------

  /** メインのグラフ用 Canvas 寸法（論理px）。cellSize 未指定なら 580×200 */
  _mainSize() {
    return MotionGraphRenderer.computeCanvasSize(this.state.gridConfig, this.state.cellSize);
  }

  /** 任意寸法で Canvas を生成（dispW/dispH 省略時は _mainSize()） */
  _makeCanvas(dispW, dispH) {
    if (dispW === undefined || dispH === undefined) {
      const s = this._mainSize();
      dispW = s.width;
      dispH = s.height;
    }
    const canvas = document.createElement('canvas');
    canvas.width        = dispW * this.PR;
    canvas.height       = dispH * this.PR;
    canvas.style.width  = `${dispW}px`;
    canvas.style.height = `${dispH}px`;
    return canvas;
  }

  /**
   * gridConfig + styleConfig から MotionGraphRenderer を組み立てる
   * （App._setupEditor / App.renderDerivedGraphs と同じ慣習: gridStyle と
   * stylePreset の両方を渡す）
   */
  _makeRenderer(canvas, configOverride = {}) {
    const sc = this.state.styleConfig;
    return new MotionGraphRenderer(
      canvas,
      Object.assign(
        {},
        this.state.gridConfig,
        configOverride,
        { pixelRatio: this.PR, gridStyle: sc ? sc.grid : undefined, stylePreset: sc }
      )
    );
  }

  /**
   * 手描きグラフ（単一カーブ）を描く際の固定スタイルを返す
   *
   * STYLE_PRESETS の xt/vt/at 別スタイル（bw では破線パターンで区別）は、
   * 複数カーブが同一 Canvas に並ぶ「導出グラフ」表示でこそ意味を持つ。
   * 設問の「元にするグラフ」は単一カーブなので、それを適用すると
   * v-t を選んだだけで常に破線表示になってしまう（MotionGraphEditor と
   * 同じ問題 — editor.js _curveStyle() 参照）。そのため種類によらず
   * 固定の実線スタイルを使う。
   */
  static _handDrawnStyle() {
    return { color: '#c9551a', lineWidth: 2.5 };
  }

  /**
   * sourceKind に応じて Kinematics.deriveFromVT / deriveFromXT / deriveFromVTStep を呼び分ける。
   * 各呼び出し元が個別に持っていた3分岐ディスパッチを共通化したもの
   * （'vt'|'xt' は従来どおり `source.kind` を sourceKind に揃えてから呼ぶが、
   * StepMotionGraph は kind が常に 'vt-step' 固定でそもそも不一致が起こらないため、
   * `source.kind = sourceKind` の代入は 'vt'|'xt' の場合のみ行う）。
   *
   * @param {MotionGraph|StepMotionGraph} source
   * @param {'vt'|'xt'|'vt-step'} sourceKind
   * @param {number} [x0]  v-t系（'vt'|'vt-step'）の積分基準点
   * @returns {{vt:Curve, xt:Curve, at:Curve}}
   */
  static _deriveForSource(source, sourceKind, x0) {
    if (sourceKind === 'vt-step') {
      if (x0 !== undefined) source.x0 = x0;
      return Kinematics.deriveFromVTStep(source);
    }
    if (sourceKind !== source.kind) source.kind = sourceKind;
    if (sourceKind === 'vt') {
      source.x0 = x0 ?? source.x0 ?? 0;
      return Kinematics.deriveFromVT(source);
    }
    return Kinematics.deriveFromXT(source);
  }

  /** 軸ラベル（日本語の物理記法）を運動グラフの種類から決める */
  static _yLabel(kind) {
    if (kind === 'xt') return '位置 x [m]';
    if (kind === 'vt' || kind === 'vt-step') return '速度 v [m/s]';
    return '加速度 a [m/s²]';
  }

  /**
   * カーブの値域から、見やすい余白付きの y 軸範囲を求める
   * （App._autoValueRange と同じロジック — 自動導出グラフタブと模範解答とで
   * 「種類ごとに自分の値域に合わせて軸を独立に決める」という見せ方を揃えるため）。
   *
   * @param {Curve} curve
   * @param {number} tMin
   * @param {number} tMax
   * @returns {{yMin:number, yMax:number}}
   */
  static _autoValueRange(curve, tMin, tMax) {
    const { lo, hi } = KinematicsProblemGenerator._curveExtent(curve, tMin, tMax);
    return KinematicsProblemGenerator._marginFromExtent(lo, hi);
  }

  /** カーブのセグメントを密にサンプリングして [tMin, tMax] 内の値域 {lo, hi} を求める */
  static _curveExtent(curve, tMin, tMax) {
    const SAMPLES_PER_UNIT = 10;
    let lo = Infinity, hi = -Infinity;

    if (curve && curve.segments) {
      curve.segments.forEach(seg => {
        const segT0 = Math.max(seg.t0, tMin);
        const segT1 = Math.min(seg.t1, tMax);
        if (segT1 <= segT0) return;
        const span = segT1 - segT0;
        const n = Math.max(1, Math.ceil(span * SAMPLES_PER_UNIT));
        for (let i = 0; i <= n; i++) {
          const t = segT0 + (span * i) / n;
          const dt = t - seg.t0;
          const v = seg.c0 + seg.c1 * dt + seg.c2 * dt * dt;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      });
    }
    return { lo, hi };
  }

  /** 手描き風グラフ（MotionGraph、区分線形）の頂点列から [tMin, tMax] 内の値域 {lo, hi} を求める */
  static _graphExtent(graph, tMin, tMax) {
    let lo = Infinity, hi = -Infinity;
    if (graph && !graph.isEmpty() && typeof graph.getSnapshot === 'function') {
      graph.getSnapshot(tMin, tMax).forEach(p => {
        if (p.value < lo) lo = p.value;
        if (p.value > hi) hi = p.value;
      });
    }
    return { lo, hi };
  }

  /**
   * {lo, hi} の値域に余白・原点を加味した {yMin, yMax} を組み立てる（_autoValueRange の後段）。
   *
   * 余白を加えただけの境界は目盛り間隔の倍数からずれるため、drawGrid が
   * 上下端ぴったりに補助線を引けず「上端（または下端）の補助グリッド線が
   * 消えている」ように見える（目盛りは yMax 未満の最後の倍数までしか
   * 描かれないため）。そこで最終的に yMin/yMax を目盛り間隔の倍数に
   * 外側へスナップし、グラフ枠の上下端に必ず補助線が来るようにする。
   */
  static _marginFromExtent(lo, hi) {
    if (!isFinite(lo) || !isFinite(hi)) {
      return { yMin: -2, yMax: 2 };
    }
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const range  = hi - lo;
    const margin = Math.max(range * 0.15, 0.5);
    let yMin = lo - margin;
    let yMax = hi + margin;

    if (yMin > 0) yMin = Math.min(yMin, 0);
    if (yMax < 0) yMax = Math.max(yMax, 0);

    const step = MotionGraphRenderer.computeTickStep(yMax - yMin);
    yMin = Math.floor(yMin / step) * step;
    yMax = Math.ceil(yMax / step) * step;

    return { yMin, yMax };
  }

  /**
   * Canvas 1枚につき単一カーブしか描かない場面（自動導出グラフ・模範解答）向けに、
   * x-t/v-t/a-t 間で見た目（実線・太さ）を揃えたカーブスタイルを返す。
   *
   * STYLE_PRESETS の bw は本来「複数カーブが同一 Canvas に重なる」場面のために
   * 種類ごとに線幅・破線パターンを変えているが、このアプリでは drawCurve の
   * 呼び出し箇所が常に単一カーブであるため、その描き分けは機能しておらず、
   * 同じ運動の対等な3つの側面（位置・速度・加速度）が「グラフごとに線の太さが
   * 違って見える」という副作用だけが残る。色は種類ごとの意味を保ちつつ、
   * 実線・太さ（xt の値を基準とする）を統一する。
   *
   * @param {Object} preset STYLE_PRESETS.bw / .color などのプリセットオブジェクト
   * @param {'xt'|'vt'|'at'} kind
   * @returns {Object} drawCurve に渡せるカーブスタイル
   */
  static singleCurveStyle(preset, kind) {
    const p = preset || {};
    const base = p[kind] || {};
    const ref  = p.xt || base;
    return Object.assign({}, base, { dashed: false, dashPattern: [], lineWidth: ref.lineWidth });
  }

  /**
   * 模範解答として単独描画するカーブのスタイルを返す
   * （x-t/v-t/a-t 間で実線・太さを揃える singleCurveStyle に委譲）。
   *
   * @param {'xt'|'vt'|'at'} kind
   */
  _solidCurveStyle(kind) {
    return KinematicsProblemGenerator.singleCurveStyle(this.state.styleConfig, kind);
  }

  /**
   * Curve を Canvas に描画する（カーブ本体 + リサー + 未定義マーカー）。
   * 運動グラフ特有の要素（discontinuities / undefinedInstants）を
   * 一貫した見た目で扱うための共通ヘルパー。
   *
   * @param {MotionGraphRenderer} r
   * @param {Curve} curve
   * @param {number} tMin
   * @param {number} tMax
   */
  _drawCurveWithMarkers(r, curve, tMin, tMax) {
    const sc = this.state.styleConfig || {};
    if (!curve || !curve.segments || curve.segments.length === 0) return;

    r.drawCurve(curve, this._solidCurveStyle(curve.kind), tMin, tMax);

    (curve.discontinuities || []).forEach(t => {
      const before = this._curveValueApproachingFromLeft(curve, t);
      const after  = this._curveValueApproachingFromRight(curve, t);
      if (before !== null && after !== null) {
        r.drawDiscontinuity(t, before, after, sc.riser || {});
      }
    });

    // 未定義の瞬間（例: x-t の角から逆算した a-t）は破線・グレーで
    // 「曖昧」だと明示する（CLAUDE.md の設計ルール — 非表示にはしない）
    (curve.undefinedInstants || []).forEach(t => {
      r.drawUndefinedMarker(t, sc.undefinedMark || {});
    });
  }

  /**
   * 不連続点 t の直前セグメントの終端値（リサー描画用。App._curveValueApproachingFromLeft と同じロジック）
   * 曲線の最初のセグメントより前には何もない＝静止（値0）とみなす。
   */
  _curveValueApproachingFromLeft(curve, t) {
    let best = null;
    curve.segments.forEach(seg => {
      if (seg.t1 <= t + 1e-9 && seg.t1 >= t - 1e-6) {
        const dt = seg.t1 - seg.t0;
        best = seg.c0 + seg.c1 * dt + seg.c2 * dt * dt;
      }
    });
    if (best === null && curve.segments.length > 0 && t <= curve.segments[0].t0 + 1e-6) {
      best = 0;
    }
    return best;
  }

  /**
   * 不連続点 t の直後セグメントの始端値（リサー描画用）
   * 曲線の最後のセグメントより後には何もない＝静止（値0）とみなす。
   */
  _curveValueApproachingFromRight(curve, t) {
    let best = null;
    curve.segments.forEach(seg => {
      if (seg.t0 >= t - 1e-9 && seg.t0 <= t + 1e-6) {
        if (best === null) best = seg.c0;
      }
    });
    if (best === null && curve.segments.length > 0) {
      const last = curve.segments[curve.segments.length - 1];
      if (t >= last.t1 - 1e-6) best = 0;
    }
    return best;
  }

  /**
   * グラフ（手描き graph または導出 curve）を描いた Canvas を返す共通ヘルパー
   * @param {Object} opts
   *   opts.curve  {Curve}        描画する導出済みカーブ（あれば優先）
   *   opts.graph  {MotionGraph|StepMotionGraph} 手描きグラフ（curve 未指定時、ポリライン
   *                                  または階段状カーブ＋リサーとして描く）
   *   opts.kind   {'xt'|'vt'|'at'} 軸ラベル決定用
   *   opts.label  {string}       右上に表示する補助ラベル（凡例代わりの説明文）
   */
  _renderGraphCanvas(opts) {
    const { curve, graph, kind, range } = opts;
    const canvas = this._makeCanvas();
    // 導出カーブは手描きグラフとは値域が大きく異なりうる（例: v-t を積分した
    // x-t の変位は手描き v の範囲よりずっと大きい）。種類ごとに自分の値域へ
    // 独立に合わせる（renderDerivedGraphs/_autoValueRange と同じ見せ方）ことで、
    // 模範解答のカーブが解答欄からはみ出さないようにする。
    // ただし呼び出し側が range を明示した場合（選択肢問題で複数 Canvas の
    // 縮尺を揃えたい場合など）はそちらを優先する。
    const g = this.state.gridConfig;
    const configOverride = range
      ? range
      : curve
        ? KinematicsProblemGenerator._autoValueRange(curve, g.xMin, g.xMax)
        : {};
    const r = this._makeRenderer(canvas, configOverride);
    const c = r.config;
    r.clear();
    r.drawGrid();
    r.drawAxes({ xLabel: '時刻 t [s]', yLabel: KinematicsProblemGenerator._yLabel(kind) });

    if (curve) {
      this._drawCurveWithMarkers(r, curve, c.xMin, c.xMax);
    } else if (graph && graph.kind === 'vt-step' && !graph.isEmpty()) {
      // 階段状 v-t グラフ（StepMotionGraph）— StepGraphEditor.render() と
      // 同じロジックで「区分定数カーブ＋段差リサー」を描く（getSnapshot/points を持たないため）
      const stepCurve = Kinematics.curveFromStepGraph(graph);
      const style = KinematicsProblemGenerator._handDrawnStyle();
      r.drawCurve(stepCurve, style, c.xMin, c.xMax);
      stepCurve.discontinuities.forEach(t => {
        const valueBefore = graph.values[t - graph.tStart - 1];
        const valueAfter  = graph.values[t - graph.tStart];
        r.drawDiscontinuity(t, valueBefore, valueAfter, {
          color: style.color,
          dashed: false,
          lineWidth: style.lineWidth,
        });
      });
    } else if (graph && !graph.isEmpty()) {
      r.drawPolyline(graph.getSnapshot(c.xMin, c.xMax), KinematicsProblemGenerator._handDrawnStyle());
    }
    return canvas;
  }

  /** 空白の解答欄（グリッド＋軸のみ）を描いた Canvas を返す */
  _renderBlank(kind) {
    const canvas = this._makeCanvas();
    const r = this._makeRenderer(canvas);
    r.clear();
    r.drawGrid();
    r.drawAxes({ xLabel: '時刻 t [s]', yLabel: KinematicsProblemGenerator._yLabel(kind) });
    return canvas;
  }

  // ================================================================
  // ① グラフ変換型
  // ================================================================

  /**
   * 手描きグラフから別の運動グラフ（複数可）を導出させる設問を生成する
   *
   * @param {Object} params
   *   params.source     {MotionGraph|StepMotionGraph} 手描きグラフ
   *   params.sourceKind {'vt'|'xt'|'vt-step'} 手描きグラフの種類（= source.kind と一致させること）
   *   params.askFor     {Array<'xt'|'vt'|'at'>} 学生に描かせる対象（複数可）
   *   params.x0         {number} v-t系（'vt'|'vt-step'）始点の場合の積分基準点（x-t 導出に必要）
   * @returns {{ question: {text, canvases}, answer: {text, canvases} }}
   */
  generateGraphConversion({ source, sourceKind, askFor, x0 }) {
    const derived = KinematicsProblemGenerator._deriveForSource(source, sourceKind, x0);

    const sourceLabel = (sourceKind === 'vt' || sourceKind === 'vt-step')
      ? 'v-t（速度-時間）'
      : 'x-t（位置-時間）';
    const targetLabels = askFor.map(k => KinematicsProblemGenerator._kindLabel(k));

    const questionText =
      `下図は、ある物体の${sourceLabel}グラフである。\n` +
      `この運動について、${targetLabels.join('・')}グラフをそれぞれ描け。`;

    const questionCanvases = [
      this._renderGraphCanvas({ graph: source, kind: sourceKind }),
      ...askFor.map(k => this._renderBlank(k)),
    ];

    const answerNotes = [];
    askFor.forEach(k => {
      if (k === 'at' && derived.at.undefinedInstants && derived.at.undefinedInstants.length > 0) {
        answerNotes.push(
          '※ a-t グラフの「?」マーカーの時刻は、x-t の角（速度が不連続にジャンプする点）に' +
          '対応しており、加速度の値が定義できない（撃力的に変化する）瞬間を表す。'
        );
      }
    });

    const answerText =
      `${targetLabels.join('・')}グラフ（解答例）\n` +
      (answerNotes.length > 0 ? answerNotes.join('\n') : '上の手描きグラフから直接導出した結果。');

    const answerCanvases = askFor.map(k => this._renderGraphCanvas({ curve: derived[k], kind: k }));

    return {
      question: { text: questionText, canvases: questionCanvases },
      answer:   { text: answerText,   canvases: answerCanvases },
    };
  }

  // ================================================================
  // ③ グラフ選択肢型（API 専用 — UI からは生成しない）
  // ================================================================
  //
  // CLAUDE.md / CONTEXT.md の方針:
  //   「グラフが選択肢になる問題はUIからは作らず、API側でのみ対応する」
  //   「誤答グラフは API 呼び出し側（AIエージェント）が指定する」
  // この app の役割は「正答グラフの導出・描画 + 呼び出し側が与えた誤答グラフの
  // 描画 + 決定論的シードによるシャッフル整形」のみであり、誤答そのものを
  // 生成するロジックは持たない（教育的に「生徒に手描きさせたい」という理由で
  // UI には絶対に置かない——ボタンを生やさないことで担保する）。

  /**
   * グラフ選択肢問題を生成する
   *
   * 「下図の [v-t/x-t] グラフに対応する [x-t/v-t/a-t] グラフはどれか」
   * という形式の多肢選択問題。正答は Kinematics.deriveFromVT/XT で導出し、
   * 誤答（distractors）は呼び出し側が MotionGraph 形状の JSON で与える
   * 「生徒が誤って描きそうなグラフ」をそのまま手描き風ポリラインとして描く
   * （導出エンジンを通さない——もっともらしい誤答に見せることが目的のため）。
   *
   * @param {Object} params
   *   params.source      {MotionGraph|StepMotionGraph} 問題文に示す手描きグラフ（与えられたグラフ）
   *   params.sourceKind  {'vt'|'xt'|'vt-step'} source の種類
   *   params.askFor      {'xt'|'vt'|'at'} 選択肢として問う対象（単一）
   *   params.distractors {Array<Object>} MotionGraph.toJSON() 形状の誤答グラフ JSON 配列
   *   params.x0          {number} v-t系（'vt'|'vt-step'）始点の場合の積分基準点（x-t 導出に必要）
   *   params.shuffle     {boolean} 選択肢をシャッフルするか（既定 true）
   * @returns {{
   *   question: {text, canvases},
   *   answer:   {text},
   *   choices:  Array<{canvas, isCorrect, label}>,
   *   correctIndex: number,
   *   seed: number,
   * }}
   */
  generateGraphChoice({ source, sourceKind, askFor, distractors = [], x0, shuffle = true }) {
    const derived = KinematicsProblemGenerator._deriveForSource(source, sourceKind, x0);
    const correctCurve = derived[askFor];

    // 誤答グラフを MotionGraph として復元（描画は手描き風ポリライン——
    // Kinematics.derive* を通さないことで「もっともらしい誤答」の見た目を保つ）
    const distractorGraphs = distractors.map(json => new MotionGraph().fromJSON(json));

    const sourceLabel = (sourceKind === 'vt' || sourceKind === 'vt-step')
      ? 'v-t（速度-時間）'
      : 'x-t（位置-時間）';
    const targetLabel = KinematicsProblemGenerator._kindLabel(askFor);

    // 選択肢はすべて同じ種類（askFor）のグラフなので、正答・誤答を問わず
    // 同じ縮尺で並べないと「見た目の大小だけで選べてしまう／選べなくなる」
    // という不公平が生じる。よって全選択肢の値域をまとめて1つの range にする
    // （他の種類の Curve とは独立——本メソッド内で完結する共有レンジ）。
    const grid = this.state.gridConfig;
    let lo = Infinity, hi = -Infinity;
    const correctExtent = KinematicsProblemGenerator._curveExtent(correctCurve, grid.xMin, grid.xMax);
    lo = Math.min(lo, correctExtent.lo);
    hi = Math.max(hi, correctExtent.hi);
    distractorGraphs.forEach(dg => {
      const ext = KinematicsProblemGenerator._graphExtent(dg, grid.xMin, grid.xMax);
      lo = Math.min(lo, ext.lo);
      hi = Math.max(hi, ext.hi);
    });
    const choiceRange = KinematicsProblemGenerator._marginFromExtent(lo, hi);

    // シャッフル前の並び（順序固定: ① 正答 ② 誤答1 ③ 誤答2 …）と
    // それぞれの canvas/isCorrect を組み立て、決定論的シードでシャッフルする
    // （legacy app の _buildChoices / shuffleChoicesWithSeed と同じ考え方）。
    const items = [
      { canvas: this._renderGraphCanvas({ curve: correctCurve, kind: askFor, range: choiceRange }), isCorrect: true },
      ...distractorGraphs.map(g => ({
        canvas: this._renderGraphCanvas({ graph: g, kind: askFor, range: choiceRange }),
        isCorrect: false,
      })),
    ];

    const seed = KinematicsProblemGenerator.buildGraphChoiceSeed(source, sourceKind, askFor, distractors, x0);
    const { ordered, correctIndex } = shuffle
      ? KinematicsProblemGenerator._shuffleChoices(items, seed)
      : { ordered: items, correctIndex: 0 };

    const choices = ordered.map((item, i) => ({
      canvas: item.canvas,
      isCorrect: item.isCorrect,
      label: KinematicsProblemGenerator.CIRCLED_DIGITS[i] || `(${i + 1})`,
    }));

    const questionText =
      `下図は、ある物体の${sourceLabel}グラフである。\n` +
      `この運動に対応する${targetLabel}グラフとして正しいものを、下の①〜${KinematicsProblemGenerator.CIRCLED_DIGITS[choices.length - 1] || `(${choices.length})`}` +
      `のうちから一つ選べ。`;

    const questionCanvases = [
      this._renderGraphCanvas({ graph: source, kind: sourceKind }),
    ];

    const answerText =
      `正答: ${choices[correctIndex].label}\n` +
      `${sourceLabel}グラフから導出した${targetLabel}グラフが正しい対応関係である` +
      (correctCurve && correctCurve.undefinedInstants && correctCurve.undefinedInstants.length > 0
        ? '（「?」マーカーの時刻は、角の瞬間で値が定義できない「曖昧な瞬間」を表す）。'
        : '。');

    return {
      question: { text: questionText, canvases: questionCanvases },
      answer:   { text: answerText },
      choices,
      correctIndex,
      seed,
    };
  }

  /** 'xt'/'vt'/'at' から日本語の表示ラベルを返す（共通化のため切り出し） */
  static _kindLabel(kind) {
    if (kind === 'xt') return 'x-t（位置-時間）';
    if (kind === 'vt') return 'v-t（速度-時間）';
    return 'a-t（加速度-時間）';
  }

  /**
   * グラフ選択肢問題用のシード値を決定論的に作る。
   * 「与えられたグラフ + その種類 + 問う対象 + 誤答グラフ群 + 積分定数」の
   * すべてを文字列化してハッシュする — どれか一つでも変われば違うシャッフルになる
   * （buildSeed と同じ djb2 ハッシュ規約を流用し、専用の文字列構成のみ追加する）。
   */
  static buildGraphChoiceSeed(source, sourceKind, askFor, distractors, x0) {
    const seedSource =
      `graphChoice|${JSON.stringify(source.toJSON())}|${sourceKind}|${askFor}|` +
      `${JSON.stringify(distractors)}|x0=${x0 ?? ''}`;
    return SeededRandom.hashString(seedSource);
  }

  /**
   * 選択肢配列をシード値で決定論的にシャッフルする（純粋関数・テスト容易）。
   * 入力は「先頭が正答」の前提（_buildChoices と同じ並び）。
   * legacy の Exporter.shuffleChoicesWithSeed と同じ考え方をこちらに移植し、
   * Canvas 非依存にすることで Node テスト環境でも検証できるようにした。
   *
   * @param {Array<{isCorrect: boolean, ...}>} items 先頭が正答の配列
   * @param {number} seed
   * @returns {{ordered: Array, correctIndex: number, indices: number[]}}
   *   ordered: シャッフル後の配列
   *   correctIndex: シャッフル後に正答が来たインデックス
   *   indices: シャッフル後の i 番目が元の何番目だったか
   */
  static _shuffleChoices(items, seed) {
    const indices = SeededRandom.seededShuffleIndices(items.length, seed);
    const ordered = indices.map(i => items[i]);
    const correctIndex = indices.indexOf(0);
    return { ordered, correctIndex, indices };
  }

  // ================================================================
  // ② 数値・記述型（自由記述のみ）
  // ================================================================

  /**
   * 数値・記述問題を生成する
   *
   * @param {Object} params
   *   params.source     {MotionGraph|StepMotionGraph}
   *   params.sourceKind {'vt'|'xt'|'vt-step'}
   *   params.subtype    {'acceleration'|'displacement'|'direction'|'describe'}
   *   params.params     {Object} サブタイプ別の追加パラメータ（interval 等）。
   *                       省略時は SeededRandom で決定論的にランダム選択する。
   * @returns {{ question: {text, canvases}, answer: {text, canvases} }}
   */
  generateNumeric({ source, sourceKind, subtype, params = {} }) {
    const derived = KinematicsProblemGenerator._deriveForSource(source, sourceKind);

    switch (subtype) {
      case 'acceleration': return this._generateAcceleration(source, derived, params);
      case 'displacement': return this._generateDisplacement(source, derived, params);
      case 'direction':    return this._generateDirection(source, derived, params);
      case 'describe':     return this._generateDescribe(source, derived, params);
      default:
        throw new Error(`未知の数値・記述問題サブタイプ: ${subtype}`);
    }
  }

  // ----------------------------------------------------------------
  // サブタイプ共通: 区間選択（決定論的乱数）
  // ----------------------------------------------------------------

  /**
   * シード値を「グラフの内容 + サブタイプ + 補助情報」から決定論的に作る。
   * 同じグラフ・同じ条件で再生成すれば同じ区間が選ばれる
   * （legacy app の _buildChoicesSeedSource と同じ考え方）。
   */
  static buildSeed(graph, subtype, extra = '') {
    return SeededRandom.hashString(`${subtype}|${JSON.stringify(graph.toJSON())}|${extra}`);
  }

  /**
   * 区分カーブ（vt や at）からランダムに1セグメント区間を選ぶ。
   * params.interval = {t0, t1} が明示指定されていればそれを優先する。
   *
   * @param {Curve} curve   区間候補を持つカーブ（通常は vt または at）
   * @param {Object} params { interval?: {t0, t1} }
   * @param {number} seed
   * @returns {{t0:number, t1:number}|null}
   */
  static pickInterval(curve, params, seed) {
    if (params && params.interval) return params.interval;
    if (!curve || !curve.segments || curve.segments.length === 0) return null;
    const idx = Math.floor(SeededRandom.mulberry32(seed)() * curve.segments.length);
    const seg = curve.segments[Math.min(idx, curve.segments.length - 1)];
    return { t0: seg.t0, t1: seg.t1 };
  }

  // ----------------------------------------------------------------
  // 数値・記述: acceleration（加速度を求める）
  // ----------------------------------------------------------------
  _generateAcceleration(source, derived, params) {
    const seed = KinematicsProblemGenerator.buildSeed(source, 'acceleration', JSON.stringify(params));
    const interval = KinematicsProblemGenerator.pickInterval(derived.at, params, seed);
    if (!interval) {
      throw new Error('加速度を計算できる区間がありません。グラフを描いてください。');
    }
    const { t0, t1 } = interval;
    const a = KinematicsProblemGenerator._segmentValueAt(derived.at, (t0 + t1) / 2);

    const questionText =
      `下図は、ある物体の${(source.kind === 'vt' || source.kind === 'vt-step') ? 'v-t' : 'x-t'} グラフである。\n` +
      `t = ${KinematicsProblemGenerator._fmt(t0)} 〜 ${KinematicsProblemGenerator._fmt(t1)} s の間の加速度を求めよ。`;
    const questionCanvases = [this._renderGraphCanvas({ graph: source, kind: source.kind })];

    const seg = KinematicsProblemGenerator._segmentAt(derived.vt, (t0 + t1) / 2);
    const calcText = (seg !== null)
      ? `加速度 a = (速度の変化量) ÷ (経過時間)\n` +
        `  = (${KinematicsProblemGenerator._fmt(KinematicsProblemGenerator._segmentValueAt(derived.vt, t1))} ` +
        `− ${KinematicsProblemGenerator._fmt(KinematicsProblemGenerator._segmentValueAt(derived.vt, t0))}) ÷ ` +
        `(${KinematicsProblemGenerator._fmt(t1)} − ${KinematicsProblemGenerator._fmt(t0)})\n` +
        `  = ${KinematicsProblemGenerator._fmt(a)} m/s²`
      : `a = ${KinematicsProblemGenerator._fmt(a)} m/s²`;

    return {
      question: { text: questionText, canvases: questionCanvases },
      answer:   { text: `a = ${KinematicsProblemGenerator._fmt(a)} m/s²\n${calcText}`, canvases: [] },
    };
  }

  // ----------------------------------------------------------------
  // 数値・記述: displacement（変位を求める = v-t の面積）
  // ----------------------------------------------------------------
  _generateDisplacement(source, derived, params) {
    const seed = KinematicsProblemGenerator.buildSeed(source, 'displacement', JSON.stringify(params));
    const vt = derived.vt;
    if (!vt || !vt.segments || vt.segments.length === 0) {
      throw new Error('変位を計算できる区間がありません。グラフを描いてください。');
    }

    // params.interval 指定時はその区間、それ以外は手描き全体の範囲（全変位）を対象にする
    const interval = (params && params.interval)
      ? params.interval
      : { t0: vt.segments[0].t0, t1: vt.segments[vt.segments.length - 1].t1 };

    // 区間をセグメント境界 + 符号反転点（ゼロクロス）で分割し、それぞれの
    // 符号付き面積を積分で求める。1区間内で v の符号が変わる場合に
    // 単純に積分すると正負が打ち消し合って「面積の合計」という直感と
    // ズレるため、塗り分け（drawFilledArea）・計算式の両方で分割して示す。
    const subIntervals = this._splitIntervalBySigns(vt, this._splitIntervalBySegments(vt, interval));
    const parts = subIntervals.map(iv => ({
      ...iv,
      area: KinematicsProblemGenerator._integrateSegmentArea(vt, iv.t0, iv.t1),
    }));
    const total = parts.reduce((s, p) => s + p.area, 0);

    const questionText =
      `下図は、ある物体の${(source.kind === 'vt' || source.kind === 'vt-step') ? 'v-t' : 'x-t'} グラフである。\n` +
      `t = ${KinematicsProblemGenerator._fmt(interval.t0)} 〜 ${KinematicsProblemGenerator._fmt(interval.t1)} s の間の変位を求めよ。`;
    const questionCanvases = [this._renderGraphCanvas({ graph: source, kind: source.kind })];

    // v-t グラフ上に符号付き面積を塗りつぶして可視化（面積=変位）
    // source が x-t の場合、derived.vt は手描きの値域とは無関係な導出カーブに
    // なりうるため、共有 gridConfig ではなく vt 自身の値域に合わせて軸を取る。
    const answerCanvas = this._makeCanvas();
    const grid = this.state.gridConfig;
    const r = this._makeRenderer(answerCanvas, KinematicsProblemGenerator._autoValueRange(vt, grid.xMin, grid.xMax));
    const c = r.config;
    r.clear();
    r.drawGrid();
    r.drawAxes({ xLabel: '時刻 t [s]', yLabel: KinematicsProblemGenerator._yLabel('vt') });
    this._drawCurveWithMarkers(r, vt, c.xMin, c.xMax);
    const sc = this.state.styleConfig || {};
    r.drawFilledArea(vt, parts.map(p => ({ t0: p.t0, t1: p.t1 })), sc.fill || {});

    const calcLines = parts.map((p, i) =>
      `  区間${i + 1}（t=${KinematicsProblemGenerator._fmt(p.t0)}〜${KinematicsProblemGenerator._fmt(p.t1)}）: ` +
      `${KinematicsProblemGenerator._fmt(p.area)} m`
    );
    const calcText = (parts.length > 1)
      ? `各区間の符号付き面積（速度が負の区間はマイナス）を合計する。\n` +
        calcLines.join('\n') + `\n  合計: ` +
        `${parts.map(p => KinematicsProblemGenerator._fmt(p.area)).join(' + ')} = ${KinematicsProblemGenerator._fmt(total)} m`
      : `変位 = 面積 = ${KinematicsProblemGenerator._fmt(total)} m`;

    return {
      question: { text: questionText, canvases: questionCanvases },
      answer:   { text: `変位 = ${KinematicsProblemGenerator._fmt(total)} m\n${calcText}`, canvases: [answerCanvas] },
    };
  }

  /** 区間 [t0,t1] を vt のセグメント境界で分割した部分区間配列を返す */
  _splitIntervalBySegments(curve, interval) {
    const cuts = new Set([interval.t0, interval.t1]);
    curve.segments.forEach(seg => {
      if (seg.t0 > interval.t0 - 1e-9 && seg.t0 < interval.t1 - 1e-9) cuts.add(seg.t0);
      if (seg.t1 > interval.t0 + 1e-9 && seg.t1 < interval.t1 + 1e-9) cuts.add(seg.t1);
    });
    const sorted = [...cuts].sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1] - sorted[i] > 1e-9) result.push({ t0: sorted[i], t1: sorted[i + 1] });
    }
    return result.length > 0 ? result : [{ t0: interval.t0, t1: interval.t1 }];
  }

  /**
   * 各部分区間をさらに「v の符号が変わる時刻（ゼロクロス）」で分割する。
   * v-t が1セグメント内で正→負（または負→正）に変わる場合、その区間を
   * そのまま積分すると正負の寄与が打ち消し合い、「符号付き面積の合計」
   * という説明と数値が一致しなくなる。ゼロクロスで割ることで、
   * 各部分区間が常に同符号になり、塗り分け（drawFilledArea）・
   * 計算式の表示の両方で物理的に正しい説明ができる。
   *
   * @param {Curve} vt
   * @param {Array<{t0,t1}>} intervals
   * @returns {Array<{t0,t1}>}
   */
  _splitIntervalBySigns(vt, intervals) {
    const result = [];
    intervals.forEach(iv => {
      const v0 = KinematicsProblemGenerator._segmentValueAt(vt, iv.t0);
      const v1 = KinematicsProblemGenerator._segmentValueAt(vt, iv.t1);
      const seg = KinematicsProblemGenerator._segmentAt(vt, (iv.t0 + iv.t1) / 2);

      const signChanges = (v0 > 1e-9 && v1 < -1e-9) || (v0 < -1e-9 && v1 > 1e-9);
      if (signChanges && seg && Math.abs(seg.c1) > 1e-12) {
        const dtCross = -seg.c0 / seg.c1;
        const tCross  = seg.t0 + dtCross;
        if (tCross > iv.t0 + 1e-9 && tCross < iv.t1 - 1e-9) {
          result.push({ t0: iv.t0, t1: tCross });
          result.push({ t0: tCross, t1: iv.t1 });
          return;
        }
      }
      result.push(iv);
    });
    return result;
  }

  /**
   * カーブ（区分多項式）の [t0,t1] 区間の積分値（=符号付き面積）を解析的に求める。
   * セグメント内 v(t) = c0 + c1*dt + c2*dt^2 （dt = t - segT0）の不定積分は
   * c0*dt + c1/2*dt^2 + c2/3*dt^3。区間が複数セグメントにまたがる場合は
   * セグメントごとに積分して合計する（呼び出し側で境界をすでに分割している前提だが、
   * 念のため複数セグメント対応にしておく）。
   */
  static _integrateSegmentArea(curve, t0, t1) {
    let total = 0;
    curve.segments.forEach(seg => {
      const a = Math.max(seg.t0, t0);
      const b = Math.min(seg.t1, t1);
      if (b <= a) return;
      const da = a - seg.t0;
      const db = b - seg.t0;
      const F = (dt) => seg.c0 * dt + (seg.c1 / 2) * dt * dt + (seg.c2 / 3) * dt * dt * dt;
      total += F(db) - F(da);
    });
    return total;
  }

  // ----------------------------------------------------------------
  // 数値・記述: direction（速度が負になる区間 = 逆向きに運動する区間）
  // ----------------------------------------------------------------
  _generateDirection(source, derived, params) {
    const vt = derived.vt;
    const negativeIntervals = KinematicsProblemGenerator.findNegativeIntervals(vt);

    const questionText =
      `下図は、ある物体の${(source.kind === 'vt' || source.kind === 'vt-step') ? 'v-t' : 'x-t'} グラフである。\n` +
      `この物体が逆向きに運動している（速度が負である）区間はどこか、答えよ。`;
    const questionCanvases = [this._renderGraphCanvas({ graph: source, kind: source.kind })];

    const answerText = (negativeIntervals.length === 0)
      ? '速度が負になる区間はない（常に同じ向きに運動している、または静止している）。'
      : '速度が負になる区間: ' +
        negativeIntervals.map(iv =>
          `t = ${KinematicsProblemGenerator._fmt(iv.t0)} 〜 ${KinematicsProblemGenerator._fmt(iv.t1)} s`
        ).join('、');

    return {
      question: { text: questionText, canvases: questionCanvases },
      answer:   { text: answerText, canvases: [] },
    };
  }

  /**
   * v-t カーブから速度が負（v < 0）になる区間を求める（純粋関数・テスト容易）
   * 区分一次（c2=0）の vt セグメントに対して、符号が変わる場合はゼロクロス時刻で分割する。
   * @param {Curve} vt
   * @returns {Array<{t0:number, t1:number}>}
   */
  static findNegativeIntervals(vt) {
    if (!vt || !vt.segments) return [];
    const result = [];
    vt.segments.forEach(seg => {
      const v0 = seg.c0;
      const v1 = seg.c0 + seg.c1 * (seg.t1 - seg.t0);
      const negAtStart = v0 < -1e-9;
      const negAtEnd   = v1 < -1e-9;

      if (negAtStart && negAtEnd) {
        result.push({ t0: seg.t0, t1: seg.t1 });
      } else if (negAtStart !== negAtEnd && Math.abs(seg.c1) > 1e-12) {
        // ゼロクロス時刻 = -c0/c1 (dt 基準)
        const dtCross = -seg.c0 / seg.c1;
        const tCross  = seg.t0 + dtCross;
        if (negAtStart) result.push({ t0: seg.t0, t1: tCross });
        else            result.push({ t0: tCross, t1: seg.t1 });
      }
      // 両端とも非負ならその区間は含めない
    });

    // 隣接する区間を結合（境界がほぼ一致する場合）
    const merged = [];
    result.forEach(iv => {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last.t1 - iv.t0) < 1e-9) {
        last.t1 = iv.t1;
      } else {
        merged.push({ ...iv });
      }
    });
    return merged;
  }

  // ----------------------------------------------------------------
  // 数値・記述: describe（運動の様子を説明する模範解答テキスト生成）
  // ----------------------------------------------------------------
  _generateDescribe(source, derived, params) {
    const seed = KinematicsProblemGenerator.buildSeed(source, 'describe', JSON.stringify(params));
    const interval = KinematicsProblemGenerator.pickInterval(derived.vt, params, seed);
    if (!interval) {
      throw new Error('説明できる区間がありません。グラフを描いてください。');
    }
    const { t0, t1 } = interval;

    const questionText =
      `下図は、ある物体の${(source.kind === 'vt' || source.kind === 'vt-step') ? 'v-t' : 'x-t'} グラフである。\n` +
      `t = ${KinematicsProblemGenerator._fmt(t0)} 〜 ${KinematicsProblemGenerator._fmt(t1)} s の間の運動の様子を説明せよ。`;
    const questionCanvases = [this._renderGraphCanvas({ graph: source, kind: source.kind })];

    const v0 = KinematicsProblemGenerator._segmentValueAt(derived.vt, t0);
    const v1 = KinematicsProblemGenerator._segmentValueAt(derived.vt, t1);
    const a  = KinematicsProblemGenerator._segmentValueAt(derived.at, (t0 + t1) / 2);

    const answerText = KinematicsProblemGenerator.describeMotion(v0, v1, a, t0, t1);

    return {
      question: { text: questionText, canvases: questionCanvases },
      answer:   { text: answerText, canvases: [] },
    };
  }

  /**
   * 区間の始点速度・終点速度・加速度から、高校物理基礎レベルの
   * 「運動の様子」模範解答テキスト（日本語）を生成する（純粋関数・テスト容易）。
   *
   * 場合分け（高校生にとって直感的な分類を優先）:
   *   - |v0|, |v1| ともに ~0           → 静止している
   *   - a ~ 0                          → 等速直線運動（向きは v の符号で判定）
   *   - a ≠ 0 かつ |v| が増加          → （向き）に加速しながら進む運動（速さが増加）
   *   - a ≠ 0 かつ |v| が減少          → （向き）に進みながら減速する運動（速さが減少）
   *   - v の符号が反転                 → 一度停止して逆向きに運動を始める
   *
   * @returns {string}
   */
  static describeMotion(v0, v1, a, t0, t1) {
    const EPS = 1e-9;
    const fmt = KinematicsProblemGenerator._fmt;
    const dirOf = (v) => (v > EPS ? '正の向き（+）' : (v < -EPS ? '負の向き（-）' : null));

    const span = `t = ${fmt(t0)} 〜 ${fmt(t1)} s の間、`;

    // 静止
    if (Math.abs(v0) < EPS && Math.abs(v1) < EPS && Math.abs(a) < EPS) {
      return `${span}物体は静止している（速度 v = 0 のまま変化しない）。`;
    }

    // 等速直線運動（加速度がほぼ0）
    if (Math.abs(a) < EPS) {
      const dir = dirOf(v0) || dirOf(v1);
      return `${span}物体は ${dir} に、速さ ${fmt(Math.abs(v0))} m/s の等速直線運動をしている` +
             `（加速度 a = 0、速度が一定）。`;
    }

    // 速度の符号が反転（向きが変わる）
    if ((v0 > EPS && v1 < -EPS) || (v0 < -EPS && v1 > EPS)) {
      const dir0 = dirOf(v0);
      const dir1 = dirOf(v1);
      return `${span}物体は初め ${dir0} に進んでいたが、加速度 a = ${fmt(a)} m/s² で減速して` +
             `一旦停止し、その後 ${dir1} に運動を始める（向きが反転する）。`;
    }

    const dir = dirOf(v1) || dirOf(v0);
    const speeding = Math.abs(v1) > Math.abs(v0) + EPS;
    const slowing  = Math.abs(v1) < Math.abs(v0) - EPS;

    if (speeding) {
      return `${span}物体は ${dir} に、加速度 a = ${fmt(a)} m/s² で速さを増しながら運動している` +
             `（速さ ${fmt(Math.abs(v0))} → ${fmt(Math.abs(v1))} m/s に増加）。`;
    }
    if (slowing) {
      return `${span}物体は ${dir} に、加速度 a = ${fmt(a)} m/s² で速さを減らしながら運動している` +
             `（速さ ${fmt(Math.abs(v0))} → ${fmt(Math.abs(v1))} m/s に減少）。`;
    }
    // 速さが変わらないが加速度が非ゼロ（理論上は起きにくいが念のため）
    return `${span}物体は ${dir} に、加速度 a = ${fmt(a)} m/s² で運動している。`;
  }

  // ----------------------------------------------------------------
  // 数値ヘルパー
  // ----------------------------------------------------------------

  /** 時刻 t を含むセグメントを返す（端点は前のセグメント優先） */
  static _segmentAt(curve, t) {
    if (!curve || !curve.segments) return null;
    for (const seg of curve.segments) {
      if (t >= seg.t0 - 1e-9 && t <= seg.t1 + 1e-9) return seg;
    }
    return null;
  }

  /** カーブの時刻 t における値（区分多項式評価。セグメント境界は含む側で評価） */
  static _segmentValueAt(curve, t) {
    const seg = KinematicsProblemGenerator._segmentAt(curve, t);
    if (!seg) return 0;
    const dt = t - seg.t0;
    return seg.c0 + seg.c1 * dt + seg.c2 * dt * dt;
  }

  /** 数値を見やすい桁数に丸めて文字列化する（誤差を消すため小数第2位で丸める） */
  static _fmt(v) {
    const r = Math.round(v * 100) / 100;
    return String(r);
  }
}
