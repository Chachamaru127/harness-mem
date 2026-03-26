import {
  runClaudeMemContinuityBaseline,
  runHarnessFirstTurnContinuityBenchmark,
  runMemoryRecallComparison,
} from "./benchmarks/session-continuity-shared";

const claudeMemRepo = process.env.CLAUDE_MEM_REPO;

const harnessContinuity = await runHarnessFirstTurnContinuityBenchmark();

const report: Record<string, unknown> = {
  generated_at: new Date().toISOString(),
  harness_first_turn_continuity: harnessContinuity,
};

if (claudeMemRepo) {
  report.memory_recall_comparison = await runMemoryRecallComparison(claudeMemRepo);
  report.claude_mem_first_turn_baseline = await runClaudeMemContinuityBaseline(claudeMemRepo);
} else {
  report.note =
    "Set CLAUDE_MEM_REPO=/absolute/path/to/claude-mem to run local Claude-mem comparison.";
}

console.log(JSON.stringify(report, null, 2));
