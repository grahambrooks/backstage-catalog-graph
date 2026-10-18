# Catalog graph conformance specification

This is the behaviour contract every editor implementation must meet. It is normative: where an
implementation and this document disagree, the implementation is wrong.

Behaviour is pinned by a corpus, not by prose alone. `manifest.json` lists cases; each names an
input descriptor and has a golden document in `expected/`. Each editor runs the whole corpus in
its own CI, in its own language. Drift shows up as a failing test rather than as a bug report
six months later.

## Why the core is implemented per editor

The core is about 500 lines and implements a published, slow-moving format. Sharing it as a
compiled artifact would mean a JVM toolchain in the VS Code build or a WebAssembly rewrite, for
a saving of 500 lines — while the half of the work that actually differs, the rendering, cannot
be shared at any price. So each editor gets an idiomatic implementation in its own language, and
this corpus, not a shared binary, is what keeps them honest.

## Reading a descriptor

A `catalog-info.yaml` holds one or more YAML documents. A document that is not a mapping is
skipped silently — a comment-only file is not a broken file.

### Entity identity

An entity is identified by `kind`, `metadata.namespace` (default `default`) and `metadata.name`.
All three are compared **case-insensitively** and stored lower-cased. The canonical form written
in golden files is `kind:namespace/name`.

A document with no `kind`, or no `metadata.name`, is skipped and reported as a problem.

Two documents declaring the same reference produce **one** node, from the later declaration, and
a `Duplicate entity` problem.

### Reference resolution

References are written `[<kind>:][<namespace>/]<name>`. Missing parts are filled in from context:

- **kind** — from the `spec` field the reference appears in (see the table below).
- **namespace** — from the *referring entity's* own namespace, not from `default`.

An explicit prefix always wins: `owner: user:grahambrooks` is a User, not a Group.

Text that cannot be a reference — empty, blank, containing whitespace, or missing a part either
side of its separators — is rejected and reported as a problem rather than guessed at.

### Relations

Each `spec` field maps to one relation. Only the direction actually written in the descriptor is
modelled; Backstage's materialised inverse relations are not drawn, because drawing both would
double every edge.

| `spec` field | Relation | Reference defaults to kind |
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

Duplicate edges are collapsed: one edge per distinct `(from, to, relation)`.

`Location.spec.targets` holds paths and URLs, not entity references, and produces no edges.

### External placeholders

Any reference resolving to an entity the file does not declare becomes a node with
`external: true`. This is the point of the graph: it shows both what the file defines and what it
assumes exists elsewhere. External nodes carry only a reference and a kind — the title is the
reference's name, and every other field is null or empty.

### Tolerance

The reader never throws on a badly shaped document. Specifically:

- A field documented as a list may be written as a bare scalar; both forms produce the same
  edges (`case-scalar-or-list`).
- Non-string entries in a list are dropped.
- A scalar where a string is expected is coerced: `title: 42` yields the title `"42"`.
- A mapping or list where a reference is expected yields no edge and no problem.
- A `spec` that is not a mapping yields no relations for that entity, but the entity still
  appears (`case-wrong-shapes`).

## Layout

Nodes are laid out in horizontal layers. The layer comes from the entity kind, not from the
longest path through the graph — a catalog has a conventional reading order, and kind-based
layering keeps the picture stable as entities are added.

| Kind | Layer rank |
|---|---|
| `Domain` | 0 |
| `System` | 1 |
| `Component`, `Template` | 2 |
| `API`, `Resource` | 3 |
| `Group` | 4 |
| `User` | 5 |
| `Location`, anything unrecognised | 6 |

Ranks with no nodes are dropped, so layers are contiguous.

Within a layer, nodes start ordered by `(external, lowercased title)` and are then reordered by
four alternating barycentre sweeps — even-numbered sweeps run top-to-bottom against the layer
above, odd-numbered sweeps bottom-to-top against the layer below. A node with no neighbour in
the adjacent layer keeps its current index. Sorting must be **stable**.

Layout must terminate on cyclic and self-referencing graphs, and must place every node
(`case-cycles`).

### Drawing a layer as several rows

This part is presentation, not contract: nothing below is in the golden files.

A layer can hold its own hierarchy -- Groups joined by `parent`/`children`, Components by
`subcomponentOf`. Drawn as one row, those edges run sideways through their siblings. So after
ordering, a layer is drawn as one row per hierarchy depth, parents above children:

- A node's parents are the far ends of its `childOf` and `partOf` edges, and the near end of a
  `parentOf` edge, counting only parents in the same layer.
- Depth is 0 with no parent, otherwise one more than the deepest parent. A node reached again
  while its own depth is being worked out counts as depth 0, which is what ends a cycle.
- Each row keeps the layer's order. Then each row below the first gets one stable barycentre
  pass against the row above it, using parents only, so children sit under their parents.

Two further drawing choices are also presentation only. A row wider than the editor's limit wraps
onto several, in order. And with Systems drawn as containers, the rows a System's members occupy
place that System's nodes in one column, so its box encloses them. Neither changes a layer's
membership or order.

Because a layer can span several rows, a runner must read layer membership and order from the
layout's logical layers, not by grouping nodes on their y coordinate.

## Golden document format

One JSON document per case in `expected/<id>.json`.

```json
{
  "nodes":    [ {"ref", "kind", "title", "type", "lifecycle", "tags", "external"} ],
  "edges":    [ {"from", "to", "type"} ],
  "problems": [ "message" ],
  "layers":   [ ["ref", "..."] ]
}
```

- `nodes` sorted by `ref`; `edges` by `(from, type, to)`; `problems` by message. These orders are
  imposed so that an implementation's internal ordering is not accidentally part of the contract.
- `kind` is the display name (`Component`, `API`, `Domain`, …), not the lower-cased reference
  kind. Anything unrecognised is `Entity`.
- `type` and `lifecycle` are `null` when absent. `tags` is `[]` when absent.
- `layers` **is** ordered — outer array top layer first, inner arrays in the order the ordering
  sweeps leave them. This is what pins the layout algorithm across implementations. They are
  the logical layers, before any layer is drawn as several rows.
- Layout for the golden files is measured with every node fixed at 100 × 50, because real
  rendering measures text and no two UI toolkits would agree on the result.

Source offsets are **not** in the golden files and are not part of the contract. Each editor
takes them from its own YAML parser, and the parsers disagree about where a document begins --
IntelliJ's PSI and the `yaml` package differ over whether the `---` separator belongs to the
document that follows it. Both land the caret in the right entity, which is all that matters.

Problem messages are compared verbatim, so they are part of the contract. Changing one means
regenerating the goldens and updating every implementation.

## Changing the contract

1. Change the reference implementation (`editors/jetbrains`).
2. Regenerate: `cd editors/jetbrains && ./gradlew test -Dconformance.update=true`
3. **Read the diff.** A changed golden is a changed contract.
4. Update the other implementations until the corpus passes everywhere.

Adding a case is the same, plus an entry in `manifest.json`.
