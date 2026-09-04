# Changelog

Versions are CalVer (`YYYY.M.D`) and are kept in step with the JetBrains plugin.

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
