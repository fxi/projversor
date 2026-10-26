#!/usr/bin/env bash
# Reproduce the CI checks on a clean copy of the working tree before a
# release. A clean `npm ci` catches what the local node_modules hides: a lock
# file out of sync with package.json, or a dependency `npm link`ed to a
# sibling checkout that is ahead of its published version.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Tracked and untracked files as they are now, without node_modules/dist.
git -C "$root" ls-files -z --cached --others --exclude-standard |
  (cd "$root" && xargs -0 tar -cf - 2>/dev/null) |
  tar -xf - -C "$tmp"

cd "$tmp"
npm ci --ignore-scripts --no-audit --no-fund
npm run quality
npm test
npm run build:lib
npm run build:demos
echo "preflight: ok"
