/**
 * S154-502/503/504: Phase 8 embedding generation refresh.
 *
 * - 502: 2026-generation candidates in the catalog, shadow default swap,
 *        bge-m3 prefix/pooling correction.
 * - 503: per-model pooling (mean / last_token / cls), fail-closed dimension
 *        guard (no silent truncate/pad), Matryoshka truncate + re-normalize,
 *        batch-padding correctness for last_token pooling.
 * - 504: pull pipeline — streaming download with size verification,
 *        external-data sidecar discovery via the HF tree listing,
 *        onnxFile variant support, partial-download fail-closed.
 * - 156-002: pull supply-chain hardening — pinned HF revision URLs and
 *        sha256 verification for catalog-pinned model artifacts.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findModelById } from "../../src/embedding/model-catalog";
import { resolveEmbeddingShadowProviders } from "../../src/embedding/registry";
import {
  extractBatchVectors,
  pickTokenIndex,
  poolTokens,
  projectVector,
} from "../../src/embedding/local-onnx";
import { ModelManager } from "../../src/embedding/model-manager";

describe("S154-502: 2026-generation candidate onboarding", () => {
  test("qwen3-embedding-0.6b is registered with decoder-correct measurement config", () => {
    const entry = findModelById("qwen3-embedding-0.6b");
    expect(entry).toBeDefined();
    expect(entry?.onnxRepo).toBe("onnx-community/Qwen3-Embedding-0.6B-ONNX");
    expect(entry?.dimension).toBe(1024);
    expect(entry?.nativeDimension).toBe(1024);
    expect(entry?.matryoshka).toBe(true);
    expect(entry?.pooling).toBe("last_token");
    expect(entry?.appendText).toBe("<|endoftext|>");
    expect(entry?.queryPrefix).toContain("Instruct:");
    expect(entry?.passagePrefix).toBeUndefined();
  });

  test("granite-embedding-311m-r2 is registered with CLS pooling and no prefixes", () => {
    const entry = findModelById("granite-embedding-311m-r2");
    expect(entry).toBeDefined();
    expect(entry?.onnxRepo).toBe("ibm-granite/granite-embedding-311m-multilingual-r2");
    expect(entry?.dimension).toBe(768);
    expect(entry?.pooling).toBe("cls");
    expect(entry?.queryPrefix).toBeUndefined();
    expect(entry?.passagePrefix).toBeUndefined();
    expect(entry?.revision).toBe("44399559930365213510b1ee2eb15ded83374f0e");
    expect(entry?.sha256).toBe("75f9f258bf5013f5fe8a4dad61dd0fd16ac0cbaa7a106e3d3f41c2d04a42d541");
  });

  test("bge-m3 prefix contamination is removed and pooling is official CLS", () => {
    const entry = findModelById("bge-m3");
    // The old catalog carried the bge-small v1.5 instruction as queryPrefix,
    // which would bias any measurement against bge-m3 (official: no instruction).
    expect(entry?.queryPrefix).toBeUndefined();
    expect(entry?.pooling).toBe("cls");
  });

  test("shadow default candidates are the 2026 generation (ruri judged, bge-m3 demoted)", () => {
    const candidates = resolveEmbeddingShadowProviders({
      currentVectorModel: "local:multilingual-e5",
      currentVectorDimension: 384,
    });
    expect(candidates.map((c) => c.model_id)).toEqual([
      "qwen3-embedding-0.6b",
      "granite-embedding-311m-r2",
    ]);
    for (const candidate of candidates) {
      expect(candidate.provider).toBe("local");
      expect(candidate.local_only).toBe(true);
      expect(candidate.separate_vector_table_required).toBe(true);
      if (!candidate.installed) {
        expect(candidate.skip_reason).toBe(`model_not_installed:${candidate.model_id}`);
      }
    }
  });

  test("explicit modelIds (--models path) still resolves demoted candidates like bge-m3", () => {
    const candidates = resolveEmbeddingShadowProviders({
      currentVectorModel: "local:multilingual-e5",
      currentVectorDimension: 384,
      modelIds: ["bge-m3"],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].model_id).toBe("bge-m3");
  });
});

describe("S154-503: pooling strategies", () => {
  const rows = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [9, 9, 9],
  ];

  test("pickTokenIndex respects right padding", () => {
    expect(pickTokenIndex([1, 1, 1, 0], "last")).toBe(2);
    expect(pickTokenIndex([1, 1, 1, 0], "first")).toBe(0);
  });

  test("pickTokenIndex respects left padding", () => {
    expect(pickTokenIndex([0, 1, 1, 1], "last")).toBe(3);
    expect(pickTokenIndex([0, 1, 1, 1], "first")).toBe(1);
  });

  test("last_token pooling picks the final non-pad hidden state, not the pad row", () => {
    // Right padding: rows[3] is a pad-token hidden state and must not win.
    expect(poolTokens(rows, [1, 1, 1, 0], "last_token")).toEqual([0, 0, 1]);
  });

  test("cls pooling picks the first non-pad hidden state (left padding safe)", () => {
    expect(poolTokens(rows, [0, 1, 1, 1], "cls")).toEqual([0, 1, 0]);
  });

  test("mean pooling matches the historical implementation", () => {
    expect(poolTokens(rows, [1, 1, 0, 0], "mean")).toEqual([0.5, 0.5, 0]);
  });
});

describe("S154-503: fail-closed dimension projection", () => {
  test("hidden size mismatch throws instead of silent truncate/pad", () => {
    expect(() =>
      projectVector([1, 2, 3], { modelId: "m", dimension: 4, nativeDimension: 4, matryoshka: false })
    ).toThrow(/hidden size 3.*nativeDimension 4/);
  });

  test("non-matryoshka dimension reduction throws", () => {
    expect(() =>
      projectVector([1, 2, 3, 4], { modelId: "m", dimension: 2, nativeDimension: 4, matryoshka: false })
    ).toThrow(/not declared matryoshka/);
  });

  test("matryoshka truncation re-normalizes to unit length", () => {
    const projected = projectVector([3, 4, 0, 0], {
      modelId: "m",
      dimension: 2,
      nativeDimension: 4,
      matryoshka: true,
    });
    expect(projected).toHaveLength(2);
    const norm = Math.sqrt(projected.reduce((acc, v) => acc + v * v, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-12);
  });

  test("exact dimension passes through L2-normalized", () => {
    const projected = projectVector([3, 4], { modelId: "m", dimension: 2, nativeDimension: 2, matryoshka: false });
    expect(projected[0]).toBeCloseTo(0.6, 12);
    expect(projected[1]).toBeCloseTo(0.8, 12);
  });
});

describe("S154-503: batch padding trap (last_token over mixed-length batch)", () => {
  function tensor3d(batch: number[][][]): { data: Float32Array; dims: number[] } {
    const batchSize = batch.length;
    const seqLen = batch[0].length;
    const hidden = batch[0][0].length;
    const data = new Float32Array(batchSize * seqLen * hidden);
    batch.forEach((rows, b) =>
      rows.forEach((row, t) => row.forEach((v, d) => {
        data[(b * seqLen + t) * hidden + d] = v;
      }))
    );
    return { data, dims: [batchSize, seqLen, hidden] };
  }

  const projection = { modelId: "m", dimension: 3, nativeDimension: 3, matryoshka: false };

  test("batched short input equals the same input embedded alone (cosine drift < 1e-6)", () => {
    // Item A has 2 real tokens (right-padded to 3); item B has 3 real tokens.
    const itemA = [[1, 2, 3], [4, 5, 6], [99, 99, 99]];
    const itemB = [[7, 8, 9], [1, 1, 1], [2, 2, 2]];
    const batched = extractBatchVectors(
      tensor3d([itemA, itemB]),
      [1, 1, 0, 1, 1, 1],
      [2, 3],
      projection,
      "last_token"
    );
    const aloneA = extractBatchVectors(tensor3d([itemA.slice(0, 2)]), [1, 1], [1, 2], projection, "last_token");
    expect(batched).not.toBeNull();
    expect(aloneA).not.toBeNull();
    const cos = (x: number[], y: number[]) => {
      let dot = 0;
      let nx = 0;
      let ny = 0;
      for (let i = 0; i < x.length; i++) {
        dot += x[i] * y[i];
        nx += x[i] * x[i];
        ny += y[i] * y[i];
      }
      return dot / Math.sqrt(nx * ny);
    };
    expect(cos(batched![0], aloneA![0])).toBeGreaterThan(1 - 1e-6);
    // And the pad row [99,99,99] must not have been selected.
    const padNorm = [99, 99, 99].map((v) => v / Math.sqrt(3 * 99 * 99));
    expect(cos(batched![0], padNorm)).toBeLessThan(0.999999);
  });

  test("left-padded batch picks the true last token", () => {
    const item = [[99, 99, 99], [1, 2, 3], [4, 5, 6]];
    const vectors = extractBatchVectors(tensor3d([item]), [0, 1, 1], [1, 3], projection, "last_token");
    const expected = [4, 5, 6].map((v) => v / Math.sqrt(16 + 25 + 36));
    vectors![0].forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
  });
});

describe("S154-504: pull pipeline (streaming + external-data + fail-closed)", () => {
  const realFetch = globalThis.fetch;
  let tempDir: string | null = null;

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  interface FakeRepoFile {
    body: string;
  }

  function installFakeHub(options: {
    onnxTree: Array<{ path: string; size?: number }>;
    files: Record<string, FakeRepoFile>;
    treeStatus?: number;
  }): string[] {
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/tree/") && url.endsWith("/onnx")) {
        if (options.treeStatus && options.treeStatus !== 200) {
          return new Response("err", { status: options.treeStatus });
        }
        return Response.json(options.onnxTree);
      }
      const match = Object.entries(options.files).find(([suffix]) => url.endsWith(suffix));
      if (!match) {
        return new Response("not found", { status: 404 });
      }
      return new Response(match[1].body, { status: 200 });
    }) as typeof fetch;
    return requested;
  }

  function sha256Text(body: string): string {
    return createHash("sha256").update(body).digest("hex");
  }

  function temporarilySetCatalogSha256(modelId: string, sha256: string): () => void {
    const entry = findModelById(modelId);
    if (!entry) throw new Error(`missing catalog entry ${modelId}`);
    const original = entry.sha256;
    entry.sha256 = sha256;
    return () => {
      entry.sha256 = original;
    };
  }

  const tokenizerFiles = {
    "config.json": { body: "{}" },
    "tokenizer.json": { body: "{\"fake\":true}" },
    "special_tokens_map.json": { body: "{}" },
    "tokenizer_config.json": { body: "{}" },
  };

  test("downloads main file + external-data sidecar with size verification", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "s154-504-"));
    const mainBody = "ONNXMAIN";
    const sidecarBody = "EXTERNALDATA";
    installFakeHub({
      onnxTree: [
        { path: "onnx/model.onnx", size: mainBody.length },
        { path: "onnx/model.onnx_data", size: sidecarBody.length },
      ],
      files: {
        ...tokenizerFiles,
        "onnx/model.onnx": { body: mainBody },
        "onnx/model.onnx_data": { body: sidecarBody },
      },
    });

    const manager = new ModelManager(tempDir);
    const modelDir = await manager.pullModel("qwen3-embedding-0.6b");
    expect(readFileSync(join(modelDir, "onnx", "model.onnx"), "utf8")).toBe(mainBody);
    expect(readFileSync(join(modelDir, "onnx", "model.onnx_data"), "utf8")).toBe(sidecarBody);
  });

  test("partial download is fail-closed: mismatched size removes the file and throws", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "s154-504-"));
    installFakeHub({
      onnxTree: [{ path: "onnx/model.onnx", size: 9999 }],
      files: {
        ...tokenizerFiles,
        "onnx/model.onnx": { body: "TRUNCATED" },
      },
    });

    const manager = new ModelManager(tempDir);
    await expect(manager.pullModel("granite-embedding-311m-r2")).rejects.toThrow(/partial download/);
    expect(existsSync(join(tempDir, "granite-embedding-311m-r2", "onnx", "model.onnx"))).toBe(false);
  });

  test("missing main ONNX file in the tree listing throws (no blind 404 download)", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "s154-504-"));
    installFakeHub({
      onnxTree: [{ path: "onnx/model_other.onnx", size: 3 }],
      files: tokenizerFiles,
    });

    const manager = new ModelManager(tempDir);
    await expect(manager.pullModel("granite-embedding-311m-r2")).rejects.toThrow(/not found in/);
  });

  test("tree listing failure is fail-closed (cannot silently assume single-file layout)", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "s154-504-"));
    installFakeHub({ onnxTree: [], files: tokenizerFiles, treeStatus: 500 });

    const manager = new ModelManager(tempDir);
    await expect(manager.pullModel("granite-embedding-311m-r2")).rejects.toThrow(/HTTP 500/);
  });

  test("single-file model (no sidecar in tree) downloads only the main file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "s154-504-"));
    const mainBody = "GRANITE";
    const restoreSha = temporarilySetCatalogSha256("granite-embedding-311m-r2", sha256Text(mainBody));
    const requested = installFakeHub({
      onnxTree: [
        { path: "onnx/model.onnx", size: mainBody.length },
        { path: "onnx/model_quint8_avx2.onnx", size: 3 },
      ],
      files: {
        ...tokenizerFiles,
        "onnx/model.onnx": { body: mainBody },
      },
    });

    try {
      const manager = new ModelManager(tempDir);
      const modelDir = await manager.pullModel("granite-embedding-311m-r2");
      expect(readFileSync(join(modelDir, "onnx", "model.onnx"), "utf8")).toBe(mainBody);
      expect(existsSync(join(modelDir, "onnx", "model.onnx_data"))).toBe(false);
      expect(requested.some((url) => url.includes("model_quint8_avx2"))).toBe(false);
    } finally {
      restoreSha();
    }
  });

  test("unpinned entries keep legacy main URLs but emit a warning", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "s156-002-"));
    const mainBody = "E5";
    const requested = installFakeHub({
      onnxTree: [{ path: "onnx/model.onnx", size: mainBody.length }],
      files: {
        ...tokenizerFiles,
        "onnx/model.onnx": { body: mainBody },
      },
    });
    const writes: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const manager = new ModelManager(tempDir);
      await manager.pullModel("multilingual-e5");
    } finally {
      process.stderr.write = realWrite as typeof process.stderr.write;
    }

    expect(requested.some((url) => url.includes("/resolve/main/onnx/model.onnx"))).toBe(true);
    expect(writes.some((line) => line.includes("missing revision+sha256"))).toBe(true);
  });

  test("pinned catalog entries use resolve/<revision>/ URLs", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "s156-002-"));
    const mainBody = "GRANITE";
    const restoreSha = temporarilySetCatalogSha256("granite-embedding-311m-r2", sha256Text(mainBody));
    const requested = installFakeHub({
      onnxTree: [{ path: "onnx/model.onnx", size: mainBody.length }],
      files: {
        ...tokenizerFiles,
        "onnx/model.onnx": { body: mainBody },
      },
    });

    try {
      const manager = new ModelManager(tempDir);
      await manager.pullModel("granite-embedding-311m-r2");

      const granite = findModelById("granite-embedding-311m-r2");
      expect(granite?.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(requested.some((url) => url.includes(`/tree/${granite?.revision}/onnx`))).toBe(true);
      expect(requested.some((url) => url.includes(`/resolve/${granite?.revision}/onnx/model.onnx`))).toBe(true);
    } finally {
      restoreSha();
    }
  });

  test("same-size artifact replacement is detected by sha256 and removed fail-closed", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "s156-002-"));
    const expectedBody = "GRANITE";
    const replacementBody = "MALWARE";
    expect(replacementBody.length).toBe(expectedBody.length);
    const restoreSha = temporarilySetCatalogSha256("granite-embedding-311m-r2", sha256Text(expectedBody));
    installFakeHub({
      onnxTree: [{ path: "onnx/model.onnx", size: replacementBody.length }],
      files: {
        ...tokenizerFiles,
        "onnx/model.onnx": { body: replacementBody },
      },
    });

    try {
      const manager = new ModelManager(tempDir);
      await expect(manager.pullModel("granite-embedding-311m-r2")).rejects.toThrow(/sha256 mismatch/);
      expect(existsSync(join(tempDir, "granite-embedding-311m-r2", "onnx", "model.onnx"))).toBe(false);
    } finally {
      restoreSha();
    }
  });
});
