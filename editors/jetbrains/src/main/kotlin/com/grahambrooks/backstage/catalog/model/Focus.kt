package com.grahambrooks.backstage.catalog.model

/**
 * Focus mode: the drawn graph cut down to one entity and what it is drawn joined to, so a large
 * catalog can be read one neighbourhood at a time.
 *
 * Presentation only, like [OwnerBadges]. It works on the graph as drawn, so an entity joined to
 * the focus only by a folded `ownedBy` edge does not appear as a stray, edgeless box.
 */
object Focus {

    /**
     * [drawn] restricted to [ref], its neighbours along drawn edges, and [owned] -- the entities
     * [ref] owns when owners are badges, which carry its name. A [ref] that is not drawn leaves
     * the graph unchanged.
     */
    fun around(drawn: CatalogGraph, ref: EntityRef, owned: Set<EntityRef> = emptySet()): CatalogGraph {
        if (ref !in drawn.nodes) return drawn
        val keep = drawn.neighbourhoodOf(ref) + owned.filter { it in drawn.nodes }
        return drawn.copy(
            nodes = drawn.nodes.filterKeys { it in keep },
            edges = drawn.edges.filter { it.from in keep && it.to in keep },
        )
    }
}
