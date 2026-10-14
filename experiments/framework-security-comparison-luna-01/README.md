# Framework Security Comparison — Luna 01

**Japanese name:** フレームワーク・セキュリティ比較実験 — Luna 01
**Status:** completed exploratory pilot; automated candidates remain unverified.

This folder consolidates the planning history, six-condition Luna study, generated applications, functional and security evaluation artifacts, and bilingual manuscript drafts for one experiment. “Framework absent” means no full-stack framework was named in the generation prompt. It does not mean the generated application had no libraries.

## Start here

1. [`RESULTS.md`](RESULTS.md) — concise outcome summary and limitations.
2. [`PLAN.md`](PLAN.md) — study protocol and history, including the earlier Sonnet pilot and Luna transition.
3. [`paper/manuscript.en.md`](paper/manuscript.en.md) and [`paper/manuscript.ja.md`](paper/manuscript.ja.md) — English and Japanese exploratory manuscript drafts.
4. [`evaluation/FUNCTIONAL-TESTS.md`](evaluation/FUNCTIONAL-TESTS.md) — functional acceptance gate.
5. [`evaluation/README.md`](evaluation/README.md) — security harness, test meanings, and usage.

## Contents

- `runner/`: generation prompts, scripts, and runtime setup.
- `runs/`: run order, per-condition generation records, generated workspaces, logs, and adapters.
- `evaluation/`: functional and security harnesses, mock identity provider, and raw results.
- `paper/`: bilingual manuscript drafts.
- `PLAN.md`, `RECORD.md`, `RESULTS.md`: protocol, event record, and synthesized results.

## Reproduction

Evaluation instructions are in [`evaluation/README.md`](evaluation/README.md). The six recorded applications can be reevaluated with `evaluation/run-all.sh`; review that script and the loopback-only test configuration before running it. Generation scripts are in `runner/`; a new generation writes a new run directory and requires Codex CLI signed in with ChatGPT. Do not reuse an existing run ID.

This public research copy excludes installed dependencies, build output, SQLite databases, and raw `.log` files. The private working copy remains under `.private/framework-security-comparison-luna-01/`. Historical event records and generated assistant messages may contain absolute paths from before the folder was renamed; they are retained as run records. No credential files, private keys, or populated `.env` files were found in the copied artifacts. The included `.env.example` files contain placeholders. The generation scripts and app examples refer to environment variables for authentication; never put real credentials in committed files, prompts, or logs.

## Current interpretation

Each of the six prompt conditions was generated once. Four applications passed the functional gate and received security testing. Three automated T8 candidates remain unverified. No condition can be ranked as the most secure from this pilot; two conditions did not reach security testing because they failed functional prerequisites.
