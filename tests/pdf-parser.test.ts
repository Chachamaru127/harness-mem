/**
 * NEXT-006: PDF ネイティブパーサー テスト
 * parsePdfBuffer / parsePdfChunks の動作を検証する。
 */
import { describe, expect, test } from "bun:test";
import { parsePdfBuffer, parsePdfChunks } from "../memory-server/src/ingest/document-parser";

// 最小有効 PDF バイナリ（1ページ・テキスト "Hello PDF"）
// PDF 1.0 の最小構造で実際のオブジェクトストリームを含む
function buildMinimalPdf(text: string): Uint8Array {
  // 最も単純な有効PDFを文字列として構築する
  const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj

4 0 obj
<< /Length ${text.length + 20} >>
stream
BT /F1 12 Tf 72 720 Td (${text}) Tj ET
endstream
endobj

5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000380 00000 n

trailer
<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF`;
  return new TextEncoder().encode(content);
}

describe("NEXT-006: PDF パーサー", () => {
  test("parsePdfBuffer はエクスポートされている", () => {
    expect(typeof parsePdfBuffer).toBe("function");
  });

  test("parsePdfChunks はエクスポートされている", () => {
    expect(typeof parsePdfChunks).toBe("function");
  });

  test("parsePdfBuffer が正常なPDFバイナリからテキストを抽出する", async () => {
    const pdf = buildMinimalPdf("HelloPDF");
    const result = await parsePdfBuffer(pdf);
    expect(result.ok).toBe(true);
    expect(result.text).toBeDefined();
  });

  test("parsePdfBuffer が空の入力でエラーを返す", async () => {
    const result = await parsePdfBuffer(new Uint8Array(0));
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("parsePdfChunks が空テキストで空配列を返す", () => {
    const chunks = parsePdfChunks("", "document.pdf");
    expect(chunks).toEqual([]);
  });

  test("parsePdfChunks がページテキストをチャンク分割する", () => {
    const text = "Section One\nContent of section one.\n\nSection Two\nContent of section two.";
    const chunks = parsePdfChunks(text, "test.pdf");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content.length).toBeGreaterThan(0);
  });

  test("ingestDocument が pdf フォーマットを受け付ける（型チェック）", () => {
    // DocumentFormat が 'pdf' を含むことをコンパイル時に確認
    const format: import("../memory-server/src/ingest/document-parser").DocumentFormat = "pdf";
    expect(format).toBe("pdf");
  });
});
