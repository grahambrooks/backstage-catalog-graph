package com.grahambrooks.backstage.catalog.model

import com.grahambrooks.backstage.catalog.Fixtures
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CatalogGraphBuilderTest {

    private val graph = CatalogGraphBuilder.build(Fixtures.load("catalog-info.yaml"))

    private fun ref(text: String) = requireNotNull(EntityRef.parse(text, defaultKind = "component"))

    @Test
    fun `every document in the file becomes a declared node`() {
        assertEquals(
            setOf(
                ref("component:symgraph"),
                ref("api:symgraph-mcp-api"),
                ref("resource:symgraph-index"),
            ),
            graph.declaredNodes.map { it.ref }.toSet(),
        )
    }

    @Test
    fun `metadata is carried onto the node`() {
        val node = requireNotNull(graph.nodes[ref("component:symgraph")])
        assertEquals("Symgraph", node.title)
        assertEquals("service", node.type)
        assertEquals("production", node.lifecycle)
        assertEquals(listOf("rust", "mcp"), node.tags)
        assertEquals("Semantic code intelligence MCP server", node.description)
        assertFalse(node.external)
        assertNotNull(node.sourceOffset)
    }

    @Test
    fun `title falls back to name when metadata title is absent`() {
        assertEquals("symgraph-mcp-api", graph.nodes[ref("api:symgraph-mcp-api")]?.title)
    }

    @Test
    fun `references that leave the file become external placeholders`() {
        val external = graph.externalNodes.map { it.ref }.toSet()
        assertEquals(
            setOf(
                ref("user:grahambrooks"),
                ref("system:developer-tools"),
                ref("api:github-api"),
            ),
            external,
        )
        assertTrue(graph.externalNodes.all { it.sourceOffset == null })
    }

    @Test
    fun `a reference resolved inside the file is not marked external`() {
        val api = requireNotNull(graph.nodes[ref("api:symgraph-mcp-api")])
        assertFalse(api.external)
    }

    @Test
    fun `spec fields map onto the relations Backstage names them by`() {
        val fromSymgraph = graph.edges
            .filter { it.from == ref("component:symgraph") }
            .map { it.type to it.to }
            .toSet()

        assertEquals(
            setOf(
                RelationType.OWNED_BY to ref("user:grahambrooks"),
                RelationType.PART_OF to ref("system:developer-tools"),
                RelationType.PROVIDES_API to ref("api:symgraph-mcp-api"),
                RelationType.CONSUMES_API to ref("api:github-api"),
                RelationType.DEPENDS_ON to ref("resource:symgraph-index"),
            ),
            fromSymgraph,
        )
    }

    @Test
    fun `owner defaults to Group but an explicit kind prefix wins`() {
        // `owner: user:grahambrooks` in the fixture -- the explicit `user:` must not be
        // overridden by the field's Group default.
        assertTrue(graph.nodes.keys.any { it == ref("user:grahambrooks") })
        assertFalse(graph.nodes.keys.any { it == ref("group:grahambrooks") })
    }

    @Test
    fun `an edge touching a placeholder is dangling`() {
        val toSystem = graph.edges.first { it.to == ref("system:developer-tools") }
        val toLocalApi = graph.edges.first { it.to == ref("api:symgraph-mcp-api") }
        assertTrue(toSystem.isDangling(graph.nodes))
        assertFalse(toLocalApi.isDangling(graph.nodes))
    }

    @Test
    fun `neighbourhood covers both directions plus the node itself`() {
        val neighbourhood = graph.neighbourhoodOf(ref("api:symgraph-mcp-api"))
        assertTrue(ref("api:symgraph-mcp-api") in neighbourhood)
        assertTrue(ref("component:symgraph") in neighbourhood)
        assertTrue(ref("user:grahambrooks") in neighbourhood)
    }

    @Test
    fun `a valid file produces no problems`() {
        assertEquals(emptyList<CatalogProblem>(), graph.problems)
    }
}

class CatalogGraphBuilderProblemTest {

    private val graph = CatalogGraphBuilder.build(Fixtures.load("malformed.yaml"))

    @Test
    fun `bad documents are reported and the rest of the file still renders`() {
        val messages = graph.problems.map { it.message }
        assertTrue(messages.any { it.contains("no `metadata.name`") }, messages.toString())
        assertTrue(messages.any { it.contains("no `kind`") }, messages.toString())
        assertTrue(messages.any { it.contains("Duplicate entity") }, messages.toString())

        // `duplicated` survived, so a broken sibling document did not take the file down.
        assertTrue(graph.declaredNodes.any { it.ref.name == "duplicated" })
    }

    @Test
    fun `a duplicate declaration produces one node, not two`() {
        assertEquals(1, graph.declaredNodes.count { it.ref.name == "duplicated" })
    }
}
