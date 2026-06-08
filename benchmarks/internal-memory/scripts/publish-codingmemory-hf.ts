#!/usr/bin/env bun
/**
 * Hugging Face publish helper for CodingMemory Bench v3.
 * Requires: HF_TOKEN, optional CODINGMEMORY_HF_REPO (default: placeholder)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DATASET_DIR = join(ROOT, "datasets");
const V3 = join(DATASET_DIR, "coding-memory-real-ja-mixed-v3.jsonl");
const CARD = join(DATASET_DIR, "dataset-card.md");
const LICENSE = join(DATASET_DIR, "LICENSE");
const MANIFEST = join(DATASET_DIR, "codingmemory-v3-corpus-manifest.json");

const repo = process.env.CODINGMEMORY_HF_REPO?.trim() ?? "PLACEHOLDER_ORG/codingmemory-bench-v3";

function required(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`missing required file: ${path}`);
  }
  return path;
}

async function main(): Promise<void> {
  required(V3);
  required(CARD);
  required(LICENSE);
  const token = process.env.HF_TOKEN?.trim();
  if (!token) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          dry_run: true,
          repo,
          files: [V3, CARD, LICENSE, MANIFEST].filter((path) => existsSync(path)),
          message: "Set HF_TOKEN to upload. Run `huggingface-cli upload` manually until token is configured.",
          upload_command: `huggingface-cli upload ${repo} ${V3} coding-memory-real-ja-mixed-v3.jsonl --repo-type dataset`,
        },
        null,
        2,
      ),
    );
    return;
  }

  const readme = readFileSync(CARD, "utf8");
  const form = new FormData();
  form.append("file", new Blob([readme], { type: "text/markdown" }), "README.md");

  const response = await fetch(`https://huggingface.co/api/datasets/${repo}/commit/main`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`HF upload failed: ${response.status} ${await response.text()}`);
  }
  console.log(JSON.stringify({ ok: true, repo, uploaded: ["README.md"] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
