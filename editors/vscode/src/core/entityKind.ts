/**
 * The entity kinds defined by the Backstage descriptor format, plus `Entity` for anything a
 * custom processor may add.
 *
 * `rank` drives the vertical layering of the graph: lower ranks are drawn nearer the top, so a
 * Domain sits above its Systems, which sit above their Components.
 */
export interface EntityKind {
  readonly displayName: string;
  readonly rank: number;
}

export const ENTITY_KINDS = {
  DOMAIN: { displayName: 'Domain', rank: 0 },
  SYSTEM: { displayName: 'System', rank: 1 },
  COMPONENT: { displayName: 'Component', rank: 2 },
  API: { displayName: 'API', rank: 3 },
  RESOURCE: { displayName: 'Resource', rank: 3 },
  GROUP: { displayName: 'Group', rank: 4 },
  USER: { displayName: 'User', rank: 5 },
  TEMPLATE: { displayName: 'Template', rank: 2 },
  // Alpha (Backstage 1.51+, `catalog-backend-module-ai-model`): skills, rules, plugins and
  // marketplaces for AI coding tools. Part of a System like an API or Resource, so it shares
  // their layer.
  AI_RESOURCE: { displayName: 'AiResource', rank: 3 },
  LOCATION: { displayName: 'Location', rank: 6 },
  OTHER: { displayName: 'Entity', rank: 6 },
} as const satisfies Record<string, EntityKind>;

const BY_ID = new Map<string, EntityKind>(
  Object.values(ENTITY_KINDS).map((kind) => [kind.displayName.toLowerCase(), kind]),
);

export function kindOf(kind: string): EntityKind {
  return BY_ID.get(kind.trim().toLowerCase()) ?? ENTITY_KINDS.OTHER;
}
