/**
 * One-shot child process for project stats.
 *
 * The daemon owns HTTP and readiness; this child owns the potentially heavy
 * project stats SQLite aggregates so `/health/ready` stays responsive.
 */

import { HarnessMemCore, getConfig } from "../core/harness-mem-core";
import type { ProjectsStatsRequest } from "../core/types";

async function readPayload(): Promise<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of process.stdin) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
  }
  text += decoder.decode();
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function toStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const values = raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return values.length > 0 ? values : undefined;
}

async function parseRequest(): Promise<ProjectsStatsRequest> {
  const payload = await readPayload();
  return {
    include_private: payload.include_private === true,
    project: typeof payload.project === "string" && payload.project.trim().length > 0
      ? payload.project.trim()
      : undefined,
    project_members: toStringArray(payload.project_members),
  };
}

async function testDelayIfRequested(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  const delayMs = Number(process.env.HARNESS_MEM_TEST_PROJECTS_STATS_CHILD_DELAY_MS || 0);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await Bun.sleep(Math.min(5_000, Math.floor(delayMs)));
  }
}

async function main(): Promise<void> {
  const request = await parseRequest();
  const core = new HarnessMemCore({
    ...getConfig(),
    backgroundWorkersEnabled: false,
  });
  try {
    await testDelayIfRequested();
    const response = core.projectsStats(request);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    core.shutdown("projects-stats-child");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
