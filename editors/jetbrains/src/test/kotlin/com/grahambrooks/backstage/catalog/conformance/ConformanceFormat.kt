package com.grahambrooks.backstage.catalog.conformance

import com.grahambrooks.backstage.catalog.layout.LayeredLayout
import com.grahambrooks.backstage.catalog.model.CatalogGraph

/**
 * Renders a [CatalogGraph] as the canonical JSON the cross-editor conformance corpus is written
 * in. See `conformance/spec.md` for the format and what each field means.
 *
 * Every editor implementation must produce this same document for a given input. Ordering is
 * fixed here rather than left to whatever order an implementation happens to build things in:
 * nodes by reference, edges by (from, type, to), problems by message. Layer *contents* are the
 * exception -- they are emitted in layout order, because that ordering is itself the contract.
 */
object ConformanceFormat {

    /**
     * Layout is measured with a fixed node size so layer assignment and within-layer ordering
     * can be compared across editors. Real rendering measures text, which no two UI toolkits
     * would agree on.
     */
    private const val FIXED_NODE_WIDTH = 100.0
    private const val FIXED_NODE_HEIGHT = 50.0

    fun render(graph: CatalogGraph): String {
        val nodes = graph.nodes.values.sortedBy { it.ref.toString() }
        val edges = graph.edges.sortedWith(
            compareBy({ it.from.toString() }, { it.type.displayName }, { it.to.toString() }),
        )
        val problems = graph.problems.map { it.message }.sorted()
        val layers = layersOf(graph)

        return buildString {
            append("{\n")

            append("  \"nodes\": [\n")
            nodes.forEachIndexed { index, node ->
                append("    {")
                append("\"ref\": ").append(quote(node.ref.toString()))
                append(", \"kind\": ").append(quote(node.kind.displayName))
                append(", \"title\": ").append(quote(node.title))
                append(", \"type\": ").append(quoteOrNull(node.type))
                append(", \"lifecycle\": ").append(quoteOrNull(node.lifecycle))
                append(", \"tags\": ").append(node.tags.joinToString(", ", "[", "]") { quote(it) })
                append(", \"external\": ").append(node.external)
                append("}")
                if (index < nodes.lastIndex) append(",")
                append("\n")
            }
            append("  ],\n")

            append("  \"edges\": [\n")
            edges.forEachIndexed { index, edge ->
                append("    {")
                append("\"from\": ").append(quote(edge.from.toString()))
                append(", \"to\": ").append(quote(edge.to.toString()))
                append(", \"type\": ").append(quote(edge.type.displayName))
                append("}")
                if (index < edges.lastIndex) append(",")
                append("\n")
            }
            append("  ],\n")

            append("  \"problems\": [\n")
            problems.forEachIndexed { index, message ->
                append("    ").append(quote(message))
                if (index < problems.lastIndex) append(",")
                append("\n")
            }
            append("  ],\n")

            append("  \"layers\": [\n")
            layers.forEachIndexed { index, layer ->
                append("    ").append(layer.joinToString(", ", "[", "]") { quote(it) })
                if (index < layers.lastIndex) append(",")
                append("\n")
            }
            append("  ]\n")

            append("}\n")
        }
    }

    /**
     * Node references per logical layer, top layer first, in contract order. Read from the
     * layout's own layers rather than by grouping on y, because a layer with an internal
     * hierarchy is drawn as several rows.
     */
    private fun layersOf(graph: CatalogGraph): List<List<String>> {
        if (graph.isEmpty) return emptyList()
        val layout = LayeredLayout(sizer = { FIXED_NODE_WIDTH to FIXED_NODE_HEIGHT }).layout(graph)
        return layout.layers.map { layer -> layer.map { it.toString() } }
    }

    private fun quoteOrNull(value: String?): String = value?.let { quote(it) } ?: "null"

    /**
     * JSON string escaping. Control characters go out as `\u00xx` rather than the shorter `\b`
     * and `\f` forms; both parse identically, and no descriptor field has ever contained one.
     */
    private fun quote(value: String): String = buildString {
        append('"')
        for (character in value) {
            when {
                character == '"' -> append("\\\"")
                character == '\\' -> append("\\\\")
                character == '\n' -> append("\\n")
                character == '\r' -> append("\\r")
                character == '\t' -> append("\\t")
                character < ' ' -> append("\\u%04x".format(character.code))
                else -> append(character)
            }
        }
        append('"')
    }
}
