import unittest
from unittest.mock import MagicMock, patch

from harness_mem_langchain.adapter import HarnessMemLangChainRetriever, HarnessMemLangChainChatMemory


class LangChainAdapterTest(unittest.TestCase):
    def test_retriever_and_memory_shapes(self) -> None:
        retriever = HarnessMemLangChainRetriever(base_url="http://127.0.0.1:37888", project="langchain-test")
        self.assertEqual(retriever.project, "langchain-test")
        self.assertTrue(callable(retriever.invoke))

        memory = HarnessMemLangChainChatMemory(base_url="http://127.0.0.1:37888", project="langchain-test", session_id="lc-1")
        self.assertEqual(memory.session_id, "lc-1")
        self.assertTrue(callable(memory.load_memory_variables))
        self.assertTrue(callable(memory.save_context))

    @patch("harness_mem_langchain.adapter.urlopen")
    def test_token_headers_are_forwarded_when_token_is_set(self, mock_urlopen: MagicMock) -> None:
        response = MagicMock()
        response.read.return_value = b'{"items":[]}'
        context = MagicMock()
        context.__enter__.return_value = response
        context.__exit__.return_value = False
        mock_urlopen.return_value = context

        retriever = HarnessMemLangChainRetriever(
            base_url="http://127.0.0.1:37888",
            project="langchain-test",
            token="secret-token",
        )
        retriever.invoke("token header test", limit=1)

        memory = HarnessMemLangChainChatMemory(
            base_url="http://127.0.0.1:37888",
            project="langchain-test",
            session_id="lc-1",
            token="secret-token",
        )
        memory.save_context({"input": "hello"}, {"output": "world"})

        self.assertGreaterEqual(mock_urlopen.call_count, 2)
        for called in mock_urlopen.call_args_list:
            request = called.args[0]
            headers = {key.lower(): value for key, value in request.header_items()}
            self.assertEqual(headers.get("x-harness-mem-token"), "secret-token")
            self.assertEqual(headers.get("authorization"), "Bearer secret-token")


if __name__ == "__main__":
    unittest.main()
