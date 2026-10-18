package com.grahambrooks.backstage.catalog.layout

import com.grahambrooks.backstage.catalog.model.CatalogGraph
import com.grahambrooks.backstage.catalog.model.CatalogNode
import com.grahambrooks.backstage.catalog.model.EntityRef
import com.grahambrooks.backstage.catalog.model.RelationType

/**
 * A Sugiyama-style layered layout, specialised for catalogs.
 *
 * Layers come from [com.grahambrooks.backstage.catalog.model.EntityKind.rank] rather than from
 * the longest path through the graph. A catalog has a conventional reading order -- Domain,
 * System, Component, API/Resource, then the Group and User that own them -- and holding to it
 * means the picture keeps its shape as entities are added, instead of reshuffling every time a
 * new edge changes the longest path.
 *
 * Within a layer, nodes are ordered by the barycentre heuristic to cut edge crossings.
 *
 * A layer that contains its own hierarchy -- Groups with a `parent`, Components with a
 * `subcomponentOf` -- is then drawn as several rows, parents above children, so those edges run
 * vertically instead of along a single row through their siblings. That split is presentation
 * only: the layer and its order, which the conformance contract pins, are unchanged.
 */
class LayeredLayout(
    private val sizer: NodeSizer,
    private val horizontalGap: Double = 32.0,
    private val verticalGap: Double = 84.0,
    private val margin: Double = 32.0,
    private val orderingSweeps: Int = 4,
    private val hierarchyGap: Double = 56.0,
) {

    fun layout(graph: CatalogGraph): GraphLayout {
        if (graph.isEmpty) return GraphLayout.EMPTY

        val layers = layerNodes(graph)
        val adjacency = adjacencyOf(graph)
        val ordered = orderLayers(layers, adjacency)

        return position(ordered, graph)
    }

    /** Buckets nodes by kind rank, dropping the ranks nothing lands in so there are no gaps. */
    private fun layerNodes(graph: CatalogGraph): List<List<CatalogNode>> =
        graph.nodes.values
            .groupBy { it.kind.rank }
            .toSortedMap()
            .values
            .map { layer -> layer.sortedWith(compareBy({ it.external }, { it.title.lowercase() })) }

    private fun adjacencyOf(graph: CatalogGraph): Map<EntityRef, List<EntityRef>> {
        val adjacency = mutableMapOf<EntityRef, MutableList<EntityRef>>()
        for (edge in graph.edges) {
            adjacency.getOrPut(edge.from) { mutableListOf() } += edge.to
            adjacency.getOrPut(edge.to) { mutableListOf() } += edge.from
        }
        return adjacency
    }

    /**
     * Alternating down and up barycentre sweeps. Each pass moves a node towards the average
     * position of its neighbours in the adjacent layer; nodes with no neighbour there keep the
     * position they had, which stops isolated entities from drifting to one edge.
     */
    private fun orderLayers(
        layers: List<List<CatalogNode>>,
        adjacency: Map<EntityRef, List<EntityRef>>,
    ): List<List<CatalogNode>> {
        var current = layers.map { it.toMutableList() }

        repeat(orderingSweeps) { sweep ->
            val indices = if (sweep % 2 == 0) current.indices else current.indices.reversed()
            for (index in indices) {
                val fixedIndex = if (sweep % 2 == 0) index - 1 else index + 1
                val fixed = current.getOrNull(fixedIndex) ?: continue
                val positions = fixed.withIndex().associate { (i, node) -> node.ref to i.toDouble() }

                current[index].sortWith(
                    compareBy { node ->
                        val neighbours = adjacency[node.ref].orEmpty().mapNotNull { positions[it] }
                        if (neighbours.isEmpty()) {
                            current[index].indexOfFirst { it.ref == node.ref }.toDouble()
                        } else {
                            neighbours.average()
                        }
                    },
                )
            }
            current = current.map { it.toMutableList() }
        }

        return current
    }

    /**
     * Splits one ordered layer into rows by hierarchy depth within the layer. Each row keeps the
     * layer's order, then a single barycentre pass against the row above puts children under
     * their parents; a node with no parent in that row keeps its index.
     */
    private fun hierarchyRows(layer: List<CatalogNode>, graph: CatalogGraph): List<List<CatalogNode>> {
        val inLayer = layer.map { it.ref }.toSet()
        val parents = mutableMapOf<EntityRef, MutableList<EntityRef>>()
        for (edge in graph.edges) {
            val (child, parent) = when (edge.type) {
                RelationType.PARENT_OF -> edge.to to edge.from
                RelationType.CHILD_OF, RelationType.PART_OF -> edge.from to edge.to
                else -> continue
            }
            if (child != parent && child in inLayer && parent in inLayer) {
                parents.getOrPut(child) { mutableListOf() } += parent
            }
        }
        if (parents.isEmpty()) return listOf(layer)

        val depths = mutableMapOf<EntityRef, Int>()
        fun depthOf(ref: EntityRef, visiting: Set<EntityRef>): Int {
            depths[ref]?.let { return it }
            // A cycle has no top; the node that closes it is treated as a root.
            if (ref in visiting) return 0
            val above = parents[ref].orEmpty()
            val depth = if (above.isEmpty()) 0 else 1 + above.maxOf { depthOf(it, visiting + ref) }
            depths[ref] = depth
            return depth
        }
        layer.forEach { depthOf(it.ref, emptySet()) }

        val rows = layer.groupBy { depths.getValue(it.ref) }.toSortedMap().values.map { it.toMutableList() }
        for (index in 1 until rows.size) {
            val positions = rows[index - 1].withIndex().associate { (i, node) -> node.ref to i.toDouble() }
            val current = rows[index].toList()
            rows[index].sortWith(
                compareBy { node ->
                    val above = parents[node.ref].orEmpty().mapNotNull { positions[it] }
                    if (above.isEmpty()) current.indexOf(node).toDouble() else above.average()
                },
            )
        }
        return rows
    }

    /** Packs each row left to right, then centres the rows on a common axis. */
    private fun position(layers: List<List<CatalogNode>>, graph: CatalogGraph): GraphLayout {
        val rows = mutableListOf<MutableList<NodeBounds>>()
        var y = margin
        var widest = 0.0

        for (layer in layers) {
            val split = hierarchyRows(layer, graph)
            split.forEachIndexed { index, nodes ->
                var x = 0.0
                var tallest = 0.0
                val row = mutableListOf<NodeBounds>()
                for (node in nodes) {
                    val (width, height) = sizer.size(node)
                    row += NodeBounds(node, x, y, width, height)
                    x += width + horizontalGap
                    tallest = maxOf(tallest, height)
                }
                val rowWidth = (x - horizontalGap).coerceAtLeast(0.0)
                widest = maxOf(widest, rowWidth)
                rows += row
                y += tallest + if (index < split.lastIndex) hierarchyGap else verticalGap
            }
        }

        val positioned = mutableMapOf<EntityRef, NodeBounds>()
        for (row in rows) {
            val rowWidth = row.lastOrNull()?.right ?: 0.0
            val offset = margin + (widest - rowWidth) / 2
            for (bounds in row) {
                positioned[bounds.node.ref] = bounds.copy(x = bounds.x + offset)
            }
        }

        val height = (y - verticalGap + margin).coerceAtLeast(0.0)
        return GraphLayout(positioned, widest + margin * 2, height, layers.map { layer -> layer.map { it.ref } })
    }
}
