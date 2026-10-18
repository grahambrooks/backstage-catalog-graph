# Changelog

Notable changes across all editor implementations. Versions are CalVer (`YYYY.M.D`) and are kept
in step between editors. The VS Code extension also carries
[its own changelog](editors/vscode/CHANGELOG.md), because the marketplace displays it.

## [Unreleased]

## [2026.10.18]

### Added

- **Owners as badges** (default on) — each entity's owner is a pill on the entity instead of an
  `ownedBy` edge running down to the Group layer; a placeholder that was only an owner is not
  drawn.
- **Edges coloured by relation**, inverse pairs sharing a colour, with the relations drawn listed
  in the legend.
- **Group by System** — each System drawn as a box around the entities that are part of it.
- **Focus on Selection** — draw only the selected entity and what it is joined to, following the
  selection.
- **Outline** — the catalog as a tree of kind, entity and relations.
- **Find** (Ctrl/Cmd+F) — select and reveal entities by title or reference.
- **Two-way sync with the YAML** — moving the caret selects the entity under it; clicking a node
  selects the YAML that defines it.
- **Keyboard** — arrows move between nodes, Enter jumps to the YAML, Escape deselects, + − 0 zoom.
- **Problems list** — the warning is clickable and lists every problem, each jumping to its line.
- A root `Makefile` for building packages and launching each editor for hands-on testing.
- **`AiResource`** (alpha kind, Backstage 1.51+) — drawn in the API/Resource layer in its own
  colour. A skill's `dependsOn` defaults to `AiResource`; a plugin's `skills` and a marketplace's
  `plugins` draw the new `hasPart` relation, and that hierarchy draws as rows. New example
  `11-ai-resources`.
- **`Domain.spec.subdomainOf`** — a nested domain now draws `partOf` into its parent.

### Changed

- A hierarchy inside one layer — Groups with a `parent`, subcomponents — is drawn as rows,
  parents above children, so those edges run vertically.
- Edges are routed through the gaps in the rows they cross instead of over the nodes there, and
  edges within one row arc over it. Rows wider than about 1200px wrap.
- Fit to Window can zoom out to 10%, so a catalog of a few dozen entities fits whole, and a file
  opens fitted to the pane.
- Faster on large files: focus moves lay out only the focused neighbourhood (the full layout is
  kept until the file or a toggle changes), text truncation bisects instead of trimming a
  character at a time, fonts and text widths are cached, and the JetBrains plugin reads the YAML
  in a background read action instead of on the UI thread. A focus move keeps the zoom when the
  neighbourhood fits.
- Conformance runners read the layout's logical layers rather than grouping nodes by position.
- CI: every action pinned to a commit SHA and moved to its current major (`gradle/actions` stays
  on v5 — v6 changes its licence terms); every workflow's token is read-only except the release;
  release notes come from this file; a new workflow runs actionlint. A `renovate.json` keeps
  actions pinned and holds `@types/vscode` and `@types/node` to the oldest supported VS Code.
- **Contract:** `dependsOn` and `dependencyOf` on anything but an `AiResource` no longer assume
  `Component`. As in Backstage, a reference there must name its kind; a bare name is reported as
  a problem and draws no edge. Fields are now scoped by kind, so `skills`/`plugins` mean nothing
  outside an `AiResource`. New conformance case `case-kind-scoped-fields`; goldens for
  `04-all-relations` and `case-ref-forms` regenerated.

### Fixed

- The JetBrains graph painted outside its own pane, over the project panel, once it was larger
  than the pane.
- In VS Code, clicking a node did nothing: the pan handler captured the pointer, so the click
  went to the canvas and cleared the selection.
- The JetBrains layout read a node's position from the layer while sorting it, so layers with
  unlinked nodes could be ordered differently from the spec and from VS Code. New conformance
  case `case-unlinked-ordering` pins it for both.
- Editing the selected entity's relations left its neighbourhood highlight stale, and Find's
  "n of m" stale, until something was reselected.
- Caret sync could select the wrong entity while typing, because it used the previous graph's
  offsets; a caret move is now held until the graph catches up.
- The JetBrains legend took no width and never showed; tooltips showed a literal `&middot;`.
- VS Code: a theme switch now recolours the graph; the explorer's *Show Catalog Graph* opens the
  file that was right-clicked; selecting YAML reuses the column it is open in.

## [2026.9.4]

### Added

- **VS Code extension** ([`editors/vscode`](editors/vscode)) — the catalog graph in a webview
  beside the descriptor, opened from the editor title bar, command palette or explorer context
  menu. Same layout, colours and interactions as the JetBrains plugin. Also installs in Cursor,
  Windsurf, VSCodium, Theia and Codespaces.
- **Cross-editor conformance corpus** ([`conformance/`](conformance/spec.md)) — a normative spec
  plus 18 cases with golden documents, run by both implementations in their own language and CI.
  A disagreement about what a descriptor means now fails a test.
- **JetBrains plugin** ([`editors/jetbrains`](editors/jetbrains)) — split `Text` / `Backstage
  Catalog` editor for `catalog-info.yaml`, entities laid out by kind, relations from every
  documented `spec` field, dashed placeholders for references the file does not declare, zoom,
  pan, neighbourhood highlighting, double-click to a declaration, and inline problem reporting.
- [`examples/`](examples/README.md) — ten scenarios doubling as the manual test plan, with
  expected counts asserted by both implementations.
- [`ROADMAP.md`](ROADMAP.md) — which editors come next, and the reasoning.
- `packageTestKit` (JetBrains) and `npm run package` (VS Code) build artifacts for testing on
  another machine.

### Changed

- Repository reorganised around `editors/<name>/`, `conformance/` and `examples/`. The JetBrains
  Gradle project moved to `editors/jetbrains/` unchanged; `examples/` and `conformance/` are
  shared and live at the root.

### Fixed

- The JetBrains graph no longer forces a PSI commit from `selectNotify` or the debounce alarm,
  which are write-unsafe contexts; opening a catalog file logged a SEVERE "Write-unsafe context"
  error naming the plugin. The rebuild now waits for the PSI to catch up.
