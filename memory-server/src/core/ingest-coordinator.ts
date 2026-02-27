/**
 * ingest-coordinator.ts
 *
 * 取り込み調整モジュール。
 * HarnessMemCore から分割された各プラットフォームのデータ取り込み責務を担う。
 *
 * 担当 API:
 *   - ingestCodexHistory (委譲)
 *   - ingestOpencodeHistory (委譲)
 *   - ingestCursorHistory (委譲)
 *   - ingestAntigravityHistory (委譲)
 *   - ingestGeminiHistory (委譲)
 *   - startClaudeMemImport (委譲)
 *   - getImportJobStatus (委譲)
 *   - verifyClaudeMemImport (委譲)
 */

import type { ApiResponse } from "./harness-mem-core";
import type { ClaudeMemImportRequest } from "../ingest/claude-mem-import";

// ---------------------------------------------------------------------------
// IngestCoordinatorDeps: HarnessMemCore から渡される内部依存
// ---------------------------------------------------------------------------

export interface IngestCoordinatorDeps {
  /** ingestCodexHistory() の実装委譲 */
  doIngestCodexHistory: () => ApiResponse;
  /** ingestOpencodeHistory() の実装委譲 */
  doIngestOpencodeHistory: () => ApiResponse;
  /** ingestCursorHistory() の実装委譲 */
  doIngestCursorHistory: () => ApiResponse;
  /** ingestAntigravityHistory() の実装委譲 */
  doIngestAntigravityHistory: () => ApiResponse;
  /** ingestGeminiHistory() の実装委譲 */
  doIngestGeminiHistory: () => ApiResponse;
  /** startClaudeMemImport() の実装委譲 */
  doStartClaudeMemImport: (request: ClaudeMemImportRequest) => ApiResponse;
  /** getImportJobStatus() の実装委譲 */
  doGetImportJobStatus: (request: { job_id: string }) => ApiResponse;
  /** verifyClaudeMemImport() の実装委譲 */
  doVerifyClaudeMemImport: (request: { job_id: string }) => ApiResponse;
}

// ---------------------------------------------------------------------------
// IngestCoordinator クラス
// ---------------------------------------------------------------------------

export class IngestCoordinator {
  constructor(private readonly deps: IngestCoordinatorDeps) {}

  ingestCodexHistory(): ApiResponse {
    return this.deps.doIngestCodexHistory();
  }

  ingestOpencodeHistory(): ApiResponse {
    return this.deps.doIngestOpencodeHistory();
  }

  ingestCursorHistory(): ApiResponse {
    return this.deps.doIngestCursorHistory();
  }

  ingestAntigravityHistory(): ApiResponse {
    return this.deps.doIngestAntigravityHistory();
  }

  ingestGeminiHistory(): ApiResponse {
    return this.deps.doIngestGeminiHistory();
  }

  startClaudeMemImport(request: ClaudeMemImportRequest): ApiResponse {
    return this.deps.doStartClaudeMemImport(request);
  }

  getImportJobStatus(request: { job_id: string }): ApiResponse {
    return this.deps.doGetImportJobStatus(request);
  }

  verifyClaudeMemImport(request: { job_id: string }): ApiResponse {
    return this.deps.doVerifyClaudeMemImport(request);
  }
}
