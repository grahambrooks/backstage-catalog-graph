/**
 * The relation a descriptor field expresses, named as Backstage names it on the source side.
 *
 * Only the direction actually written in the descriptor is modelled. Backstage's catalog also
 * materialises the inverse of every relation, but drawing both would double every edge.
 */
export type RelationType =
  | 'ownedBy'
  | 'partOf'
  | 'parentOf'
  | 'childOf'
  | 'memberOf'
  | 'hasMember'
  | 'providesApi'
  | 'consumesApi'
  | 'dependsOn'
  | 'dependencyOf'
  /** Written by an alpha `AiResource` plugin's `skills` and a marketplace's `plugins`. */
  | 'hasPart';

export interface SpecRule {
  /** The `spec` field this rule reads. */
  readonly field: string;
  readonly relation: RelationType;
  /**
   * Kind assumed when a reference omits its own, e.g. `owner: platform-team`. Undefined means
   * the reference must name its kind, as Backstage requires for `dependsOn`.
   */
  readonly targetKind?: string;
  /** When present, the rule applies only to entities of these (lower-cased) kinds. */
  readonly kinds?: readonly string[];
}

/**
 * The whole relation table from `conformance/spec.md`, in the order it is documented. Where a
 * field means something different for one kind, that kind's rule comes first and wins.
 */
export const SPEC_RULES: readonly SpecRule[] = [
  { field: 'owner', relation: 'ownedBy', targetKind: 'group' },
  { field: 'system', relation: 'partOf', targetKind: 'system' },
  { field: 'domain', relation: 'partOf', targetKind: 'domain' },
  { field: 'subcomponentOf', relation: 'partOf', targetKind: 'component' },
  { field: 'subdomainOf', relation: 'partOf', targetKind: 'domain' },
  { field: 'parent', relation: 'childOf', targetKind: 'group' },
  { field: 'children', relation: 'parentOf', targetKind: 'group' },
  { field: 'members', relation: 'hasMember', targetKind: 'user' },
  { field: 'memberOf', relation: 'memberOf', targetKind: 'group' },
  { field: 'providesApis', relation: 'providesApi', targetKind: 'api' },
  { field: 'consumesApis', relation: 'consumesApi', targetKind: 'api' },
  { field: 'dependsOn', relation: 'dependsOn', targetKind: 'airesource', kinds: ['airesource'] },
  { field: 'dependsOn', relation: 'dependsOn' },
  { field: 'dependencyOf', relation: 'dependencyOf' },
  { field: 'skills', relation: 'hasPart', targetKind: 'airesource', kinds: ['airesource'] },
  { field: 'plugins', relation: 'hasPart', targetKind: 'airesource', kinds: ['airesource'] },
];

/** The rules that apply to an entity of `kind`: for each field, the first that matches. */
export function rulesFor(kind: string): SpecRule[] {
  const seen = new Set<string>();
  return SPEC_RULES.filter((rule) => {
    if ((rule.kinds && !rule.kinds.includes(kind)) || seen.has(rule.field)) {
      return false;
    }
    seen.add(rule.field);
    return true;
  });
}
