'use strict';

const { Document, Packer, Paragraph, TextRun, ImageRun } = require('docx');
const { CIRCLED_DIGITS } = require('./serialize');

function _imgParagraph(canvas) {
  const data = canvas.toBuffer('image/png');
  const w = Math.round(canvas.width / 2);
  const h = Math.round(canvas.height / 2);
  return new Paragraph({
    children: [new ImageRun({ data, transformation: { width: w, height: h }, type: 'png' })],
    spacing: { before: 80, after: 80 },
  });
}

function _textParagraphs(text, opts = {}) {
  const { bold = false, size = 22, italics = false } = opts;
  return (text || '').split('\n').map(line =>
    new Paragraph({
      children: [new TextRun({ text: line || ' ', bold, size, italics })],
      spacing: { after: 60 },
    })
  );
}

function _heading(label) {
  return new Paragraph({
    children: [new TextRun({ text: label, bold: true, size: 28 })],
    spacing: { before: 320, after: 160 },
  });
}

/**
 * 問題・解答（・選択肢）を含む Word 文書を Buffer として生成する
 *
 * legacy_nami_app の docx-writer.js をフォーク。result の形が異なる
 * （{question:{text,canvases}, answer:{text,canvases}, choices, correctIndex}）
 * ため、フィールド参照をすべて新形状に合わせて書き換えた。
 * KinematicsProblemGenerator の設問は refCanvases（解説スナップショット列）を
 * 持たないため、その節は省略した（legacy の Type3 専用機能）。
 *
 * @param {object} result            - KinematicsProblemGenerator の返り値
 * @param {object} opts
 * @param {Array}  opts.shuffledChoices  - 最終順序の選択肢配列 [{canvas, isCorrect, ...}]
 * @param {number|null} opts.correctNewIndex - 最終順序での正答インデックス
 * @returns {Promise<Buffer>}
 */
async function generateDocxBuffer(result, { shuffledChoices = null, correctNewIndex = null } = {}) {
  const children = [];

  // 【問題】
  children.push(_heading('【問題】'));
  children.push(..._textParagraphs(result.question?.text || ''));
  for (const c of (result.question?.canvases || [])) children.push(_imgParagraph(c));

  // 【選択肢】
  if (shuffledChoices?.length) {
    children.push(_heading('【選択肢】'));
    shuffledChoices.forEach((item, i) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: item.label || CIRCLED_DIGITS[i] || `(${i + 1})`, bold: true, size: 22 })],
        spacing: { before: 120, after: 40 },
      }));
      children.push(_imgParagraph(item.canvas));
    });
  }

  // 【解答】
  children.push(_heading('【解答】'));
  if (shuffledChoices && correctNewIndex !== null) {
    const label = (shuffledChoices[correctNewIndex] && shuffledChoices[correctNewIndex].label)
      || CIRCLED_DIGITS[correctNewIndex] || `(${correctNewIndex + 1})`;
    children.push(..._textParagraphs(`正答: 選択肢 ${label}`));
    if (result.answer?.text) children.push(..._textParagraphs(result.answer.text));
  } else {
    children.push(..._textParagraphs(result.answer?.text || ''));
    for (const c of (result.answer?.canvases || [])) children.push(_imgParagraph(c));
  }

  const doc = new Document({
    creator: '運動グラフ 問題作成ツール',
    sections: [{ children }],
  });
  return await Packer.toBuffer(doc);
}

module.exports = { generateDocxBuffer };
