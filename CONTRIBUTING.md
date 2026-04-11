# Contributing to harness-mem

Thank you for your interest in contributing to **harness-mem**. Please read
this document before opening an issue or pull request.

---

## License and Contributor Agreement

harness-mem is licensed under the **Business Source License 1.1 (BSL)**.
See the [LICENSE](./LICENSE) file for full terms and the [NOTICE](./NOTICE)
file for a non-binding summary.

By submitting a pull request, bug report, feature request, or any other
contribution to this repository, you agree to the following:

1. **License grant**. You license your contribution to CAN AI LLC and all
   recipients of the software under the same Business Source License 1.1
   that governs this project.

2. **Broad license grant for relicensing**. You grant CAN AI LLC a
   perpetual, worldwide, non-exclusive, royalty-free, irrevocable license
   — with the right to sublicense — to use, reproduce, modify, distribute,
   and relicense your contribution, including under a commercial license
   or a future open source license of CAN AI LLC's choosing.

   This is an *inbound license grant*, not a copyright assignment — you
   retain ownership of your contribution. The grant is deliberately broad
   so that CAN AI LLC can offer commercial licenses for use cases that
   fall outside the BSL's Additional Use Grant (for example, offering
   harness-mem as a managed Memory Service).

3. **Originality**. You represent that your contribution is your original
   work, or that you have the right to submit it under the terms above,
   and that it does not knowingly infringe any third party's rights.

4. **No warranty**. Your contribution is provided "as is", without
   warranty of any kind.

5. **Moral rights waiver (for contributors subject to jurisdictions
   recognizing moral rights, including Japan)**. To the maximum extent
   permitted by applicable law, you agree not to assert any moral rights
   (including the rights of attribution and integrity, and in Japan,
   著作者人格権) against CAN AI LLC, its successors, assigns, sublicensees,
   or downstream users of the Licensed Work, in respect of your
   contribution. This waiver does not affect your right to be credited in
   commit history or release notes where reasonable.

If you cannot agree to these terms, please do not submit contributions.

---

## Before You Open a Pull Request

- **Issues first**. For non-trivial changes, open an issue describing the
  problem or proposal before writing code. This avoids wasted work.
- **One concern per PR**. Keep pull requests focused. Separate refactors
  from feature work.
- **Tests**. New functionality should include tests. Bug fixes should
  include a regression test where practical.
- **Conventional-style commits**. Prefix commits with `feat:`, `fix:`,
  `docs:`, `refactor:`, `test:`, `chore:` so the history stays scannable.

---

## Development Setup

See the component-specific READMEs:

- [`mcp-server/README.md`](./mcp-server/README.md) — Node/TypeScript MCP server
- [`mcp-server-go/`](./mcp-server-go/) — Go MCP server
- [`harness-mem-ui/`](./harness-mem-ui/) — UI
- [`memory-server/`](./memory-server/) — Memory daemon

---

## Trademarks

"harness-mem" and associated logos are trademarks of CAN AI LLC. See
[TRADEMARK.md](./TRADEMARK.md) for acceptable-use rules. Briefly: you may
refer to harness-mem by name when discussing or integrating with it, but
forks and derivative distributions must use a different name.

---

## Contact

For commercial licensing, partnership inquiries, or questions that are
not suitable for public issues, please reach out via the repository's
GitHub profile: https://github.com/Chachamaru127/harness-mem

— CAN AI LLC
