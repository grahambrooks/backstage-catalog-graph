package com.grahambrooks.backstage.catalog.model

/**
 * The entity kinds defined by the Backstage descriptor format, plus [OTHER] for anything a
 * custom processor may add.
 *
 * [rank] drives the vertical layering of the graph: lower ranks are drawn nearer the top, so a
 * Domain sits above its Systems, which sit above their Components.
 */
enum class EntityKind(
    val displayName: String,
    val rank: Int,
) {
    DOMAIN("Domain", 0),
    SYSTEM("System", 1),
    COMPONENT("Component", 2),
    API("API", 3),
    RESOURCE("Resource", 3),
    GROUP("Group", 4),
    USER("User", 5),
    TEMPLATE("Template", 2),
    LOCATION("Location", 6),
    OTHER("Entity", 6),
    ;

    companion object {
        private val byId = entries.associateBy { it.displayName.lowercase() }

        fun of(kind: String): EntityKind = byId[EntityRef.normalizeKind(kind)] ?: OTHER
    }
}
