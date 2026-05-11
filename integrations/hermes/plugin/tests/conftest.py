"""pytest configuration: wire up sys.path so tests can locate the plugin
package and the local python-sdk without requiring `pip install -e ...` first.

In CI or when running `pip install -e integrations/hermes/plugin[test]`,
this file becomes a no-op because the package is already importable.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent

# tests/ -> plugin/
_PLUGIN_ROOT = _HERE.parent
# plugin/ -> hermes/ -> integrations/ -> <worktree-root>/ -> python-sdk/
_PYTHON_SDK = _PLUGIN_ROOT.parent.parent.parent / "python-sdk"

if str(_PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_ROOT))

if _PYTHON_SDK.is_dir() and str(_PYTHON_SDK) not in sys.path:
    sys.path.insert(0, str(_PYTHON_SDK))
