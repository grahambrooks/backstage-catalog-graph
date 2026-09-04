import { parseAllDocuments } from 'yaml';
import { RawDocument } from './rawDocument';

/**
 * Reduces a `catalog-info.yaml` to the plain objects the core works on.
 *
 * The `yaml` package is used rather than a JSON-ish shortcut because it keeps each document's
 * character range, which is what lets a node in the graph carry the caret back to its
 * declaration. A document that is not a mapping is dropped -- a comment-only file is not a
 * broken file.
 */
export function readDocuments(text: string): RawDocument[] {
  const documents: RawDocument[] = [];

  for (const document of parseAllDocuments(text)) {
    // Syntax errors are left to the editor's own YAML support to report; a document that will
    // not parse simply contributes nothing to the graph.
    if (document.errors.length > 0) {
      continue;
    }
    const data: unknown = document.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
    if (!isPlainObject(data)) {
      continue;
    }
    documents.push({ data, offset: document.range?.[0] ?? 0 });
  }

  return documents;
}

/**
 * Anchors and aliases are legal YAML and appear in hand-written catalogs, but an unbounded
 * alias count is how a small file expands into gigabytes. This is well above anything a real
 * descriptor uses.
 */
const MAX_ALIAS_COUNT = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
