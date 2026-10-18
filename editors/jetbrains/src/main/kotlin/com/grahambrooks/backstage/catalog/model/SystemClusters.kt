package com.grahambrooks.backstage.catalog.model

/**
 * Which System each entity is drawn inside when Systems are containers.
 *
 * An entity belongs to the System it is `partOf` directly -- a Component, API or Resource with
 * `spec.system` -- or, for a subcomponent, to whatever System its parent Component belongs to.
 * Presentation only, like [OwnerBadges].
 */
object SystemClusters {

    fun of(graph: CatalogGraph): Map<EntityRef, EntityRef> {
        val parentOf = graph.edges
            .filter { it.type == RelationType.PART_OF && it.from != it.to }
            .groupBy({ it.from }, { it.to })

        fun systemOf(ref: EntityRef, visiting: Set<EntityRef>): EntityRef? {
            if (ref in visiting) return null
            for (parent in parentOf[ref].orEmpty()) {
                when (graph.nodes[parent]?.kind) {
                    EntityKind.SYSTEM -> return parent
                    EntityKind.COMPONENT -> systemOf(parent, visiting + ref)?.let { return it }
                    else -> Unit
                }
            }
            return null
        }

        return graph.nodes.values
            .filter { it.kind != EntityKind.SYSTEM }
            .mapNotNull { node -> systemOf(node.ref, emptySet())?.let { node.ref to it } }
            .toMap()
    }
}
