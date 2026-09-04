package com.grahambrooks.backstage.catalog.layout

import com.grahambrooks.backstage.catalog.Fixtures
import com.grahambrooks.backstage.catalog.model.CatalogGraph
import com.grahambrooks.backstage.catalog.model.CatalogGraphBuilder
import com.grahambrooks.backstage.catalog.model.EntityKind
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
}
