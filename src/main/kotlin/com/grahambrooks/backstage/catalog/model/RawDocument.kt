package com.grahambrooks.backstage.catalog.model

/**
 * One YAML document from a `catalog-info.yaml`, already reduced to plain maps, lists and scalars.
 *
 * Keeping the graph builder on this shape rather than on PSI is what lets the whole model layer
 * be unit-tested from YAML fixtures without starting an IDE.
 */
data class RawDocument(
    val data: Map<String, Any?>,
    /** Character offset of the document's start in the file, for caret navigation. */
    val offset: Int = 0,
)
