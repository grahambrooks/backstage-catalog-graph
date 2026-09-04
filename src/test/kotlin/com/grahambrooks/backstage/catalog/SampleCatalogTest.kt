package com.grahambrooks.backstage.catalog

import com.grahambrooks.backstage.catalog.model.CatalogGraphBuilder
import com.grahambrooks.backstage.catalog.model.EntityRef
import com.grahambrooks.backstage.catalog.model.RawDocument
import com.grahambrooks.backstage.catalog.model.RelationType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.yaml.snakeyaml.Yaml
import java.nio.file.Files
import java.nio.file.Path

/**
 * Holds `samples/catalog-info.yaml` -- the file the README tells you to open in the sandbox IDE
 * -- to what it claims to demonstrate. Without this the sample quietly rots into a demo that no
 * longer shows the feature.
 */
class SampleCatalogTest {

    private val graph = CatalogGraphBuilder.build(
        Yaml().loadAll(Files.readString(Path.of("samples/catalog-info.yaml")))
            .mapIndexedNotNull { index, document ->
                @Suppress("UNCHECKED_CAST")
                (document as? Map<String, Any?>)?.let { RawDocument(it, index) }
            },
    )

    private fun ref(text: String) = requireNotNull(EntityRef.parse(text, defaultKind = "component"))

    @Test
    fun `the sample parses cleanly`() {
        assertEquals(emptyList<String>(), graph.problems.map { it.message })
    }

    @Test
    fun `the sample shows exactly the external references it advertises`() {
        assertEquals(
            setOf(
                ref("group:retail-leadership"),
                ref("group:platform-engineering"),
                ref("api:payments-api"),
                ref("resource:shared-kafka"),
                ref("user:jane.doe"),
            ),
            graph.externalNodes.map { it.ref }.toSet(),
        )
    }

    @Test
    fun `the sample exercises every relation the plugin understands except the inverse forms`() {
        val exercised = graph.edges.map { it.type }.toSet()
        val expected = setOf(
            RelationType.OWNED_BY,
            RelationType.PART_OF,
            RelationType.PROVIDES_API,
            RelationType.CONSUMES_API,
            RelationType.DEPENDS_ON,
            RelationType.CHILD_OF,
            RelationType.HAS_MEMBER,
        )
        assertTrue(exercised.containsAll(expected), "Missing from the sample: ${expected - exercised}")
    }
}
