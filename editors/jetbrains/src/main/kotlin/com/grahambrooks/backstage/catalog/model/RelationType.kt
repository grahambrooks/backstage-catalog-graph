package com.grahambrooks.backstage.catalog.model

/**
 * The relation a descriptor field expresses, named as Backstage names it on the source side.
 *
 * Only the direction actually written in the descriptor is modelled. Backstage's catalog also
 * materialises the inverse of every relation, but drawing both would double every edge.
 */
enum class RelationType(
    val displayName: String,
    /** Kind assumed when a reference omits its kind, e.g. `owner: platform-team`. */
    val defaultTargetKind: String,
) {
    OWNED_BY("ownedBy", "group"),
    PART_OF("partOf", "system"),
    PARENT_OF("parentOf", "group"),
    CHILD_OF("childOf", "group"),
    MEMBER_OF("memberOf", "group"),
    HAS_MEMBER("hasMember", "user"),
    PROVIDES_API("providesApi", "api"),
    CONSUMES_API("consumesApi", "api"),
    DEPENDS_ON("dependsOn", "component"),
    DEPENDENCY_OF("dependencyOf", "component"),
}
