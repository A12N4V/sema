#!/bin/bash
# Live progress board for the sema autoresearch team.
cd "$(dirname "$0")/.."
exec python3 agents/progress.py --title sema --file PROGRESS.md --file agents/.state/PROGRESS.md --feed agents/.state/feed.log "$@"
