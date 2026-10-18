package com.grahambrooks.backstage.catalog.model

/**
 * The graph as drawn when owners are shown as badges on their entities rather than as edges.
 *
 * `ownedBy` is usually the most common relation in a descriptor, and every one of those edges
 * runs from a Component or API all the way down to the Group layer, crossing everything in
 * between. Folding them into a badge removes the worst of the clutter without losing the fact.
 *
 * This is presentation only: the conformance contract is the unfolded graph.
 */
data class OwnerBadges(
    /** The graph left to lay out: no `ownedBy` edges, and no placeholder that existed only as an owner. */
    val graph: CatalogGraph,
    /** Owners of each entity, in edge order. Entities with no owner are absent. */
    val owners: Map<EntityRef, List<CatalogNode>>,
) {
    companion object {
        fun fold(graph: CatalogGraph): OwnerBadges {
            val owners = graph.edges
                .filter { it.type == RelationType.OWNED_BY }
                .mapNotNull { edge -> graph.nodes[edge.to]?.let { edge.from to it } }
                .groupBy({ it.first }, { it.second })

            val remaining = graph.edges.filter { it.type != RelationType.OWNED_BY }
            val stillJoined = remaining.flatMap { listOf(it.from, it.to) }.toSet()
            val ownerOnly = owners.values.flatten()
                .filter { it.external && it.ref !in stillJoined }
                .map { it.ref }
                .toSet()

            return OwnerBadges(
                graph = graph.copy(
                    nodes = graph.nodes.filterKeys { it !in ownerOnly },
                    edges = remaining,
                ),
                owners = owners,
            )
        }
    }
}
