# S129 Hard Purge Readiness Manifest

- generated_at: 2026-05-20T10:13:58.451Z
- generated_at_jst: 2026-05-20 19:13:58 JST
- live_db: `/Users/tachibanashuuta/.harness-mem/harness-mem.db`
- result: CANDIDATES READY, EXECUTE BLOCKED
- hard_purge: not executed
- vacuum: not executed
- confirmation_phrase: not generated

## Candidate Readiness

- selected archived rows: 100
- ready candidates: 100
- validation failures: 0
- legal_hold blockers: 0
- archive state: `archived=100`
- restore-capable stub/full payload count: 100
- readiness_manifest_sha256: `58de4caa1a9dd1efb199b4f4876cf6f6570858fa9b20632c5d071eafb73f7c35`

## Backup Evidence

- path: `/Users/tachibanashuuta/.harness-mem/harness-mem-backup-2026-05-20T08-49-44-193Z.db`
- exists: true
- size_bytes: 14241361920
- sha256: `2c566c961d2a53048718fd25afd80b669ba19b44bd5988c1b63cc9e8d2713734`
- sha256_verified_current: true
- integrity_check: ok from S129 fresh backup preflight

Note: re-running full backup integrity inline through the live hard-purge HTTP
path is not operationally acceptable for this 14GB backup. It timed out, and
the pre-fix implementation also attempted to read the whole backup into memory.

## Cross-Store Impact If Later Approved

- observations: 100
- mem_vectors: 147
- mem_links_touching: 205
- mem_relations: 0
- mem_facts: 9
- mem_events: 100
- mem_tags: 261
- mem_observation_entities: 0
- mem_nuggets: 0
- mem_nugget_vectors: 0
- mem_vectors_vec_map: 147
- mem_archive_stubs: 100
- mem_archive_full: 100

## Execute Readiness

`execute_ready_now=false`.

Blockers:

- hard purge execute requires separate operator approval
- inline backup integrity verification is too slow for the live HTTP request path

## Operational Findings

- The hard-purge readiness API now supports `readiness_only:true`; this omits
  `confirmation_phrase` and does not activate an execute window.
- Backup SHA verification was changed from whole-file `readFileSync` to
  streaming reads, preventing ENOMEM on a 14GB backup.
- The remaining hardening item before physical purge is to make backup evidence
  nonblocking for the live request path, for example by using a preverified
  backup evidence record/token produced by a separate backup-check command.

## Boundary

This report is readiness-only. It did not delete observations, clear archive
payloads, mark archive rows as purged, or run `VACUUM` / `VACUUM INTO`.
