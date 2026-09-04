/**
 * A resolved reference to a catalog entity.
 *
 * Backstage writes references in the compact form `[<kind>:][<namespace>/]<name>`, where the
 * missing parts are filled in from context. `parseRef` does that filling-in so that two
 * spellings of the same entity compare equal once formatted.
 */
export interface EntityRef {
  readonly kind: string;
  readonly namespace: string;
  readonly name: string;
}

export const DEFAULT_NAMESPACE = 'default';

/** Canonical `kind:namespace/name`, always lower case -- Backstage refs are case-insensitive. */
export function formatRef(ref: EntityRef): string {
  return `${ref.kind}:${ref.namespace}/${ref.name}`;
}

/** The shortest spelling that is still unambiguous in the default namespace. */
export function shortLabel(ref: EntityRef): string {
  return ref.namespace === DEFAULT_NAMESPACE ? `${ref.kind}:${ref.name}` : formatRef(ref);
}

/**
 * Canonical lower-case kind. Kept as its own function so the display side and the identity side
 * agree on one spelling.
 */
export function normalizeKind(kind: string): string {
  return kind.trim().toLowerCase();
}

/**
 * Parses `text`, filling in `defaultKind` and `defaultNamespace` for the parts it omits.
 *
 * Returns `undefined` for text that cannot be a reference (blank, or containing whitespace),
 * which keeps malformed descriptors from producing phantom nodes.
 */
export function parseRef(
  text: string,
  defaultKind: string,
  defaultNamespace: string = DEFAULT_NAMESPACE,
): EntityRef | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) {
    return undefined;
  }

  const colon = trimmed.indexOf(':');
  const kind = colon >= 0 ? trimmed.slice(0, colon) : defaultKind;
  const rest = colon >= 0 ? trimmed.slice(colon + 1) : trimmed;

  const slash = rest.indexOf('/');
  const namespace = slash >= 0 ? rest.slice(0, slash) : defaultNamespace;
  const name = slash >= 0 ? rest.slice(slash + 1) : rest;

  if (isBlank(kind) || isBlank(namespace) || isBlank(name)) {
    return undefined;
  }

  return {
    kind: normalizeKind(kind),
    namespace: namespace.toLowerCase(),
    name: name.toLowerCase(),
  };
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}
