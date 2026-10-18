package com.grahambrooks.backstage.catalog.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

class FocusTest {

    private fun node(text: String): CatalogNode {
        val ref = requireNotNull(EntityRef.parse(text, defaultKind = "component"))
        return CatalogNode(ref = ref, kind = EntityKind.of(ref.kind), title = ref.name)
    }

    private val system = node("system:shop")
    private val cart = node("component:cart")
    private val payments = node("component:payments")
    private val api = node("api:cart-api")
    private val unrelated = node("component:unrelated")
    private val team = node("group:team")

    private val drawn = CatalogGraph(
        nodes = listOf(system, cart, payments, api, unrelated, team).associateBy { it.ref },
        edges = listOf(
            CatalogEdge(cart.ref, system.ref, RelationType.PART_OF),
            CatalogEdge(payments.ref, system.ref, RelationType.PART_OF),
            CatalogEdge(cart.ref, api.ref, RelationType.PROVIDES_API),
            CatalogEdge(unrelated.ref, api.ref, RelationType.CONSUMES_API),
        ),
    )

    @Test
    fun `focus keeps the entity, its drawn neighbours and the edges among them`() {
        val focused = Focus.around(drawn, cart.ref)
        assertEquals(setOf(cart.ref, system.ref, api.ref), focused.nodes.keys)
        assertEquals(2, focused.edges.size)
    }

    @Test
    fun `a focused owner keeps the entities it owns`() {
        val focused = Focus.around(drawn, team.ref, owned = setOf(cart.ref, payments.ref))
        assertEquals(setOf(team.ref, cart.ref, payments.ref), focused.nodes.keys)
    }

    @Test
    fun `focusing on something not drawn changes nothing`() {
        assertSame(drawn, Focus.around(drawn, node("component:hidden").ref))
    }
}
