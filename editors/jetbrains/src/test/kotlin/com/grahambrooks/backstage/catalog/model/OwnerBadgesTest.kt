package com.grahambrooks.backstage.catalog.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class OwnerBadgesTest {

    private fun ref(text: String) = requireNotNull(EntityRef.parse(text, defaultKind = "component"))

    private fun node(text: String, external: Boolean = false): CatalogNode {
        val ref = ref(text)
        return CatalogNode(ref = ref, kind = EntityKind.of(ref.kind), title = ref.name, external = external)
    }

    private val service = node("component:service")
    private val api = node("api:service-api")
    private val team = node("group:team")
    private val outsider = node("group:outsider", external = true)
    private val parentOrg = node("group:org", external = true)

    private val graph = CatalogGraph(
        nodes = listOf(service, api, team, outsider, parentOrg).associateBy { it.ref },
        edges = listOf(
            CatalogEdge(service.ref, team.ref, RelationType.OWNED_BY),
            CatalogEdge(api.ref, outsider.ref, RelationType.OWNED_BY),
            CatalogEdge(service.ref, api.ref, RelationType.PROVIDES_API),
            CatalogEdge(team.ref, parentOrg.ref, RelationType.CHILD_OF),
            CatalogEdge(api.ref, parentOrg.ref, RelationType.OWNED_BY),
        ),
    )

    private val folded = OwnerBadges.fold(graph)

    @Test
    fun `ownedBy edges become badges`() {
        assertEquals(listOf(team), folded.owners[service.ref])
        assertEquals(listOf(outsider, parentOrg), folded.owners[api.ref])
        assertTrue(folded.graph.edges.none { it.type == RelationType.OWNED_BY })
    }

    @Test
    fun `other relations are kept`() {
        assertEquals(
            setOf(RelationType.PROVIDES_API, RelationType.CHILD_OF),
            folded.graph.edges.map { it.type }.toSet(),
        )
    }

    @Test
    fun `a placeholder that is only an owner is dropped`() {
        assertFalse(outsider.ref in folded.graph.nodes)
    }

    @Test
    fun `a placeholder still joined by another relation stays`() {
        assertTrue(parentOrg.ref in folded.graph.nodes)
    }

    @Test
    fun `a declared owner stays even when only an owner`() {
        val alone = CatalogGraph(
            nodes = listOf(service, team).associateBy { it.ref },
            edges = listOf(CatalogEdge(service.ref, team.ref, RelationType.OWNED_BY)),
        )
        assertTrue(team.ref in OwnerBadges.fold(alone).graph.nodes)
    }
}
