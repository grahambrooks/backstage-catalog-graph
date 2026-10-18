# Examples

A manual test plan, shared by every editor. Each directory holds one descriptor that isolates
one thing worth checking, with the counts you should see and the interactions to try.

These same descriptors are the inputs to the automated
[conformance corpus](../conformance/README.md), so what you check by hand and what CI checks are
the same files.

**VS Code** — press <kbd>F5</kbd> from the repository root to launch an Extension Development
Host with this directory open, then open a file below and click **Show Catalog Graph to the
Side** in the editor title bar.

**JetBrains** — `cd editors/jetbrains && ./gradlew runIde`, which opens this directory as the
sandbox project. Each file below opens with a **Text** / **Backstage Catalog** split.

In both, the counts appear at the bottom right of the graph pane.

The counts in this table are asserted by `ExamplesTest`, so if what you see disagrees with what
is written here, the plugin is wrong, not the example.

| Example | Entities | External | Relations | Problems | What it is for |
|---|---:|---:|---:|---:|---|
| [`01-minimal`](01-minimal/catalog-info.yaml) | 1 | 2 | 2 | 0 | The everyday case: one component, owner and system defined elsewhere |
| [`02-storefront-system`](02-storefront-system/catalog-info.yaml) | 7 | 5 | 18 | 0 | A complete system — domain, system, components, API, resource, group |
| [`03-external-references`](03-external-references/catalog-info.yaml) | 1 | 9 | 9 | 0 | Placeholder rendering on its own, and the external toggle |
| [`04-all-relations`](04-all-relations/catalog-info.yaml) | 10 | 5 | 24 | 0 | Every one of the eleven relation types, so every edge label appears |
| [`05-namespaces`](05-namespaces/catalog-info.yaml) | 3 | 2 | 5 | 0 | Namespace handling and reference equality |
| [`06-org-chart`](06-org-chart/catalog-info.yaml) | 6 | 1 | 10 | 0 | Groups and Users only — layout with no Component or System |
| [`07-malformed`](07-malformed/catalog-info.yaml) | 2 | 2 | 2 | 4 | Problem reporting, and that a bad document doesn't blank the graph |
| [`08-large-catalog`](08-large-catalog/catalog-info.yaml) | 37 | 1 | 93 | 0 | Viewport controls and neighbourhood highlighting at scale |
| [`09-no-entities`](09-no-entities/catalog-info.yaml) | 0 | 0 | 0 | 0 | The empty state — a comment-only file is not a broken file |
| [`10-file-naming`](10-file-naming) | — | — | — | — | Which filenames get a catalog tab, and which don't |
| [`11-ai-resources`](11-ai-resources/catalog-info.yaml) | 7 | 3 | 18 | 0 | The alpha `AiResource` kind — skills, a rule, a plugin, a marketplace — and an MCP server API |

"External" counts the dashed placeholder nodes: entities the file references but does not
declare. "Relations" counts edges, including those to placeholders.

## What to check

The two editors name their toolbar controls slightly differently; the notes below use the
JetBrains names.

| JetBrains | VS Code |
|---|---|
| Fit to Window | Fit |
| Show External References | External references |
| Show Owners as Badges | Owners as badges |
| Group by System | Group by System |
| Focus on Selection | Focus |
| Show Outline | Outline |

**01-minimal** — one solid node, two dashed. Hover the dashed nodes: the tooltip should say
*Referenced but not defined in this file*. Hover the solid one: it should offer double-click to
jump to the definition, and doing so should move the caret in the text pane.

**02-storefront-system** — the layers should read Domain, System, Component, API/Resource,
Group, User from top to bottom. Edit `metadata.title` of any entity in the text pane and the
label should follow within about a third of a second, without the graph jumping.

**03-external-references** — turn **Show External References** off in the toolbar. Everything
should vanish but a single isolated node; turn it back on and the nine placeholders return.

**04-all-relations** — zoom past about 75% and every edge should carry its relation name:
`ownedBy`, `partOf`, `parentOf`, `childOf`, `memberOf`, `hasMember`, `providesApi`,
`consumesApi`, `dependsOn`, `dependencyOf`, `hasPart`. Below that threshold labels are suppressed,
which is deliberate. `Retail` sits beside `Commerce` with a `partOf` edge into it (`subdomainOf`).
Turn **Show Owners as Badges** off to see the `ownedBy` edges.

**05-namespaces** — `Checkout (retail)` and `Checkout (wholesale)` must be two nodes, not one.
Both should have a `consumesApi` edge into the *same* `Checkout API (retail)` node, even though
one wrote `checkout-api` and the other wrote `api:retail/checkout-api`.

**06-org-chart** — Group and User are the two lowest layers, so this graph occupies only the
bottom of the layout. Check it still centres and that **Fit to Window** does something sensible.
The Groups form a hierarchy, so their layer is drawn as one row per depth: parent teams above
their children, and the `childOf`/`parentOf` edges running vertically, not along a row.

**07-malformed** — a warning strip at the top of the graph pane reading the first problem and
`(+3 more)`; clicking it lists all four, and picking one moves the caret to that document. Two
solid nodes remain. The surviving `duplicated`
node should be titled **Second definition** — the later declaration wins.

**08-large-catalog** — **Fit to Window** should bring all 37 entities into view. Ctrl/Cmd-scroll
zooms about the cursor, plain scroll pans vertically, Shift-scroll horizontally, and dragging
pans. Click a node: everything outside its neighbourhood should dim.

**09-no-entities** — *No Backstage entities found in this file*, centred, with no warning strip.

**10-file-naming** — `payments.catalog-info.yaml` and `catalog-all.yaml` should each open with
the split view. `app-config.yaml` is the control: it should open in the ordinary YAML editor
with **no** catalog tab.

**11-ai-resources** — the alpha `AiResource` kind, in gold, in the same layer as the MCP server
API. The marketplace, plugin and skills form a hierarchy, so they draw as rows: *Internal
Marketplace* above *Frontend Pack* above its two skills, joined by `hasPart`. *Frontend Design*'s
bare `dependsOn: base-coding-standards` lands on the skill, not on a Component. `security-pack`
is a dashed placeholder. **Group by System** puts all of it in one *AI Tooling* box.

## Adding an example

Add the directory and file, then:

1. Add a row to `expectations` in
   `editors/jetbrains/src/test/kotlin/com/grahambrooks/backstage/catalog/ExamplesTest.kt` and to
   the table above. That test fails if a catalog file in this tree is missing from the list, so
   the plan cannot silently drift from the tree.
2. Add it to [`conformance/manifest.json`](../conformance/manifest.json) and regenerate the
   goldens, so every editor is checked against it:
   `cd editors/jetbrains && ./gradlew test -Dconformance.update=true`
