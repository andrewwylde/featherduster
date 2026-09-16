#!/bin/sh
# ==============================================================================
# Featherduster Git Pre-Push Hook
# ==============================================================================
# Prevents accidental remote pushes of private career evidence, telemetry,
# unverified metrics, or sensitive company data.
# ==============================================================================

set -e

# 1. Unconditional push block check
# Users can configure unconditional push rejection by setting:
#   git config featherduster.blockPush true
# or by configuring `block_push: true` in .featherduster/config.yaml

BLOCK_PUSH_GIT=$(git config --bool featherduster.blockPush 2>/dev/null || echo "false")
if [ "$BLOCK_PUSH_GIT" = "true" ]; then
  cat >&2 <<'EOF'

[PUSH BLOCKED] Remote push is disabled for this Featherduster career repository.
Your career evidence, personal telemetry, and internal notes are kept strictly local.

To override:
  git config featherduster.blockPush false

EOF
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CONFIG_FILE="$REPO_ROOT/.featherduster/config.yaml"

if [ -f "$CONFIG_FILE" ]; then
  if grep -E "^\s*block_push:\s*true" "$CONFIG_FILE" >/dev/null 2>&1; then
    cat >&2 <<'EOF'

[PUSH BLOCKED] Remote push is blocked by .featherduster/config.yaml (block_push: true).
To allow pushing, remove or set block_push: false in .featherduster/config.yaml.

EOF
    exit 1
  fi
fi

# 2. Run Featherduster integrity audit
echo "Running Featherduster pre-push integrity verification..."

CHECK_CMD=""
if command -v npx >/dev/null 2>&1; then
  CHECK_CMD="npx featherduster check"
elif command -v featherduster >/dev/null 2>&1; then
  CHECK_CMD="featherduster check"
fi

if [ -n "$CHECK_CMD" ]; then
  if ! (cd "$REPO_ROOT" && $CHECK_CMD); then
    cat >&2 <<'EOF'

[PRE-PUSH REJECTED] Featherduster integrity audit detected violations!
Please fix dangling citations, missing metrics, or banned keywords before pushing.
To bypass in an emergency: git push --no-verify

EOF
    exit 1
  fi
  echo "✔ Featherduster integrity pre-push check passed."
else
  cat >&2 <<'EOF'

[PRE-PUSH FAILED] Neither 'npx' nor 'featherduster' CLI was found on PATH.
Cannot verify privacy and integrity rules. Push aborted to protect confidential career data.
To bypass if intentional: git push --no-verify

EOF
  exit 1
fi

exit 0
