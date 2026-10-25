# Changelog

Versions are CalVer (`YYYY.M.D`) and are kept in step with the JetBrains plugin.

## [2026.10.24]

### Added

- An extension icon, and screenshots and install instructions in the README.

### Changed

- Distributed through GitHub Releases, with a `SHA256SUMS` file and build-provenance
  attestations.

## [2026.10.18]

### Added

- Owners shown as badges on their entities instead of `ownedBy` edges (setting
  `backstageCatalogGraph.ownersAsBadges`, default on), and edges coloured by relation.
- **Group by System**, **Focus** and **Outline** views in the toolbar.
- **Find entity** box, and two-way sync: the caret selects the entity under it, and clicking a
  node selects the YAML that defines it.
- Keyboard navigation: arrows, Enter, Escape, + − 0.
- A clickable problems list that jumps to each problem.
- The alpha `AiResource` kind and its `skills`/`plugins` (`hasPart`) and `dependsOn` fields, and
  `Domain.spec.subdomainOf`.

### Changed

- Team and subcomponent hierarchies drawn as rows, parents above children; edges routed around
  nodes; very wide rows wrap; zoom out to 10%.
- Faster focus moves and redraws on large files, and a focus move keeps the zoom when the
  neighbourhood fits.
- A bare `dependsOn` reference is now reported as needing a kind, as Backstage requires,
  instead of being assumed to be a Component — on every kind except `AiResource`, where it means
  another `AiResource`. A bare `dependencyOf` reference always needs a kind.

### Fixed

- Clicking a node did nothing, because the pan handler captured the pointer.
- Finishing a pan no longer clears the selection.
- Editing the selected entity's relations no longer leaves its highlight or Find's count stale.
- Caret sync no longer picks the wrong entity while you type.
- Switching theme recolours the graph.
- *Show Catalog Graph* from the explorer opens the file you right-clicked.
- Selecting an entity's YAML reuses the column the file is open in.

## [2026.9.4]

### Added

- First release. Catalog graph in a webview beside the descriptor, opened from the editor title
  bar, the command palette or the explorer context menu.
- Entities laid out by kind (Domain → System → Component → API/Resource → Group → User), with
  every `spec` reference drawn as a labelled edge.
- Dashed placeholder nodes for entities referenced by the file but declared elsewhere.
- Live redraw as you type, zoom, pan, neighbourhood highlighting, and double-click to jump to a
  declaration.
- Descriptor problems reported in the toolbar instead of an empty graph.
- Passes the cross-editor conformance corpus, so the graph matches the JetBrains plugin's
  reading of the same file.
