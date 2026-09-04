# Backstage Catalog Graph

A JetBrains IDE plugin that draws a Backstage `catalog-info.yaml` as the catalog graph it
describes — entities as nodes, `spec` references as labelled edges, and **dashed placeholders
for every reference that leaves the file**.

The placeholders are the point. A descriptor almost never declares everything it names: the
owning group lives in the org catalog, the system is defined in another repository, a
`dependsOn` points at a resource someone else runs. Dropping those references would draw a
tidier but dishonest picture, so they are drawn as ghosts, and the graph shows both what the
file defines and what it assumes exists.

## What it does

Open any `catalog-info.yaml` and the editor splits into **Text** and **Backstage Catalog**.

- Every YAML document in the file becomes a node, coloured and layered by entity kind
  (Domain → System → Component → API/Resource → Group → User).
- Every reference in `spec` becomes a directed, labelled edge.
- Anything referenced but not declared becomes a dashed external placeholder; the edge to it is
  dashed too.
- The graph rebuilds as you type (debounced), so it tracks the file you are editing.
- Click a node to highlight its neighbourhood; double-click to jump to its declaration.
- Descriptor problems — missing `kind`, missing `metadata.name`, duplicate entities,
  unreadable references — are reported in the toolbar strip instead of yielding a blank graph.

### Relations understood

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
References are resolved the way Backstage resolves them — `[<kind>:][<namespace>/]<name>`, with
the entity's own namespace as the default — and compared case-insensitively, so
`system: developer-tools` and `system:default/developer-tools` are one node.

### Files it attaches to

`catalog-info.yaml` / `.yml`, `*.catalog-info.yaml`, and the explicitly prefixed
`catalog-all.yaml` / `catalog-entities.yaml`. Other YAML files are left alone.

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

## Building

Requires JDK 21. The Gradle toolchain will provision one if the machine has none.

```bash
./gradlew build          # compile, unit tests
./gradlew runIde         # sandbox IDE — then work through examples/
./gradlew buildPlugin    # build/distributions/backstage-catalog-graph-<version>.zip
./gradlew verifyPlugin   # JetBrains plugin verifier against recommended IDEs
```

[`examples/`](examples/README.md) is the manual test plan: ten scenarios, each isolating
one behaviour, with the entity, placeholder, relation and problem counts you should see. Those
counts are asserted by `ExamplesTest`, so an example that disagrees with the plugin is a bug in
the plugin.

## Design notes

**Java2D, not a diagram framework.** IntelliJ's `com.intellij.diagram` API is Ultimate-only, and
a JCEF view would mean shipping a JavaScript bundle to draw a few dozen boxes. The canvas is
plain Java2D, so the plugin works in Community editions and carries no runtime of its own.

**The IDE's YAML PSI, not a bundled parser.** It is already in the IDE, it is incremental so the
graph is cheap to rebuild while typing, and it gives each document a text offset — which is what
makes double-click-to-declaration possible.

**Kind-based layering, not longest-path.** A catalog has a conventional reading order. Layering
by `EntityKind.rank` means the picture keeps its shape as entities are added, rather than
reshuffling every time a new edge changes the longest path through the graph. Within a layer,
node order is a barycentre heuristic to cut crossings.

**The model layer knows nothing about the IDE.** `model/` and `layout/` work on plain maps and
lists, with `psi/YamlDocumentReader` as the only adapter. That is why the tests are ordinary
JUnit 5 running in under a second, with no IDE fixture.

## Layout

```
src/main/kotlin/com/grahambrooks/backstage/catalog/
├── CatalogInfoFiles.kt          which files get a graph tab
├── model/                       entity refs, relations, graph building   (IDE-free)
├── layout/                      layered graph layout                     (IDE-free)
├── psi/                         YAML PSI → plain maps
└── ui/                          canvas, toolbar, split file editor

examples/                        manual test plan — see examples/README.md
```

## Releasing

CalVer, set in `gradle.properties` as `pluginVersion`. Tag `v<version>` on `main`; the release
workflow verifies the tag matches, builds, and attaches the ZIP to a GitHub release. Publishing
to the JetBrains Marketplace is irreversible and stays behind a manual `workflow_dispatch`.

## Licence

MIT — see [LICENSE](LICENSE).
