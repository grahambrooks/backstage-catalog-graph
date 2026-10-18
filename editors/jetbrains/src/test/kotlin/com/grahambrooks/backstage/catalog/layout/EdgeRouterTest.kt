package com.grahambrooks.backstage.catalog.layout

import com.grahambrooks.backstage.catalog.Fixtures
import com.grahambrooks.backstage.catalog.model.CatalogGraphBuilder
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class EdgeRouterTest {

    private val graph = CatalogGraphBuilder.build(Fixtures.loadExample("08-large-catalog"))
    private val layout = LayeredLayout(sizer = { _ -> 100.0 to 50.0 }).layout(graph)
    private val router = EdgeRouter(layout)

    private fun routes() = graph.edges.mapNotNull { edge ->
        val from = layout.nodes[edge.from] ?: return@mapNotNull null
        val to = layout.nodes[edge.to] ?: return@mapNotNull null
        Triple(from, to, router.route(from, to))
    }

    @Test
    fun `every route starts at its source and ends at its target`() {
        for ((from, to, route) in routes()) {
            assertEquals(from.centerX, route.points.first().x)
            assertEquals(to.centerX, route.points.last().x)
        }
    }

    @Test
    fun `no straight leg of a route passes through a node it does not join`() {
        for ((from, to, route) in routes().filter { !it.third.sameRow }) {
            route.points.zipWithNext { a, b ->
                for (node in layout.nodes.values) {
                    if (node == from || node == to) continue
                    // Sample the leg; the drawn curve bends towards these straight legs.
                    for (step in 1 until 20) {
                        val x = a.x + (b.x - a.x) * step / 20
                        val y = a.y + (b.y - a.y) * step / 20
                        val inside = x > node.x && x < node.right && y > node.y && y < node.bottom
                        assertTrue(!inside, "${from.node.title} -> ${to.node.title} crosses ${node.node.title}")
                    }
                }
            }
        }
    }

    @Test
    fun `edges within one row arc over it`() {
        val a = NodeBounds(graph.nodes.values.first(), 0.0, 0.0, 100.0, 50.0)
        val b = a.copy(x = 400.0)
        val route = EdgeRouter(GraphLayout(emptyMap(), 500.0, 50.0)).route(a, b)
        assertTrue(route.sameRow)
        assertEquals(listOf(Point(50.0, 0.0), Point(450.0, 0.0)), route.points)
    }
}
