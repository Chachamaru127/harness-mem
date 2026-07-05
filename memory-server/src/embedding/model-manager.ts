import { createReadStream, existsSync, mkdirSync, statSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { findModelById, type ModelCatalogEntry } from "./model-catalog";

export interface ModelStatus {
  id: string;
  installed: boolean;
  path?: string;
  sizeBytes?: number;
}

const DEFAULT_MODELS_DIR = join(homedir(), ".harness-mem", "models");

const TOKENIZER_FILES = [
  "config.json",
  "tokenizer.json",
  "special_tokens_map.json",
  "tokenizer_config.json",
];

const ONNX_FILE = join("onnx", "model.onnx");

function buildHuggingFaceUrl(repo: string, filePath: string, revision?: string): string {
  return `https://huggingface.co/${repo}/resolve/${revision ?? "main"}/${filePath}`;
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        total += dirSizeBytes(full);
      } else {
        try {
          total += statSync(full).size;
        } catch {
          // ignore unreadable files
        }
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return total;
}

// S154-504: redirects are followed MANUALLY. Bun's automatic redirect
// handling hangs on the HF LFS 302 to cas-bridge.xethub.hf.co (observed
// 2026-06-12: auto-follow stalls indefinitely while a manual two-step fetch
// retrieves the same 33MB file in ~0.6s).
async function fetchFollowingRedirects(
  url: string,
  signal: AbortSignal,
  maxRedirects = 5
): Promise<Response> {
  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetch(currentUrl, {
      headers: { "User-Agent": "harness-mem/1.0" },
      redirect: "manual",
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`HTTP ${response.status} redirect without Location from ${currentUrl}`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new Error(`too many redirects fetching ${url}`);
}

// S154-504: streaming download with bounded memory — the body is consumed
// chunk-by-chunk through a FileSink so whole model files (bge-m3 2.27GB /
// qwen3 fp32 2.4GB) never sit fully in RSS. Bun.write(path, Response) is NOT
// used: against the HF CDN it hangs without consuming the body (observed
// 2026-06-12, same Bun version that streams fine via reader+FileSink).
// expectedBytes (from the HF tree listing) makes partial downloads
// fail-closed: size mismatch deletes the file and throws instead of leaving
// a truncated model that "installs".
async function downloadFile(url: string, destPath: string, expectedBytes?: number): Promise<void> {
  const destDir = dirname(destPath);
  mkdirSync(destDir, { recursive: true });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000); // 30 min timeout

  try {
    const response = await fetchFollowingRedirects(url, controller.signal);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    if (!response.body) {
      throw new Error(`empty response body fetching ${url}`);
    }

    const sink = Bun.file(destPath).writer({ highWaterMark: 4 * 1024 * 1024 });
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const pending = sink.write(value);
        if (typeof pending !== "number") {
          await pending;
        }
      }
      await sink.end();
    } catch (error) {
      try {
        await sink.end();
      } catch {
        // best-effort close before removing the partial file
      }
      rmSync(destPath, { force: true });
      throw error;
    }

    if (typeof expectedBytes === "number" && expectedBytes > 0) {
      const written = statSync(destPath).size;
      if (written !== expectedBytes) {
        rmSync(destPath, { force: true });
        throw new Error(
          `partial download for ${url}: wrote ${written} bytes, expected ${expectedBytes} (removed; re-run pull)`
        );
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function removeOnnxArtifacts(modelDir: string, onnxFile: string): void {
  rmSync(join(modelDir, ONNX_FILE), { force: true });
  const sidecars = new Set([`${onnxFile}_data`, "model.onnx_data"]);
  for (const sidecar of sidecars) {
    rmSync(join(modelDir, "onnx", sidecar), { force: true });
  }
}

async function verifyFileSha256(path: string, expectedSha256: string, label: string): Promise<void> {
  const expected = expectedSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`invalid catalog sha256 for ${label}: ${expectedSha256}`);
  }
  const actual = await sha256File(path);
  if (actual !== expected) {
    rmSync(path, { force: true });
    throw new Error(`sha256 mismatch for ${label}: expected ${expected}, got ${actual} (removed; re-run pull)`);
  }
}

function warnIfUnpinned(entry: ModelCatalogEntry): void {
  const missing: string[] = [];
  if (!entry.revision) missing.push("revision");
  if (!entry.sha256) missing.push("sha256");
  if (missing.length === 0) return;
  process.stderr.write(
    `[harness-mem] Warning: model catalog entry ${entry.id} is missing ${missing.join(
      "+"
    )}; using legacy mutable/checksum-less Hugging Face pull behavior.\n`
  );
}

interface HfTreeEntry {
  path: string;
  size?: number;
}

// HF tree listing for the repo's onnx/ directory. Used to discover the
// ONNX external-data sidecar (`<file>_data`, required for >2GB protobuf
// models such as qwen3-embedding fp32) and the expected file sizes.
// Fail-closed: pull requires network anyway, so a failed listing aborts
// instead of guessing whether a sidecar exists.
async function listOnnxTree(repo: string, revision?: string): Promise<HfTreeEntry[]> {
  const url = `https://huggingface.co/api/models/${repo}/tree/${revision ?? "main"}/onnx`;
  const response = await fetch(url, { headers: { "User-Agent": "harness-mem/1.0" } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} listing ${url} (cannot verify ONNX file layout)`);
  }
  const entries = (await response.json()) as HfTreeEntry[];
  if (!Array.isArray(entries)) {
    throw new Error(`unexpected tree response for ${url}`);
  }
  return entries;
}

export class ModelManager {
  private modelsDir: string;

  constructor(modelsDir?: string) {
    this.modelsDir = modelsDir ?? DEFAULT_MODELS_DIR;
  }

  getModelDir(modelId: string): string {
    return join(this.modelsDir, modelId);
  }

  getStatus(modelId: string): ModelStatus {
    const modelDir = this.getModelDir(modelId);
    if (!existsSync(modelDir)) {
      return { id: modelId, installed: false };
    }

    // Check that key files exist: tokenizer.json + onnx/model.onnx
    const tokenizerPath = join(modelDir, "tokenizer.json");
    const onnxPath = join(modelDir, ONNX_FILE);

    if (!existsSync(tokenizerPath) || !existsSync(onnxPath)) {
      return { id: modelId, installed: false };
    }

    const sizeBytes = dirSizeBytes(modelDir);
    return { id: modelId, installed: true, path: modelDir, sizeBytes };
  }

  listModels(): ModelStatus[] {
    if (!existsSync(this.modelsDir)) {
      return [];
    }

    const entries = readdirSync(this.modelsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => this.getStatus(e.name));
  }

  getModelPath(modelId: string): string | null {
    const status = this.getStatus(modelId);
    return status.installed && status.path ? status.path : null;
  }

  async pullModel(modelId: string): Promise<string> {
    const entry: ModelCatalogEntry | undefined = findModelById(modelId);
    if (!entry) {
      throw new Error(`Unknown model id: "${modelId}". Run 'harness-mem model list' to see available models.`);
    }

    const modelDir = this.getModelDir(modelId);
    mkdirSync(modelDir, { recursive: true });
    warnIfUnpinned(entry);

    // Download tokenizer files from tokenizerRepo
    for (const file of TOKENIZER_FILES) {
      const url = buildHuggingFaceUrl(entry.tokenizerRepo, file, entry.revision);
      const dest = join(modelDir, file);
      if (existsSync(dest) && statSync(dest).size > 0) {
        continue;
      }
      process.stderr.write(`[harness-mem] Downloading ${file} from ${entry.tokenizerRepo}...\n`);
      await downloadFile(url, dest);
    }

    // S154-504: resolve the ONNX layout from the repo tree. Supports
    // catalog onnxFile variants (e.g. model_quint8_avx2.onnx) and the
    // external-data format (main file + `<file>_data` sidecar).
    const onnxFile = entry.onnxFile ?? "model.onnx";
    const tree = await listOnnxTree(entry.onnxRepo, entry.revision);
    const mainEntry = tree.find((item) => item.path === `onnx/${onnxFile}`);
    if (!mainEntry) {
      throw new Error(
        `onnx/${onnxFile} not found in ${entry.onnxRepo} (tree: ${tree.map((item) => item.path).join(", ") || "empty"})`
      );
    }
    const sidecarEntry = tree.find((item) => item.path === `onnx/${onnxFile}_data`);

    // The main file is always stored locally as onnx/model.onnx (what
    // Transformers.js loads by default). The sidecar keeps its original
    // filename because the ONNX protobuf references it by name.
    const onnxDest = join(modelDir, ONNX_FILE);
    const needMain =
      !existsSync(onnxDest) ||
      (typeof mainEntry.size === "number" && statSync(onnxDest).size !== mainEntry.size);
    if (needMain) {
      const onnxUrl = buildHuggingFaceUrl(entry.onnxRepo, `onnx/${onnxFile}`, entry.revision);
      process.stderr.write(
        `[harness-mem] Downloading onnx/${onnxFile} from ${entry.onnxRepo} (~${Math.round((mainEntry.size ?? entry.sizeBytes) / 1_000_000)}MB)...\n`
      );
      await downloadFile(onnxUrl, onnxDest, mainEntry.size);
    }
    if (entry.sha256) {
      try {
        await verifyFileSha256(onnxDest, entry.sha256, `${entry.id}:onnx/${onnxFile}`);
      } catch (error) {
        removeOnnxArtifacts(modelDir, onnxFile);
        throw error;
      }
    }

    if (sidecarEntry) {
      const sidecarDest = join(modelDir, "onnx", `${onnxFile}_data`);
      const needSidecar =
        !existsSync(sidecarDest) ||
        (typeof sidecarEntry.size === "number" && statSync(sidecarDest).size !== sidecarEntry.size);
      if (needSidecar) {
        const sidecarUrl = buildHuggingFaceUrl(entry.onnxRepo, `onnx/${onnxFile}_data`, entry.revision);
        process.stderr.write(
          `[harness-mem] Downloading onnx/${onnxFile}_data from ${entry.onnxRepo} (~${Math.round((sidecarEntry.size ?? 0) / 1_000_000)}MB, external-data sidecar)...\n`
        );
        await downloadFile(sidecarUrl, sidecarDest, sidecarEntry.size);
      }
    }

    return modelDir;
  }
}
