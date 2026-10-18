package com.grahambrooks.backstage.catalog.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class SystemClustersTest {

    private fun node(text: String): CatalogNode {
        val ref = requireNotNull(EntityRef.parse(text, defaultKind = "component"))
        return CatalogNode(ref = ref, kind = EntityKind.of(ref.kind), title = ref.name)
    }

    private val domain = node("domain:commerce")
    private val shop = node("system:shop")
    private val cart = node("component:cart")
    private val widget = node("component:cart-widget")
    private val api = node("api:cart-api")
    private val loose = node("component:loose")

    private val graph = CatalogGraph(
        nodes = listOf(domain, shop, cart, widget, api, loose).associateBy { it.ref },
        edges = listOf(
            CatalogEdge(shop.ref, domain.ref, RelationType.PART_OF),
            CatalogEdge(cart.ref, shop.ref, RelationType.PART_OF),
            CatalogEdge(widget.ref, cart.ref, RelationType.PART_OF),
            CatalogEdge(api.ref, shop.ref, RelationType.PART_OF),
            CatalogEdge(loose.ref, loose.ref, RelationType.PART_OF),
        ),
    )

    @Test
    fun `entities belong to the System they are part of, subcomponents through their parent`() {
        assertEquals(
            mapOf(cart.ref to shop.ref, widget.ref to shop.ref, api.ref to shop.ref),
            SystemClusters.of(graph),
        )
    }

    @Test
    fun `a subcomponent cycle with no System ends`() {
        val cyclic = graph.copy(
            edges = listOf(
                CatalogEdge(cart.ref, widget.ref, RelationType.PART_OF),
                CatalogEdge(widget.ref, cart.ref, RelationType.PART_OF),
            ),
        )
        assertEquals(emptyMap<EntityRef, EntityRef>(), SystemClusters.of(cyclic))
    }
}
