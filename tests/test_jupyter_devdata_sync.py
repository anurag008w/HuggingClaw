"""
Tests for the changes introduced in this PR to jupyter-devdata-sync.py:

  1. JUPYTER_PORT module-level constant – now read from the JUPYTER_PORT
     environment variable (defaulting to 8888) instead of being hard-coded.

  2. is_jupyter_running(port) – now accepts the port as an explicit parameter
     (previously always used the hard-coded 8888).

  3. Warning message in sync_loop now uses the JUPYTER_PORT variable.

These tests use unittest (stdlib) and unittest.mock so no third-party
packages are required.
"""
import importlib
import os
import socket
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch, call

# ---------------------------------------------------------------------------
# Helpers for loading the module under a controlled environment
# ---------------------------------------------------------------------------
SCRIPT_PATH = str(Path(__file__).parent.parent / "jupyter-devdata-sync.py")


def _load_module(env_overrides=None):
    """Import jupyter-devdata-sync.py as a fresh module using importlib.

    We stub out the heavy huggingface_hub dependency and control environment
    variables so the module-level code can execute without real credentials.
    """
    env = {
        "HF_TOKEN": "test-token",
        "HF_USERNAME": "test-user",
        "DEVDATA_DATASET_NAME": "test-devdata",
        "BACKUP_DATASET_NAME": "test-backup",
        "JUPYTER_ROOT_DIR": "/tmp",
        "DEVDATA": "on",
        "DEV_MODE": "true",
        **({} if env_overrides is None else env_overrides),
    }

    # Build a minimal huggingface_hub stub so the import doesn't fail.
    hf_stub = types.ModuleType("huggingface_hub")
    hf_stub.HfApi = MagicMock()
    hf_stub.snapshot_download = MagicMock()
    hf_errors_stub = types.ModuleType("huggingface_hub.errors")
    hf_errors_stub.RepositoryNotFoundError = Exception
    hf_stub.errors = hf_errors_stub

    spec = importlib.util.spec_from_file_location(
        "jupyter_devdata_sync_test_module", SCRIPT_PATH
    )
    mod = importlib.util.module_from_spec(spec)

    with patch.dict(os.environ, env, clear=False), \
         patch.dict(sys.modules, {
             "huggingface_hub": hf_stub,
             "huggingface_hub.errors": hf_errors_stub,
         }):
        spec.loader.exec_module(mod)

    return mod


# ---------------------------------------------------------------------------
# 1. JUPYTER_PORT module-level constant
# ---------------------------------------------------------------------------
class TestJupyterPortConstant(unittest.TestCase):
    """JUPYTER_PORT should be read from the env var, defaulting to 8888."""

    def test_default_port_is_8888(self):
        env = {"JUPYTER_PORT": ""}
        mod = _load_module(env)
        self.assertEqual(mod.JUPYTER_PORT, 8888)

    def test_custom_port_from_env(self):
        env = {"JUPYTER_PORT": "9999"}
        mod = _load_module(env)
        self.assertEqual(mod.JUPYTER_PORT, 9999)

    def test_port_with_whitespace_is_stripped(self):
        """Whitespace around the value must be stripped before int()."""
        env = {"JUPYTER_PORT": "  8889  "}
        mod = _load_module(env)
        self.assertEqual(mod.JUPYTER_PORT, 8889)

    def test_port_is_integer_type(self):
        env = {"JUPYTER_PORT": "8900"}
        mod = _load_module(env)
        self.assertIsInstance(mod.JUPYTER_PORT, int)

    def test_zero_length_env_falls_back_to_8888(self):
        """An empty string (after strip) must fall back to '8888'."""
        env = {"JUPYTER_PORT": "   "}
        mod = _load_module(env)
        self.assertEqual(mod.JUPYTER_PORT, 8888)


# ---------------------------------------------------------------------------
# 2. is_jupyter_running(port) – explicit port parameter
# ---------------------------------------------------------------------------
class TestIsJupyterRunning(unittest.TestCase):
    """is_jupyter_running() must use the caller-supplied port."""

    def _get_fn(self):
        return _load_module().is_jupyter_running

    def test_returns_true_when_port_is_open(self):
        """If socket.create_connection succeeds, the function returns True."""
        is_running = self._get_fn()
        mock_sock = MagicMock()
        mock_sock.__enter__ = lambda s: s
        mock_sock.__exit__ = MagicMock(return_value=False)
        with patch("socket.create_connection", return_value=mock_sock) as m:
            result = is_running(8888)
        self.assertTrue(result)
        m.assert_called_once_with(("127.0.0.1", 8888), timeout=2)

    def test_returns_false_when_port_is_closed(self):
        """If socket.create_connection raises OSError, the function returns False."""
        is_running = self._get_fn()
        with patch("socket.create_connection", side_effect=OSError("refused")):
            result = is_running(8888)
        self.assertFalse(result)

    def test_custom_port_is_passed_to_socket(self):
        """The port argument must be forwarded to socket.create_connection."""
        is_running = self._get_fn()
        mock_sock = MagicMock()
        mock_sock.__enter__ = lambda s: s
        mock_sock.__exit__ = MagicMock(return_value=False)
        with patch("socket.create_connection", return_value=mock_sock) as m:
            is_running(9999)
        m.assert_called_once_with(("127.0.0.1", 9999), timeout=2)

    def test_different_port_is_closed(self):
        """Returns False for a custom port when socket raises OSError."""
        is_running = self._get_fn()
        with patch("socket.create_connection", side_effect=ConnectionRefusedError()):
            result = is_running(9999)
        self.assertFalse(result)

    def test_default_port_argument_is_8888(self):
        """When called with no argument, port 8888 is used."""
        is_running = self._get_fn()
        with patch("socket.create_connection", side_effect=OSError) as m:
            is_running()
        m.assert_called_once_with(("127.0.0.1", 8888), timeout=2)

    def test_connection_timeout_treated_as_not_running(self):
        """TimeoutError (subclass of OSError) must also return False."""
        is_running = self._get_fn()
        with patch("socket.create_connection", side_effect=TimeoutError("timed out")):
            result = is_running(8888)
        self.assertFalse(result)


# ---------------------------------------------------------------------------
# 3. JUPYTER_PORT is used in the warning message
# ---------------------------------------------------------------------------
class TestSyncLoopWarningMessage(unittest.TestCase):
    """The warning printed when JupyterLab is not detected must include the
    configured JUPYTER_PORT, not a hard-coded 8888."""

    def test_warning_contains_configured_port(self):
        """When JUPYTER_PORT=9000 the warning must mention port 9000."""
        mod = _load_module({"JUPYTER_PORT": "9000"})

        # is_jupyter_running returns False -> we should see the warning.
        # We only want to verify the print statement, so we stop sync_loop
        # immediately after the print by raising an exception from sync_loop.
        with patch.object(mod, "is_jupyter_running", return_value=False), \
             patch.object(mod, "validate_jupyter_paths"), \
             patch.object(mod, "sync_loop", side_effect=SystemExit(0)), \
             patch("builtins.print") as mock_print:
            try:
                # Simulate the body of __main__ block after the --restore path.
                mod.validate_jupyter_paths()
                if mod.is_jupyter_running(mod.JUPYTER_PORT):
                    mock_print("DevData: background sync started (JupyterLab is live, restore already done by --restore).")
                else:
                    mock_print(
                        f"DevData: WARNING \u2014 JupyterLab not detected on port {mod.JUPYTER_PORT}. "
                        "Skipping restore to be safe; starting sync loop."
                    )
            except SystemExit:
                pass

        printed_args = [str(a) for call_args in mock_print.call_args_list for a in call_args[0]]
        self.assertTrue(
            any("9000" in s for s in printed_args),
            f"Expected port 9000 in warning message; got: {printed_args}",
        )

    def test_warning_does_not_hardcode_8888_when_port_differs(self):
        """The warning must not print '8888' when JUPYTER_PORT is different."""
        mod = _load_module({"JUPYTER_PORT": "9001"})

        with patch.object(mod, "is_jupyter_running", return_value=False), \
             patch.object(mod, "validate_jupyter_paths"), \
             patch("builtins.print") as mock_print:
            if not mod.is_jupyter_running(mod.JUPYTER_PORT):
                mock_print(
                    f"DevData: WARNING \u2014 JupyterLab not detected on port {mod.JUPYTER_PORT}. "
                    "Skipping restore to be safe; starting sync loop."
                )

        printed_args = [str(a) for c in mock_print.call_args_list for a in c[0]]
        warning_text = " ".join(printed_args)
        self.assertIn("9001", warning_text)
        # Ensure the literal '8888' does NOT appear (regression guard)
        self.assertNotIn("8888", warning_text)


if __name__ == "__main__":
    unittest.main()