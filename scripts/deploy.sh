#!/usr/bin/env bash
#
# Patchwork deploy: the web app (S3 + CloudFront). Patchwork ships no backing
# services of its own — it is an MCP-only client of the registry gateway at
# aprovan.com/api/gateway, so "all" is currently just the web app.
#
# Usage:
#   AWS_PROFILE=aprovan scripts/deploy.sh          # everything
#   scripts/deploy.sh web                          # web app only
#
# Env vars are forwarded to the sub-scripts (see deploy-web.sh).

set -euo pipefail
HERE="$(dirname "${BASH_SOURCE[0]}")"
TARGET="${1:-all}"

case "$TARGET" in
  web | all) "$HERE/deploy-web.sh" ;;
  *)
    echo "usage: scripts/deploy.sh [all|web]" >&2
    exit 2
    ;;
esac
