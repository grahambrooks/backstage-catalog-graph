/**
 * Decides which files get a catalog graph.
 *
 * Backstage itself accepts any filename -- a location can point anywhere -- but offering the
 * graph on every YAML file in a workspace would be noise. These are the names the catalog
 * conventionally uses, plus the `*.catalog-info.yaml` form that repositories with several
 * entities tend to adopt. Mirrors `CatalogInfoFiles` in the JetBrains implementation.
 */
const EXTENSIONS = new Set(['yaml', 'yml']);
const PREFIXED_BASE_NAMES = new Set(['catalog-all', 'catalog-entities']);

export function isCatalogFileName(fileName: string): boolean {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot < 0) {
    return false;
  }
  const extension = fileName.slice(lastDot + 1).toLowerCase();
  if (!EXTENSIONS.has(extension)) {
    return false;
  }
  return matchesBaseName(fileName.slice(0, lastDot));
}

export function matchesBaseName(nameWithoutExtension: string): boolean {
  const name = nameWithoutExtension.toLowerCase();
  if (name === 'catalog-info') {
    return true;
  }
  if (name.endsWith('.catalog-info')) {
    return true;
  }
  return PREFIXED_BASE_NAMES.has(name);
}
