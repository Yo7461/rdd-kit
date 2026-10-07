# Developing rdd-kit

This page is for working on rdd-kit itself: the linter, the skill text, and the plugin bundle. To use the kit, start from the [README](../README.md).

## Requirements

- Node.js **>= 24**
- pnpm, at the version `packageManager` names in `package.json`
- Claude Code, to validate the plugin and to run it before a release

## Repository layout

| Path | Contents |
|------|----------|
| `plugin/` | **The source of truth for what is distributed** — `.claude-plugin/plugin.json`, `skills/roadmap/` (the /roadmap skill), `hooks/` (`hooks.json`, which declares the module and nothing else, and `register.ts`, the hooks module: the lint after an edit and the `roadmap_lint` tool), `lib/` (readable copies of the lint core, `lib/core/`, and of the third-party packages it uses, `lib/vendor/`), `LICENSE` and `THIRD-PARTY-LICENSES.txt` — `lib/` and the two license files are committed build artifacts — and `NOTICE` (the copyright notice, a copy of the root file kept by hand) |
| `.claude-plugin/marketplace.json` | The marketplace definition (one plugin: rdd-kit) |
| `packages/core` | @rdd-kit/core — the lint engine (parser, diagnostic model, all 35 rules, reporters). It reads nothing itself: files and git reach it through a `Host` interface, which the CLI implements on Node and the hooks module implements on Claude Code's `$` |
| `packages/cli` | The roadmap-lint CLI (npm bin = `bundle/roadmap-lint.cjs`, development entry = `dist/main.js`) and the command hook for a setup without the plugin, `hooks/roadmap-lint-hook.mjs` |
| `types/claude-code.d.ts` | An excerpt of Claude Code's own declarations (2.1.286): what the hooks module uses. The module and `plugin/lib/` are type-checked against it through `tsconfig.plugin.json` |
| `fixtures/` | The check corpus — `valid/` (a complete set of records that passes every rule but the GIT ones, which `lint-corpus.config.json` turns off — a corpus for the checks, not a model of the records: the templates in the skill are the model), `violations/<rule-id>/` (a minimal mutation of it and a golden file), `valid-variants/<name>/` (other valid shapes, such as a finished project) |
| `scripts/` | Maintenance scripts (regenerate the fixtures; build the plugin — the copies, the CLI bundle, the license files; sync the versions) |
| `lint-corpus.config.json` | The config for checking `fixtures/valid` as a corpus. It turns the GIT rules off, because they judge the git state of the host repository rather than the corpus |
| `doc/` | The documentation |

## Self-check

rdd-kit checks a corpus of records with its own linter on every test run.

- `pnpm test` runs the typechecks — the packages, the tests, and the hooks module together with the copies under `plugin/lib/` against `types/claude-code.d.ts` — and then the full test suite. The fixture checks are part of it: `fixtures/valid` and every variant under `fixtures/valid-variants/` must produce zero diagnostics, and every case under `fixtures/violations/` must produce exactly the diagnostics in its golden file
- The valid corpus alone, by hand through the CLI: `pnpm run lint:corpus` (it builds, then runs `node packages/cli/dist/main.js fixtures/valid --config lint-corpus.config.json`)
- The documentation is checked as well (`packages/core/test/docs.test.ts`): the rule table in [roadmap-lint.md](roadmap-lint.md#rules) and the defaults table in [concepts.md](concepts.md#defaults-and-the-projects-configuration) against the rule registry, the rule count wherever the documentation and the skill text state it in digits, every relative link and anchor, the owner, the plugin name, and the marketplace name wherever the documentation names them, and the license named in the manifests against `LICENSE`. A count of only some of the rules is written in words, so that a number followed by "rules" always means all of them

- The hooks module is tested without Claude Code (`packages/cli/test/mod.test.ts`): `register.ts` runs against a stand-in for `$` built on Node, in a temporary git repository — the report after an edit (the same text the command hook writes), the silent cases, a check that fails, and the `roadmap_lint` tool. Whether Claude Code itself loads and runs the module is checked by running the installed plugin in a scratch project before a release

The corpus checks leave the GIT rules out. Those rules are verified by tests that build temporary git repositories.

## Maintaining fixtures

- After a change to the valid corpus, `pnpm run regen:fixtures` brings the overlays and the golden files under `violations/` along with it. The source of truth for the mutations is the mutation manifest in `scripts/regen-fixtures.mjs`, which fails loudly when an anchor disappears from the base
- `pnpm run regen:fixtures -- --check` verifies reproducibility: a byte-for-byte match against the existing fixtures
- The overlays for file types that do not derive from the base (FILE-1, ID-1, ID-3) are checked in as the source of truth, and the GIT rules (GIT-1–GIT-7) are verified by the temporary-repository tests. Neither is regenerated
- A rule that misjudges a record that follows the conventions gets a regression case here together with its fix

## Development and releases

- Setup: `pnpm install`, then `pnpm build`. The full test suite is `pnpm test`. During development the CLI is `node packages/cli/dist/main.js`
- The distribution: `pnpm run build:plugin` (after `pnpm build` — the CLI bundle is built from the compiled core) writes everything generated in one go. `plugin/lib/core/` is a copy of `packages/core/src` without `testing/`, its relative imports rewritten to the `.ts` files; `plugin/lib/vendor/<package>/` holds every third-party file that esbuild's metafile reaches from the core (resolved platform-neutral, so nothing needs Node), with bare imports rewritten to relative paths inside the plugin, the one CommonJS file converted to an ES module, and each package's license file copied along. `lib/` is rebuilt from scratch every time, so nothing stale survives. The license files are `LICENSE` (a copy of the root file) and `THIRD-PARTY-LICENSES.txt` (the license of every package copied, derived from the copies) in both `plugin/` and `packages/cli/`; `packages/cli/bundle/roadmap-lint.cjs` is the CLI bundle, which inlines a subset of those packages (the build and the tests check that the subset holds). `pnpm run build:plugin -- --check` checks that all of it is fresh, byte for byte, and that `lib/` holds no orphan. The test suite holds `lib/core` to the sources, every import under `lib/` to a relative path inside it (or a type-only one), loads every vendor file as an ES module in Node, holds the list to the copied packages at their installed versions, and holds the npm tarball to the bundle, the command hook, the two license files, the copyright notice (`NOTICE`, the same in the root, `plugin/`, and `packages/cli/`), and `package.json`
- The skill text: `plugin/skills/roadmap/` is its only source. The size limits, the shelf life, and the commit labels it states are checked against the rules' `defaultOptions` by the test suite, so a changed default fails until the text follows. The shape of what the skill prints for the person is held the same way (`packages/core/test/skill-printouts.test.ts`): the seven parts, every row of the words tables, the single definition of the five frames — and their restatement in `README.md` and [concepts.md](concepts.md#what-the-person-reads) — the skeleton of the start block, and how a reply ends. The records check the skill describes has two routes, the plugin's tool first and the CLI second, in the same order as [roadmap-lint.md](roadmap-lint.md#running-it)
- A release: add the version's line at the top of [Upgrade notes](roadmap-lint.md#upgrade-notes), then `pnpm run sync:version <SemVer>` (syncs `plugin.json` and both packages; `pnpm run sync:version -- --check` verifies that the three agree), then `pnpm run build:plugin`, then `pnpm test`, then `claude plugin validate --strict plugin && claude plugin validate --strict .`, then a run of the installed plugin in a scratch project — the version of Claude Code it ran on goes into the READMEs as the version this release was run on
- Versions follow SemVer, and one version covers the skill, the hooks module, and the CLI together. Removing or renaming a rule ID is a breaking change; adding a rule is a minor one. The version goes up with every release — Claude Code detects an update by the version, and an installed copy stays where it is until the version changes
