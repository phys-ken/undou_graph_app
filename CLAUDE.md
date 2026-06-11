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
npm test                          # motion/kinematics/renderer/problems ユニットテスト
npm run test:api                  # API バックエンドテスト
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
- グラフ選択肢問題は **UI（誤答を教員が手描き）と API（誤答を呼び出し側が JSON で渡す）の
  両方で作れる**（2026-06 改訂。旧ルール「UIからは作らない」は撤回）。
  ただし**誤答グラフの自動生成ロジックは持たない**点は不変——誤答は常に人間/呼び出し側が用意する。
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

**端部ランプ（復活済み・モデルレベルで表示と導出に統合）**
`Wave.getY` 由来の「最初/最後の頂点の外側1マスで 0（基準線）へ線形に近づく端部ランプ」を
`MotionGraph.getRampedPoints()` として復活させた。`points=[{t,value},...]` から
`[{t:first.t-1, value:0}, ...points, {t:last.t+1, value:0}]` を生成する
（点が1つもなければ空配列のまま）。

「表示と導出の一致」は維持したまま復活させるため、表示側（`valueAt`/`getSnapshot`）と
導出側（`Kinematics.curveFromGraph`）の両方が `getRampedPoints()` を参照するように
した。これにより：
- v-t/x-t エディタは、頂点が1つだけでも前後1マスで 0 に向かう三角形として表示される。
- `Kinematics.deriveFromVT`/`deriveFromXT` が対象とする区間もランプ分だけ前後に1マス
  広がり、自動導出グラフ（vt/xt/at）・設問生成・PDF/PNG出力にもこの区間が含まれる。
- ランプ区間とその直後の描画区間で傾きが異なる場合、最初/最後の頂点そのものの位置にも
  `at.discontinuities`/`undefinedInstants`（x-t 由来）や `at.discontinuities`（v-t 由来）
  が記録されうる（ランプ前後で加速度が不連続になるため）。
- v-t の `x0` の意味が変わった：「最初の頂点の時刻での位置」ではなく「最初の頂点の
  1マス手前（ランプ起点）での位置」を表す。

ランプより外側（最初の頂点の2マス以上手前・最後の頂点の2マス以上先）は引き続き
「未定義（描かれていない）」として `null` を返す。

階段状（`StepMotionGraph`/`vt-step`）には端部ランプは適用しない（区間定義が
`tStart`/`values` で完結しており、ランプの概念がそぐわないため）。

**端部ランプ境界の不連続判定（曲線の外側＝静止 a=0/v=0 とみなす）**
`deriveFromVT`/`deriveFromXT` は、ランプ済み曲線の最初/最後のセグメントの
「さらに外側」を a=0（v-t入力）/ v=0（x-t入力）＝静止とみなして
discontinuities/undefinedInstants を判定する（`prevSlope` の初期値を `0` にし、
ループ後にも最終セグメントの傾きを `0` と比較する）。

これにより、「v-t で三角形 (2,0)-(3,4)-(4,0) を描く」場合、点 (3,4) だけを
クリックして端部ランプに任せても、(2,0)/(3,4)/(4,0) を全て明示的にクリックしても、
得られる a-t の `discontinuities`（=リサーの位置）は常に同じ `[2,3,4]` になる
（y=0 の端点を明示的に描いたかどうかで a-t の見た目が変わらない）。
x-t 入力の `vt`/`at` も同様。

`_curveValueApproachingFromLeft`/`_curveValueApproachingFromRight`
（js/app.js・js/problems.js）も合わせて、曲線の最初のセグメントより前／
最後のセグメントより後でリサーの「外側の値」を求める場合は `0` を返すように
した（従来は `null` を返し、リサー自体が描画されないことがあった）。

vt-step（`deriveFromVTStep`）はこの変更の対象外（区間が常に明示的で
「補完されたランプ」が存在しないため、元々一貫している）。

**階段状（ガウス記号）v-t グラフ（実装済み）**
`StepMotionGraph`（`js/step-motion.js`）は、区間幅1の区分定数 v-t グラフを表す
モデル（`tStart` を起点に `values[i]` が各単位区間 `[tStart+i, tStart+i+1)` の
一定速度。区間は連続でなければならず、先頭/末尾からのみ伸縮できる）。
`StepGraphEditor`（`js/step-editor.js`）でセル選択＋縦ドラッグにより編集する。

導出は既存の Curve パイプラインにそのまま統合している：
- `Kinematics.curveFromStepGraph(stepGraph)` → vt の Curve（区間境界に discontinuities）
- `Kinematics.deriveFromVTStep(stepGraph)` → `{vt, xt, at}`
  （a-t は各区間内 a=0・境界は撃力的＝`undefinedInstants`、x-t は角を持つ連続な折れ線）

`App.graphMode` は `'vt' | 'xt' | 'vt-step'` の3値。設問生成
（`KinematicsProblemGenerator`）・REST API（`api/schema.json` の
`stepMotionGraph` / `kind: 'vt-step'`）も対応済み。

**グラフ選択肢モード（UI 実装済み・schema v1.2）**
問題種類「グラフ選択肢」（`problemCategory='choice'`）。選択肢①＝正答
（自動導出）、②以降＝誤答をユーザーが小 Canvas に手描きする（nami アプリの
選択肢モードと同方式）。エンジンは従来の `generateGraphChoice` をそのまま使う。

- **誤答モデルは「問う対象」で決まる**（`App._choiceTargetUsesStep`）:
  xt → `MotionGraph`（折れ線）／ vt・at → `StepMotionGraph`（区分定数）。
  理由: a-t（および x-t 由来の v-t）の正答は区分定数＋段差リサー付きで
  描かれるため、誤答が折れ線だと「リサーの有無」だけで正答が見分けられて
  しまう。`StepGraphEditor` は第5引数 `opts.axisLabels` で y 軸ラベルを
  差し替えて流用する（a-t 誤答エディタで「加速度 a [m/s²]」を出すため）。
- **エンジン側も distractor JSON を kind で判別**
  （`KinematicsProblemGenerator._distractorGraphFromJSON`、
  `kind:'vt-step'` → StepMotionGraph）。`_graphExtent` も階段型対応済み。
  REST API（schema v1.2）も `choices.distractors` に階段型 JSON を受ける
  （`GraphSpec` が元々 discriminatedUnion なので validate.js は無変更）。
- **選択肢の描画スタイルは正答・誤答で必ず揃える**
  （`_renderGraphCanvas` の `choiceStyle: true` → `_solidCurveStyle`／
  `sc.riser`）。手描き風オレンジ（`_handDrawnStyle`）は問題文の元グラフ
  専用。揃えないと「色・線幅・リサーの違いだけで正答がバレる」
  （実装時に実画像で確認済みの実バグ——戻さないこと）。
- **誤答エディタの縦軸範囲は正答カーブの自動レンジに追従**
  （`_autoValueRange`）。元グラフを編集するとパネル再表示時にグリッドも
  追従する（頂点・区間は保持）。最終出力では `generateGraphChoice` が
  全選択肢の値域を統合した共有レンジに揃え直す。
- **誤答セットは問う対象別（xt/vt/at）に保持・localStorage 保存**
  （`undou_choiceConfig`）。選択肢数（2〜10、既定4）を減らしても配列は
  切り詰めない（生成・表示時に先頭 count-1 個を使う——再び増やせば復元）。
- 誤答に端部ランプが付くのは折れ線（MotionGraph）誤答のみで、メイン
  エディタと同じ挙動（編集中も出力も `getSnapshot` 経由＝WYSIWYG）。
- 生成時に空の誤答があればアラートで中断（黙って空選択肢を出力しない）。
- 出力配線: 画面は `.choices-display`（2列グリッド）、PDF/DOCX は
  exporter.js の既存 `section.choices` 描画を使用。解答セクションには
  正答1枚だけを `showCorrect: true`（★ 正答）で載せる（全選択肢を
  繰り返すと PDF が倍に膨らむため）。ZIP は `mondai_c_N[_correct].png`
  （API の `choice_N_correct.png` と同じ正答タグ規約）。

**文字サイズ・表示項目選択（実装済み・API 対応済み）**
グラフ内テキストのフォントサイズ（8〜24px、既定12）と、表示項目の
show/hide トグル（11キー）＋プリセット（4種）を持つ。

- 伝播経路は `App._rendererExtras()`（js/app.js）一本：
  `{fontSize, ...displayOptions}` を `_editorGridConfig()` と
  `_renderDerivedCanvas()` の gridConfig にマージするだけで、エディタ・
  自動導出グラフ・模範解答・選択肢・PNG/PDF/DOCX 出力の全てに届く
  （`KinematicsProblemGenerator._makeRenderer` の `Object.assign` を素通りする。
  problems.js / exporter.js に専用の配線はない——増やさないこと）。
- レンダラ側は `config.showXxx !== false` 判定（キー欠落＝全表示の後方互換）。
  fontSize > 12 のときは `padScale = max(1, fontSize/12)` で padding を拡大し、
  プロット領域サイズは保つ（`computeCanvasSize`/コンストラクタ/translate.js の
  3箇所が同じ式を使う——変えるなら全部揃えること）。
- **目盛り本数はフォントサイズに反比例して間引く**
  （`computeFontAwareMaxTicks`、12px 以下は従来の10本上限のまま）。
  プロット領域のピクセル数は padScale で変わらないため、間引かないと
  大フォントで目盛り数値が重なって潰れる（nami は値域が ±2 程度で
  顕在化しなかった、このアプリ固有の問題）。drawGrid と drawAxes は
  `_tickSteps()` を共有しグリッド線と目盛りの間隔は常に一致する。
- **DEFAULT_PADDING.right は 68**（nami の 52 ではない）。x 軸ラベル
  「時刻 t [s]」は 12px で約 58px 必要で、52 だと末尾の "]" が常に
  クリップされる（nami の 'x [cm]' ≒38px とはラベル長が違う）。
  drawAxes 側にも `measureText` による右端クランプの保険がある。
- **原点 O は「実際の原点（y=0）の高さに縦中央揃え・軸の左横」**
  （`textBaseline='middle'`・`y=yAxis`・`x=xAxis - round(0.7em)`、nami と同じ方式）。
  y 目盛り数値は y=0 をスキップして描かれるため O とは重ならない。
  左下固定（旧実装）だと yMin < 0 のとき軸直下の負の目盛り数値と
  同じ列で縦に重なるので戻さないこと。
- **`showUndefinedMark` は「未定義 "?" マーカー」と「面積塗りつぶし」の統合トグル**
  （`drawUndefinedMarker`/`drawFilledArea` が同じキーを参照）。全プリセットで ON
  （「曖昧さを非表示にしない」原則）。
- **`showZeroLine` は `showAxes === false` のときだけ意味を持つ**（通常は t 軸が
  y=0 線を兼ねるため。nami アプリと違い軸と基準線が同一直線）。
- 軸ラベルは `showAxisLabelX`/`showAxisLabelY` で独立に消せる（「概形のみ」
  プリセットの肝——ラベルが残るとどの物理量のグラフか分かってしまう）。
  `showUnitX`/`showUnitY` は単位部分 `[s]` 等だけを正規表現
  `/\s*\[.*?\]/g` で除去する独立トグル（ラベル本体は残る）。
- プリセット定義の単一情報源は **js/styles.js の `DISPLAY_PRESETS` /
  `DISPLAY_OPTION_KEYS`**（app.js は API サンドボックスに読み込まれないため
  ここに置く）。`App.presetDisplayOptions()` と REST API（`spec.displayPreset`）
  の両方がこれを参照する。
- REST API（schema v1.1 で追加）：トップレベル `fontSize` / `displayPreset` /
  `display`。`displayPreset` を先に適用し `display` の個別キーで上書き
  （UI の「プリセットボタン → チェックボックス」と同じ）。全 Canvas 一律適用
  （選択肢だけ別設定にする機能は意図的に持たない——必要になったら
  `choices.display` を追加する設計余地は残してある）。実装は
  `api/translate.js buildState`・`api/validate.js`。
