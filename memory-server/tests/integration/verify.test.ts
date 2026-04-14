/**
 * S80-C03 integration DoD:
 *   > 1 call で observation → (session_id, event_id, file_path, action)
 *   > が返り、harness_mem_graph の BFS と組合せて 2-hop 遡及が可能な
 *   > integration test PASS.
 *
 * This test records a tool_use event that mints an observation, then adds a
 * second observation linked to the first via `derives`. The verify call
 * returns the origin provenance, and getLinks BFS from the derived node
 * reaches the origin — demonstrating the 2-hop (derived obs → origin obs →
 * event → file/action) chain the DoD asks for.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";

function createCore(name: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-verify-${name}-`));
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
  };
  return { core: new HarnessMemCore(config), dir };
}

describe("S80-C03 verify integration", () => {
  test("verify → links BFS covers the 2-hop derived → origin → file chain", () => {
    const { core, dir } = createCore("2hop");
    try {
      // --- 1. Record a tool_use event that includes a file Write ---
      core.recordEvent({
        platform: "claude",
        project: "verify-proj",
        session_id: "sess-origin",
        event_type: "tool_use",
        ts: "2026-02-14T00:00:00.000Z",
        payload: {
          tool_name: "Write",
          file_path: "src/components/Header.tsx",
          content: "export default function Header() {}",
        },
        tags: [],
        privacy_tags: [],
      });

      // --- 2. Find the observation that was minted for the event ---
      const sessions = core.sessionsList({ project: "verify-proj", limit: 10 });
      expect(sessions.ok).toBe(true);
      const thread = core.sessionThread({ session_id: "sess-origin" });
      expect(thread.ok).toBe(true);
      const originObs = (thread.items as Array<{ id?: string; type?: string }>)
        .find((it) => typeof it.id === "string" && it.id.length > 0);
      expect(originObs).toBeDefined();
      const originId = originObs!.id!;

      // --- 3. Verify the origin observation traces back to the Write ---
      const verifyOrigin = core.verifyObservation({ observation_id: originId });
      expect(verifyOrigin.ok).toBe(true);
      const originResult = verifyOrigin.items[0] as {
        observation: { session_id?: string };
        event: { event_id?: string; tool_name?: string } | null;
        provenance: { file_path?: string; action?: string } | null;
      };
      expect(originResult.observation.session_id).toBe("sess-origin");
      expect(originResult.event?.tool_name).toBe("Write");
      expect(originResult.provenance?.file_path).toBe("src/components/Header.tsx");
      expect(originResult.provenance?.action).toBe("create");

      // --- 4. Add a derived observation that points at the origin ---
      // `addRelation` creates a `derives` link when we pass the observation
      // IDs explicitly. We simulate a summarization that cites the origin.
      core.recordEvent({
        platform: "claude",
        project: "verify-proj",
        session_id: "sess-derived",
        event_type: "user_prompt",
        ts: "2026-02-14T01:00:00.000Z",
        payload: { content: "summary referring to the Header Write above" },
        tags: [],
        privacy_tags: [],
      });
      const derivedThread = core.sessionThread({ session_id: "sess-derived" });
      const derivedObs = (derivedThread.items as Array<{ id?: string }>).find(
        (it) => typeof it.id === "string" && it.id.length > 0
      );
      expect(derivedObs).toBeDefined();
      const derivedId = derivedObs!.id!;

      core.createLink({
        from_observation_id: derivedId,
        to_observation_id: originId,
        relation: "derives",
      });

      // --- 5. 2-hop: BFS from the derived node via getLinks, then verify the
      //        origin it reaches. This proves the DoD chain end-to-end. ---
      const links = core.getLinks({
        observation_id: derivedId,
        relation: "derives",
        depth: 1,
      });
      expect(links.ok).toBe(true);
      const neighborIds = (links.items as Array<{ to_observation_id?: string }>)
        .map((l) => l.to_observation_id)
        .filter((x): x is string => typeof x === "string");
      expect(neighborIds).toContain(originId);

      const verifyViaHop = core.verifyObservation({ observation_id: neighborIds[0]! });
      const hopResult = verifyViaHop.items[0] as {
        provenance: { file_path?: string; action?: string } | null;
      };
      expect(hopResult.provenance?.file_path).toBe("src/components/Header.tsx");
      expect(hopResult.provenance?.action).toBe("create");

      core.shutdown("test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
