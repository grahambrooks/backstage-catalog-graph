# Changelog

Notable changes across all editor implementations. Versions are CalVer (`YYYY.M.D`) and are kept
in step between editors. The VS Code extension also carries
[its own changelog](editors/vscode/CHANGELOG.md), because the marketplace displays it.

## [Unreleased]

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
