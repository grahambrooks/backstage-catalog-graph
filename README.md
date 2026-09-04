# Backstage Catalog Graph

Editor plugins that draw a Backstage `catalog-info.yaml` as the catalog graph it describes —
entities as nodes, `spec` references as labelled edges, and **dashed placeholders for every
reference that leaves the file**.

The placeholders are the point. A descriptor almost never declares everything it names: the
owning group lives in the org catalog, the system is defined in another repository, a
`dependsOn` points at a resource someone else runs. Dropping those references would draw a
tidier but dishonest picture, so they are drawn as ghosts, and the graph shows both what the
file defines and what it assumes exists.

| Editor | Status | |
|---|---|---|
| **VS Code** — and Cursor, Windsurf, VSCodium, Theia, Codespaces | Shipped | [`editors/vscode`](editors/vscode) |
| **JetBrains** — IDEA, PyCharm, GoLand, RustRover, … | Shipped | [`editors/jetbrains`](editors/jetbrains) |
| Vim, Neovim, Helix, Emacs, Sublime, Zed | Planned, via a language server | [ROADMAP.md](ROADMAP.md) |

## Layout

```
conformance/          the behaviour contract, and the corpus that pins it
  spec.md             normative: how a descriptor is read and laid out
  manifest.json       every case, and the descriptor it reads
  cases/              edge cases that make poor demos
  expected/           one golden document per case

editors/
  jetbrains/          Kotlin core + Swing canvas, split editor
  vscode/             TypeScript core + SVG webview, preview to the side

examples/             ten scenarios, doubling as the manual test plan
ROADMAP.md            which editors, in what order, and why
```

## One contract, an implementation per editor

Each editor implements the core — reference resolution, relations, external placeholders,
layered layout — in its own language. Nothing is shared at runtime. What is shared is
[`conformance/`](conformance/spec.md): a corpus of descriptors with a golden document for each,
which **every implementation runs in its own CI, in its own language**.

That is a deliberate trade. The core is about 500 lines and implements a published, slow-moving
format. Sharing it as a compiled artifact would mean a JVM toolchain inside the VS Code build,
or rewriting it for WebAssembly — while the half of the work that actually differs, the
rendering, cannot be shared at any price. Two implementations of 500 lines is the cheaper
problem, *provided* drift is caught mechanically. That is what the corpus is for: a disagreement
about what a descriptor means shows up as a failing test, not as a bug report six months later.

The JetBrains side is the reference implementation and generates the goldens. Changing behaviour
means changing it, regenerating, reading the diff, and then making every other implementation
pass again:

```bash
cd editors/jetbrains && ./gradlew test -Dconformance.update=true
cd editors/vscode    && npm test
```

If you are adding a third editor, [ROADMAP.md](ROADMAP.md#adding-an-editor) has the order to do
it in — pass the corpus before writing any rendering code.

## Building

Neither editor needs the other's toolchain.

```bash
# VS Code — needs Node
cd editors/vscode
npm install && npm test && npm run package     # -> backstage-catalog-graph-<version>.vsix

# JetBrains — needs a JDK (Gradle will provision one)
cd editors/jetbrains
./gradlew build                                 # compile, unit tests, conformance corpus
./gradlew runIde                                # sandbox IDE with examples/ open
./gradlew buildPlugin                           # -> backstage-catalog-graph-<version>.zip
./gradlew packageTestKit                        # plugin + examples + TESTING.md
```

## Trying it

[`examples/`](examples/README.md) is a manual test plan of ten scenarios — the everyday
single-component case, a complete system, placeholder rendering on its own, every relation type,
namespace equality, a Group/User-only graph, each problem the reader reports, a 37-entity
catalog for the viewport controls, the empty state, and filename matching. Each lists the exact
entity, placeholder, relation and problem counts it should produce, and those counts are
asserted by both implementations.

- **VS Code**: <kbd>F5</kbd> from this repository launches an Extension Development Host with
  `examples/` open.
- **JetBrains**: `./gradlew runIde` from `editors/jetbrains`, optionally with
  `-PopenFile=examples/04-all-relations/catalog-info.yaml`.

## Relations understood

| `spec` field | Relation | Reference defaults to |
|---|---|---|
| `owner` | `ownedBy` | `Group` |
| `system` | `partOf` | `System` |
| `domain` | `partOf` | `Domain` |
| `subcomponentOf` | `partOf` | `Component` |
| `parent` | `childOf` | `Group` |
| `children` | `parentOf` | `Group` |
| `members` | `hasMember` | `User` |
| `memberOf` | `memberOf` | `Group` |
| `providesApis` | `providesApi` | `API` |
| `consumesApis` | `consumesApi` | `API` |
| `dependsOn` | `dependsOn` | `Component` |
| `dependencyOf` | `dependencyOf` | `Component` |

An explicit prefix always wins: `owner: user:grahambrooks` yields a `User`, not a `Group`.
References resolve the way Backstage resolves them — `[<kind>:][<namespace>/]<name>`, with the
entity's own namespace as the default — and compare case-insensitively.
[`conformance/spec.md`](conformance/spec.md) is the full, normative version.

## Deliberately not in scope

Stated so a later change doesn't "complete" something that was cut on purpose:

- **No catalog-wide graph.** The view is scoped to one file. Resolving references against other
  files in the project, or against a running Backstage instance, would remove exactly the
  boundary the external placeholders are there to show.
- **No network access.** Nothing is fetched from a Backstage API, and no `backstage.io/*`
  annotation is dereferenced.
- **No `Location` target expansion.** `spec.targets` holds paths and URLs, not entity
  references, so it produces no edges.
- **No editing.** The graph is a view of the YAML; the YAML is edited as YAML.

## Releasing

CalVer, kept in step across editors: `pluginVersion` in `editors/jetbrains/gradle.properties`
and `version` in `editors/vscode/package.json`. Tag `v<version>`; the release workflow checks
both match, builds each editor's artifact, and attaches them to a GitHub release. Publishing to
the JetBrains Marketplace and the VS Code Marketplace is irreversible and stays behind a manual
`workflow_dispatch`.

## Licence

MIT — see [LICENSE](LICENSE).
