# Backstage Catalog Graph for VS Code

Visualises a Backstage `catalog-info.yaml` as the catalog graph it describes — entities as
nodes, `spec` references as labelled edges, and **dashed placeholders for every reference that
leaves the file**.

The placeholders are the point. A descriptor almost never declares everything it names: the
owning group lives in the org catalog, the system is defined in another repository, a
`dependsOn` points at a resource someone else runs. Dropping those references would draw a
tidier but dishonest picture, so they are drawn as ghosts, and the graph shows both what the
file defines and what it assumes exists.

## Using it

Open a `catalog-info.yaml` and either:

- click the **Show Catalog Graph to the Side** button in the editor title bar, or
- run **Backstage: Show Catalog Graph to the Side** from the command palette, or
- right-click the file in the explorer and choose **Show Catalog Graph**.

The graph opens beside the file and follows it as you type.

| | |
|---|---|
| Click a node | Select it, dim everything outside its neighbourhood, and select the YAML that defines it; focus stays in the graph |
| Double-click a node | As a click, and move keyboard focus to the editor |
| Hover a node | Details, and whether it is declared here or elsewhere |
| Move the caret into an entity's YAML | Select it in the graph, panning to it if it is off screen (zoom is kept) |
| Type in **Find entity** (Ctrl/Cmd+F) | Select and reveal the first entity whose title or reference matches; Enter / Shift+Enter for next / previous, Escape to clear |
| Ctrl/Cmd + scroll | Zoom about the cursor |
| Scroll / Shift + scroll | Pan vertically / horizontally |
| Drag | Pan |
| Arrow keys (graph focused) | Move the selection to the nearest node that way, selecting its YAML |
| Enter / Escape | Select the YAML and focus the editor / deselect |
| + / − / 0 | Zoom in / zoom out / fit |
| Toolbar | Zoom, Fit, Actual size, External references, Owners as badges, Group by System, Focus, Outline, Reload |
| **Focus** on | Draw only the selected entity and what it is joined to, laid out afresh; the focus follows each click, Find and caret move |
| **Group by System** on | Each System is a box around the entities that are part of it; the `partOf` edges into the box are not drawn |
| **Outline** on | The catalog as a tree of kind, entity and relations; clicking a row selects its YAML |
| Click the problems warning | List every problem; picking one moves the caret to it |

Edge labels appear above roughly 75% zoom and are hidden below it, on purpose. Edges are coloured
by relation, with inverse pairs (`childOf`/`parentOf`) sharing a colour, and the legend lists the
relations drawn. With **Owners as badges** on (the default) each entity's owner is a pill under its
subtitle rather than an `ownedBy` edge, and a placeholder that was only an owner is not drawn.
Edges are routed through the gaps in the rows they cross rather than over the nodes there, edges
within one row arc over it, and a row wider than about 1200px wraps onto several.

## Files it offers the graph on

`catalog-info.yaml` / `.yml`, `*.catalog-info.yaml`, and the explicitly prefixed
`catalog-all.yaml` / `catalog-entities.yaml`. Other YAML files are left alone.

## Settings

| Setting | Default | |
|---|---|---|
| `backstageCatalogGraph.showExternalReferences` | `true` | Draw placeholders for entities declared elsewhere |
| `backstageCatalogGraph.ownersAsBadges` | `true` | Show owners as badges instead of `ownedBy` edges |
| `backstageCatalogGraph.rebuildDelayMs` | `350` | How long to wait after a keystroke before redrawing |

## Deliberately not in scope

- **No catalog-wide graph.** The view is scoped to one file. Resolving references against other
  files in the workspace, or against a running Backstage instance, would remove exactly the
  boundary the external placeholders are there to show.
- **No network access.** Nothing is fetched from a Backstage API.
- **No `Location` target expansion.** `spec.targets` holds paths and URLs, not entity references.
- **No editing.** The graph is a view; the YAML is edited as YAML.

## Testing it locally

Two ways, for two different questions.

### Trying out a change — Extension Development Host

A second VS Code window running the extension straight from source. This is the loop to use
while working on it.

```bash
cd editors/vscode
npm install
npm run bundle
```

Then either press <kbd>F5</kbd> with the **repository root** open in VS Code — the bundled
launch configuration builds first and opens `examples/` for you — or start it from the command
line:

```bash
# from editors/vscode
code --extensionDevelopmentPath="$PWD" --new-window ../../examples
```

A new window opens with `examples/` as its workspace. Open `01-minimal/catalog-info.yaml` and
click **Show Catalog Graph to the Side** in the editor title bar.

After changing anything under `src/`, rebuild and then run **Developer: Reload Window**
(<kbd>Cmd/Ctrl</kbd>+<kbd>R</kbd>) in the development host — VS Code does not re-read the bundle
on its own. Leave a rebuild running in a second terminal so only the reload is manual:

```bash
npm run watch
```

To keep the development host away from your real settings and installed extensions — worth
doing if you want to see the extension behave the way a new user would:

```bash
code --extensionDevelopmentPath="$PWD" \
     --user-data-dir=/tmp/bcg-profile --extensions-dir=/tmp/bcg-extensions \
     --new-window ../../examples
```

### Testing a build the way a user gets it — install the VSIX

This exercises the packaged artifact: minified bundle, real activation events, real install path.
It is what to do before handing a build to someone else.

```bash
cd editors/vscode
npm run package                                             # -> backstage-catalog-graph-<version>.vsix
code --install-extension backstage-catalog-graph-*.vsix --force
```

Restart VS Code, then open any descriptor under [`examples/`](../../examples/README.md).

When you are done:

```bash
code --uninstall-extension grahambrooks.backstage-catalog-graph
```

The same VSIX installs in Cursor, Windsurf and VSCodium — substitute `cursor`, `windsurf` or
`codium` for `code` above.

### What to check

[`examples/README.md`](../../examples/README.md) is the test plan: ten scenarios, each with the
exact entity, placeholder, relation and problem counts it should produce, and the interactions
to try in each. The counts are asserted by the automated tests, so if what you see on screen
disagrees with what is written there, the bug is in the plugin and not in the example.

A quick pass, if you only have a few minutes:

| Open | Expect |
|---|---|
| `01-minimal` | 1 solid node, 2 dashed; hover a dashed one for *Referenced but not defined in this file* |
| `03-external-references` | Untick **External references**; all but one isolated node should vanish |
| `04-all-relations` | Zoom past ~75%; every edge should carry its relation name |
| `07-malformed` | A warning in the toolbar reading the first problem and `(+3 more)`, and two nodes still drawn |
| `08-large-catalog` | **Fit**, then click a node — everything outside its neighbourhood dims |

Double-click any solid node: the caret should land on that entity in the YAML pane.

### Automated tests

```bash
npm test        # unit tests, plus the cross-editor conformance corpus
npm run typecheck
```

`npm test` runs the corpus in [`../../conformance`](../../conformance/README.md) — the same
cases, and the same golden documents, that the JetBrains implementation is checked against. If
it passes here and there, both editors agree about what a descriptor means.

## Developing

```bash
npm install
npm test               # unit tests + the cross-editor conformance corpus
npm run typecheck
npm run bundle         # out/extension.js and out/webview.js, with sourcemaps
npm run watch          # the same, rebuilding on save
npm run package        # minified, then backstage-catalog-graph-<version>.vsix
```

Nothing under `src/core/` may import `vscode`: that is what lets the conformance corpus run it
in plain Node, and what would let it move to a language server later. Rendering lives in
`src/webview/`, which runs in a browser context and must not import `vscode` either — it talks
to the extension host over `postMessage`, through the wire format in `src/core/wire.ts`.

How a descriptor is interpreted is specified in
[`conformance/spec.md`](../../conformance/spec.md) and pinned by a corpus shared with the
JetBrains implementation. Changing that behaviour means changing the spec and regenerating the
goldens — see the [repository README](../../README.md).
