#!/usr/bin/env bash
# Push the current commit to a Hugging Face Space (docker SDK).
#
#   ./scripts/deploy_space.sh <hf-username>/<space-name>
#
# The GitHub README has no Space frontmatter, so this builds a throwaway
# checkout whose README.md gets one prepended. Needs `hf auth login` (or an
# HF_TOKEN with write access) done once.
set -euo pipefail
SPACE="${1:?usage: deploy_space.sh <user>/<space>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

git -C "$ROOT" archive HEAD | tar -x -C "$TMP"
{ printf -- '---\ntitle: Sema\nemoji: 🧠\ncolorFrom: gray\ncolorTo: blue\nsdk: docker\napp_port: 7860\npinned: false\nlicense: mit\n---\n\n'
  cat "$TMP/README.md"; } > "$TMP/README.md.new" && mv "$TMP/README.md.new" "$TMP/README.md"

cd "$TMP"
git init -q -b main && git add -A && git commit -q -m "Deploy $(git -C "$ROOT" rev-parse --short HEAD)"
git push -f "https://huggingface.co/spaces/$SPACE" main
