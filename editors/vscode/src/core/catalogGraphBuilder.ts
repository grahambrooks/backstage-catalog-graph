import {
  CatalogEdge,
  CatalogGraph,
  CatalogNode,
  CatalogProblem,
  keyOf,
} from './catalogGraph';
import { kindOf } from './entityKind';
import { DEFAULT_NAMESPACE, EntityRef, normalizeKind, parseRef, shortLabel } from './entityRef';
import { SPEC_RULES } from './relationType';
import { RawDocument } from './rawDocument';

/**
 * Turns the YAML documents of a `catalog-info.yaml` into a `CatalogGraph`.
 *
 * Behaviour is specified by `conformance/spec.md` and pinned by the shared corpus; this is one
 * of two implementations of it. Two things it deliberately does not do:
 *
 *  - resolve references against a running Backstage catalog, or against other files in the
 *    workspace. Anything this file references but does not declare becomes an external
 *    placeholder, which is what makes the picture honest about the file's boundary.
 *  - reject a bad document. Unparseable entities are reported as problems and the rest of the
 *    file still renders.
 */
export function buildCatalogGraph(documents: readonly RawDocument[]): CatalogGraph {
  const problems: CatalogProblem[] = [];
  const nodes = new Map<string, CatalogNode>();
  const edges: CatalogEdge[] = [];
  const pending: Array<{ document: RawDocument; ref: EntityRef }> = [];

  // Pass 1 -- everything this file declares. Done first so pass 2 can tell a reference to a
  // local entity from a reference that leaves the file.
  for (const document of documents) {
    const ref = refOf(document, problems);
    if (!ref) {
      continue;
    }
    const key = keyOf(ref);
    if (nodes.has(key)) {
      problems.push({
        message: `Duplicate entity ${shortLabel(ref)} -- the later definition is shown`,
        sourceOffset: document.offset,
      });
    }
    // `set` on an existing key replaces the value and keeps the original position, which is
    // what the reference implementation's LinkedHashMap does. The later declaration wins.
    nodes.set(key, nodeOf(document, ref));
    pending.push({ document, ref });
  }

  // Pass 2 -- relations, creating a placeholder for every target this file does not declare.
  const seen = new Set<string>();
  for (const { document, ref } of pending) {
    const spec = mapAt(document.data, 'spec');
    if (!spec) {
      continue;
    }
    for (const rule of SPEC_RULES) {
      for (const raw of stringsAt(spec, rule.field)) {
        const target = parseRef(raw, rule.targetKind, ref.namespace);
        if (!target) {
          problems.push({
            message:
              `${shortLabel(ref)}: cannot read "${raw}" in spec.${rule.field} ` +
              'as an entity reference',
            sourceOffset: document.offset,
          });
          continue;
        }
        const targetKey = keyOf(target);
        if (!nodes.has(targetKey)) {
          nodes.set(targetKey, placeholderFor(target));
        }
        const edge: CatalogEdge = { from: keyOf(ref), to: targetKey, type: rule.relation };
        const signature = `${edge.from}|${edge.to}|${edge.type}`;
        if (!seen.has(signature)) {
          seen.add(signature);
          edges.push(edge);
        }
      }
    }
  }

  return { nodes, edges, problems };
}

function refOf(document: RawDocument, problems: CatalogProblem[]): EntityRef | undefined {
  const kind = stringAt(document.data, 'kind');
  if (!kind || kind.trim().length === 0) {
    problems.push({
      message: 'Document has no `kind` and was skipped',
      sourceOffset: document.offset,
    });
    return undefined;
  }

  const metadata = mapAt(document.data, 'metadata');
  const name = metadata ? stringAt(metadata, 'name') : undefined;
  if (!name || name.trim().length === 0) {
    problems.push({
      message: `${kind} has no \`metadata.name\` and was skipped`,
      sourceOffset: document.offset,
    });
    return undefined;
  }

  const declared = metadata ? stringAt(metadata, 'namespace') : undefined;
  const namespace =
    declared && declared.trim().length > 0 ? declared : DEFAULT_NAMESPACE;

  return {
    kind: normalizeKind(kind),
    namespace: namespace.toLowerCase(),
    name: name.toLowerCase(),
  };
}

function nodeOf(document: RawDocument, ref: EntityRef): CatalogNode {
  const metadata = mapAt(document.data, 'metadata');
  const spec = mapAt(document.data, 'spec');
  const title = metadata ? stringAt(metadata, 'title') : undefined;
  const name = metadata ? stringAt(metadata, 'name') : undefined;

  return {
    ref,
    kind: kindOf(ref.kind),
    title: title && title.trim().length > 0 ? title : (name ?? ref.name),
    description: metadata ? stringAt(metadata, 'description') : undefined,
    type: spec ? stringAt(spec, 'type') : undefined,
    lifecycle: spec ? stringAt(spec, 'lifecycle') : undefined,
    tags: metadata ? stringsAt(metadata, 'tags') : [],
    external: false,
    sourceOffset: document.offset,
  };
}

function placeholderFor(ref: EntityRef): CatalogNode {
  return {
    ref,
    kind: kindOf(ref.kind),
    title: ref.name,
    tags: [],
    external: true,
  };
}

// --- Untyped-YAML accessors ---------------------------------------------------------------
// Everything below tolerates the wrong shape rather than throwing: a descriptor with
// `tags: production` instead of a list should still draw. See "Tolerance" in the spec.

type Untyped = Record<string, unknown>;

function mapAt(data: Untyped, key: string): Untyped | undefined {
  const value = data[key];
  return isPlainObject(value) ? value : undefined;
}

function stringAt(data: Untyped, key: string): string | undefined {
  const value = data[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

/** Reads a field that may be a single scalar or a list of them, and skips anything else. */
function stringsAt(data: Untyped, key: string): string[] {
  const value = data[key];
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function isPlainObject(value: unknown): value is Untyped {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
