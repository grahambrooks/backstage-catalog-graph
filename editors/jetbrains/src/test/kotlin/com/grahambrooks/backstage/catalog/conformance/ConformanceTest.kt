package com.grahambrooks.backstage.catalog.conformance

import com.grahambrooks.backstage.catalog.model.CatalogGraph
import com.grahambrooks.backstage.catalog.model.CatalogGraphBuilder
import com.grahambrooks.backstage.catalog.model.RawDocument
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import org.yaml.snakeyaml.Yaml
import java.nio.file.Files
import java.nio.file.Path

/**
 * Runs the cross-editor conformance corpus against this implementation.
 *
 * The corpus at `conformance/` is the contract every editor implements. This side is also the
 * generator: run with `-Dconformance.update=true` to rewrite the golden files after a
 * deliberate behaviour change, then read the diff before committing it -- an updated golden is
 * a change to the contract that the VS Code implementation will then have to meet too.
 *
 *     ./gradlew test -Dconformance.update=true --tests '*ConformanceTest*'
 */
class ConformanceTest {

    @TestFactory
    fun `conformance corpus`(): List<DynamicTest> = manifest().map { case ->
        DynamicTest.dynamicTest(case.id) { check(case) }
    }

    private fun check(case: Case) {
        val input = REPO_ROOT.resolve(case.input)
        assertTrue(Files.exists(input), "Missing conformance input: ${case.input}")

        val actual = ConformanceFormat.render(graphOf(input))
        val golden = CONFORMANCE.resolve("expected/${case.id}.json")

        if (System.getProperty("conformance.update") == "true") {
            Files.createDirectories(golden.parent)
            Files.writeString(golden, actual)
            return
        }

        assertTrue(
            Files.exists(golden),
            "No golden for '${case.id}'. Generate it with -Dconformance.update=true.",
        )
        assertEquals(Files.readString(golden), actual, "Conformance drift in '${case.id}'")
    }

    private fun graphOf(input: Path): CatalogGraph = CatalogGraphBuilder.build(
        Yaml().loadAll(Files.readString(input))
            .mapIndexedNotNull { index, document ->
                @Suppress("UNCHECKED_CAST")
                (document as? Map<String, Any?>)?.let { RawDocument(it, index) }
            },
    )

    private data class Case(val id: String, val input: String)

    private fun manifest(): List<Case> {
        // manifest.json is read with the YAML parser already on the test classpath -- JSON is a
        // subset of YAML, so this avoids a JSON dependency for one small file.
        val parsed = Yaml().load<Map<String, Any?>>(Files.readString(CONFORMANCE.resolve("manifest.json")))

        @Suppress("UNCHECKED_CAST")
        val cases = parsed["cases"] as List<Map<String, Any?>>
        return cases.map { Case(it["id"] as String, it["input"] as String) }
    }

    private companion object {
        val REPO_ROOT: Path = Path.of(System.getProperty("repo.root", "../.."))
        val CONFORMANCE: Path = REPO_ROOT.resolve("conformance")
    }
}
