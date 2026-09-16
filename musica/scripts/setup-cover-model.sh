#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv --without-pip .venv
if [[ ! -x .venv/bin/pip ]]; then
  curl --fail --location --silent --show-error https://bootstrap.pypa.io/get-pip.py --output /tmp/musicgen-get-pip.py
  .venv/bin/python /tmp/musicgen-get-pip.py
fi
.venv/bin/pip install --upgrade pip
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -r requirements-cover.txt
HF_HOME="$PWD/.cache/huggingface" .venv/bin/python scripts/generate_cover.py --warmup
echo "Modelo de portadas instalado y listo."
