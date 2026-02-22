#!/usr/bin/env python3
from __future__ import annotations

from harness_mem_langchain.adapter import HarnessMemLangChainChatMemory, HarnessMemLangChainRetriever


def main() -> None:
    retriever = HarnessMemLangChainRetriever(project="langchain-sample")
    memory = HarnessMemLangChainChatMemory(project="langchain-sample", session_id="langchain-sample-session")

    memory.save_context({"input": "What memory strategy should we use?"}, {"output": "Use 3-layer workflow."})
    history = memory.load_memory_variables({"input": "Show memory"})
    hits = retriever.invoke("memory strategy", limit=3)

    print("history_length", len(history.get("history", "")))
    print("hits", len(hits))


if __name__ == "__main__":
    main()
