## [0.1.1] - 2026-02-17

### 🎯 What's Changed for You

Harness-mem setup and feed viewing are now easier to complete without guesswork.

| Before | After |
|--------|-------|
| `setup` only asked target platform selection. | `setup` now asks language, target tools, optional Claude-mem import, and optional Claude-mem stop. |
| Clicking a feed card opened a dimmed overlay that could feel off-screen in long scroll views. | Clicking a feed card expands full text inline at the clicked card (accordion behavior). |

### Added

- Settings now include design presets (`Bento Canvas`, `Liquid Glass`, `Night Signal`) and language-aware copy updates.
- Feed platform badges now include dedicated visual labels for `cursor` and `antigravity`.

### Changed

- UI default language handling and document language metadata were aligned to English-by-default with runtime language switching.

### Internal

- Added and updated UI tests for inline detail expansion, settings persistence, and platform badge rendering.
