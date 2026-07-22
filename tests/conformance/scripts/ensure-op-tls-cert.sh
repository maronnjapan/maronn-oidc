#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFORMANCE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CERT_DIR="${CONFORMANCE_DIR}/.generated/certs"
CERT_PATH="${CERT_DIR}/op-tls.crt"
KEY_PATH="${CERT_DIR}/op-tls.key"

mkdir -p "${CERT_DIR}"

if [[ -f "${CERT_PATH}" && -f "${KEY_PATH}" ]]; then
  exit 0
fi

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -sha256 \
  -nodes \
  -days 30 \
  -keyout "${KEY_PATH}" \
  -out "${CERT_PATH}" \
  -subj "/CN=op-tls" \
  -addext "subjectAltName=DNS:op-tls,DNS:localhost,IP:127.0.0.1"
