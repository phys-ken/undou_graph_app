/**
 * App - メインコントローラ
 * UI の状態管理、タブ切り替え、グラフ編集・自動導出表示を統括する
 *
 * legacy_nami_app の App（波アプリ用コントローラ）をフォークし、
 * 運動グラフ（v-t / x-t / a-t）向けに大幅に簡素化したもの。
 * Type1-7 設問生成・エクスポートは Milestone 4 以降で追加する。
 */
const App = {
  // ------------------------------------------------------------------
  // 状態
  // ------------------------------------------------------------------
  graphMode:  'vt',   // 'vt' | 'xt' | 'vt-step' — 手描き対象（他は自動導出表示に回る）
  gridConfig: { tMin: 0, tMax: 10, valMin: -2, valMax: 2 },
  cellSize:   { w: null, h: null }, // null=自動（580×200 デフォルト）
  styleMode:  'bw',   // 'bw' | 'color'
  x0:         0,      // v-t モードでの初期位置（積分の基準点）
  fontSize:   12,     // グラフ内テキストのフォントサイズ（8〜24px）

  // グラフ表示項目トグル（renderer の config.showXxx に対応。
  // showUndefinedMark は "?" マーカーと面積塗りつぶしの統合トグル）
  displayOptions: {
    showGrid: true,
    showAxes: true,
    showTicksX: true, showTicksY: true,
    showUnitX: true, showUnitY: true,
    showAxisLabelX: true, showAxisLabelY: true,
    showZeroLine: true,
    showLegend: true,
    showUndefinedMark: true,
  },

  graph:  null,  // MotionGraph（手描き対象）
  editor: null,  // MotionGraphEditor

  currentProblem: null, // 直近に生成した設問（{ question:{text,canvases}, answer:{text,canvases} }）

  // ------------------------------------------------------------------
  // 初期化
  // ------------------------------------------------------------------
  init() {
    this._loadGraphMode();
    this._loadGridConfig();
    this._loadCellSize();
    this._loadStyleMode();
    this._loadX0();
    this._loadFontSize();
    this._loadDisplayOptions();

    if (this.graphMode === 'vt-step') {
      this.graph = new StepMotionGraph();
    } else {
      this.graph = new MotionGraph();
      this.graph.kind = this.graphMode;
    }
    this.graph.x0 = this.x0;
    this._loadGraphData();

    this._syncGraphModeButtons();
    this._syncGridInputs();
    this._syncCellSizeInputs();
    this._syncStylePresetButtons();
    this._syncFontSizeInputs();
    this._syncDisplayOptionInputs();
    this._syncX0Visibility();
    this._updateEditorTitle();
    this._syncProblemSubtypeOptions();

    this._setupEditor();

    // タブボタン
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.showTab(btn.dataset.tab, btn));
    });
  },

  // ------------------------------------------------------------------
  // 確認・通知ダイアログ（confirm()/alert() の代替）
  //
  // ブラウザネイティブの confirm()/alert() はレンダラをブロックし、
  // Chrome 拡張機能などによる自動操作（CDP 経由のクリック等）を
  // フリーズさせてしまう。自前の DOM オーバーレイで代替することで、
  // 通常操作はもちろんブラウザ自動テストでも問題なく動作する。
  // ------------------------------------------------------------------

  /**
   * 確認ダイアログを表示し、「OK」「キャンセル」の選択結果を Promise で返す
   * @param {string} message
   * @returns {Promise<boolean>} OK なら true、キャンセルなら false
   */
  _confirm(message) {
    return this._showDialog(message, [
      { label: 'キャンセル', cls: 'dialog-btn-cancel', value: false },
      { label: 'OK',         cls: 'dialog-btn-ok',     value: true  },
    ]);
  },

  /**
   * 通知ダイアログ（OK ボタンのみ）を表示する
   * @param {string} message
   * @returns {Promise<void>}
   */
  _alert(message) {
    return this._showDialog(message, [
      { label: 'OK', cls: 'dialog-btn-ok', value: true },
    ]).then(() => {});
  },

  /** ダイアログ DOM を組み立てて表示し、ボタン押下を待つ内部ヘルパー */
  _showDialog(message, buttons) {
    return new Promise(resolve => {
      const overlay = document.getElementById('dialogOverlay');
      const msgEl   = document.getElementById('dialogMessage');
      const footer  = document.getElementById('dialogFooter');
      if (!overlay || !msgEl || !footer) { resolve(buttons[buttons.length - 1].value); return; }

      msgEl.textContent = message;
      footer.innerHTML = '';

      const close = (value) => {
        overlay.style.display = 'none';
        resolve(value);
      };

      buttons.forEach(({ label, cls, value }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `dialog-btn ${cls}`;
        btn.textContent = label;
        btn.onclick = () => close(value);
        footer.appendChild(btn);
      });

      overlay.style.display = 'flex';
    });
  },

  // ------------------------------------------------------------------
  // localStorage キー
  // ------------------------------------------------------------------
  _KEYS: {
    graphMode:      'undou_graphMode',
    gridConfig:     'undou_gridConfig',
    cellSize:       'undou_cellSize',
    styleMode:      'undou_styleMode',
    x0:             'undou_x0',
    graphData:      'undou_graphData',
    fontSize:       'undou_fontSize',
    displayOptions: 'undou_displayOptions',
  },

  // ------------------------------------------------------------------
  // グラフ種類（手描き対象）の切り替え
  // ------------------------------------------------------------------
  _loadGraphMode() {
    try {
      const saved = localStorage.getItem(this._KEYS.graphMode);
      if (saved === 'vt' || saved === 'xt' || saved === 'vt-step') this.graphMode = saved;
    } catch (_) {}
  },

  _saveGraphMode() {
    try { localStorage.setItem(this._KEYS.graphMode, this.graphMode); } catch (_) {}
  },

  _syncGraphModeButtons() {
    document.getElementById('graphModeBtn_vt')?.classList.toggle('active', this.graphMode === 'vt');
    document.getElementById('graphModeBtn_vtstep')?.classList.toggle('active', this.graphMode === 'vt-step');
    document.getElementById('graphModeBtn_xt')?.classList.toggle('active', this.graphMode === 'xt');
    const label = document.getElementById('valAxisLabel');
    if (label) label.textContent = this.graphMode === 'xt' ? 'x 軸' : 'v 軸';
  },

  _syncX0Visibility() {
    const row = document.getElementById('x0Row');
    if (row) row.style.display = (this.graphMode === 'vt' || this.graphMode === 'vt-step') ? 'flex' : 'none';
  },

  _updateEditorTitle() {
    const el = document.getElementById('editorTitle');
    if (!el) return;
    if (this.graphMode === 'xt') el.textContent = 'x-t グラフを描く';
    else if (this.graphMode === 'vt-step') el.textContent = 'v-t グラフを描く（階段状）';
    else el.textContent = 'v-t グラフを描く';
  },

  /**
   * 手描き対象のグラフ種類を切り替える。
   * 既存の手描き内容がある場合は確認ダイアログを出し、了承されたら
   * 新しい種類の空の MotionGraph を作って編集をやり直す。
   */
  async setGraphMode(mode) {
    if (mode === this.graphMode) return;
    if (this.graph && !this.graph.isEmpty()) {
      const ok = await this._confirm('グラフの種類を切り替えると、現在描画中のグラフは消去されます。よろしいですか？');
      if (!ok) return;
    }

    this.graphMode = mode;
    this._saveGraphMode();

    if (mode === 'vt-step') {
      this.graph = new StepMotionGraph();
    } else {
      this.graph = new MotionGraph();
      this.graph.kind = mode;
    }
    this.graph.x0 = this.x0;
    this._saveGraphData();

    this._syncGraphModeButtons();
    this._syncX0Visibility();
    this._updateEditorTitle();
    this._syncGridInputs();
    this._syncProblemSubtypeOptions();
    this._setupEditor();
  },

  // ------------------------------------------------------------------
  // グリッド設定
  // ------------------------------------------------------------------
  _loadGridConfig() {
    try {
      const saved = localStorage.getItem(this._KEYS.gridConfig);
      if (saved) {
        const obj = JSON.parse(saved);
        if (typeof obj.tMin === 'number' && typeof obj.tMax === 'number'
          && typeof obj.valMin === 'number' && typeof obj.valMax === 'number'
          && obj.tMin < obj.tMax && obj.valMin < obj.valMax) {
          this.gridConfig = { tMin: obj.tMin, tMax: obj.tMax, valMin: obj.valMin, valMax: obj.valMax };
        }
      }
    } catch (_) {}
  },

  _saveGridConfig() {
    try { localStorage.setItem(this._KEYS.gridConfig, JSON.stringify(this.gridConfig)); } catch (_) {}
  },

  _syncGridInputs() {
    document.getElementById('tMin').value   = this.gridConfig.tMin;
    document.getElementById('tMax').value   = this.gridConfig.tMax;
    document.getElementById('valMin').value = this.gridConfig.valMin;
    document.getElementById('valMax').value = this.gridConfig.valMax;
    document.getElementById('x0').value     = this.x0;
  },

  async applyGridConfig() {
    const tMin   = parseFloat(document.getElementById('tMin').value);
    const tMax   = parseFloat(document.getElementById('tMax').value);
    const valMin = parseFloat(document.getElementById('valMin').value);
    const valMax = parseFloat(document.getElementById('valMax').value);
    const x0     = parseFloat(document.getElementById('x0').value);

    if (isNaN(tMin) || isNaN(tMax) || isNaN(valMin) || isNaN(valMax) || tMin >= tMax || valMin >= valMax) {
      await this._alert('グリッド範囲が不正です。min < max になるように入力してください。');
      return;
    }

    const newCellSize = await this._readCellSizeInputs();
    if (newCellSize === null) return; // バリデーションエラーで中断

    this.gridConfig = { tMin, tMax, valMin, valMax };
    this.cellSize   = newCellSize;
    if (!isNaN(x0)) {
      this.x0 = x0;
      this.graph.x0 = x0;
      this._saveX0();
    }
    this._saveGridConfig();
    this._saveCellSize();
    this._setupEditor();
  },

  // ------------------------------------------------------------------
  // 1目盛サイズ（cellSize）— null=自動
  // ------------------------------------------------------------------
  _loadCellSize() {
    try {
      const saved = localStorage.getItem(this._KEYS.cellSize);
      if (saved) {
        const obj = JSON.parse(saved);
        this.cellSize = {
          w: (typeof obj.w === 'number' && obj.w > 0) ? obj.w : null,
          h: (typeof obj.h === 'number' && obj.h > 0) ? obj.h : null,
        };
      }
    } catch (_) { this.cellSize = { w: null, h: null }; }
  },

  _saveCellSize() {
    try { localStorage.setItem(this._KEYS.cellSize, JSON.stringify(this.cellSize)); } catch (_) {}
  },

  _syncCellSizeInputs() {
    const wEl = document.getElementById('cellPxW');
    const hEl = document.getElementById('cellPxH');
    if (wEl) wEl.value = this.cellSize.w == null ? '' : this.cellSize.w;
    if (hEl) hEl.value = this.cellSize.h == null ? '' : this.cellSize.h;
  },

  /**
   * cellSize 入力欄を読む。空欄=null、範囲外はアラート出して null を返す（呼び出し側で中断）
   * @returns {{w:number|null, h:number|null} | null}  null=バリデーションエラー
   */
  async _readCellSizeInputs() {
    const min = MotionGraphRenderer.CELL_PX_MIN;
    const max = MotionGraphRenderer.CELL_PX_MAX;
    const parseOne = async (id, label) => {
      const raw = document.getElementById(id).value.trim();
      if (raw === '') return { ok: true, value: null };
      const v = parseFloat(raw);
      if (isNaN(v) || v < min || v > max) {
        await this._alert(`${label} は ${min} 〜 ${max} の数値、または空欄（自動）を指定してください。`);
        return { ok: false };
      }
      return { ok: true, value: v };
    };
    const w = await parseOne('cellPxW', '1目盛のt方向ピクセル');
    if (!w.ok) return null;
    const h = await parseOne('cellPxH', '1目盛の値方向ピクセル');
    if (!h.ok) return null;
    return { w: w.value, h: h.value };
  },

  // ------------------------------------------------------------------
  // 初期位置 x0
  // ------------------------------------------------------------------
  _loadX0() {
    try {
      const saved = localStorage.getItem(this._KEYS.x0);
      if (saved !== null) {
        const v = parseFloat(saved);
        if (!isNaN(v)) this.x0 = v;
      }
    } catch (_) {}
  },

  _saveX0() {
    try { localStorage.setItem(this._KEYS.x0, String(this.x0)); } catch (_) {}
  },

  // ------------------------------------------------------------------
  // 文字サイズ（グラフ内テキストのフォントサイズ 8〜24px）
  // ------------------------------------------------------------------
  FONT_SIZE_MIN: 8,
  FONT_SIZE_MAX: 24,

  /** 値を 8〜24 の整数にクランプする。NaN は既定 12 */
  _clampFontSize(v) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return 12;
    return Math.min(this.FONT_SIZE_MAX, Math.max(this.FONT_SIZE_MIN, n));
  },

  _loadFontSize() {
    try {
      const saved = localStorage.getItem(this._KEYS.fontSize);
      if (saved !== null) this.fontSize = this._clampFontSize(saved);
    } catch (_) {}
  },

  _saveFontSize() {
    try { localStorage.setItem(this._KEYS.fontSize, String(this.fontSize)); } catch (_) {}
  },

  _syncFontSizeInputs() {
    const rangeEl  = document.getElementById('fontSizeRange');
    const numberEl = document.getElementById('fontSizeNumber');
    if (rangeEl  && String(rangeEl.value)  !== String(this.fontSize)) rangeEl.value  = this.fontSize;
    if (numberEl && String(numberEl.value) !== String(this.fontSize)) numberEl.value = this.fontSize;
  },

  /** スライダー / 数値入力からフォントサイズを変更する */
  onFontSizeChange(val) {
    const size = this._clampFontSize(val);
    if (size === this.fontSize) { this._syncFontSizeInputs(); return; }
    this.fontSize = size;
    this._syncFontSizeInputs();
    this._saveFontSize();
    this._refreshRenderedViews();
  },

  // ------------------------------------------------------------------
  // グラフ表示項目（show/hide トグル + プリセット）
  // ------------------------------------------------------------------
  DISPLAY_OPTION_KEYS: [
    'showGrid', 'showAxes',
    'showTicksX', 'showTicksY',
    'showUnitX', 'showUnitY',
    'showAxisLabelX', 'showAxisLabelY',
    'showZeroLine', 'showLegend', 'showUndefinedMark',
  ],

  /**
   * 表示項目プリセットの値オブジェクトを返す（純粋関数 — テスト容易性のため分離）。
   * - all              : 標準（全項目 ON）
   * - qualitative      : 定性的（軸・ラベル・y=0線・"?"マーカーのみ）
   * - qualitative-grid : 定性的 + グリッド
   * - shape-only       : 概形のみ（物理量を特定できる情報を全て隠す —
   *                      グラフ概形選択問題の選択肢用）
   * showUndefinedMark は全プリセットで ON（「曖昧さを非表示にしない」原則。
   * 手動チェックボックスでのみ個別 OFF できる）。
   * @param {string} preset
   * @returns {Object|null} 不明なプリセット名は null
   */
  presetDisplayOptions(preset) {
    const presets = {
      'all': {
        showGrid: true, showAxes: true,
        showTicksX: true, showTicksY: true,
        showUnitX: true, showUnitY: true,
        showAxisLabelX: true, showAxisLabelY: true,
        showZeroLine: true, showLegend: true, showUndefinedMark: true,
      },
      'qualitative': {
        showGrid: false, showAxes: true,
        showTicksX: false, showTicksY: false,
        showUnitX: false, showUnitY: false,
        showAxisLabelX: true, showAxisLabelY: true,
        showZeroLine: true, showLegend: false, showUndefinedMark: true,
      },
      'qualitative-grid': {
        showGrid: true, showAxes: true,
        showTicksX: false, showTicksY: false,
        showUnitX: false, showUnitY: false,
        showAxisLabelX: true, showAxisLabelY: true,
        showZeroLine: true, showLegend: false, showUndefinedMark: true,
      },
      'shape-only': {
        showGrid: false, showAxes: true,
        showTicksX: false, showTicksY: false,
        showUnitX: false, showUnitY: false,
        showAxisLabelX: false, showAxisLabelY: false,
        showZeroLine: true, showLegend: false, showUndefinedMark: true,
      },
    };
    return presets[preset] ? Object.assign({}, presets[preset]) : null;
  },

  _loadDisplayOptions() {
    try {
      const saved = localStorage.getItem(this._KEYS.displayOptions);
      if (saved) {
        const obj = JSON.parse(saved);
        if (obj && typeof obj === 'object') {
          // 既定値に上書きマージ（保存ブロブに無い新キーは既定 true で補完＝前方互換）
          const merged = Object.assign({}, this.displayOptions);
          this.DISPLAY_OPTION_KEYS.forEach(key => {
            if (typeof obj[key] === 'boolean') merged[key] = obj[key];
          });
          this.displayOptions = merged;
        }
      }
    } catch (_) {}
  },

  _saveDisplayOptions() {
    try { localStorage.setItem(this._KEYS.displayOptions, JSON.stringify(this.displayOptions)); } catch (_) {}
  },

  _syncDisplayOptionInputs() {
    this.DISPLAY_OPTION_KEYS.forEach(key => {
      const el = document.getElementById(key);
      if (el) el.checked = this.displayOptions[key] !== false;
    });
  },

  /** チェックボックス変更時: 全チェックボックスの状態を読み取って反映する */
  onDisplayOptionChange() {
    this.DISPLAY_OPTION_KEYS.forEach(key => {
      const el = document.getElementById(key);
      if (el) this.displayOptions[key] = !!el.checked;
    });
    this._saveDisplayOptions();
    this._refreshRenderedViews();
  },

  /** プリセットボタン押下時: 表の定義値を一括適用する */
  applyDisplayPreset(preset) {
    const values = this.presetDisplayOptions(preset);
    if (!values) return;
    this.displayOptions = values;
    this._syncDisplayOptionInputs();
    this._saveDisplayOptions();
    this._refreshRenderedViews();
  },

  /**
   * fontSize / displayOptions 変更後の再描画。
   * エディタを再構築し、自動導出グラフタブが表示中なら導出グラフも更新、
   * 生成済みの設問があれば模範解答 Canvas にも反映されるよう再生成する。
   */
  _refreshRenderedViews() {
    this._setupEditor();
    const derivedTab = document.getElementById('tab-derived');
    if (derivedTab && derivedTab.classList.contains('active')) {
      this.renderDerivedGraphs();
    }
    if (this.currentProblem && this.graph && !this.graph.isEmpty()) {
      this.generateProblem();
    }
  },

  // ------------------------------------------------------------------
  // 描画スタイル
  // ------------------------------------------------------------------
  _loadStyleMode() {
    try {
      const saved = localStorage.getItem(this._KEYS.styleMode);
      if (saved === 'bw' || saved === 'color') this.styleMode = saved;
    } catch (_) {}
  },

  _saveStyleMode() {
    try { localStorage.setItem(this._KEYS.styleMode, this.styleMode); } catch (_) {}
  },

  _syncStylePresetButtons() {
    document.getElementById('presetBtn_bw')?.classList.toggle('active', this.styleMode === 'bw');
    document.getElementById('presetBtn_color')?.classList.toggle('active', this.styleMode === 'color');
  },

  _activeStylePreset() {
    return STYLE_PRESETS[this.styleMode] || STYLE_PRESETS.bw;
  },

  applyStylePreset(mode) {
    if (mode !== 'bw' && mode !== 'color') return;
    this.styleMode = mode;
    this._saveStyleMode();
    this._syncStylePresetButtons();
    this._setupEditor();
  },

  // ------------------------------------------------------------------
  // グラフデータの永続化
  // ------------------------------------------------------------------
  _loadGraphData() {
    try {
      const saved = localStorage.getItem(this._KEYS.graphData);
      if (saved) {
        const obj = JSON.parse(saved);
        if (obj && obj.kind === this.graphMode) {
          this.graph.fromJSON(obj);
          this.graph.x0 = this.x0; // x0 はグローバル設定を優先
        }
      }
    } catch (_) {}
  },

  _saveGraphData() {
    try { localStorage.setItem(this._KEYS.graphData, JSON.stringify(this.graph.toJSON())); } catch (_) {}
  },

  // ------------------------------------------------------------------
  // エディタ
  // ------------------------------------------------------------------
  /** エディタ Canvas に gridConfig + cellSize から算出した寸法を適用する（pixelRatio=1） */
  _applyEditorCanvasSize(canvas) {
    const gc = this._editorGridConfig();
    const size = MotionGraphRenderer.computeCanvasSize(gc, this.cellSize);
    canvas.width        = size.width;
    canvas.height       = size.height;
    canvas.style.width  = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
  },

  /**
   * fontSize + displayOptions を renderer config 用にまとめる。
   * _editorGridConfig() / _renderDerivedCanvas() の両方からマージされ、
   * KinematicsProblemGenerator（模範解答・選択肢・エクスポート）へも
   * gridConfig 経由で自動伝播する。
   */
  _rendererExtras() {
    return Object.assign({ fontSize: this.fontSize }, this.displayOptions);
  },

  /** MotionGraphRenderer 用の gridConfig（軸名は xMin/xMax/yMin/yMax で統一） */
  _editorGridConfig() {
    const g = this.gridConfig;
    return Object.assign(
      { xMin: g.tMin, xMax: g.tMax, yMin: g.valMin, yMax: g.valMax },
      this._rendererExtras()
    );
  },

  _setupEditor() {
    const canvas = document.getElementById('editorCanvas');
    if (!canvas) return;
    this._applyEditorCanvasSize(canvas);

    const renderer = new MotionGraphRenderer(canvas, Object.assign({}, this._editorGridConfig(), {
      gridStyle:   this._activeStylePreset().grid,
      stylePreset: this._activeStylePreset(),
    }));

    const EditorClass = (this.graphMode === 'vt-step') ? StepGraphEditor : MotionGraphEditor;

    if (this.editor && !(this.editor instanceof EditorClass)) {
      this.editor.destroy();
      this.editor = null;
    }

    if (this.editor) {
      this.editor.graph    = this.graph;
      this.editor.renderer = renderer;
      this.editor.render();
    } else {
      this.editor = new EditorClass(canvas, this.graph, renderer, () => this._saveGraphData());
    }
  },

  // ------------------------------------------------------------------
  // グラフのクリア
  // ------------------------------------------------------------------
  async clearGraph() {
    if (this.graph.isEmpty()) return;
    const ok = await this._confirm('現在描画中のグラフを消去します。よろしいですか？');
    if (!ok) return;
    this.graph.clear();
    this._saveGraphData();
    this.editor && this.editor.render();
  },

  // ------------------------------------------------------------------
  // タブ切り替え
  // ------------------------------------------------------------------
  showTab(tabName, clickedBtn) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    if (clickedBtn) clickedBtn.classList.add('active');

    if (tabName === 'derived') this.renderDerivedGraphs();
    if (tabName === 'problems') this._syncProblemSubtypeOptions();
  },

  // ------------------------------------------------------------------
  // 自動導出グラフの描画
  // ------------------------------------------------------------------

  /**
   * 導出済み Curve から値の範囲（自動スケーリング）を計算する。
   * 設計方針: 手描きグラフの軸範囲（gridConfig.valMin/valMax）はユーザーが
   * 明示的に決めた値なので、その種類の導出グラフではそのまま再利用する
   * （例: v-t を手描きしたら、導出される v-t のスケールは手描きと同じ）。
   * それ以外の2種類（手描きでない方の v-t/x-t、および a-t）は、Curve の
   * サンプリング値レンジに対してマージンを加えた範囲を自動算出する。
   * これにより「手描きと同じ軸で答え合わせができる」+「未知のスケールの
   * グラフも見やすく自動調整される」の両立を狙う。
   *
   * @param {Curve} curve
   * @param {number} tMin
   * @param {number} tMax
   * @returns {{yMin:number, yMax:number}}
   */
  _autoValueRange(curve, tMin, tMax) {
    // ロジック本体は KinematicsProblemGenerator._autoValueRange に集約
    // （自動導出グラフ・模範解答の双方で同じ「種類ごとに値域へ独立に
    //   合わせ、目盛り間隔の倍数にスナップする」見せ方にするため）。
    return KinematicsProblemGenerator._autoValueRange(curve, tMin, tMax);
  },

  /**
   * 自動導出グラフ（x-t / v-t / a-t）を計算し、3つの読み取り専用 Canvas に描画する。
   * graphMode に応じて Kinematics.deriveFromVT / deriveFromXT を呼び分ける。
   */
  renderDerivedGraphs() {
    if (!this.graph) return;
    const g = this.gridConfig;
    const tMin = g.tMin, tMax = g.tMax;

    let derived;
    if (this.graphMode === 'vt') {
      derived = Kinematics.deriveFromVT(this.graph);
    } else if (this.graphMode === 'vt-step') {
      derived = Kinematics.deriveFromVTStep(this.graph);
    } else {
      derived = Kinematics.deriveFromXT(this.graph);
    }

    const preset = this._activeStylePreset();
    const handDrawnRange = { yMin: g.valMin, yMax: g.valMax };
    const isHandDrawnVT = (this.graphMode === 'vt' || this.graphMode === 'vt-step');

    const specs = [
      {
        canvasId: 'derivedCanvasXT',
        curve: derived.xt,
        kind: 'xt',
        yLabel: '位置 x [m]',
        range: (this.graphMode === 'xt') ? handDrawnRange : this._autoValueRange(derived.xt, tMin, tMax),
      },
      {
        canvasId: 'derivedCanvasVT',
        curve: derived.vt,
        kind: 'vt',
        yLabel: '速度 v [m/s]',
        range: isHandDrawnVT ? handDrawnRange : this._autoValueRange(derived.vt, tMin, tMax),
      },
      {
        canvasId: 'derivedCanvasAT',
        curve: derived.at,
        kind: 'at',
        yLabel: '加速度 a [m/s²]',
        range: this._autoValueRange(derived.at, tMin, tMax),
      },
    ];

    specs.forEach(spec => this._renderDerivedCanvas(spec, tMin, tMax, preset));
  },

  /** 1枚の導出グラフ Canvas を描画する内部ヘルパー */
  _renderDerivedCanvas(spec, tMin, tMax, preset) {
    const canvas = document.getElementById(spec.canvasId);
    if (!canvas) return;

    const gridConfig = Object.assign(
      { xMin: tMin, xMax: tMax, yMin: spec.range.yMin, yMax: spec.range.yMax },
      this._rendererExtras()
    );
    const size = MotionGraphRenderer.computeCanvasSize(gridConfig, this.cellSize);
    const PR = 1;
    canvas.width        = size.width  * PR;
    canvas.height       = size.height * PR;
    canvas.style.width  = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const renderer = new MotionGraphRenderer(canvas, Object.assign({}, gridConfig, {
      pixelRatio: PR,
      gridStyle:  preset.grid,
    }));

    renderer.clear();
    renderer.drawGrid();
    renderer.drawAxes({ xLabel: '時刻 t [s]', yLabel: spec.yLabel });

    if (spec.curve && spec.curve.segments && spec.curve.segments.length > 0) {
      // 自動導出グラフは Canvas 1枚につき常に単一カーブしか描かないため、
      // x-t/v-t/a-t 間で実線・太さを揃える（KinematicsProblemGenerator._solidCurveStyle と同趣旨）。
      renderer.drawCurve(spec.curve, KinematicsProblemGenerator.singleCurveStyle(preset, spec.kind), tMin, tMax);

      // 不連続点（リサー）: 直前/直後セグメントの境界値で段差を描く
      (spec.curve.discontinuities || []).forEach(t => {
        const before = this._curveValueApproachingFromLeft(spec.curve, t);
        const after  = this._curveValueApproachingFromRight(spec.curve, t);
        if (before !== null && after !== null) {
          renderer.drawDiscontinuity(t, before, after, preset.riser);
        }
      });

      // 未定義の瞬間マーカー
      (spec.curve.undefinedInstants || []).forEach(t => {
        renderer.drawUndefinedMarker(t, preset.undefinedMark);
      });
    }
  },

  /** 自動導出グラフ（x-t/v-t/a-t）の Canvas を PNG としてダウンロードする */
  downloadDerivedCanvasPNG(kind) {
    const ids = { xt: 'derivedCanvasXT', vt: 'derivedCanvasVT', at: 'derivedCanvasAT' };
    const canvas = document.getElementById(ids[kind]);
    if (!canvas) return;
    Exporter.downloadCanvasPNG(canvas, `derived_${kind}.png`);
  },

  /**
   * 不連続点 t の直前セグメントの終端値を求める（リサー描画用）
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
  },

  /**
   * 不連続点 t の直後セグメントの始端値を求める（リサー描画用）
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
  },

  // ------------------------------------------------------------------
  // 設問生成タブ
  // ------------------------------------------------------------------

  /**
   * 「問題種類」セレクトの値に応じて「設問」セレクトの選択肢を構築する。
   * 有効な選択肢は手描き対象（App.graph.kind）に依存する:
   *   - グラフ変換: 手描きが v-t なら「v-t → x-t・a-t」、x-t なら「x-t → v-t・a-t」
   *   - 数値・記述: acceleration / displacement / direction / describe
   *     （v-t・x-t どちらでも Kinematics が v-t を導出できるため共通で有効）
   */
  _syncProblemSubtypeOptions() {
    const catEl = document.getElementById('problemCategory');
    const subEl = document.getElementById('problemSubtype');
    if (!catEl || !subEl) return;

    const category = catEl.value;
    const kind = this.graph ? this.graph.kind : this.graphMode;
    let options;

    if (category === 'conversion') {
      options = (kind === 'vt' || kind === 'vt-step')
        ? [{ value: 'vt2xtat', label: 'v-t から x-t・a-t を導出させる' }]
        : [{ value: 'xt2vtat', label: 'x-t から v-t・a-t を導出させる' }];
    } else {
      options = [
        { value: 'acceleration', label: '加速度を求める（数値）' },
        { value: 'displacement', label: '変位を求める（数値・面積）' },
        { value: 'direction',    label: '逆向きに運動する区間を答える（記述）' },
        { value: 'describe',     label: '運動の様子を説明する（記述）' },
      ];
    }

    const prevValue = subEl.value;
    subEl.innerHTML = '';
    options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      subEl.appendChild(el);
    });
    // 同じ種類のサブタイプが残っていれば選択を維持する
    if (options.some(o => o.value === prevValue)) subEl.value = prevValue;
  },

  /**
   * 「生成」ボタン押下時の処理。
   * グラフ未描画ならアラートを出して中断し、選択中のカテゴリ・サブタイプから
   * KinematicsProblemGenerator を呼び分けて結果を描画する。
   */
  async generateProblem() {
    if (!this.graph || this.graph.isEmpty()) {
      await this._alert('グラフが空です。先にグラフを描いてください。');
      return;
    }

    const category = document.getElementById('problemCategory').value;
    const subtype  = document.getElementById('problemSubtype').value;
    const generator = new KinematicsProblemGenerator({
      gridConfig:  this._editorGridConfig(),
      styleConfig: this._activeStylePreset(),
      cellSize:    this.cellSize,
    });

    let result;
    try {
      if (category === 'conversion') {
        const askFor = (this.graph.kind === 'vt' || this.graph.kind === 'vt-step') ? ['xt', 'at'] : ['vt', 'at'];
        result = generator.generateGraphConversion({
          source: this.graph,
          sourceKind: this.graph.kind,
          askFor,
          x0: this.x0,
        });
      } else {
        result = generator.generateNumeric({
          source: this.graph,
          sourceKind: this.graph.kind,
          subtype,
          params: {},
        });
      }
    } catch (e) {
      console.error(e);
      await this._alert('設問の生成中にエラーが発生しました: ' + e.message);
      return;
    }

    this.currentProblem = result;
    this._renderProblemOutput(result);
    document.getElementById('problemExportControls').style.display = 'flex';
  },

  /**
   * 設問結果（{question:{text,canvases}, answer:{text,canvases}}）を
   * 画面に描画する。各 Canvas には個別の画像DLボタンを付与する
   * （legacy app の _renderProblemOutput / _appendCanvases と同じ構成）。
   */
  _renderProblemOutput(result) {
    const container = document.getElementById('problemOutput');
    container.innerHTML = '';

    const qSection = document.createElement('div');
    qSection.className = 'output-section';
    qSection.innerHTML = '<h3>【問題】</h3>';
    const qText = document.createElement('p');
    qText.className = 'problem-text';
    qText.textContent = result.question.text;
    qSection.appendChild(qText);
    this._appendProblemCanvases(qSection, result.question.canvases, 'q');
    container.appendChild(qSection);

    const aSection = document.createElement('div');
    aSection.className = 'output-section answer-section';
    aSection.innerHTML = '<h3>【解答】</h3>';
    const aText = document.createElement('p');
    aText.className = 'answer-note';
    aText.textContent = result.answer.text;
    aSection.appendChild(aText);
    this._appendProblemCanvases(aSection, result.answer.canvases, 'a');
    container.appendChild(aSection);
  },

  /** Canvas 配列を「画像DL」ボタン付きで追加する（legacy app._appendCanvases と同じ構成） */
  _appendProblemCanvases(section, canvases, prefix) {
    (canvases || []).forEach((canvas, i) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'canvas-wrapper';
      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.textContent = '画像DL';
      dlBtn.className = 'dl-btn';
      dlBtn.onclick = () => Exporter.downloadCanvasPNG(canvas, `${prefix}_${i + 1}.png`);
      wrapper.appendChild(canvas);
      wrapper.appendChild(dlBtn);
      section.appendChild(wrapper);
    });
  },

  /** 問題・解答の全 Canvas を個別 PNG として連続ダウンロードする */
  downloadProblemPNG() {
    if (!this.currentProblem) return;
    const r = this.currentProblem;
    r.question.canvases.forEach((c, i) => Exporter.downloadCanvasPNG(c, `mondai_q_${i + 1}.png`));
    r.answer.canvases.forEach((c, i) => Exporter.downloadCanvasPNG(c, `mondai_a_${i + 1}.png`));
  },

  /** 問題のみの PDF をダウンロードする */
  async downloadProblemPDF() {
    if (!this.currentProblem) return;
    const r = this.currentProblem;
    const sections = [
      { label: '問題', text: r.question.text, canvases: r.question.canvases },
    ];
    await Exporter.generatePDF('運動グラフ 問題', sections, 'mondai_question.pdf');
  },

  /** 問題＋解答の PDF をダウンロードする */
  async downloadAnswerPDF() {
    if (!this.currentProblem) return;
    const r = this.currentProblem;
    const sections = [
      { label: '問題', text: r.question.text, canvases: r.question.canvases },
      { label: '解答', text: r.answer.text,   canvases: r.answer.canvases },
    ];
    await Exporter.generatePDF('運動グラフ 解答', sections, 'mondai_answer.pdf');
  },

  /**
   * 問題のみ／問題＋解答の DOCX・PDF・ZIP 共通の section 配列を組み立てる。
   * @param {boolean} includeAnswer 解答セクションを含めるか
   * @returns {Array<{label, text, canvases}>}
   */
  _buildProblemSections(includeAnswer) {
    const r = this.currentProblem;
    const sections = [
      { label: '【問題】', text: r.question.text, canvases: r.question.canvases },
    ];
    if (includeAnswer) {
      sections.push({ label: '【解答】', text: r.answer.text, canvases: r.answer.canvases });
    }
    return sections;
  },

  /** 問題のみの DOCX をダウンロードする */
  async downloadProblemDOCX() {
    if (!this.currentProblem) return;
    if (!window.docx) {
      await this._alert('docx（Word文書生成）ライブラリが読み込まれていないため、DOCXを生成できません。');
      return;
    }
    const sections = this._buildProblemSections(false);
    await Exporter.generateDOCX(sections, 'mondai_question.docx');
  },

  /** 問題＋解答の DOCX をダウンロードする */
  async downloadAnswerDOCX() {
    if (!this.currentProblem) return;
    if (!window.docx) {
      await this._alert('docx（Word文書生成）ライブラリが読み込まれていないため、DOCXを生成できません。');
      return;
    }
    const sections = this._buildProblemSections(true);
    await Exporter.generateDOCX(sections, 'mondai_answer.docx');
  },

  /** 問題・解答の PNG/PDF/DOCX をすべて 1 つの ZIP にまとめてダウンロードする */
  async downloadProblemZIP() {
    if (!this.currentProblem) return;
    const r = this.currentProblem;

    // 未ロードのライブラリをまとめて通知
    const missing = [];
    if (!window.jspdf) missing.push('jsPDF（PDF生成）');
    if (!window.docx)  missing.push('docx（Word文書生成）');
    if (!window.JSZip) missing.push('JSZip（ZIP生成）');
    if (missing.length) {
      if (!window.JSZip) {
        await this._alert('JSZip（ZIP生成）ライブラリが読み込まれていないため、ZIPを生成できません。');
        return;
      }
      const ok = await this._confirm(
        `以下のライブラリが読み込まれていないため、ZIPに一部のファイルが含まれません:\n${missing.join('\n')}\n\n続行しますか？`
      );
      if (!ok) return;
    }

    // ── 画像収集 ─────────────────────────────────────────────────────
    const images = {};
    r.question.canvases.forEach((c, i) => { images[`mondai_q_${i + 1}.png`] = c; });
    r.answer.canvases.forEach((c, i)   => { images[`mondai_a_${i + 1}.png`] = c; });

    const extraFiles = {};

    // ── PDF 生成（Blob として返す） ───────────────────────────────
    const problemSections = this._buildProblemSections(false);
    const answerSections  = this._buildProblemSections(true);

    const [problemPdfBlob, answerPdfBlob] = await Promise.all([
      Exporter.generatePDF('運動グラフ 問題', problemSections, null, { returnBlob: true, silent: true }),
      Exporter.generatePDF('運動グラフ 解答', answerSections,  null, { returnBlob: true, silent: true }),
    ]);
    if (problemPdfBlob) extraFiles['mondai_question.pdf'] = problemPdfBlob;
    if (answerPdfBlob)  extraFiles['mondai_answer.pdf']   = answerPdfBlob;

    // ── DOCX 生成（Blob として返す） ─────────────────────────────
    const [problemDocxBlob, answerDocxBlob] = await Promise.all([
      Exporter.generateDOCX(problemSections, null, { silent: true }),
      Exporter.generateDOCX(answerSections,  null, { silent: true }),
    ]);
    if (problemDocxBlob) extraFiles['mondai_question.docx'] = problemDocxBlob;
    if (answerDocxBlob)  extraFiles['mondai_answer.docx']   = answerDocxBlob;

    await Exporter.generateZIP(images, 'mondai_all.zip', extraFiles);
  },
};

// ------------------------------------------------------------------
// エントリポイント
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => App.init());
