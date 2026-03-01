/**
 * NEXT-002: Reranker + AST チャンク分割のユニットテスト
 *
 * 6テスト:
 * 1. AST チャンク: コードフェンスブロックを含む Markdown が独立チャンクになる
 * 2. AST チャンク: TypeScript コードが関数単位で分割される
 * 3. AST チャンク: 空または非コードは既存挙動を維持する
 * 4. Cross-encoder: 完全一致クエリは高スコアを得る
 * 5. Cross-encoder: 関係ないクエリは低スコアになる
 * 6. Cross-encoder: 複数候補から最も関連するアイテムが上位に来る
 */
import { describe, expect, test } from "bun:test";
import {
  parseMarkdownChunks,
  parseCodeChunks,
} from "../../memory-server/src/ingest/document-parser";
import {
  createCrossEncoderReranker,
} from "../../memory-server/src/rerank/simple-reranker";

describe("NEXT-002: AST チャンク分割", () => {
  // テスト1: コードフェンスブロックを含む Markdown が独立チャンクになる
  test("コードフェンスブロックを含む Markdown が独立チャンクになる", () => {
    const md = `# ドキュメント

テキストの説明。

\`\`\`typescript
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## セクション2

別のテキスト。

\`\`\`python
def world():
    return "world"
\`\`\`
`;
    const chunks = parseMarkdownChunks(md);
    // コードフェンスブロックが独立チャンクとして含まれている
    const hasCodeChunk = chunks.some((c) => c.content.includes("function hello") || c.content.includes("def world"));
    expect(hasCodeChunk).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  // テスト2: TypeScript コードが関数単位で分割される
  test("TypeScript コードが関数・クラス単位で parseCodeChunks により分割される", () => {
    const code = `
function add(a: number, b: number): number {
  return a + b;
}

class Calculator {
  multiply(x: number, y: number): number {
    return x * y;
  }
}

const subtract = (a: number, b: number) => a - b;
`;
    const chunks = parseCodeChunks(code, "typescript");
    // 少なくとも複数チャンクに分割される
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // 関数・クラスのキーワードが含まれている
    const hasFunctionChunk = chunks.some((c) => c.content.includes("add") || c.content.includes("subtract"));
    const hasClassChunk = chunks.some((c) => c.content.includes("Calculator") || c.content.includes("multiply"));
    expect(hasFunctionChunk || hasClassChunk).toBe(true);
  });

  // テスト3: 空または非コードは既存挙動を維持する
  test("空のコードは空配列を返す", () => {
    const chunks = parseCodeChunks("", "typescript");
    expect(chunks).toEqual([]);
    // プレーンテキストは単一チャンクとして返す
    const plain = parseCodeChunks("some plain text", "text");
    expect(plain.length).toBe(1);
  });
});

describe("NEXT-002: Cross-encoder Reranker", () => {
  // テスト4: 完全一致クエリは高スコアを得る
  test("完全一致クエリは高いrerankスコアを得る", () => {
    const reranker = createCrossEncoderReranker();
    const items = [
      {
        id: "obs-1",
        score: 0.5,
        source_index: 0,
        created_at: new Date().toISOString(),
        title: "TypeScript エラーハンドリング",
        content: "TypeScript で try/catch を使ってエラーハンドリングを実装した",
      },
    ];
    const result = reranker.rerank({ query: "TypeScript エラーハンドリング", items });
    expect(result[0].rerank_score).toBeGreaterThan(0.5);
  });

  // テスト5: 関係ないクエリは低スコアになる
  test("関係ないクエリは低いrerankスコアになる", () => {
    const reranker = createCrossEncoderReranker();
    const items = [
      {
        id: "obs-1",
        score: 0.3,
        source_index: 0,
        created_at: new Date().toISOString(),
        title: "料理レシピ",
        content: "カレーの作り方：玉ねぎをよく炒めてスパイスを加える",
      },
    ];
    const result = reranker.rerank({ query: "TypeScript バグ修正", items });
    expect(result[0].rerank_score).toBeLessThan(0.8);
  });

  // テスト6: 複数候補から最も関連するアイテムが上位に来る
  test("複数候補から最も関連するアイテムが1位になる", () => {
    const reranker = createCrossEncoderReranker();
    const items = [
      {
        id: "irrelevant",
        score: 0.6,
        source_index: 0,
        created_at: new Date().toISOString(),
        title: "今日のランチ",
        content: "ラーメンを食べた。おいしかった。",
      },
      {
        id: "relevant",
        score: 0.4,
        source_index: 1,
        created_at: new Date().toISOString(),
        title: "TypeScript 型エラー修正",
        content: "TypeScript の型チェックでエラーが発生。型アノテーションを追加して解決した。",
      },
    ];
    const result = reranker.rerank({ query: "TypeScript 型エラー", items });
    expect(result[0].id).toBe("relevant");
  });
});
