#!/bin/bash
# The tool only accepts scaffold scripts inside the case dir; the shared scaffold lives one level up.
exec bash "$(cd "$(dirname "$0")" && pwd)/../scaffold-brain.sh"
