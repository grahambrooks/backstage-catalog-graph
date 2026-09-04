package com.grahambrooks.backstage.catalog.model

/**
 * A node in the rendered graph.
 *
 * Nodes come from two places. Entities *declared* in the file being viewed carry their metadata
 * and the offset of their YAML document, so clicking one can move the caret. Entities merely
 * *referenced* by those declarations -- an owner defined in another repository, a system owned by
 * a different team -- have no declaration to point at, and are marked [external]. Rendering those
 * as placeholders rather than dropping them is the point of the graph: it shows what this file
 * depends on but does not define.
 */
data class CatalogNode(
    val ref: EntityRef,
    val kind: EntityKind,
    /** Human-facing label: `metadata.title` where present, otherwise `metadata.name`. */
    val title: String,
    val description: String? = null,
    /** `spec.type`, e.g. `service`, `library`, `openapi`. */
    val type: String? = null,
    /** `spec.lifecycle`, e.g. `production`, `experimental`. */
    val lifecycle: String? = null,
    val tags: List<String> = emptyList(),
    val external: Boolean = false,
    /** Character offset of the entity's YAML document, or `null` for [external] nodes. */
    val sourceOffset: Int? = null,
)

/** A directed relation between two nodes, as written in the source entity's `spec`. */
data class CatalogEdge(
    val from: EntityRef,
    val to: EntityRef,
    val type: RelationType,
) {
    /** True when either end is missing from the file -- drawn as a dashed edge. */
    fun isDangling(nodes: Map<EntityRef, CatalogNode>): Boolean =
        nodes[from]?.external == true || nodes[to]?.external == true
}

/**
 * A problem found while reading the descriptor. Surfaced in the graph panel rather than thrown,
 * so that a half-valid file still renders the entities it does get right.
 */
data class CatalogProblem(
    val message: String,
    val sourceOffset: Int? = null,
)

/** The whole picture: every entity to draw, every relation between them, and what went wrong. */
data class CatalogGraph(
    val nodes: Map<EntityRef, CatalogNode>,
    val edges: List<CatalogEdge>,
    val problems: List<CatalogProblem> = emptyList(),
) {
    val declaredNodes: List<CatalogNode> get() = nodes.values.filter { !it.external }
    val externalNodes: List<CatalogNode> get() = nodes.values.filter { it.external }

    val isEmpty: Boolean get() = nodes.isEmpty()

    /** Every node directly joined to [ref] in either direction, plus [ref] itself. */
    fun neighbourhoodOf(ref: EntityRef): Set<EntityRef> =
        edges.asSequence()
            .filter { it.from == ref || it.to == ref }
            .flatMap { sequenceOf(it.from, it.to) }
            .toMutableSet()
            .apply { add(ref) }

    companion object {
        val EMPTY = CatalogGraph(emptyMap(), emptyList())
    }
}
