# Changelog

All notable changes to the Backstage Catalog Graph plugin.
Versions are CalVer (`YYYY.M.D`).

## [Unreleased]

## [2026.9.4]

### Added

- Split `Text` / `Backstage Catalog` editor for `catalog-info.yaml` files.
- Entity graph built from every YAML document in the file, laid out by entity kind.
- Relations derived from `spec.owner`, `system`, `domain`, `subcomponentOf`, `parent`,
  `children`, `members`, `memberOf`, `providesApis`, `consumesApis`, `dependsOn` and
  `dependencyOf`.
- Dashed placeholder nodes for entities referenced by the file but declared elsewhere.
- Zoom, pan, neighbourhood highlighting, and double-click navigation to a declaration.
- Inline reporting of descriptor problems (missing `kind`, missing `metadata.name`,
  duplicate entities, unreadable references).
