---
name: token-saver
description: >-
  Token-saving rules for every agent: use ctx to trim long terminal output,
  search the code graph before reading whole files, and reuse past session
  memory. Load before running long commands, exploring a repo or editing code.
---
# Token Saver

1. **Trim terminal output (`ctx sift`).** Wrap commands with long output (`git diff`, `git log`, tests, builds, logs) as `ctx sift -- <command>`.
2. **Code graph (`ctx graph`).** Before reading whole files, use `ctx graph search <symbol>` or `ctx graph impact <id>`. After editing code, run `ctx graph update`.
3. **Session memory (`ctx search` / `ctx blame`).** Before repeating earlier research, check `ctx search "<term>"` or `ctx blame file <path>`.
4. **Code discipline.** Think before coding. Reuse native or existing functions before writing new code. Make only surgical changes.

If `ctx` is not on PATH: `export PATH="$HOME/.local/bin:$PATH"`. ctx is installed on the shared box; for cloud agents that don't have it, apply rule 4 and use normal tools.
