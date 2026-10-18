package com.grahambrooks.backstage.catalog.layout

import com.grahambrooks.backstage.catalog.model.CatalogNode
import com.grahambrooks.backstage.catalog.model.EntityKind
import com.grahambrooks.backstage.catalog.model.EntityRef
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class NavigationTest {

    private fun at(name: String, x: Double, y: Double): NodeBounds {
        val ref = requireNotNull(EntityRef.parse(name, defaultKind = "component"))
        return NodeBounds(CatalogNode(ref, EntityKind.COMPONENT, name), x, y, 100.0, 50.0)
    }

    //   a   b   c        row 0
    //     d       e      row 1
    private val a = at("a", 0.0, 0.0)
    private val b = at("b", 150.0, 0.0)
    private val c = at("c", 300.0, 0.0)
    private val d = at("d", 60.0, 120.0)
    private val e = at("e", 360.0, 120.0)
    private val layout = GraphLayout(listOf(a, b, c, d, e).associateBy { it.node.ref }, 460.0, 170.0)

    private fun step(from: NodeBounds?, direction: Direction) = Navigation.step(layout, from?.node?.ref, direction)

    @Test
    fun `with nothing selected any arrow starts at the first node in reading order`() {
        assertEquals(a.node.ref, step(null, Direction.DOWN))
    }

    @Test
    fun `left and right stay in the row`() {
        assertEquals(c.node.ref, step(b, Direction.RIGHT))
        assertEquals(a.node.ref, step(b, Direction.LEFT))
        assertEquals(e.node.ref, step(d, Direction.RIGHT))
    }

    @Test
    fun `up and down go to the horizontally closest node in the next row`() {
        assertEquals(d.node.ref, step(a, Direction.DOWN))
        assertEquals(e.node.ref, step(c, Direction.DOWN))
        assertEquals(c.node.ref, step(e, Direction.UP))
    }

    @Test
    fun `with nowhere to go the selection stays`() {
        assertEquals(a.node.ref, step(a, Direction.LEFT))
        assertEquals(b.node.ref, step(b, Direction.UP))
    }
}
