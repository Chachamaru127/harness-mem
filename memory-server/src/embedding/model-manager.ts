import { existsSync, mkdirSync, statSync, readdirSync } from "node:fs";
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

function buildHuggingFaceUrl(repo: string, filePath: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${filePath}`;
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

async function downloadFile(url: string, destPath: string): Promise<void> {
  const destDir = dirname(destPath);
  mkdirSync(destDir, { recursive: true });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 min timeout

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "harness-mem/1.0" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    const buffer = await response.arrayBuffer();
    await Bun.write(destPath, buffer);
  } finally {
    clearTimeout(timeoutId);
  }
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

    // Download tokenizer files from tokenizerRepo
    for (const file of TOKENIZER_FILES) {
      const url = buildHuggingFaceUrl(entry.tokenizerRepo, file);
      const dest = join(modelDir, file);
      if (existsSync(dest)) {
        continue;
      }
      process.stderr.write(`[harness-mem] Downloading ${file} from ${entry.tokenizerRepo}...\n`);
      await downloadFile(url, dest);
    }

    // Download ONNX model from onnxRepo (stored in onnx/model.onnx)
    const onnxDest = join(modelDir, ONNX_FILE);
    if (!existsSync(onnxDest)) {
      const onnxUrl = buildHuggingFaceUrl(entry.onnxRepo, "onnx/model.onnx");
      process.stderr.write(`[harness-mem] Downloading onnx/model.onnx from ${entry.onnxRepo} (~${Math.round(entry.sizeBytes / 1_000_000)}MB)...\n`);
      await downloadFile(onnxUrl, onnxDest);
    }

    return modelDir;
  }
}
