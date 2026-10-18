package com.grahambrooks.backstage.catalog.model

/**
 * The relation a descriptor field expresses, named as Backstage names it on the source side.
 *
 * Only the direction actually written in the descriptor is modelled. Backstage's catalog also
 * materialises the inverse of every relation, but drawing both would double every edge.
 */
enum class RelationType(val displayName: String) {
    OWNED_BY("ownedBy"),
    PART_OF("partOf"),
    PARENT_OF("parentOf"),
    CHILD_OF("childOf"),
    MEMBER_OF("memberOf"),
    HAS_MEMBER("hasMember"),
    PROVIDES_API("providesApi"),
    CONSUMES_API("consumesApi"),
    DEPENDS_ON("dependsOn"),
    DEPENDENCY_OF("dependencyOf"),

    /** Written by an alpha `AiResource` plugin's `skills` and a marketplace's `plugins`. */
    HAS_PART("hasPart"),
}
