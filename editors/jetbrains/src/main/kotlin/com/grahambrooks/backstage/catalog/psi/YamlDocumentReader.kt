package com.grahambrooks.backstage.catalog.psi

import com.grahambrooks.backstage.catalog.model.RawDocument
import com.grahambrooks.backstage.catalog.model.TextSpan
import org.jetbrains.yaml.psi.YAMLFile
import org.jetbrains.yaml.psi.YAMLMapping
import org.jetbrains.yaml.psi.YAMLScalar
import org.jetbrains.yaml.psi.YAMLSequence
import org.jetbrains.yaml.psi.YAMLValue

/**
 * Reduces the IDE's YAML PSI to the plain maps and lists the model layer works on.
 *
 * The PSI is used rather than a bundled YAML parser for three reasons: it is already in the IDE,
 * it is incremental so the graph can be rebuilt cheaply while typing, and it gives each document
 * a text offset so a node in the graph can carry the caret back to its declaration.
 */
object YamlDocumentReader {

    /** Must be called under a read action. */
    fun read(file: YAMLFile): List<RawDocument> =
        file.documents.mapNotNull { document ->
            val mapping = document.topLevelValue as? YAMLMapping ?: return@mapNotNull null
            RawDocument(
                data = convertMapping(mapping),
                offset = document.textRange.startOffset,
                definition = mapping.textRange.let { TextSpan(it.startOffset, it.endOffset) },
            )
        }

    private fun convert(value: YAMLValue?): Any? = when (value) {
        null -> null
        is YAMLMapping -> convertMapping(value)
        is YAMLSequence -> value.items.map { convert(it.value) }
        is YAMLScalar -> value.textValue
        else -> value.text
    }

    private fun convertMapping(mapping: YAMLMapping): Map<String, Any?> {
        val result = LinkedHashMap<String, Any?>()
        for (keyValue in mapping.keyValues) {
            val key = keyValue.keyText.takeIf { it.isNotBlank() } ?: continue
            result[key] = convert(keyValue.value)
        }
        return result
    }
}
