package com.grahambrooks.backstage.catalog.layout

import com.grahambrooks.backstage.catalog.Fixtures
import com.grahambrooks.backstage.catalog.model.CatalogEdge
import com.grahambrooks.backstage.catalog.model.CatalogGraph
import com.grahambrooks.backstage.catalog.model.CatalogGraphBuilder
import com.grahambrooks.backstage.catalog.model.CatalogNode
import com.grahambrooks.backstage.catalog.model.EntityKind
import com.grahambrooks.backstage.catalog.model.EntityRef
import com.grahambrooks.backstage.catalog.model.RelationType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LayeredLayoutTest {

    private val graph = CatalogGraphBuilder.build(Fixtures.load("catalog-info.yaml"))
    private val layout = LayeredLayout(sizer = { node -> 180.0 + node.title.length to 52.0 })
        .layout(graph)

    @Test
    fun `every node is placed`() {
        assertEquals(graph.nodes.keys, layout.nodes.keys)
    }

    @Test
    fun `layers follow the conventional catalog reading order`() {
        // Every node of a kind shares its layer's y, so `distinct().single()` also asserts
        // that a kind is never split across layers.
        val yByKind = layout.nodes.values.groupBy({ it.node.kind }, { it.y })
        val systemY = yByKind.getValue(EntityKind.SYSTEM).distinct().single()
        val componentY = yByKind.getValue(EntityKind.COMPONENT).distinct().single()
        val apiY = yByKind.getValue(EntityKind.API).distinct().single()
        val userY = yByKind.getValue(EntityKind.USER).distinct().single()

        assertTrue(systemY < componentY, "System should sit above Component")
        assertTrue(componentY < apiY, "Component should sit above API")
        assertTrue(apiY < userY, "API should sit above User")
    }

    @Test
    fun `API and Resource share a layer because they share a rank`() {
        val apiY = layout.nodes.values.first { it.node.kind == EntityKind.API }.y
        val resourceY = layout.nodes.values.first { it.node.kind == EntityKind.RESOURCE }.y
        assertEquals(apiY, resourceY)
    }

    @Test
    fun `nodes in the same layer do not overlap`() {
        layout.nodes.values.groupBy { it.y }.values.forEach { row ->
            val sorted = row.sortedBy { it.x }
            sorted.zipWithNext { left, right ->
                assertTrue(left.right <= right.x, "${left.node.title} overlaps ${right.node.title}")
            }
        }
    }

    @Test
    fun `the reported extent contains every node`() {
        layout.nodes.values.forEach {
            assertTrue(it.right <= layout.width, "${it.node.title} exceeds the layout width")
            assertTrue(it.bottom <= layout.height, "${it.node.title} exceeds the layout height")
        }
    }

    @Test
    fun `layout is deterministic for the same graph`() {
        val again = LayeredLayout(sizer = { node -> 180.0 + node.title.length to 52.0 }).layout(graph)
        assertEquals(layout, again)
    }

    @Test
    fun `an empty graph lays out to nothing rather than failing`() {
        assertSame(GraphLayout.EMPTY, LayeredLayout(sizer = { _ -> 10.0 to 10.0 }).layout(CatalogGraph.EMPTY))
    }

    private fun group(name: String): CatalogNode {
        val ref = requireNotNull(EntityRef.parse(name, defaultKind = "group"))
        return CatalogNode(ref = ref, kind = EntityKind.GROUP, title = name)
    }

    private val org = group("org")
    private val platform = group("platform")
    private val payments = group("payments")
    private val sre = group("sre")
    private val teams = CatalogGraph(
        nodes = listOf(org, payments, platform, sre).associateBy { it.ref },
        edges = listOf(
            CatalogEdge(platform.ref, org.ref, RelationType.CHILD_OF),
            CatalogEdge(org.ref, payments.ref, RelationType.PARENT_OF),
            CatalogEdge(sre.ref, platform.ref, RelationType.CHILD_OF),
        ),
    )
    private val teamLayout = LayeredLayout(sizer = { _ -> 100.0 to 50.0 }).layout(teams)

    private fun y(node: CatalogNode) = teamLayout.nodes.getValue(node.ref).y

    @Test
    fun `a hierarchy inside one layer is drawn parents above children`() {
        assertTrue(y(org) < y(platform))
        assertEquals(y(platform), y(payments))
        assertTrue(y(platform) < y(sre))
    }

    @Test
    fun `drawing a layer as several rows leaves the logical layer whole`() {
        assertEquals(1, teamLayout.layers.size)
        assertEquals(teams.nodes.keys, teamLayout.layers.single().toSet())
    }

    @Test
    fun `a hierarchy cycle still places every node`() {
        val cyclic = teams.copy(edges = teams.edges + CatalogEdge(org.ref, sre.ref, RelationType.CHILD_OF))
        val placed = LayeredLayout(sizer = { _ -> 100.0 to 50.0 }).layout(cyclic)
        assertEquals(cyclic.nodes.keys, placed.nodes.keys)
    }

    @Test
    fun `Systems drawn as containers get boxes that hold their members and never overlap`() {
        val large = CatalogGraphBuilder.build(Fixtures.loadExample("08-large-catalog"))
        val clusters = com.grahambrooks.backstage.catalog.model.SystemClusters.of(large)
        val boxed = LayeredLayout(sizer = { _ -> 100.0 to 50.0 }, clusters = clusters).layout(large)

        val systems = clusters.values.toSet()
        assertEquals(systems, boxed.clusters.map { it.system }.toSet())
        for (box in boxed.clusters) {
            val members = boxed.nodes.values.filter { clusters[it.node.ref] == box.system || it.node.ref == box.system }
            members.forEach {
                assertTrue(it.x >= box.x && it.right <= box.right && it.y >= box.y && it.bottom <= box.bottom, "${it.node.title} outside ${box.system}")
            }
            val others = boxed.nodes.values - members.toSet()
            others.forEach {
                val overlaps = it.x < box.right && it.right > box.x && it.y < box.bottom && it.bottom > box.y
                assertTrue(!overlaps, "${it.node.title} intrudes on ${box.system}")
            }
        }
        boxed.clusters.zipWithNext { left, right -> assertTrue(left.right <= right.x) }
        assertEquals(LayeredLayout(sizer = { _ -> 100.0 to 50.0 }).layout(large).layers, boxed.layers)
    }

    @Test
    fun `a row wider than the limit wraps into balanced rows and keeps its layer`() {
        val large = CatalogGraphBuilder.build(Fixtures.loadExample("08-large-catalog"))
        val wrapped = LayeredLayout(sizer = { _ -> 100.0 to 50.0 }, maxRowWidth = 700.0).layout(large)
        val rows = wrapped.nodes.values.groupBy { it.y }.values
        rows.forEach { row ->
            assertTrue(row.size * 100 + (row.size - 1) * 32 <= 700 || row.size == 1, "row of ${row.size} too wide")
        }
        assertEquals(LayeredLayout(sizer = { _ -> 100.0 to 50.0 }).layout(large).layers, wrapped.layers)
    }
}
