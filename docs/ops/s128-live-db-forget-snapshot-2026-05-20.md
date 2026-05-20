# S128 Live DB Forget Snapshot

- generated_at: 2026-05-20T04:58:42.864Z
- db_path: /Users/tachibanashuuta/.harness-mem/harness-mem.db
- db_size: 13.7 GB
- wal_size: 428 MB
- open_mode: readonly for plan snapshot

## Plan Summary

- observations: 344946
- archived: 0
- expired: 0
- legal_hold: 0
- mutation_check: content_unchanged
- audit_log_drift_check: unchanged
- live_probe_drift_check: content_unchanged
- live_probe_audit_log_drift_check: changed
- dry_run_candidate_count: 1000
- scanned: 344946
- score_summary: {"min":0.9499,"max":1,"avg":0.9532}

## Top Candidate Projects

- project_09c1093888f381f6: 345
- project_c3322fe1466533f0: 127
- project_24f71091682bb646: 118
- project_6b4a5fbba9968feb: 102
- project_41c21dd6ed019683: 89
- project_a838ffd7506db490: 48
- project_609ed728460433cc: 47
- project_5f1257c334a1f05b: 41
- project_975a31cd68de5bd2: 32
- project_ec57f4e14556925d: 22

## Cross Store Impact

- observations: 1000
- mem_vectors: 1047
- mem_links_touching: 229
- mem_relations: 0
- mem_facts: 25
- mem_events: 1000
- mem_tags: 2112
- mem_observation_entities: 0
- mem_nuggets: 0
- mem_nugget_vectors: 0
- mem_vectors_vec_map: 1047
- mem_archive_stubs: 0
- mem_archive_full: 0

## Daemon Probe

- health: {"ok":true,"status":200,"service_status":"ok","pid":34341,"backend_mode":"local","vector_engine":"sqlite-vec","vector_model":"adaptive:ruri-v3-30m+multilingual-e5","embedding_provider_status":"healthy","counts_status":"omitted","latency_ms":0.08}
- metrics: {"ok":true,"status":200,"coverage":{"observations":344946,"mem_vectors":518731,"current_model_observations":344946,"current_model_vector_rows":389468,"vector_coverage":1,"target_coverage":0.95,"missing_current_model_vectors":0,"mem_vectors_vec_map":394311},"retry_queue":{"count":0,"max_retry_count":0},"consolidation_queue":{"pending":0,"running":2,"failed":0,"completed":4997},"facts":{"total":269137,"merged":185461},"latency_ms":5095.67}
- forget_plan_endpoint: {"ok":false,"status":404,"body":"Not Found"}
- hard_purge_endpoint: {"skipped":true,"reason":"plan-only boundary: do not POST to hard-purge because prepare mode can generate a confirmation phrase"}

## Backup

- path: /Users/tachibanashuuta/.harness-mem/backups/harness-mem-backup-2026-05-20T04-12-35-622Z.db
- size: 13.2 GB
- sha256: edc48c6bc75a5412092cd7e3c7ab7b8669525161123437bbe847a57665ee7379
- integrity_check: {"checked":true,"ok":true,"result":"ok","error":null}
- creation_method: operator-created WAL-safe backup; this script validates the supplied backup artifact

## Hard Purge Readiness

- execute_ready: false
- blockers: ["live execute not requested","forget candidates are dry-run soft-archive candidates, not restore-capable hard-purge candidates","mem_archive_stubs table is absent","mem_archive_full table is absent","no archived observations currently exist"]

## Next Decision

This artifact is a plan-only snapshot. It does not archive or hard-purge live rows.
If disk reclamation is still desired, the next step is to decide whether to create restore-capable archive rows for selected candidates before any execute attempt.
