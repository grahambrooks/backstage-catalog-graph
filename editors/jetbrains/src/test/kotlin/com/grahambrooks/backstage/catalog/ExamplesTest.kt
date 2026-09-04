package com.grahambrooks.backstage.catalog

import com.grahambrooks.backstage.catalog.model.CatalogGraph
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
import kotlin.io.path.name

/**
 * Holds `examples/` to the shape its README promises.
 *
 * The examples are the manual test plan: a tester opens each one and checks the graph against
 * the documented counts. Without this the plan rots into a set of files that no longer show
 * what they claim, and a tester chasing a "wrong" count would be debugging the example.
 */
class ExamplesTest {

    private data class Expectation(
        val path: String,
        val declared: Int,
        val external: Int,
        val edges: Int,
        val problems: Int,
    )

    private val expectations = listOf(
        Expectation("01-minimal/catalog-info.yaml", declared = 1, external = 2, edges = 2, problems = 0),
        Expectation("02-storefront-system/catalog-info.yaml", declared = 7, external = 5, edges = 18, problems = 0),
        Expectation("03-external-references/catalog-info.yaml", declared = 1, external = 9, edges = 9, problems = 0),
        Expectation("04-all-relations/catalog-info.yaml", declared = 8, external = 4, edges = 19, problems = 0),
        Expectation("05-namespaces/catalog-info.yaml", declared = 3, external = 2, edges = 5, problems = 0),
        Expectation("06-org-chart/catalog-info.yaml", declared = 6, external = 1, edges = 10, problems = 0),
        Expectation("07-malformed/catalog-info.yaml", declared = 2, external = 2, edges = 2, problems = 4),
        Expectation("08-large-catalog/catalog-info.yaml", declared = 37, external = 1, edges = 93, problems = 0),
        Expectation("09-no-entities/catalog-info.yaml", declared = 0, external = 0, edges = 0, problems = 0),
        Expectation("10-file-naming/catalog-all.yaml", declared = 1, external = 1, edges = 1, problems = 0),
        Expectation("10-file-naming/payments.catalog-info.yaml", declared = 1, external = 1, edges = 1, problems = 0),
    )

    @Test
    fun `each example matches the counts its README documents`() {
        val actual = expectations.map { expected ->
            val graph = graphOf(expected.path)
            expected.copy(
                declared = graph.declaredNodes.size,
                external = graph.externalNodes.size,
                edges = graph.edges.size,
                problems = graph.problems.size,
            )
        }
        assertEquals(expectations, actual)
    }

    @Test
    fun `the example tree contains no catalog file the README leaves out`() {
        val found = Files.walk(EXAMPLES).use { paths ->
            paths.filter { it.name.endsWith(".yaml") }
                .filter { CatalogInfoFiles.matchesName(it.name.removeSuffix(".yaml")) }
                .map { EXAMPLES.relativize(it).toString() }
                .sorted()
                .toList()
        }
        assertEquals(expectations.map { it.path }.sorted(), found)
    }

    @Test
    fun `the file-naming control is not picked up as a catalog file`() {
        assertTrue(Files.exists(EXAMPLES.resolve("10-file-naming/app-config.yaml")))
        assertTrue(!CatalogInfoFiles.matchesName("app-config"))
    }

    @Test
    fun `04-all-relations exercises every relation the plugin reads`() {
        val exercised = graphOf("04-all-relations/catalog-info.yaml").edges.map { it.type }.toSet()
        assertEquals(RelationType.entries.toSet(), exercised)
    }

    @Test
    fun `05-namespaces keeps same-named entities apart and cross-namespace refs together`() {
        val graph = graphOf("05-namespaces/catalog-info.yaml")

        val retail = EntityRef("component", "retail", "checkout")
        val wholesale = EntityRef("component", "wholesale", "checkout")
        assertTrue(retail in graph.nodes && wholesale in graph.nodes, "Same name, different namespace")

        // Both the bare `checkout-api` inside `retail` and the explicit `api:retail/checkout-api`
        // from `wholesale` must land on the one node.
        val api = EntityRef("api", "retail", "checkout-api")
        val consumers = graph.edges
            .filter { it.type == RelationType.CONSUMES_API && it.to == api }
            .map { it.from }
            .toSet()
        assertEquals(setOf(retail, wholesale), consumers)
    }

    @Test
    fun `07-malformed reports each kind of problem and still draws what it can`() {
        val graph = graphOf("07-malformed/catalog-info.yaml")
        val messages = graph.problems.map { it.message }
        assertTrue(messages.any { it.contains("no `kind`") }, messages.toString())
        assertTrue(messages.any { it.contains("no `metadata.name`") }, messages.toString())
        assertTrue(messages.any { it.contains("cannot read") }, messages.toString())
        assertTrue(messages.any { it.contains("Duplicate entity") }, messages.toString())
        assertEquals(setOf("readable", "duplicated"), graph.declaredNodes.map { it.ref.name }.toSet())
        assertEquals("Second definition", graph.nodes.values.first { it.ref.name == "duplicated" }.title)
    }

    private fun graphOf(relativePath: String): CatalogGraph = CatalogGraphBuilder.build(
        Yaml().loadAll(Files.readString(EXAMPLES.resolve(relativePath)))
            .mapIndexedNotNull { index, document ->
                @Suppress("UNCHECKED_CAST")
                (document as? Map<String, Any?>)?.let { RawDocument(it, index) }
            },
    )

    private companion object {
        /** Set by the Gradle `test` task -- the examples are shared with the other editors. */
        val EXAMPLES: Path = Path.of(System.getProperty("repo.root", "../..")).resolve("examples")
    }
}
