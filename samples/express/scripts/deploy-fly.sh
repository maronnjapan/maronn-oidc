#!/usr/bin/env bash
# Thin wrapper around scripts/lib/deploy-fly-node-sample.sh for this sample.
# See samples/express/README.md for prerequisites and what this automates.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

export SAMPLE_DIR="samples/express"
export SAMPLE_PACKAGE="@maronn-oidc/sample-express"
export RUNTIME_DEP_NAME="express"
export RUNTIME_DEP_VERSION="^5.2.1"

cd "${ROOT_DIR}"
exec "${ROOT_DIR}/scripts/lib/deploy-fly-node-sample.sh" "$@"
