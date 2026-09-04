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
  | 'dependencyOf';

export interface SpecRule {
  /** The `spec` field this rule reads. */
  readonly field: string;
  readonly relation: RelationType;
  /** Kind assumed when a reference omits its own, e.g. `owner: platform-team`. */
  readonly targetKind: string;
}

/** The whole relation table from `conformance/spec.md`, in the order it is documented. */
export const SPEC_RULES: readonly SpecRule[] = [
  { field: 'owner', relation: 'ownedBy', targetKind: 'group' },
  { field: 'system', relation: 'partOf', targetKind: 'system' },
  { field: 'domain', relation: 'partOf', targetKind: 'domain' },
  { field: 'subcomponentOf', relation: 'partOf', targetKind: 'component' },
  { field: 'parent', relation: 'childOf', targetKind: 'group' },
  { field: 'children', relation: 'parentOf', targetKind: 'group' },
  { field: 'members', relation: 'hasMember', targetKind: 'user' },
  { field: 'memberOf', relation: 'memberOf', targetKind: 'group' },
  { field: 'providesApis', relation: 'providesApi', targetKind: 'api' },
  { field: 'consumesApis', relation: 'consumesApi', targetKind: 'api' },
  { field: 'dependsOn', relation: 'dependsOn', targetKind: 'component' },
  { field: 'dependencyOf', relation: 'dependencyOf', targetKind: 'component' },
];
