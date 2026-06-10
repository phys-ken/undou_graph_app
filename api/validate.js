'use strict';

const { z } = require('zod');

// MotionGraph.toJSON()/fromJSON() の形に合わせる（js/motion.js 参照）。
// points は t 昇順である必要はない（MotionGraph.setPoint が整列するため）が、
// 最低2点ないと Kinematics.curveFromGraph が空カーブを返してしまう。
const Point = z.object({
  t: z.number().int(),
  value: z.number().refine((v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9, {
    message: 'value must be a multiple of 0.5',
  }),
});

const MotionGraphSpec = z.object({
  kind:   z.enum(['vt', 'xt']),
  points: z.array(Point).min(2, 'points には少なくとも2点必要です'),
  x0:     z.number().optional(),
  label:  z.string().optional(),
});

// StepMotionGraph.toJSON()/fromJSON() の形に合わせる（js/step-motion.js 参照）。
// values は「区間 [tStart+i, tStart+i+1) の一定速度」の配列。各要素は実数で良い
// （0.5 刻みへのスナップはモデル側 paintInterval が行うため、ここでは構造のみ検証する）。
const StepGraphSpec = z.object({
  kind:   z.literal('vt-step'),
  tStart: z.number().int(),
  values: z.array(z.number().finite()).min(1, 'values には少なくとも1要素必要です'),
  x0:     z.number().optional(),
  label:  z.string().optional(),
});

const GraphSpec = z.discriminatedUnion('kind', [MotionGraphSpec, StepGraphSpec]);

const GridSpec = z.object({
  xMin: z.number().optional(),
  xMax: z.number().optional(),
  yMin: z.number().optional(),
  yMax: z.number().optional(),
  paddingLeft: z.number().int().nonnegative().optional(),
  paddingRight: z.number().int().nonnegative().optional(),
  paddingTop: z.number().int().nonnegative().optional(),
  paddingBottom: z.number().int().nonnegative().optional(),
}).refine((g) => {
  if (g.xMin !== undefined && g.xMax !== undefined && g.xMin >= g.xMax) return false;
  if (g.yMin !== undefined && g.yMax !== undefined && g.yMin >= g.yMax) return false;
  return true;
}, { message: 'xMin < xMax and yMin < yMax must hold' });

const CellSize = z.object({
  w: z.number().int().min(15).max(120).nullable().optional(),
  h: z.number().int().min(15).max(120).nullable().optional(),
}).optional();

// 既定スタイルは bw（CLAUDE.md）。'gray' は使わない（カラーモードは 'color'）。
const StyleSpec = z.union([z.enum(['bw', 'color']), z.record(z.any())]).optional();

// グラフ選択肢の誤答は「呼び出し側が完全な MotionGraph 仕様 JSON を渡す」
// （CONTEXT.md の方針: 本ツールは誤答グラフの生成ロジックを持たない）。
const ChoicesSpec = z.object({
  enabled: z.boolean(),
  count: z.number().int().min(2).max(10),
  shuffle: z.boolean().default(true),
  distractors: z.array(GraphSpec).default([]),
}).optional();

const SUBTYPES = ['acceleration', 'displacement', 'direction', 'describe'];

const IntervalSpec = z.object({
  t0: z.number(),
  t1: z.number(),
}).refine((iv) => iv.t0 < iv.t1, { message: 't0 < t1 must hold' });

const NumericParamsSpec = z.object({
  interval: IntervalSpec.optional(),
}).default({});

const TypeSchema = z.enum(['graphConversion', 'numeric', 'graphChoice']);
const KindSchema = z.enum(['xt', 'vt', 'at']);

const GenerateRequest = z.object({
  type: TypeSchema,
  grid: GridSpec.optional(),
  cellSize: CellSize,
  style: StyleSpec,

  // 手描きグラフ（すべてのタイプで必須の「与えられたグラフ」）
  source: GraphSpec,
  // source.kind と一致させる（MotionGraph.kind の上書き用）。省略時は source.kind を使う。
  sourceKind: z.enum(['vt', 'xt', 'vt-step']).optional(),
  // v-t を主入力とした場合の積分定数（x-t 導出に使う初期位置）
  x0: z.number().optional(),

  // graphConversion 用: 描かせる対象（複数可）
  askFor: z.union([KindSchema, z.array(KindSchema).min(1)]).optional(),

  // numeric 用
  subtype: z.enum(SUBTYPES).optional(),
  params: NumericParamsSpec,

  // graphChoice 用
  choices: ChoicesSpec,

  outputDir: z.string().nullable().optional(),
  filenamePrefix: z.string().max(64).optional(),
  inline: z.boolean().default(false),
}).superRefine((v, ctx) => {
  const t = v.type;

  if (t === 'graphConversion') {
    if (v.askFor === undefined) {
      ctx.addIssue({ code: 'custom', path: ['askFor'], message: 'askFor is required for type graphConversion' });
    }
  }

  if (t === 'numeric') {
    if (v.subtype === undefined) {
      ctx.addIssue({ code: 'custom', path: ['subtype'], message: 'subtype is required for type numeric' });
    }
  }

  if (t === 'graphChoice') {
    if (v.askFor === undefined) {
      ctx.addIssue({ code: 'custom', path: ['askFor'], message: 'askFor is required for type graphChoice' });
    } else if (Array.isArray(v.askFor)) {
      ctx.addIssue({ code: 'custom', path: ['askFor'], message: 'askFor must be a single kind (not an array) for type graphChoice' });
    }
    if (!v.choices || !v.choices.enabled) {
      ctx.addIssue({ code: 'custom', path: ['choices'], message: 'choices.enabled=true is required for type graphChoice' });
    } else if (v.choices.distractors.length !== v.choices.count - 1) {
      ctx.addIssue({
        code: 'custom', path: ['choices', 'distractors'],
        message: `distractors.length (${v.choices.distractors.length}) must equal count-1 (${v.choices.count - 1})`,
      });
    }
  } else if (v.choices?.enabled) {
    ctx.addIssue({ code: 'custom', path: ['choices'], message: 'choices are only supported for type graphChoice' });
  }

  // sourceKind が明示されているなら source.kind と一致しているか確認
  // （翻訳層が source.kind を上書きするため、矛盾があれば早期に弾く）
  if (v.sourceKind !== undefined && v.source && v.sourceKind !== v.source.kind) {
    // 矛盾は許容する（翻訳層が sourceKind を優先して上書きする — legacy の sineMode 切替と同様の方針）
    // ただし完全に独立した値だと混乱を招くため警告的 issue は出さない（API 利用者が意図的に変更するケースを許す）
  }
});

function validateRequest(input) {
  return GenerateRequest.safeParse(input);
}

module.exports = { validateRequest, GenerateRequest, GraphSpec, GridSpec };
