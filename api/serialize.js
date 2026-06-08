'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CIRCLED_DIGITS = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];

function newSessionId(now = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
             `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex');
  return `${ts}_${rand}`;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function saveCanvasPng(canvas, outPath) {
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  return { path: outPath, bytes: buf.length };
}

function canvasToDataUrl(canvas) {
  return canvas.toDataURL('image/png');
}

/**
 * 共通コア処理: PNG 書き出し・選択肢処理・レスポンスオブジェクト構築
 *
 * legacy との重要な相違点:
 *   legacy は ProblemGenerator が未シャッフルの choices.items を返し、
 *   serialize 層が seed を使ってシャッフルしていた（applyShuffle）。
 *   このアプリでは KinematicsProblemGenerator.generateGraphChoice が
 *   「シャッフル済みの choices 配列 + correctIndex + seed」を直接返す
 *   （CLAUDE.md/タスク仕様の指示通り）。そのため、ここでは一切
 *   シャッフルし直さず、生成器が確定した最終順序をそのまま使う。
 *
 * @returns {{ response: object, finalChoiceItems: Array|null }}
 */
function _buildCore({ result, spec, sandbox, sessionDir, sessionId, prefix, inline, gridConfig }) {
  const writeOrInline = (canvas, basename) => {
    if (inline) {
      return { dataUrl: canvasToDataUrl(canvas) };
    }
    const outPath = path.join(sessionDir, `${prefix}${basename}.png`);
    saveCanvasPng(canvas, outPath);
    return { path: outPath };
  };

  const questionFiles = (result.question?.canvases || []).map((c, i) => writeOrInline(c, `_question_${i + 1}`));
  const answerFiles   = (result.answer?.canvases   || []).map((c, i) => writeOrInline(c, `_answer_${i + 1}`));

  let choiceFiles = null;
  let finalChoiceItems = null;
  if (result.choices) {
    // generator がすでに最終順序で返している（シャッフル済み・correctIndex 確定済み）
    finalChoiceItems = result.choices.map((it, i) => ({
      ...it,
      // originalIndex は legacy のレスポンス形式踏襲のため保持するが、
      // generator はシャッフル前のインデックスを返さないので i をそのまま使う
      // （手前で正答=0 として組み立てているため、isCorrect で判別可能）
      originalIndex: i,
    }));

    choiceFiles = finalChoiceItems.map((item, displayIdx) => {
      const target = writeOrInline(item.canvas, `_choice_${displayIdx + 1}${item.isCorrect ? '_correct' : ''}`);
      return {
        ...target,
        isCorrect: !!item.isCorrect,
        label: item.label || CIRCLED_DIGITS[displayIdx] || `(${displayIdx + 1})`,
      };
    });
  }

  const response = {
    success: true,
    type: spec.type,
    sessionId,
    outputDir: inline ? null : sessionDir,
    gridConfig: gridConfig || null,
    questionText: result.question?.text || null,
    answerText: result.answer?.text || null,
    files: {
      question: questionFiles,
      answer: answerFiles,
      choices: choiceFiles,
    },
    correctIndex: (result.correctIndex !== undefined) ? result.correctIndex : null,
    shuffleSeed: (result.seed !== undefined) ? result.seed : null,
    warnings: [],
  };

  return { response, finalChoiceItems };
}

/**
 * DOCX・TXT・Bundle ZIP を生成してレスポンスに追加する（非同期）
 */
async function _addExtraFiles({ response, result, finalChoiceItems, prefix, sessionDir }) {
  // question.txt
  if (result.question?.text) {
    const p = path.join(sessionDir, `${prefix}_question.txt`);
    fs.writeFileSync(p, result.question.text, 'utf8');
    response.files.questionTxt = p;
  }

  // answer.txt
  const answerLines = [];
  if (finalChoiceItems) {
    const cidx = finalChoiceItems.findIndex(it => it.isCorrect);
    if (cidx >= 0) answerLines.push(`正答: 選択肢 ${CIRCLED_DIGITS[cidx] || `(${cidx + 1})`}`);
  }
  if (result.answer?.text) answerLines.push(result.answer.text);
  if (answerLines.length) {
    const p = path.join(sessionDir, `${prefix}_answer.txt`);
    fs.writeFileSync(p, answerLines.join('\n'), 'utf8');
    response.files.answerTxt = p;
  }

  // DOCX
  try {
    const { generateDocxBuffer } = require('./docx-writer');
    const cidx = finalChoiceItems ? finalChoiceItems.findIndex(it => it.isCorrect) : -1;
    const docxBuf = await generateDocxBuffer(result, {
      shuffledChoices:  finalChoiceItems  || null,
      correctNewIndex:  cidx >= 0 ? cidx : null,
    });
    const p = path.join(sessionDir, `${prefix}_problem.docx`);
    fs.writeFileSync(p, docxBuf);
    response.files.docx = p;
  } catch (e) {
    console.error('[serialize] DOCX generation failed:', e.message);
  }

  // Bundle ZIP
  try {
    const JSZip = require('jszip');
    const zip   = new JSZip();

    const pngEntries = [
      ...(response.files.question || []).map((f, i) => [`question_${i + 1}.png`, f.path]),
      ...(response.files.answer   || []).map((f, i) => [`answer_${i + 1}.png`,   f.path]),
      ...(response.files.choices  || []).map((f, i) => {
        const tag = f.isCorrect ? '_correct' : '';
        return [`choice_${i + 1}${tag}.png`, f.path];
      }),
    ];
    for (const [name, p] of pngEntries) {
      if (p && fs.existsSync(p)) zip.file(name, fs.readFileSync(p));
    }
    if (response.files.questionTxt) zip.file('question.txt', fs.readFileSync(response.files.questionTxt));
    if (response.files.answerTxt)   zip.file('answer.txt',   fs.readFileSync(response.files.answerTxt));
    if (response.files.docx)        zip.file('motion_problem.docx', fs.readFileSync(response.files.docx));

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
    const p = path.join(sessionDir, `${prefix}_bundle.zip`);
    fs.writeFileSync(p, zipBuf);
    response.files.bundle = p;
  } catch (e) {
    console.error('[serialize] Bundle ZIP generation failed:', e.message);
  }
}

/**
 * 同期版レスポンス構築（既存テストが bridge.generate() 経由で使用）
 * PNG のみ生成。DOCX/TXT/ZIP は含まない。
 */
function buildResponse({ result, spec, sandbox, sessionDir, sessionId, prefix, inline, gridConfig }) {
  const { response } = _buildCore({ result, spec, sandbox, sessionDir, sessionId, prefix, inline, gridConfig });

  if (!inline) {
    const manifestPath = path.join(sessionDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ request: spec, response }, null, 2));
    response.files.manifest = manifestPath;
  }
  return response;
}

/**
 * 非同期版レスポンス構築（api_server.js が bridge.generateFull() 経由で使用）
 * PNG に加え DOCX / TXT / Bundle ZIP も生成し、すべてのパスをレスポンスに含む。
 */
async function buildResponseFull({ result, spec, sandbox, sessionDir, sessionId, prefix, inline, gridConfig }) {
  const { response, finalChoiceItems } = _buildCore({ result, spec, sandbox, sessionDir, sessionId, prefix, inline, gridConfig });

  if (!inline) {
    await _addExtraFiles({ response, result, finalChoiceItems, prefix, sessionDir });
    const manifestPath = path.join(sessionDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ request: spec, response }, null, 2));
    response.files.manifest = manifestPath;
  }
  return response;
}

module.exports = {
  newSessionId,
  ensureDir,
  saveCanvasPng,
  canvasToDataUrl,
  buildResponse,
  buildResponseFull,
  CIRCLED_DIGITS,
};
