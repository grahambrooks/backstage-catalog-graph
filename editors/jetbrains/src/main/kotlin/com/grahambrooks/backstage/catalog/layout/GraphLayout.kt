package com.grahambrooks.backstage.catalog.layout

import com.grahambrooks.backstage.catalog.model.CatalogNode
import com.grahambrooks.backstage.catalog.model.EntityRef

/** Where one node ended up, in graph coordinates (pixels before zoom and pan). */
data class NodeBounds(
    val node: CatalogNode,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
) {
    val centerX: Double get() = x + width / 2
    val centerY: Double get() = y + height / 2
    val bottom: Double get() = y + height
    val right: Double get() = x + width

    operator fun contains(point: Pair<Double, Double>): Boolean =
        point.first in x..right && point.second in y..bottom
}

/** The positioned graph, plus the extent needed to show all of it. */
data class GraphLayout(
    val nodes: Map<EntityRef, NodeBounds>,
    val width: Double,
    val height: Double,
) {
    fun at(point: Pair<Double, Double>): NodeBounds? = nodes.values.firstOrNull { point in it }

    companion object {
        val EMPTY = GraphLayout(emptyMap(), 0.0, 0.0)
    }
}

/** How wide and tall a node should be drawn. Supplied by the UI so text measurement stays there. */
fun interface NodeSizer {
    fun size(node: CatalogNode): Pair<Double, Double>
}
