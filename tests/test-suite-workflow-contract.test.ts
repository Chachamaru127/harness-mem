import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
 *
 * 実装上の制約: このテストは `npm test` (repository behavior gate) の対象なので、
 * **root の依存を一切 import できない**。gate は root の `node_modules` を用意せずに
 * 走る (初版で `yaml` を import して CI だけで落ちた)。そのため YAML パーサは使わず、
 * `on:` ブロックのインデント構造だけを行単位で読む。
 */

/** `on:` ブロックだけを抽出し、trigger 名 → その配下の行 に分解する。 */
function parseTriggers(source: string): Map<string, string[]> {
  const lines = source.split("\n");
  const triggers = new Map<string, string[]>();

  // `on:` は行頭 (インデント 0)。YAML 1.1 で真偽値に読まれる罠は文字列走査では起きない。
  const onIndex = lines.findIndex((line) => /^on:\s*$/.test(line) || /^on:\s*\S/.test(line));
  if (onIndex === -1) return triggers;

  let current: string | null = null;
  for (let i = onIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    // インデント 0 の行が来たら `on:` ブロックは終わり。
    if (!/^\s/.test(line)) break;

    const indent = line.length - line.trimStart().length;
    if (indent === 2) {
      const name = line.trim().replace(/:.*$/, "");
      current = name;
      triggers.set(name, []);
    } else if (current) {
      triggers.get(current)?.push(line.trim());
    }
  }

  return triggers;
}

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

    const triggers = parseTriggers(source);
    const prBody = triggers.get("pull_request");
    const hasPullRequestTrigger = prBody !== undefined;
    const pullRequestIsPathFiltered =
      hasPullRequestTrigger &&
      (prBody ?? []).some((line) => /^paths(-ignore)?:/.test(line));

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
