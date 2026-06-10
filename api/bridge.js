'use strict';

const path = require('node:path');
const { buildSandbox } = require('./sandbox-stubs');
const { loadAllJsModules } = require('./loader');
const {
  buildState, callGenerator, autoAdjustYRange,
} = require('./translate');
const {
  newSessionId, ensureDir, buildResponse, buildResponseFull,
} = require('./serialize');

class Bridge {
  constructor({ projectRoot, defaultOutputDir }) {
    this.projectRoot = projectRoot;
    this.jsDir = path.join(projectRoot, 'js');
    this.defaultOutputDir = defaultOutputDir || path.join(projectRoot, 'api_output');
    this.sandbox = null;
  }

  init() {
    if (this.sandbox) return;
    this.sandbox = buildSandbox();
    loadAllJsModules(this.sandbox, this.jsDir);
    const required = [
      'MotionGraph', 'StepMotionGraph', 'SeededRandom', 'STYLE_PRESETS',
      'Kinematics', 'MotionGraphRenderer', 'KinematicsProblemGenerator',
    ];
    for (const n of required) {
      if (!this.sandbox[n]) throw new Error(`Sandbox failed to expose '${n}'.`);
    }
  }

  _prepare(spec) {
    this.init();
    const { KinematicsProblemGenerator } = this.sandbox;
    const state = buildState(spec, this.sandbox);
    autoAdjustYRange(spec, state, this.sandbox);
    const gen = new KinematicsProblemGenerator(state);
    const result = callGenerator(gen, spec, this.sandbox);

    const sessionId = newSessionId();
    const sessionDir = spec.outputDir
      ? ensureDir(spec.outputDir)
      : ensureDir(path.join(this.defaultOutputDir, sessionId));
    const prefix = spec.filenamePrefix || 'q001';
    const inline = !!spec.inline;
    return { result, state, sessionId, sessionDir, prefix, inline };
  }

  /** 同期版: PNG のみ生成（既存テスト向け） */
  generate(spec) {
    const { result, state, sessionId, sessionDir, prefix, inline } = this._prepare(spec);
    return buildResponse({
      result, spec, sandbox: this.sandbox,
      sessionDir, sessionId, prefix, inline,
      gridConfig: state.gridConfig,
    });
  }

  /** 非同期版: PNG + DOCX + TXT + Bundle ZIP を生成（API サーバー向け） */
  async generateFull(spec) {
    const { result, state, sessionId, sessionDir, prefix, inline } = this._prepare(spec);
    return await buildResponseFull({
      result, spec, sandbox: this.sandbox,
      sessionDir, sessionId, prefix, inline,
      gridConfig: state.gridConfig,
    });
  }
}

module.exports = { Bridge };
