#!/bin/bash
# Scaffold for skill-routing cases: a minimal git repo with a fresh brain made
# by the CLI itself (`brain init` → .brain/brain.db, needs Node >= 24). This is
# exactly what a user's repo looks like right after `npx -y brain-axi init`:
# no features, the seeded first checkpoint, no declared verify checks.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
git init -q . 2>/dev/null || true
node "$HERE/../bin/brain.js" init >/dev/null
