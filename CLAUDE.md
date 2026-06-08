# CLAUDE.md

このリポジトリは `legacy_nami_app`（波の重ね合わせ問題作成ソフト）をフォークした、
高校物理基礎向け「運動グラフ（x-t / v-t / a-t）設問作成ツール」です。

## 開発サーバー

```bash
python server.py        # ブラウザUIのみ: http://localhost:8000
npm install && npm start  # ブラウザUI(:8000) + REST API(:8001)
```

## テスト

```bash
npm test                          # motion/kinematics/renderer/random ユニットテスト
node --test tests/api.test.js     # API バックエンドテスト
```

## アーキテクチャ概要

```
MotionGraphEditor（頂点クリック&ドラッグ）
    ↓ setPoint()
MotionGraph（頂点モデル: 区分的に直線）
    ↓ deriveFromVT() / deriveFromXT()  [js/kinematics.js]
Curve（区分二次式 {t0,t1,c0,c1,c2} の集まり。不連続点・未定義瞬間を保持）
    ↓
MotionGraphRenderer（Canvas描画: drawCurve / drawFilledArea）
    ↓
KinematicsProblemGenerator → Exporter（PNG/PDF/DOCX/ZIP）
```

REST API は `legacy_nami_app/api/` の vm サンドボックス構成（bridge/loader/sandbox-stubs）を
そのまま流用し、`loader.js` の expose 対象クラスだけ更新する。

## 設計上の重要ルール（grill-me セッションで確定済み）

- **v-t が主入力**：頂点間の傾き＝一定の加速度。x-t は積分して放物線弧として自動導出。
- **x-t も手描き可能だが直線のみ**（二次関数は描けない＝等速の組合せに限定）。
- **a-t は常に自動生成**。x-t（角あり）から逆算した場合、角の瞬間は加速度が未定義になるため、
  `Curve.undefinedInstants` に記録し、破線・グレーで「曖昧」だと明示する（非表示にはしない）。
- **領域の塗りつぶし**（v-t の面積＝変位）が重要機能。bw（白黒印刷）既定はハッチングパターン、
  カラーモードは色分け。どちらも数値ラベルを添える。
- 数値・記述問題（加速度／総変位／向き／運動の説明）は自由記述のみ（選択肢化しない）。
- グラフが選択肢になる問題はUIからは作らず、API側でのみ対応する。
- 既定スタイルは `bw`。`gray` プリセットは使わない（カラーモードを新設）。
- ラベル・単位は日本語（位置 x[m]・速度 v[m/s]・加速度 a[m/s²]・時刻 t[s]）。

## 非自明な実装上の注意点

**頂点モデルの転用**
`legacy_nami_app/js/wave.js` の `Wave` クラス（整数 t・0.5刻み値・線形補間）を
ほぼそのまま `MotionGraph` として転用できる。傾斜区間＝等加速度／等速直線運動の
両方を「頂点を直線で結ぶ」という同一操作で表現できるため、新しい描画UXは不要。

**pixelRatio=2 の設計**
`legacy_nami_app/js/renderer.js` と同じく、Canvas物理ピクセルを2倍にして
`ctx.scale(2,2)` を適用する。描画コードは論理座標で書く。

**PDF内の日本語テキスト**
`Exporter._textCanvas()` でテキストをCanvasに描画してからPNGとして埋め込む
（jsPDFのフォント埋め込みが複雑なため）。

**legacy_nami_app の参照**
`legacy_nami_app/` は `.gitignore` 済みの参照専用フォルダ（コミットしない）。
コードを移植する際は個別にコピー＆改変すること。
