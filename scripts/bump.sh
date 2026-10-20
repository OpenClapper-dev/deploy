#!/usr/bin/env bash
# Moves the deployment to another version of the public repository: the core/ submodule and the
# reusable workflows' refs, together, so the scripts and the workflow that runs them always match.
#   scripts/bump.sh <tag|branch|commit>     e.g. scripts/bump.sh v0.2.0, scripts/bump.sh main
set -euo pipefail
cd "$(dirname "$0")/.."
ref="${1:?usage: scripts/bump.sh <tag|branch|commit>}"
git -C core fetch -q --tags origin
sha=$(git -C core rev-parse --verify "origin/$ref^{commit}" 2>/dev/null || git -C core rev-parse --verify "$ref^{commit}")
git -C core checkout -q "$sha"
sed -i -E "s#(uses: OpenClapper-dev/core/\.github/workflows/[a-z-]+\.yml@)[0-9a-f]+#\1$sha#" .github/workflows/*.yml
git add core .github/workflows
echo "core → $ref ($sha). Review the migrations in core/apps/worker/migrations, commit, push, then run Deploy."
