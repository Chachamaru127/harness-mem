# S108 Retrieval Ablation

Generated: 2026-05-07T02:34:39.537Z
Fixture: tests/benchmarks/fixtures/dev-workflow-60.json
Cases: 64

| variant | status | recall@10 | MRR | p95 ms | top miss reason |
|---|---:|---:|---:|---:|---|
| lexical | available | 0.7630 | 0.7695 | 0.4340 | ranking_miss |
| code_token | available | 0.7708 | 0.7617 | 0.3576 | ranking_miss |
| query_expansion | available | 0.7109 | 0.7220 | 0.2613 | ranking_miss |
| recency | available | 0.7318 | 0.7184 | 0.7445 | ranking_miss |
| entity | available | 0.7240 | 0.7197 | 0.7427 | ranking_miss |
| graph | available | 0.7161 | 0.7020 | 0.6542 | ranking_miss |
| vector_full_baseline | available | 0.7057 | 0.7081 | 1.9505 | ranking_miss |
| fact_chain | not_available | - | - | - | dev-workflow-60 does not carry fact-chain annotations, and S108-003 intentionally does not edit temporal persistence schema/core files |

## Per-Family Metrics

### lexical
| family | cases | recall@10 | MRR | p95 ms | top miss reason |
|---|---:|---:|---:|---:|---|
| branch | 4 | 1.0000 | 0.7500 | 0.2449 | - |
| companion | 4 | 0.8334 | 1.0000 | 0.2155 | ranking_miss |
| deploy | 4 | 0.7500 | 1.0000 | 0.2097 | ranking_miss |
| doctor | 4 | 0.7500 | 1.0000 | 0.2223 | ranking_miss |
| failing_test | 9 | 0.5185 | 0.4732 | 0.5586 | retrieval_miss |
| file | 6 | 0.6389 | 0.7235 | 1.4517 | ranking_miss |
| issue | 7 | 0.6905 | 0.7866 | 0.1855 | ranking_miss |
| migration | 6 | 0.9167 | 0.9167 | 0.3618 | ranking_miss |
| pr | 6 | 0.7500 | 0.7500 | 0.3264 | ranking_miss |
| release | 6 | 0.7778 | 0.7222 | 0.3352 | ranking_miss |
| setup | 8 | 0.9375 | 0.7264 | 0.3574 | ranking_miss |

### code_token
| family | cases | recall@10 | MRR | p95 ms | top miss reason |
|---|---:|---:|---:|---:|---|
| branch | 4 | 1.0000 | 0.7500 | 0.2735 | - |
| companion | 4 | 0.8334 | 1.0000 | 0.1689 | ranking_miss |
| deploy | 4 | 0.7500 | 1.0000 | 0.2355 | ranking_miss |
| doctor | 4 | 0.7500 | 1.0000 | 0.1818 | ranking_miss |
| failing_test | 9 | 0.5185 | 0.4732 | 0.3817 | retrieval_miss |
| file | 6 | 0.7222 | 0.7235 | 1.8416 | ranking_miss |
| issue | 7 | 0.6905 | 0.7866 | 0.3880 | ranking_miss |
| migration | 6 | 0.9167 | 0.9167 | 0.1905 | ranking_miss |
| pr | 6 | 0.7500 | 0.6667 | 0.2332 | ranking_miss |
| release | 6 | 0.7778 | 0.7222 | 0.2277 | ranking_miss |
| setup | 8 | 0.9375 | 0.7264 | 0.2658 | ranking_miss |

### query_expansion
| family | cases | recall@10 | MRR | p95 ms | top miss reason |
|---|---:|---:|---:|---:|---|
| branch | 4 | 0.8750 | 0.7500 | 0.1829 | ranking_miss |
| companion | 4 | 0.7084 | 1.0000 | 0.1501 | ranking_miss |
| deploy | 4 | 0.7500 | 0.8333 | 0.1291 | ranking_miss |
| doctor | 4 | 0.7500 | 0.8750 | 0.1349 | ranking_miss |
| failing_test | 9 | 0.4815 | 0.5078 | 0.1862 | retrieval_miss |
| file | 6 | 0.7222 | 0.7152 | 0.3205 | stale_fact_win |
| issue | 7 | 0.6905 | 0.7151 | 0.9761 | ranking_miss |
| migration | 6 | 0.9167 | 0.8667 | 0.1946 | ranking_miss |
| pr | 6 | 0.7778 | 0.6071 | 0.1868 | ranking_miss |
| release | 6 | 0.6945 | 0.6389 | 0.1805 | ranking_miss |
| setup | 8 | 0.6667 | 0.7292 | 0.2613 | ranking_miss |

### recency
| family | cases | recall@10 | MRR | p95 ms | top miss reason |
|---|---:|---:|---:|---:|---|
| branch | 4 | 0.8750 | 0.6667 | 0.5947 | stale_fact_win |
| companion | 4 | 0.7084 | 1.0000 | 0.4102 | ranking_miss |
| deploy | 4 | 0.7500 | 0.8333 | 0.4639 | ranking_miss |
| doctor | 4 | 0.8334 | 0.8750 | 0.5240 | ranking_miss |
| failing_test | 9 | 0.4815 | 0.5078 | 0.6455 | ranking_miss |
| file | 6 | 0.7222 | 0.6079 | 0.9301 | stale_fact_win |
| issue | 7 | 0.6905 | 0.7151 | 0.5017 | ranking_miss |
| migration | 6 | 0.9167 | 0.8667 | 0.8956 | ranking_miss |
| pr | 6 | 0.7778 | 0.6071 | 0.7445 | ranking_miss |
| release | 6 | 0.7778 | 0.6435 | 0.4610 | ranking_miss |
| setup | 8 | 0.7292 | 0.8185 | 1.0415 | ranking_miss |

### entity
| family | cases | recall@10 | MRR | p95 ms | top miss reason |
|---|---:|---:|---:|---:|---|
| branch | 4 | 0.8750 | 0.6875 | 0.5452 | stale_fact_win |
| companion | 4 | 0.7084 | 1.0000 | 1.0405 | ranking_miss |
| deploy | 4 | 0.7500 | 0.8333 | 0.2479 | ranking_miss |
| doctor | 4 | 0.7084 | 0.8750 | 0.6922 | ranking_miss |
| failing_test | 9 | 0.4815 | 0.5078 | 1.0248 | ranking_miss |
| file | 6 | 0.7222 | 0.6079 | 0.6346 | stale_fact_win |
| issue | 7 | 0.6905 | 0.7151 | 0.4875 | ranking_miss |
| migration | 6 | 0.9167 | 0.8667 | 0.5268 | ranking_miss |
| pr | 6 | 0.7778 | 0.6071 | 0.8560 | ranking_miss |
| release | 6 | 0.7778 | 0.6435 | 0.5292 | ranking_miss |
| setup | 8 | 0.7292 | 0.8185 | 0.5282 | ranking_miss |

### graph
| family | cases | recall@10 | MRR | p95 ms | top miss reason |
|---|---:|---:|---:|---:|---|
| branch | 4 | 0.8750 | 0.6875 | 1.0205 | stale_fact_win |
| companion | 4 | 0.7084 | 1.0000 | 0.5423 | ranking_miss |
| deploy | 4 | 0.7500 | 0.8333 | 0.5765 | ranking_miss |
| doctor | 4 | 0.7084 | 0.7500 | 0.8472 | ranking_miss |
| failing_test | 9 | 0.4815 | 0.5084 | 0.5856 | ranking_miss |
| file | 6 | 0.7222 | 0.6079 | 1.0321 | stale_fact_win |
| issue | 7 | 0.6905 | 0.7151 | 0.4887 | ranking_miss |
| migration | 6 | 0.9167 | 0.8750 | 0.6542 | ranking_miss |
| pr | 6 | 0.7778 | 0.6071 | 0.5117 | ranking_miss |
| release | 6 | 0.6945 | 0.6401 | 0.4749 | ranking_miss |
| setup | 8 | 0.7292 | 0.7351 | 0.5893 | ranking_miss |

### vector_full_baseline
| family | cases | recall@10 | MRR | p95 ms | top miss reason |
|---|---:|---:|---:|---:|---|
| branch | 4 | 0.8750 | 0.6875 | 1.7130 | stale_fact_win |
| companion | 4 | 0.7084 | 0.7500 | 1.5047 | ranking_miss |
| deploy | 4 | 0.7500 | 0.8333 | 1.4482 | ranking_miss |
| doctor | 4 | 0.7084 | 0.8333 | 1.5980 | ranking_miss |
| failing_test | 9 | 0.4259 | 0.5633 | 2.4628 | ranking_miss |
| file | 6 | 0.6667 | 0.5968 | 2.4552 | stale_fact_win |
| issue | 7 | 0.6905 | 0.7151 | 1.7569 | ranking_miss |
| migration | 6 | 0.9167 | 0.8750 | 2.1355 | ranking_miss |
| pr | 6 | 0.8333 | 0.6042 | 1.9505 | ranking_miss |
| release | 6 | 0.6945 | 0.7188 | 1.4671 | ranking_miss |
| setup | 8 | 0.7083 | 0.7570 | 1.8303 | ranking_miss |
