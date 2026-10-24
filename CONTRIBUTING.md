# Contributing

Issues and pull requests are welcome. This is a small project maintained in spare time, so a
short issue before a large change saves both of us effort.

## Before you start: two implementations, one contract

There is no shared runtime code. The JetBrains plugin (Kotlin) and the VS Code extension
(TypeScript) each implement the core — reference resolution, the relation table, external
placeholders, layered layout — in their own language. What they share is
[`conformance/`](conformance/spec.md): a normative spec plus a corpus of descriptors with golden
documents, which both implementations run in their own CI.

What that means for a change:

- **Rendering or editor integration only** (toolbar, colours, keyboard, a webview fix): change one
  editor. No contract involved.
- **What a descriptor means** (a relation, a default kind, a problem message, layer ordering):
  this is a contract change and touches **both** editors. Expect to write Kotlin *and*
  TypeScript, or say in the pull request that you need help with the other half.

A contract change is four steps:

```bash
# 1. change editors/jetbrains -- the reference implementation -- then regenerate the goldens:
cd editors/jetbrains && ./gradlew test -Dconformance.update=true
# 2. read the diff in conformance/expected/: a changed golden is a changed contract
# 3. make editors/vscode match
cd editors/vscode && npm test
# 4. update conformance/spec.md if its prose no longer describes the behaviour
```

Easy to break without noticing: problem messages are compared verbatim, and layer ordering is
part of the contract (`localeCompare` is banned in the TypeScript core because it is
machine-dependent).

## Layering rules

- `editors/vscode/src/core/` and `src/webview/` must never import `vscode`.
- `editors/jetbrains/.../model/` and `.../layout/` must never import IntelliJ APIs.

These keep the cores testable as plain code, in about a second, with no editor running.

## Building and testing

The [README](README.md#building) and each editor's own README have the full commands. In short:

```bash
cd editors/jetbrains && ./gradlew build   # JDK 21; unit tests + conformance corpus
cd editors/vscode && npm ci && npm test   # Node; unit tests + conformance corpus
```

Unit tests cannot see a UI regression. Before saying a UI change works, launch the editor
(`make run-jetbrains` / `make run-vscode`) and check it against
[`examples/`](examples/README.md), which is the manual test plan.

Adding an example means updating `examples/README.md`, `ExamplesTest.kt` *and*
`conformance/manifest.json`, then regenerating the goldens.

## Scope

Some features are left out on purpose — a catalog-wide graph, network access, `Location` target
expansion, editing, and further editors. See
[Deliberately not in scope](README.md#deliberately-not-in-scope) and [ROADMAP.md](ROADMAP.md)
before proposing one of those.

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
