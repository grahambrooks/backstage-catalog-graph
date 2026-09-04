package com.grahambrooks.backstage.catalog.model

/**
 * A resolved reference to a catalog entity.
 *
 * Backstage writes references in the compact form `[<kind>:][<namespace>/]<name>`, where the
 * missing parts are filled in from context. [parse] does that filling-in so that two spellings
 * of the same entity (`system: developer-tools` and `system:default/developer-tools`) compare
 * equal.
 */
data class EntityRef(
    val kind: String,
    val namespace: String,
    val name: String,
) {
    /** Canonical `kind:namespace/name`, always lower case -- Backstage refs are case-insensitive. */
    override fun toString(): String = "$kind:$namespace/$name"

    /** The shortest spelling that is still unambiguous in the default namespace. */
    fun shortLabel(): String = if (namespace == DEFAULT_NAMESPACE) "$kind:$name" else toString()

    companion object {
        const val DEFAULT_NAMESPACE: String = "default"

        /**
         * Parses [text], filling in [defaultKind] and [defaultNamespace] for the parts it omits.
         *
         * Returns `null` for text that cannot be a reference (blank, or containing whitespace),
         * which keeps malformed descriptors from producing phantom nodes.
         */
        fun parse(
            text: String,
            defaultKind: String,
            defaultNamespace: String = DEFAULT_NAMESPACE,
        ): EntityRef? {
            val trimmed = text.trim()
            if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null

            val colon = trimmed.indexOf(':')
            val kind = if (colon >= 0) trimmed.substring(0, colon) else defaultKind
            val rest = if (colon >= 0) trimmed.substring(colon + 1) else trimmed

            val slash = rest.indexOf('/')
            val namespace = if (slash >= 0) rest.substring(0, slash) else defaultNamespace
            val name = if (slash >= 0) rest.substring(slash + 1) else rest

            if (kind.isBlank() || namespace.isBlank() || name.isBlank()) return null

            return EntityRef(
                kind = normalizeKind(kind),
                namespace = namespace.lowercase(),
                name = name.lowercase(),
            )
        }

        /**
         * Canonical lower-case kind. Kept separate from plain [String.lowercase] so that the
         * display side ([EntityKind]) and the identity side agree on one spelling.
         */
        fun normalizeKind(kind: String): String = kind.trim().lowercase()
    }
}
