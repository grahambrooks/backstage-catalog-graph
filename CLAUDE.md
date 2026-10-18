# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

Editor plugins that draw a Backstage `catalog-info.yaml` as a graph. Two shipped implementations
(JetBrains, VS Code) over one shared behaviour contract.

## The thing to understand first

There is **no shared runtime code**. Each editor implements the ~500-line core — reference
resolution, the relation table, external placeholders, layered layout — in its own language.
What is shared is `conformance/`: a normative spec plus 20 cases with golden documents that
**both implementations run in their own CI, in their own language**.

This is load-bearing, not decorative. Changing one `targetKind` in the TypeScript relation table
fails two conformance cases immediately. Treat `conformance/spec.md` as normative: where an
implementation and that document disagree, the implementation is wrong.

**`editors/jetbrains` is the reference implementation and generates the goldens.** Changing what
a descriptor *means* is therefore a four-step operation, not a one-file edit:

```bash
# 1. change editors/jetbrains, then regenerate:
cd editors/jetbrains && ./gradlew test -Dconformance.update=true
# 2. READ THE DIFF in conformance/expected/ -- a changed golden is a changed contract
# 3. make editors/vscode match
cd editors/vscode && npm test
# 4. update conformance/spec.md if the prose no longer describes the behaviour
```

Parts of the contract that are easy to break without noticing:

- **Problem messages are compared verbatim.** Rewording one is a contract change.
- **Layer ordering is part of the contract** (`layers` in the goldens), so the barycentre sweeps
  and the stable-sort requirement must match across implementations. `localeCompare` is banned
  in the TS core for this reason — it is machine-dependent; compare by UTF-16 code unit.
- **Source offsets are deliberately NOT in the contract.** IntelliJ's PSI and the `yaml` package
  disagree about whether `---` belongs to the document after it. Both land the caret correctly;
  do not try to reconcile them.

## Layering rules that the build does not enforce

- **`editors/vscode/src/core/` must never import `vscode`.** That is what lets the conformance
  corpus run it in plain Node with no editor. `src/webview/` must not import it either — it runs
  in a browser context and talks to the extension host via `postMessage` through
  `src/core/wire.ts`.
- **`editors/jetbrains/.../model/` and `.../layout/` must never import IntelliJ APIs.** They are
  plain Kotlin on plain maps; `psi/YamlDocumentReader` is the only adapter. This is why those
  tests are ordinary JUnit 5 running in about a second with no IDE fixture.
- `examples/` and `conformance/` live at the repo root and are shared. The Gradle build passes
  their location to tests as the `repo.root` system property — Kotlin tests must not assume the
  working directory.

## Commands

The root `Makefile` wraps the commands below for local use (`make` lists targets): `make build`,
`make package` (both packages into `dist/`), `make run-jetbrains` / `make run-vscode` (open
`FILE=…`, default the large example), and `make run-vscode-package`, which installs the real
`.vsix` into a throwaway profile under `build/`. CI does not use it.

### JetBrains (`editors/jetbrains`, Kotlin + Gradle, JDK 21)

```bash
./gradlew build                      # compile, 82 tests (unit + conformance corpus)
./gradlew test --tests 'com.grahambrooks.backstage.catalog.model.EntityRefTest'   # one class
./gradlew test --tests '*ConformanceTest*'
./gradlew test -Dconformance.update=true          # regenerate the shared goldens
./gradlew runIde                     # sandbox IDE with examples/ open as the project
./gradlew runIde -PopenFile=examples/04-all-relations/catalog-info.yaml
./gradlew verifyPlugin               # JetBrains plugin verifier, real IDE binaries
./gradlew buildPlugin                # -> build/distributions/*.zip
./gradlew packageTestKit             # plugin + examples + TESTING.md, for another machine
```

### VS Code (`editors/vscode`, TypeScript + Node)

```bash
npm test                             # compile, then 60 tests (unit + conformance corpus)
node --test out-test/test/core.test.js                        # one file (after npm run compile)
node --test --test-name-pattern "casing" out-test/test/conformance.test.js   # one test
npm run typecheck
npm run watch                        # esbuild, rebuilds on save
npm run package                      # minified -> backstage-catalog-graph-<version>.vsix
code --extensionDevelopmentPath="$PWD" --new-window ../../examples
```

## Gotchas that have cost real time here

- **IntelliJ IDEA Community is no longer published from 2025.3 (build 253).** `create("IC", …)`
  fails to resolve; the unified distribution uses `intellijIdea(…)`. This project deliberately
  targets `intellijIdeaCommunity("2025.2.6")` so that `sinceBuild = 252` is an honest claim.
- **Pure JUnit 5 tests need JUnit 4 on the test runtime classpath.** The IntelliJ Platform jars
  put a launcher-session listener compiled against JUnit 4 on the classpath, so tests die at
  startup with `NoClassDefFoundError: junit/framework/TestCase` without `testRuntimeOnly(junit4)`.
  Dropping `testFramework(TestFrameworkType.Platform)` alone does not fix it.
- **A second `./gradlew runIde` while a sandbox IDE is running is forwarded to that instance and
  exits in about a second**, silently leaving the old plugin loaded. Close the sandbox first.
- **VS Code does not re-read the bundle.** After `npm run bundle`, run *Developer: Reload Window*
  in the Extension Development Host.
- **Never force a PSI commit from `selectNotify` or a debounce alarm** — both are write-unsafe
  contexts and the platform logs a SEVERE naming the plugin. Use
  `PsiDocumentManager.performWhenAllCommitted`.
- Unit tests cannot catch either of the last two. Launch the editor before claiming a UI change
  works; that is how the write-unsafe bug was found.

## Conventions

- **CalVer, kept in step across editors** — `pluginVersion` in `editors/jetbrains/gradle.properties`
  and `version` in `editors/vscode/package.json`. The release workflow fails a tag that matches
  one but not the other.
- **Trunk-based**: commit directly to `main`; PRs are not required.
- **Irreversible publishes stay behind a manual `workflow_dispatch`** — both marketplaces. Not
  going public yet: do not run it, and do not suggest it as a next step.
- `examples/` is simultaneously the human test plan and the conformance corpus input. Adding an
  example means updating `examples/README.md`, `ExamplesTest.kt` *and*
  `conformance/manifest.json`, then regenerating the goldens.

## Scope boundaries

Deliberate cuts, documented so a later change does not "complete" them: the graph covers **one
file** (cross-file resolution would destroy the external-placeholder boundary that is the whole
point), there is no network access, `Location.spec.targets` produces no edges, and the graph is
read-only.

Two more decisions, both in `ROADMAP.md`: **no further editors** (the earlier language-server
plan is shelved, not pending), and **publishing is deferred** — the repository is private and
`publish-marketplace.yml` must not be run until the owner decides to go public.
