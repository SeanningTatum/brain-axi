#!/bin/bash
# Scaffold for skill-routing cases: a minimal repo with a fresh .brain/ (from `brain init`).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cp -R "$HERE/fixtures/brain" .brain
git init -q . 2>/dev/null || true
