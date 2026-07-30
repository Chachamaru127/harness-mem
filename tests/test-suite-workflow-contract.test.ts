import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * §160-008: `npm test` (repository behavior gate) が PR で走ることを固定する。
 *
 * 経緯: この gate は release.yml の publish-npm job にしか配線されておらず、
 * tag push まで一度も走らなかった。2,600 件超のテストが緑であることを PR 時点で
 * 誰も検証できず、失敗はリリース直前に初めて表面化した。
 *
 * 検査の形について: 「test-suite.yml が存在すること」を assert する方式は採らない。
 * ファイル名を変えたり gate を別 workflow に移したりすると、名前だけ合っていて
 * 実質走っていない状態を作れてしまう (§160-005c で同じ罠を踏んだ)。
 * ここでは **workflow 群をソースから走査して「npm test を持つ job が、path filter
 * なしの pull_request trigger を持つか」** を導出する。
 *
 * この検査で分かること: trigger の宣言が正しいかどうか。
 * 分からないこと: 実際に CI が緑になるか、step の順序が正しいか、
 * 必要な事前条件 (依存インストール、モデル取得) が揃っているか。
 * それらは実際の CI run でしか確認できない。
 */

const WORKFLOWS_DIR = join(process.cwd(), ".github", "workflows");
const BEHAVIOR_GATE_COMMAND = "npm test";

interface GateCoverage {
  file: string;
  hasPullRequestTrigger: boolean;
  /** pull_request に paths / paths-ignore が付いていると、変更内容によって gate が skip されうる。 */
  pullRequestIsPathFiltered: boolean;
}

/** workflow ソース群から「behavior gate を走らせる workflow」を抽出し、PR trigger の状態を返す。 */
export function findBehaviorGateCoverage(sources: ReadonlyArray<readonly [string, string]>): GateCoverage[] {
  const coverage: GateCoverage[] = [];

  for (const [file, source] of sources) {
    if (!source.includes(BEHAVIOR_GATE_COMMAND)) continue;

    let doc: Record<string, unknown>;
    try {
      doc = parse(source) as Record<string, unknown>;
    } catch {
      continue;
    }

    // `on:` は YAML 1.1 では boolean にも読まれうるため両方見る。
    const triggers = (doc.on ?? (doc as Record<string, unknown>)["true"]) as
      | Record<string, unknown>
      | undefined;
    if (!triggers || typeof triggers !== "object") {
      coverage.push({ file, hasPullRequestTrigger: false, pullRequestIsPathFiltered: false });
      continue;
    }

    const hasPullRequestTrigger = "pull_request" in triggers;
    const pr = triggers.pull_request as Record<string, unknown> | null | undefined;
    const pullRequestIsPathFiltered =
      hasPullRequestTrigger && pr != null && typeof pr === "object" && ("paths" in pr || "paths-ignore" in pr);

    coverage.push({ file, hasPullRequestTrigger, pullRequestIsPathFiltered });
  }

  return coverage;
}

function readWorkflowSources(): Array<readonly [string, string]> {
  return readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .map((file) => [file, readFileSync(join(WORKFLOWS_DIR, file), "utf8")] as const);
}

describe("§160-008 repository behavior gate は PR で走る", () => {
  test("npm test を走らせる workflow が少なくとも 1 つ存在する", () => {
    const coverage = findBehaviorGateCoverage(readWorkflowSources());
    expect(coverage.length).toBeGreaterThan(0);
  });

  test("npm test が path filter なしの pull_request trigger で走る", () => {
    const coverage = findBehaviorGateCoverage(readWorkflowSources());
    const unfilteredOnPr = coverage.filter(
      (c) => c.hasPullRequestTrigger && !c.pullRequestIsPathFiltered,
    );

    expect(
      unfilteredOnPr.length,
      `npm test を走らせる workflow: ${JSON.stringify(coverage)}\n` +
        "PR で無条件に走るものが 1 つも無い。tag push まで gate が走らない状態に戻っている。",
    ).toBeGreaterThan(0);
  });

  test("release 経路の gate も維持されている (PR 側に移して release 側を弱めていない)", () => {
    const release = readFileSync(join(WORKFLOWS_DIR, "release.yml"), "utf8");
    expect(release).toContain("name: Run repository behavior gate");
    expect(release).toContain(BEHAVIOR_GATE_COMMAND);
  });

  test("検出ロジック自体が gate 欠落を検出する", () => {
    // gate はあるが PR trigger が無い workflow 群
    const tagOnly = findBehaviorGateCoverage([
      ["release.yml", "on:\n  push:\n    tags:\n      - 'v*'\njobs:\n  x:\n    steps:\n      - run: npm test\n"],
    ]);
    expect(tagOnly).toHaveLength(1);
    expect(tagOnly[0]?.hasPullRequestTrigger).toBe(false);

    // PR trigger はあるが paths で絞られている workflow
    const pathFiltered = findBehaviorGateCoverage([
      [
        "narrowed.yml",
        "on:\n  pull_request:\n    paths:\n      - 'memory-server/**'\njobs:\n  x:\n    steps:\n      - run: npm test\n",
      ],
    ]);
    expect(pathFiltered[0]?.hasPullRequestTrigger).toBe(true);
    expect(pathFiltered[0]?.pullRequestIsPathFiltered).toBe(true);

    // gate を含まない workflow は対象外
    expect(findBehaviorGateCoverage([["bench.yml", "on:\n  pull_request:\njobs:\n  x:\n    steps:\n      - run: bun run bench\n"]])).toHaveLength(0);
  });
});
