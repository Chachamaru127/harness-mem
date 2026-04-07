/**
 * S74-005: Code Provenance Extractor
 *
 * tool_use イベントの payload から CodeProvenance を抽出する。
 * Write / Edit / Read ツールを直接認識し、Bash コマンドは best-effort で推定する。
 */

import type { CodeProvenance } from "./types.js";

// ---------------------------------------------------------------------------
// 言語推定: ファイル拡張子 → language 名
// ---------------------------------------------------------------------------

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  sql: "sql",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  mdx: "markdown",
  vue: "vue",
  svelte: "svelte",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  tf: "terraform",
  hcl: "hcl",
  r: "r",
  jl: "julia",
  scala: "scala",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  hs: "haskell",
  lua: "lua",
  dart: "dart",
  pl: "perl",
  pm: "perl",
};

function inferLanguage(filePath: string): string | undefined {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return undefined;
  const ext = filePath.slice(lastDot + 1).toLowerCase();
  return EXT_TO_LANGUAGE[ext];
}

// ---------------------------------------------------------------------------
// ファイルパス抽出: payload の各フィールドを優先順位順に試みる
// ---------------------------------------------------------------------------

function extractFilePath(payload: Record<string, unknown>): string | null {
  for (const key of ["file_path", "path", "filePath", "filename", "file"]) {
    const val = payload[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bash コマンドからファイル操作を推定（best-effort）
// ---------------------------------------------------------------------------

// 一般的なファイル操作コマンド
const CREATE_CMD_RE = /(?:touch|mkdir)\s+([^\s|;&]+)|(?:tee|>\s*)([^\s|;&]+)/;
const DELETE_CMD_RE = /rm\s+(?:-[a-zA-Z]*\s+)*([^\s|;&]+)/;
const READ_CMD_RE = /(?:cat|less|more|head|tail)\s+([^\s|;&]+)/;
// ファイルパスっぽい引数
const FILE_PATH_RE = /(?:^|\s)((?:\.{1,2}\/|\/)?[\w./-]+\.(?:ts|js|tsx|jsx|py|rb|rs|go|java|sh|sql|json|yaml|yml|toml|md|html|css|txt|log|conf|env))\b/g;

function extractFromBashCommand(command: string): { file_path: string; action: CodeProvenance["action"] } | null {
  // 削除
  const deleteMatch = DELETE_CMD_RE.exec(command);
  if (deleteMatch?.[1] && !deleteMatch[1].startsWith("-")) {
    return { file_path: deleteMatch[1], action: "delete" };
  }

  // 作成
  const createMatch = CREATE_CMD_RE.exec(command);
  if (createMatch) {
    const filePath = createMatch[1] ?? createMatch[2];
    if (filePath) {
      return { file_path: filePath, action: "create" };
    }
  }

  // 読み取り
  const readMatch = READ_CMD_RE.exec(command);
  if (readMatch?.[1]) {
    return { file_path: readMatch[1], action: "read" };
  }

  // 汎用ファイルパス検出
  FILE_PATH_RE.lastIndex = 0;
  const pathMatch = FILE_PATH_RE.exec(command);
  if (pathMatch?.[1]) {
    // コマンドに write 系のキーワードがあれば edit と判定
    if (/(?:write|sed\s+-i|awk.*>\s*|echo.*>|printf.*>)/.test(command)) {
      return { file_path: pathMatch[1], action: "edit" };
    }
    return { file_path: pathMatch[1], action: "read" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * tool_use イベントの payload から CodeProvenance を抽出する。
 * 判定できない場合は null を返す。
 */
export function extractCodeProvenance(payload: Record<string, unknown>): CodeProvenance | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const toolName = typeof payload.tool_name === "string" ? payload.tool_name : null;
  const modelId = typeof payload.model_id === "string" ? payload.model_id : undefined;

  // ----- Write ツール -----
  if (toolName === "Write") {
    const filePath = extractFilePath(payload);
    if (!filePath) return null;
    return {
      file_path: filePath,
      action: "create",
      model_id: modelId,
      language: inferLanguage(filePath),
    };
  }

  // ----- Edit ツール -----
  if (toolName === "Edit") {
    const filePath = extractFilePath(payload);
    if (!filePath) return null;
    return {
      file_path: filePath,
      action: "edit",
      model_id: modelId,
      language: inferLanguage(filePath),
    };
  }

  // ----- Read ツール -----
  if (toolName === "Read") {
    const filePath = extractFilePath(payload);
    if (!filePath) return null;
    return {
      file_path: filePath,
      action: "read",
      model_id: modelId,
      language: inferLanguage(filePath),
    };
  }

  // ----- Bash ツール -----
  if (toolName === "Bash") {
    const command =
      typeof payload.command === "string"
        ? payload.command
        : typeof payload.cmd === "string"
          ? payload.cmd
          : null;
    if (!command) return null;

    const result = extractFromBashCommand(command);
    if (!result) return null;

    return {
      file_path: result.file_path,
      action: result.action,
      model_id: modelId,
      language: inferLanguage(result.file_path),
    };
  }

  // ----- tool_name なし / その他ツール: フィールドから推定 -----

  // old_string / new_string があれば edit
  if (
    ("old_string" in payload || "new_string" in payload) &&
    extractFilePath(payload)
  ) {
    const filePath = extractFilePath(payload)!;
    return {
      file_path: filePath,
      action: "edit",
      model_id: modelId,
      language: inferLanguage(filePath),
    };
  }

  // file_path / path / filePath があれば read として扱う
  const filePath = extractFilePath(payload);
  if (filePath) {
    return {
      file_path: filePath,
      action: "read",
      model_id: modelId,
      language: inferLanguage(filePath),
    };
  }

  return null;
}
