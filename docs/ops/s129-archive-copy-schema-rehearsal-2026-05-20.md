# S129 Archive Copy Schema Rehearsal

- generated_at: 2026-05-20T06:53:14.221Z
- task: S129-001
- result: PASS
- live_db: /Users/tachibanashuuta/.harness-mem/harness-mem.db
- backup_source: /Users/tachibanashuuta/.harness-mem/backups/harness-mem-backup-2026-05-20T04-12-35-622Z.db
- backup_copy: /var/folders/3f/917p7ynn7976192t0qv1gjhm0000gp/T/harness-mem-s129-archive-copy-1779259994221/archive-schema-rehearsal.db
- backup_copy_retained: false

## Safety Boundary

- live DB mutation: not executed
- backup source mutation: not executed
- hard purge: not executed
- VACUUM: not executed
- DDL target: backup copy only

## Live DB Unchanged Check

- check_window: immediately before committed archive-schema apply on the backup copy through immediately after idempotent reapply
- table_list_unchanged: true
- schema_hash_unchanged: true
- counts_unchanged: true
- file_size_unchanged: true
- wal_size_unchanged: true
- shm_size_unchanged: true
- all: true

## Post-Integrity Live Drift Diagnostics

- gate: diagnostic only, not part of mutation pass/fail
- note: diagnostic only; live daemon may ingest during long backup-copy integrity_check and this does not affect the core mutation gate
- table_list_unchanged_since_narrow_window: true
- schema_hash_unchanged_since_narrow_window: true
- counts_unchanged_since_narrow_window: true
- file_size_unchanged_since_narrow_window: true
- wal_size_unchanged_since_narrow_window: true
- shm_size_unchanged_since_narrow_window: true
- all: true

## Backup Source Unchanged Check

- size_unchanged: true
- mtime_unchanged: true
- all: true

## Copy Schema Rehearsal

- copied_from_backup_source: true
- rollback_created_inside_transaction: {"mem_archive_stubs":true,"mem_archive_full":true}
- rollback_absent_after_rollback: true
- rollback_reopen_quick_check: {"ok":true,"result":"ok"}
- committed_schema_applied: true
- idempotent_reapply_unchanged: true
- archive_schema_hash: 031e1ad8280de14caf04d001aba51108d08152e551ce891fcf35592f754666aa
- integrity_check: ok (170644.63 ms)

## Archive Tables

- mem_archive_stubs: {"exists":true,"row_count":0,"columns":[{"name":"archive_id","type":"TEXT","notnull":0,"dflt_value":null,"pk":1},{"name":"observation_id","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"project","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"session_id","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"user_id","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"team_id","type":"TEXT","notnull":0,"dflt_value":"NULL","pk":0},{"name":"archive_stub","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"archive_full_ref","type":"TEXT","notnull":0,"dflt_value":"NULL","pk":0},{"name":"archive_state","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"reason","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"legal_hold_snapshot","type":"INTEGER","notnull":1,"dflt_value":"0","pk":0},{"name":"content_sha256","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"manifest_sha256","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"created_at","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"restored_at","type":"TEXT","notnull":0,"dflt_value":"NULL","pk":0},{"name":"purged_at","type":"TEXT","notnull":0,"dflt_value":"NULL","pk":0},{"name":"metadata_json","type":"TEXT","notnull":1,"dflt_value":"'{}'","pk":0}]}
- mem_archive_full: {"exists":true,"row_count":0,"columns":[{"name":"archive_full_ref","type":"TEXT","notnull":0,"dflt_value":null,"pk":1},{"name":"archive_id","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"payload_json","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"payload_sha256","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"created_at","type":"TEXT","notnull":1,"dflt_value":null,"pk":0},{"name":"purged_at","type":"TEXT","notnull":0,"dflt_value":"NULL","pk":0}]}

## Conclusion

The S128 backup was copied and the archive schema was rehearsed only on that copy.
The rollback/reopen path returned the copy to its pre-DDL archive-table state,
then the committed migration created empty restore-capable archive tables and
survived an idempotent reapply. Live DB checks stayed unchanged during the
rehearsal window.
