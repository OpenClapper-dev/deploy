#!/usr/bin/env bash
# Moves the deployment to another version of the public repository: the fielder/ submodule and the
# reusable workflow's ref, together, so the scripts and the workflow that runs them always match.
#   scripts/bump.sh <tag|branch|commit>     e.g. scripts/bump.sh v0.2.0, scripts/bump.sh main
set -euo pipefail
cd "$(dirname "$0")/.."
ref="${1:?usage: scripts/bump.sh <tag|branch|commit>}"
git -C fielder fetch -q --tags origin
sha=$(git -C fielder rev-parse --verify "origin/$ref^{commit}" 2>/dev/null || git -C fielder rev-parse --verify "$ref^{commit}")
git -C fielder checkout -q "$sha"
sed -i -E "s#(uses: bubulux/fielder/\.github/workflows/deploy\.yml@)[0-9a-f]+#\1$sha#" .github/workflows/deploy.yml
git add fielder .github/workflows/deploy.yml
echo "fielder → $ref ($sha). Review the migrations in fielder/apps/worker/migrations, commit, push, then run Deploy."
