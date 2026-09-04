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
| Click a node | Select it and dim everything outside its neighbourhood |
| Double-click a node | Jump the caret to that entity's declaration |
| Hover a node | Details, and whether it is declared here or elsewhere |
| Ctrl/Cmd + scroll | Zoom about the cursor |
| Scroll / Shift + scroll | Pan vertically / horizontally |
| Drag | Pan |
| Toolbar | Zoom, Fit, Actual size, External references, Reload |

Edge labels appear above roughly 75% zoom and are hidden below it, on purpose.

## Files it offers the graph on

`catalog-info.yaml` / `.yml`, `*.catalog-info.yaml`, and the explicitly prefixed
`catalog-all.yaml` / `catalog-entities.yaml`. Other YAML files are left alone.

## Settings

| Setting | Default | |
|---|---|---|
| `backstageCatalogGraph.showExternalReferences` | `true` | Draw placeholders for entities declared elsewhere |
| `backstageCatalogGraph.rebuildDelayMs` | `350` | How long to wait after a keystroke before redrawing |

## Deliberately not in scope

- **No catalog-wide graph.** The view is scoped to one file. Resolving references against other
  files in the workspace, or against a running Backstage instance, would remove exactly the
  boundary the external placeholders are there to show.
- **No network access.** Nothing is fetched from a Backstage API.
- **No `Location` target expansion.** `spec.targets` holds paths and URLs, not entity references.
- **No editing.** The graph is a view; the YAML is edited as YAML.

## Developing

```bash
npm install
npm test        # unit tests + the cross-editor conformance corpus
npm run bundle  # out/extension.js and out/webview.js
npm run package # backstage-catalog-graph-<version>.vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host, then open anything under
[`examples/`](../../examples/README.md).

Nothing under `src/core/` may import `vscode`: that is what lets the conformance corpus run it
in plain Node. How a descriptor is interpreted is specified in
[`conformance/spec.md`](../../conformance/spec.md) and pinned by a corpus shared with the
JetBrains implementation — see the [repository README](../../README.md).
