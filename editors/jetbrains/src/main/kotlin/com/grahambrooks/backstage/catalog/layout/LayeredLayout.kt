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
    /** Rows wider than this wrap onto several; null never wraps. See [wrap]. */
    private val maxRowWidth: Double? = null,
    /**
     * Entity to the System drawn as its container; empty draws no containers. Presentation
     * only, like the row splits -- the logical layers are unchanged.
     */
    private val clusters: Map<EntityRef, EntityRef> = emptyMap(),
    private val clusterPadding: Double = 14.0,
    private val clusterGap: Double = 40.0,
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

    /**
     * Splits a row wider than [maxRowWidth] into balanced rows, keeping its order. Off when
     * Systems are drawn as containers: their columns already narrow each System, and wrapping
     * inside a column would break the box.
     */
    private fun wrap(row: List<CatalogNode>, sizes: Map<EntityRef, Pair<Double, Double>>, clustered: Boolean): List<List<CatalogNode>> {
        val limit = maxRowWidth ?: return listOf(row)
        if (clustered || row.size < 2) return listOf(row)
        val width = packedWidth(row, sizes)
        if (width <= limit) return listOf(row)
        // Width alone underestimates: balanced chunks round up, so add rows until each one fits.
        var count = kotlin.math.ceil(width / limit).toInt()
        while (true) {
            val chunks = chunked(row, count)
            if (count >= row.size || chunks.all { packedWidth(it, sizes) <= limit }) return chunks
            count++
        }
    }

    /** [row] in [count] consecutive chunks whose sizes differ by at most one, larger first. */
    private fun chunked(row: List<CatalogNode>, count: Int): List<List<CatalogNode>> {
        val base = row.size / count
        val extra = row.size % count
        var start = 0
        return List(count) { index ->
            val size = base + if (index < extra) 1 else 0
            row.subList(start, start + size).also { start += size }
        }
    }

    private fun packedWidth(nodes: List<CatalogNode>, sizes: Map<EntityRef, Pair<Double, Double>>): Double =
        if (nodes.isEmpty()) 0.0 else nodes.sumOf { sizes.getValue(it.ref).first } + horizontalGap * (nodes.size - 1)

    /** Lays [nodes] left to right from [startX], returning their bounds. */
    private fun pack(nodes: List<CatalogNode>, startX: Double, y: Double, sizes: Map<EntityRef, Pair<Double, Double>>): List<NodeBounds> {
        var x = startX
        return nodes.map { node ->
            val (width, height) = sizes.getValue(node.ref)
            NodeBounds(node, x, y, width, height).also { x += width + horizontalGap }
        }
    }

    /**
     * Places every row. Without containers each row is packed and centred on a common axis.
     *
     * With containers, each System that has members gets a column, in the order the Systems
     * sit in their layer, and every row from the first containing a member to the last puts that
     * System's nodes in its column -- the header in the System row, members below -- so the
     * boxes never overlap. Nodes outside any System share a column on the right. Rows above and
     * below that span are centred as usual.
     */
    private fun position(layers: List<List<CatalogNode>>, graph: CatalogGraph): GraphLayout {
        val sizes = graph.nodes.values.associate { it.ref to sizer.size(it) }

        val systems = clusters.values.filter { it in graph.nodes }.toSet()
        val clusterOf: (CatalogNode) -> EntityRef? = { node ->
            clusters[node.ref]?.takeIf { it in systems } ?: node.ref.takeIf { it in systems }
        }
        val columns = layers.flatten().map { it.ref }.filter { it in systems }

        class Row(val nodes: List<CatalogNode>, val gapAfter: Double)
        val rows = mutableListOf<Row>()
        for (layer in layers) {
            val split = hierarchyRows(layer, graph).flatMap { wrap(it, sizes, columns.isNotEmpty()) }
            split.forEachIndexed { index, nodes ->
                rows += Row(nodes, if (index < split.lastIndex) hierarchyGap else verticalGap)
            }
        }

        val clusteredRows = rows.indices.filter { index -> rows[index].nodes.any { clusterOf(it) != null } }
        val span = if (clusteredRows.isEmpty()) IntRange.EMPTY else clusteredRows.first()..clusteredRows.last()

        val columnWidth = columns.associateWith { system ->
            span.maxOf { index -> packedWidth(rows[index].nodes.filter { clusterOf(it) == system }, sizes) }
        }
        val freeWidth = span.maxOfOrNull { index -> packedWidth(rows[index].nodes.filter { clusterOf(it) == null }, sizes) } ?: 0.0

        val columnStart = mutableMapOf<EntityRef, Double>()
        var cursor = 0.0
        for (system in columns) {
            columnStart[system] = cursor
            cursor += columnWidth.getValue(system) + clusterPadding * 2 + clusterGap
        }
        val freeStart = cursor
        val spanWidth = if (columns.isEmpty()) 0.0 else if (freeWidth > 0) freeStart + freeWidth else cursor - clusterGap

        val placed = mutableListOf<List<NodeBounds>>()
        var y = margin
        var widest = spanWidth
        for ((index, row) in rows.withIndex()) {
            if (index in span) {
                val bounds = mutableListOf<NodeBounds>()
                for (system in columns) {
                    val group = row.nodes.filter { clusterOf(it) == system }
                    val inner = columnWidth.getValue(system)
                    bounds += pack(group, columnStart.getValue(system) + clusterPadding + (inner - packedWidth(group, sizes)) / 2, y, sizes)
                }
                val free = row.nodes.filter { clusterOf(it) == null }
                bounds += pack(free, freeStart + (freeWidth - packedWidth(free, sizes)) / 2, y, sizes)
                placed += bounds
            } else {
                val bounds = pack(row.nodes, 0.0, y, sizes)
                widest = maxOf(widest, packedWidth(row.nodes, sizes))
                placed += bounds
            }
            y += (row.nodes.maxOfOrNull { sizes.getValue(it.ref).second } ?: 0.0) + row.gapAfter
        }

        // Rows outside the container span are centred; rows inside it already use its columns.
        val positioned = mutableMapOf<EntityRef, NodeBounds>()
        for ((index, row) in placed.withIndex()) {
            val offset = if (index in span) {
                margin + (widest - spanWidth) / 2
            } else {
                margin + (widest - packedWidth(rows[index].nodes, sizes)) / 2
            }
            for (bounds in row) positioned[bounds.node.ref] = bounds.copy(x = bounds.x + offset)
        }

        val spanOffset = margin + (widest - spanWidth) / 2
        val boxes = columns.map { system ->
            val members = positioned.values.filter { clusterOf(it.node) == system }
            val top = members.minOf { it.y } - clusterPadding
            val bottom = members.maxOf { it.bottom } + clusterPadding
            ClusterBox(
                system = system,
                x = columnStart.getValue(system) + spanOffset,
                y = top,
                width = columnWidth.getValue(system) + clusterPadding * 2,
                height = bottom - top,
            )
        }

        val height = (y - verticalGap + margin).coerceAtLeast(0.0)
        return GraphLayout(
            nodes = positioned,
            width = widest + margin * 2,
            height = height,
            layers = layers.map { layer -> layer.map { it.ref } },
            clusters = boxes,
        )
    }
}
