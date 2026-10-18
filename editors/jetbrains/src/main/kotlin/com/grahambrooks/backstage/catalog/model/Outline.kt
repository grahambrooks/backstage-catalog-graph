package com.grahambrooks.backstage.catalog.model

/** One relation as the outline lists it under an entity: which way it points, and to what. */
data class OutlineRelation(val type: RelationType, val outgoing: Boolean, val other: CatalogNode)

data class OutlineEntity(val node: CatalogNode, val relations: List<OutlineRelation>)

data class OutlineSection(val kind: EntityKind, val entities: List<OutlineEntity>)

/**
 * The outline view: the graph as a tree of kind, entity, then each relation in or out. It reads
 * at any size, which the picture of a large catalog does not.
 *
 * Kinds come in layer order. Entities are declared first, then placeholders, each by title.
 * Under an entity, relations it declares come before those pointing at it, each by relation
 * then by the other end's title. Titles compare by UTF-16 code unit, as the layout does, so the
 * two editors list things in the same order.
 */
object Outline {

    fun of(graph: CatalogGraph): List<OutlineSection> {
        val byTitle = compareBy<CatalogNode>({ it.external }, { it.title.lowercase() }, { it.ref.toString() })
        return graph.nodes.values
            .groupBy { it.kind }
            .toSortedMap(compareBy({ it.rank }, { it.displayName }))
            .map { (kind, nodes) ->
                OutlineSection(
                    kind = kind,
                    entities = nodes.sortedWith(byTitle).map { node -> OutlineEntity(node, relationsOf(graph, node)) },
                )
            }
    }

    private fun relationsOf(graph: CatalogGraph, node: CatalogNode): List<OutlineRelation> =
        graph.edges.mapNotNull { edge ->
            when (node.ref) {
                edge.from -> graph.nodes[edge.to]?.let { OutlineRelation(edge.type, outgoing = true, other = it) }
                edge.to -> graph.nodes[edge.from]?.let { OutlineRelation(edge.type, outgoing = false, other = it) }
                else -> null
            }
        }.sortedWith(compareBy({ !it.outgoing }, { it.type.ordinal }, { it.other.title.lowercase() }, { it.other.ref.toString() }))
}
