package com.grahambrooks.backstage.catalog.model

import com.grahambrooks.backstage.catalog.Fixtures
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class OutlineTest {

    private val graph = CatalogGraphBuilder.build(Fixtures.loadExample("02-storefront-system"))
    private val outline = Outline.of(graph)

    @Test
    fun `sections follow the layer order`() {
        val ranks = outline.map { it.kind.rank }
        assertEquals(ranks.sorted(), ranks)
    }

    @Test
    fun `every entity is listed once and every relation appears from both ends`() {
        assertEquals(graph.nodes.keys, outline.flatMap { s -> s.entities.map { it.node.ref } }.toSet())
        assertEquals(graph.nodes.size, outline.sumOf { it.entities.size })
        assertEquals(graph.edges.size * 2, outline.sumOf { s -> s.entities.sumOf { it.relations.size } })
    }

    @Test
    fun `declared relations come before incoming ones`() {
        for (entity in outline.flatMap { it.entities }) {
            val directions = entity.relations.map { it.outgoing }
            assertEquals(directions.sortedDescending(), directions)
        }
    }
}
