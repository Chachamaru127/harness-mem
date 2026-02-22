# harness-mem Python SDK

Typed synchronous client for harness-mem daemon APIs.

## Quickstart

```bash
cd python-sdk
python3 -m unittest discover -s tests -v

# daemon default URL: http://127.0.0.1:37888
# export HARNESS_MEM_BASE_URL=http://127.0.0.1:37888
python3 examples/quickstart.py
```

## Included APIs (sync)

- `health`
- `search`
- `timeline`
- `get_observations`
- `record_event`
- `record_checkpoint`
- `finalize_session`
- `resume_pack`
- `run_consolidation`
- `consolidation_status`
- `audit_log`
