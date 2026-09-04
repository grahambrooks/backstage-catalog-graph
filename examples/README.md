# Examples

A manual test plan for the plugin. Each directory holds one descriptor that isolates one thing
worth checking, with the counts you should see and the interactions to try.

```bash
./gradlew runIde
```

Then, in the sandbox IDE, **File → Open** this repository and open the files below. Each should
open with a **Text** / **Backstage Catalog** split; the counts appear in the bottom-right of the
graph pane.

The counts in this table are asserted by `ExamplesTest`, so if what you see disagrees with what
is written here, the plugin is wrong, not the example.

| Example | Entities | External | Relations | Problems | What it is for |
|---|---:|---:|---:|---:|---|
| [`01-minimal`](01-minimal/catalog-info.yaml) | 1 | 2 | 2 | 0 | The everyday case: one component, owner and system defined elsewhere |
| [`02-storefront-system`](02-storefront-system/catalog-info.yaml) | 7 | 5 | 18 | 0 | A complete system — domain, system, components, API, resource, group |
| [`03-external-references`](03-external-references/catalog-info.yaml) | 1 | 9 | 9 | 0 | Placeholder rendering on its own, and the external toggle |
| [`04-all-relations`](04-all-relations/catalog-info.yaml) | 8 | 4 | 19 | 0 | Every one of the ten relation types, so every edge label appears |
| [`05-namespaces`](05-namespaces/catalog-info.yaml) | 3 | 2 | 5 | 0 | Namespace handling and reference equality |
| [`06-org-chart`](06-org-chart/catalog-info.yaml) | 6 | 1 | 10 | 0 | Groups and Users only — layout with no Component or System |
| [`07-malformed`](07-malformed/catalog-info.yaml) | 2 | 2 | 2 | 4 | Problem reporting, and that a bad document doesn't blank the graph |
| [`08-large-catalog`](08-large-catalog/catalog-info.yaml) | 37 | 1 | 93 | 0 | Viewport controls and neighbourhood highlighting at scale |
| [`09-no-entities`](09-no-entities/catalog-info.yaml) | 0 | 0 | 0 | 0 | The empty state — a comment-only file is not a broken file |
| [`10-file-naming`](10-file-naming) | — | — | — | — | Which filenames get a catalog tab, and which don't |

"External" counts the dashed placeholder nodes: entities the file references but does not
declare. "Relations" counts edges, including those to placeholders.

## What to check

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
`consumesApi`, `dependsOn`, `dependencyOf`. Below that threshold labels are suppressed, which is
deliberate.

**05-namespaces** — `Checkout (retail)` and `Checkout (wholesale)` must be two nodes, not one.
Both should have a `consumesApi` edge into the *same* `Checkout API (retail)` node, even though
one wrote `checkout-api` and the other wrote `api:retail/checkout-api`.

**06-org-chart** — Group and User are the two lowest layers, so this graph occupies only the
bottom of the layout. Check it still centres and that **Fit to Window** does something sensible.

**07-malformed** — a warning strip at the top of the graph pane reading the first problem and
`(+3 more)`; hovering it lists all four. Two solid nodes remain. The surviving `duplicated`
node should be titled **Second definition** — the later declaration wins.

**08-large-catalog** — **Fit to Window** should bring all 37 entities into view. Ctrl/Cmd-scroll
zooms about the cursor, plain scroll pans vertically, Shift-scroll horizontally, and dragging
pans. Click a node: everything outside its neighbourhood should dim.

**09-no-entities** — *No Backstage entities found in this file*, centred, with no warning strip.

**10-file-naming** — `payments.catalog-info.yaml` and `catalog-all.yaml` should each open with
the split view. `app-config.yaml` is the control: it should open in the ordinary YAML editor
with **no** catalog tab.

## Adding an example

Add the directory and file, then add a row to `expectations` in
`src/test/kotlin/com/grahambrooks/backstage/catalog/ExamplesTest.kt` and to the table above.
The test fails if a catalog file in this tree is missing from that list, so the plan cannot
silently drift from the tree.
