package com.grahambrooks.backstage.catalog

import com.grahambrooks.backstage.catalog.model.RawDocument
import org.yaml.snakeyaml.Yaml

/**
 * Loads a YAML fixture into the same [RawDocument] shape the YAML PSI reader produces at runtime.
 *
 * Using SnakeYAML here (test scope only) rather than an IDE fixture keeps the model tests to
 * ordinary JUnit, so they run in a fraction of a second and do not need a platform sandbox.
 */
object Fixtures {

    fun load(name: String): List<RawDocument> = parse(
        requireNotNull(javaClass.classLoader.getResourceAsStream("fixtures/$name")) {
            "Missing fixture: fixtures/$name"
        }.bufferedReader().readText(),
    )

    /** One of the shared `examples/`, found through the `repo.root` property Gradle passes. */
    fun loadExample(name: String): List<RawDocument> = parse(
        java.nio.file.Path.of(System.getProperty("repo.root", "../.."))
            .resolve("examples").resolve(name).resolve("catalog-info.yaml")
            .toFile().readText(),
    )

    private fun parse(text: String): List<RawDocument> {

        // Offsets are approximated by document start, which is all the model layer uses them for.
        var offset = 0
        return Yaml().loadAll(text).mapNotNull { document ->
            @Suppress("UNCHECKED_CAST")
            val map = document as? Map<String, Any?> ?: return@mapNotNull null
            RawDocument(map, offset).also { offset += 1 }
        }
    }
}
