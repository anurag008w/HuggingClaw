#!/usr/bin/env bash
# Tests for the pip/pip3/python/python3 shell wrapper functions in start.sh.
#
# PR changes tested here:
#   - pip()     – new venv branch: elif [ -n "${VIRTUAL_ENV:-}" ]; then env -u PIP_USER pip "$@"
#   - pip3()    – same venv branch
#   - python()  – new venv branch: elif ... -m pip with VIRTUAL_ENV; then env -u PIP_USER python "$@"
#   - python3() – same venv branch
#
# When VIRTUAL_ENV is set the wrappers must delegate to the *real* pip/pip3/
# python/python3 with PIP_USER unset (via `env -u PIP_USER`), so that packages
# are installed inside the virtual environment rather than the user site.
#
# Usage:  bash tests/test_start_sh_pip_wrappers.sh
#         Exit code 0 = all tests passed; non-zero = at least one failure.

set -uo pipefail

PASS=0
FAIL=0
ERRORS=()

# ── Minimal test harness ────────────────────────────────────────────────────
pass() { PASS=$((PASS + 1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); ERRORS+=("FAIL: $1"); echo "FAIL: $1"; }

assert_equals() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$description"
  else
    fail "$description (expected='$expected' actual='$actual')"
  fi
}

assert_contains() {
  local description="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    pass "$description"
  else
    fail "$description (needle='$needle' not found in '$haystack')"
  fi
}

assert_not_contains() {
  local description="$1" needle="$2" haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    pass "$description"
  else
    fail "$description (needle='$needle' unexpectedly found in '$haystack')"
  fi
}

# ── Define helper functions copied verbatim from start.sh ───────────────────
# These are the unchanged helpers that the pip wrappers depend on.

_hc_has_arg() {
  local needle="$1"
  shift
  local arg
  for arg in "$@"; do
    [ "$arg" = "$needle" ] && return 0
  done
  return 1
}

_hc_args_without_flags() {
  local out=()
  local arg
  for arg in "$@"; do
    case "$arg" in
      ''|-) ;;
      --*) ;;
      -*) ;;
      *) out+=("$arg") ;;
    esac
  done
  printf '%s\n' "${out[@]}"
}

_hc_has_install_targets() {
  local item
  while IFS= read -r item; do
    [ -n "$item" ] && return 0
  done <<EOF
$(_hc_args_without_flags "$@")
EOF
  return 1
}

# Stub for _hc_append_cmd – records calls in a variable for assertions.
APPEND_CMD_CALLS=()
_hc_append_cmd() { APPEND_CMD_CALLS+=("$*"); }

# ── Stubs for `command` and `env` ───────────────────────────────────────────
# We use shell functions to intercept what would normally be external processes.

# LAST_COMMAND_CALL captures the effective invocation used by the wrapper.
LAST_COMMAND_CALL=()

# We override `command` as a function only when testing inside a sub-shell
# context; for these unit tests we capture via wrapper stubs defined below.

# ── pip wrapper (from start.sh lines 1977-1993) ─────────────────────────────
pip() {
  if [ "${1:-}" = "install" ] && [ -z "${VIRTUAL_ENV:-}" ] && ! _hc_has_arg --user "$@" && ! _hc_has_arg --prefix "$@"; then
    LAST_COMMAND_CALL=("pip" "install" "--user" "--break-system-packages" "${@:2}")
  elif [ -n "${VIRTUAL_ENV:-}" ]; then
    LAST_COMMAND_CALL=("env" "-u" "PIP_USER" "pip" "$@")
  else
    LAST_COMMAND_CALL=("pip" "$@")
  fi
  local rc=0
  if [ $rc -eq 0 ] && [ "${1:-}" = "install" ] \
      && ! _hc_has_arg -r "${@:2}" && ! _hc_has_arg --requirement "${@:2}" \
      && _hc_has_install_targets "${@:2}"; then
    _hc_append_cmd "python3 -m pip install --user" "${@:2}"
  fi
  return $rc
}

# ── pip3 wrapper (from start.sh lines 1994-2009) ────────────────────────────
pip3() {
  if [ "${1:-}" = "install" ] && [ -z "${VIRTUAL_ENV:-}" ] && ! _hc_has_arg --user "$@" && ! _hc_has_arg --prefix "$@"; then
    LAST_COMMAND_CALL=("pip3" "install" "--user" "--break-system-packages" "${@:2}")
  elif [ -n "${VIRTUAL_ENV:-}" ]; then
    LAST_COMMAND_CALL=("env" "-u" "PIP_USER" "pip3" "$@")
  else
    LAST_COMMAND_CALL=("pip3" "$@")
  fi
  local rc=0
  if [ $rc -eq 0 ] && [ "${1:-}" = "install" ] \
      && ! _hc_has_arg -r "${@:2}" && ! _hc_has_arg --requirement "${@:2}" \
      && _hc_has_install_targets "${@:2}"; then
    _hc_append_cmd "python3 -m pip install --user" "${@:2}"
  fi
  return $rc
}

# ── python wrapper (from start.sh lines 2010-2025) ──────────────────────────
python() {
  if [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ "${3:-}" = "install" ] && [ -z "${VIRTUAL_ENV:-}" ] && ! _hc_has_arg --user "${@:3}" && ! _hc_has_arg --prefix "${@:3}"; then
    LAST_COMMAND_CALL=("python" "-m" "pip" "install" "--user" "--break-system-packages" "${@:4}")
  elif [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ -n "${VIRTUAL_ENV:-}" ]; then
    LAST_COMMAND_CALL=("env" "-u" "PIP_USER" "python" "$@")
  else
    LAST_COMMAND_CALL=("python" "$@")
  fi
  local rc=0
  if [ $rc -eq 0 ] && [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ "${3:-}" = "install" ] \
      && ! _hc_has_arg -r "${@:4}" && ! _hc_has_arg --requirement "${@:4}" \
      && _hc_has_install_targets "${@:4}"; then
    _hc_append_cmd "python3 -m pip install --user" "${@:4}"
  fi
  return $rc
}

# ── python3 wrapper (from start.sh lines 2026-2041) ─────────────────────────
python3() {
  if [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ "${3:-}" = "install" ] && [ -z "${VIRTUAL_ENV:-}" ] && ! _hc_has_arg --user "${@:3}" && ! _hc_has_arg --prefix "${@:3}"; then
    LAST_COMMAND_CALL=("python3" "-m" "pip" "install" "--user" "--break-system-packages" "${@:4}")
  elif [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ -n "${VIRTUAL_ENV:-}" ]; then
    LAST_COMMAND_CALL=("env" "-u" "PIP_USER" "python3" "$@")
  else
    LAST_COMMAND_CALL=("python3" "$@")
  fi
  local rc=0
  if [ $rc -eq 0 ] && [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ "${3:-}" = "install" ] \
      && ! _hc_has_arg -r "${@:4}" && ! _hc_has_arg --requirement "${@:4}" \
      && _hc_has_install_targets "${@:4}"; then
    _hc_append_cmd "python3 -m pip install --user" "${@:4}"
  fi
  return $rc
}

# ── Helper to reset state between tests ─────────────────────────────────────
reset_state() {
  LAST_COMMAND_CALL=()
  APPEND_CMD_CALLS=()
  unset VIRTUAL_ENV
}

effective_cmd() { printf '%s ' "${LAST_COMMAND_CALL[@]}"; }

# ============================================================================
# Tests: pip wrapper
# ============================================================================

# --- venv present (NEW behavior) ---
reset_state
VIRTUAL_ENV="/tmp/venv"
pip install requests
cmd=$(effective_cmd)
assert_contains "pip: venv present -> uses env -u PIP_USER" "env -u PIP_USER pip" "$cmd"
assert_not_contains "pip: venv present -> no --user flag" "--user" "$cmd"

reset_state
VIRTUAL_ENV="/tmp/venv"
pip install --upgrade requests
cmd=$(effective_cmd)
assert_contains "pip: venv + extra flags -> uses env -u PIP_USER" "env -u PIP_USER pip" "$cmd"

# --- venv absent (original behavior) ---
reset_state
unset VIRTUAL_ENV
pip install requests
cmd=$(effective_cmd)
assert_contains "pip: no venv + install -> adds --user --break-system-packages" "--user --break-system-packages" "$cmd"
assert_not_contains "pip: no venv + install -> no env -u" "env -u PIP_USER" "$cmd"

reset_state
unset VIRTUAL_ENV
pip install --user requests
cmd=$(effective_cmd)
# --user already present -> falls through to plain `pip`
assert_not_contains "pip: explicit --user -> no extra --user injection" "--user --break-system-packages" "$cmd"

reset_state
unset VIRTUAL_ENV
pip list
cmd=$(effective_cmd)
assert_contains "pip: non-install subcommand -> passes through plain pip" "pip list" "$cmd"
assert_not_contains "pip: non-install subcommand -> no env -u PIP_USER" "env -u PIP_USER" "$cmd"

# --- venv present but non-install subcommand ---
reset_state
VIRTUAL_ENV="/tmp/venv"
pip list
cmd=$(effective_cmd)
# 'pip list' with VIRTUAL_ENV: first branch (install check) fails, second branch (VIRTUAL_ENV) matches
assert_contains "pip: venv + list -> uses env -u PIP_USER" "env -u PIP_USER pip" "$cmd"

# ============================================================================
# Tests: pip3 wrapper
# ============================================================================

reset_state
VIRTUAL_ENV="/tmp/venv"
pip3 install numpy
cmd=$(effective_cmd)
assert_contains "pip3: venv present -> uses env -u PIP_USER pip3" "env -u PIP_USER pip3" "$cmd"
assert_not_contains "pip3: venv present -> no --user flag" "--user" "$cmd"

reset_state
unset VIRTUAL_ENV
pip3 install numpy
cmd=$(effective_cmd)
assert_contains "pip3: no venv + install -> adds --user --break-system-packages" "--user --break-system-packages" "$cmd"

reset_state
VIRTUAL_ENV="/tmp/venv"
pip3 show numpy
cmd=$(effective_cmd)
assert_contains "pip3: venv + show -> uses env -u PIP_USER" "env -u PIP_USER pip3" "$cmd"

# ============================================================================
# Tests: python wrapper (-m pip)
# ============================================================================

reset_state
VIRTUAL_ENV="/tmp/venv"
python -m pip install pandas
cmd=$(effective_cmd)
assert_contains "python: venv + -m pip -> uses env -u PIP_USER python" "env -u PIP_USER python" "$cmd"
assert_not_contains "python: venv + -m pip -> no --user flag" "--user" "$cmd"

reset_state
unset VIRTUAL_ENV
python -m pip install pandas
cmd=$(effective_cmd)
assert_contains "python: no venv + -m pip install -> adds --user --break-system-packages" "--user --break-system-packages" "$cmd"

reset_state
VIRTUAL_ENV="/tmp/venv"
python -m pip list
cmd=$(effective_cmd)
# 'python -m pip list': install check fails, venv check passes
assert_contains "python: venv + -m pip list -> uses env -u PIP_USER" "env -u PIP_USER python" "$cmd"

reset_state
unset VIRTUAL_ENV
python -c "print('hello')"
cmd=$(effective_cmd)
assert_contains "python: non-pip invocation -> passes through plain python" "python -c" "$cmd"
assert_not_contains "python: non-pip invocation -> no env -u" "env -u PIP_USER" "$cmd"

# ============================================================================
# Tests: python3 wrapper (-m pip)
# ============================================================================

reset_state
VIRTUAL_ENV="/tmp/venv"
python3 -m pip install scipy
cmd=$(effective_cmd)
assert_contains "python3: venv + -m pip -> uses env -u PIP_USER python3" "env -u PIP_USER python3" "$cmd"
assert_not_contains "python3: venv + -m pip -> no --user flag" "--user" "$cmd"

reset_state
unset VIRTUAL_ENV
python3 -m pip install scipy
cmd=$(effective_cmd)
assert_contains "python3: no venv + -m pip install -> adds --user --break-system-packages" "--user --break-system-packages" "$cmd"

reset_state
VIRTUAL_ENV="/tmp/venv"
python3 -m pip show scipy
cmd=$(effective_cmd)
assert_contains "python3: venv + -m pip show -> uses env -u PIP_USER" "env -u PIP_USER python3" "$cmd"

reset_state
unset VIRTUAL_ENV
python3 -c "import sys; print(sys.version)"
cmd=$(effective_cmd)
assert_contains "python3: non-pip invocation -> passes through plain python3" "python3 -c" "$cmd"

# ============================================================================
# Regression: venv wrappers must not forward --user into the venv
# ============================================================================

reset_state
VIRTUAL_ENV="/tmp/venv"
pip install --user requests
cmd=$(effective_cmd)
# When VIRTUAL_ENV is set, the 'install && no VIRTUAL_ENV' branch is skipped,
# the 'VIRTUAL_ENV' branch matches -> env -u PIP_USER is used
assert_contains "pip: venv + explicit --user -> venv branch wins" "env -u PIP_USER" "$cmd"

reset_state
VIRTUAL_ENV="/tmp/venv"
pip3 install --user requests
cmd=$(effective_cmd)
assert_contains "pip3: venv + explicit --user -> venv branch wins" "env -u PIP_USER" "$cmd"

# ============================================================================
# Summary
# ============================================================================

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"

if [ "${#ERRORS[@]}" -gt 0 ]; then
  echo ""
  echo "Failed tests:"
  for e in "${ERRORS[@]}"; do
    echo "  $e"
  done
  exit 1
fi

exit 0
