package com.grahambrooks.backstage.catalog.model

/**
 * Turns the YAML documents of a `catalog-info.yaml` into a [CatalogGraph].
 *
 * Two things it deliberately does *not* do:
 *  - resolve references against a running Backstage catalog, or against other files in the
 *    project. Anything this file references but does not declare becomes an external
 *    placeholder, which is what makes the picture honest about the file's boundary.
 *  - reject a bad document. Unparseable entities are reported as [CatalogProblem]s and the rest
 *    of the file still renders.
 */
object CatalogGraphBuilder {

    /**
     * Maps a `spec` field onto the relation it expresses and the kind its references default to.
     * A null [targetKind] means the reference must name its own kind, as Backstage requires for
     * `dependsOn`. A rule with [kinds] applies only to entities of those kinds.
     */
    private data class SpecRule(
        val field: String,
        val relation: RelationType,
        val targetKind: String?,
        val kinds: Set<String>? = null,
    )

    /**
     * The relation table from `conformance/spec.md`, in the order it is documented. Where a
     * field means something different for one kind, that kind's rule comes first and wins.
     */
    private val SPEC_RULES = listOf(
        SpecRule("owner", RelationType.OWNED_BY, "group"),
        SpecRule("system", RelationType.PART_OF, "system"),
        SpecRule("domain", RelationType.PART_OF, "domain"),
        SpecRule("subcomponentOf", RelationType.PART_OF, "component"),
        SpecRule("subdomainOf", RelationType.PART_OF, "domain"),
        SpecRule("parent", RelationType.CHILD_OF, "group"),
        SpecRule("children", RelationType.PARENT_OF, "group"),
        SpecRule("members", RelationType.HAS_MEMBER, "user"),
        SpecRule("memberOf", RelationType.MEMBER_OF, "group"),
        SpecRule("providesApis", RelationType.PROVIDES_API, "api"),
        SpecRule("consumesApis", RelationType.CONSUMES_API, "api"),
        SpecRule("dependsOn", RelationType.DEPENDS_ON, "airesource", kinds = setOf("airesource")),
        SpecRule("dependsOn", RelationType.DEPENDS_ON, null),
        SpecRule("dependencyOf", RelationType.DEPENDENCY_OF, null),
        SpecRule("skills", RelationType.HAS_PART, "airesource", kinds = setOf("airesource")),
        SpecRule("plugins", RelationType.HAS_PART, "airesource", kinds = setOf("airesource")),
    )

    /** The rules that apply to an entity of [kind]: for each field, the first that matches. */
    private fun rulesFor(kind: String): List<SpecRule> =
        SPEC_RULES.filter { it.kinds == null || kind in it.kinds }.distinctBy { it.field }

    fun build(documents: List<RawDocument>): CatalogGraph {
        val problems = mutableListOf<CatalogProblem>()
        val nodes = LinkedHashMap<EntityRef, CatalogNode>()
        val edges = mutableListOf<CatalogEdge>()
        val pending = mutableListOf<Pair<RawDocument, EntityRef>>()

        // Pass 1 -- everything this file declares. Done first so that pass 2 can tell a
        // reference to a local entity from a reference that leaves the file.
        for (document in documents) {
            val ref = refOf(document, problems) ?: continue
            val existing = nodes.put(ref, nodeOf(document, ref))
            if (existing != null) {
                problems += CatalogProblem(
                    "Duplicate entity ${ref.shortLabel()} -- the later definition is shown",
                    document.offset,
                )
            }
            pending += document to ref
        }

        // Pass 2 -- relations, creating a placeholder for every target this file does not declare.
        for ((document, ref) in pending) {
            val spec = document.data.mapAt("spec") ?: continue
            for (rule in rulesFor(ref.kind)) {
                for (raw in spec.stringsAt(rule.field)) {
                    if (rule.targetKind == null && ':' !in raw && raw.isNotBlank()) {
                        problems += CatalogProblem(
                            "${ref.shortLabel()}: \"$raw\" in spec.${rule.field} must name its kind, " +
                                "as in component:$raw or resource:$raw",
                            document.offset,
                        )
                        continue
                    }
                    val target = EntityRef.parse(raw, rule.targetKind.orEmpty(), ref.namespace)
                    if (target == null) {
                        problems += CatalogProblem(
                            "${ref.shortLabel()}: cannot read \"$raw\" in spec.${rule.field} as an entity reference",
                            document.offset,
                        )
                        continue
                    }
                    nodes.getOrPut(target) { placeholderFor(target) }
                    edges += CatalogEdge(ref, target, rule.relation)
                }
            }
        }

        return CatalogGraph(nodes, edges.distinct(), problems)
    }

    private fun refOf(document: RawDocument, problems: MutableList<CatalogProblem>): EntityRef? {
        val kind = document.data.stringAt("kind")
        if (kind.isNullOrBlank()) {
            problems += CatalogProblem("Document has no `kind` and was skipped", document.offset)
            return null
        }
        val metadata = document.data.mapAt("metadata")
        val name = metadata?.stringAt("name")
        if (name.isNullOrBlank()) {
            problems += CatalogProblem("$kind has no `metadata.name` and was skipped", document.offset)
            return null
        }
        val namespace = metadata.stringAt("namespace")?.takeIf { it.isNotBlank() }
            ?: EntityRef.DEFAULT_NAMESPACE
        return EntityRef(
            kind = EntityRef.normalizeKind(kind),
            namespace = namespace.lowercase(),
            name = name.lowercase(),
        )
    }

    private fun nodeOf(document: RawDocument, ref: EntityRef): CatalogNode {
        val metadata = document.data.mapAt("metadata")
        val spec = document.data.mapAt("spec")
        return CatalogNode(
            ref = ref,
            kind = EntityKind.of(ref.kind),
            title = metadata?.stringAt("title")?.takeIf { it.isNotBlank() }
                ?: metadata?.stringAt("name")
                ?: ref.name,
            description = metadata?.stringAt("description"),
            type = spec?.stringAt("type"),
            lifecycle = spec?.stringAt("lifecycle"),
            tags = metadata?.stringsAt("tags").orEmpty(),
            external = false,
            sourceOffset = document.offset,
            definition = document.definition,
        )
    }

    private fun placeholderFor(ref: EntityRef): CatalogNode = CatalogNode(
        ref = ref,
        kind = EntityKind.of(ref.kind),
        title = ref.name,
        external = true,
    )

    // --- Untyped-YAML accessors -------------------------------------------------------------
    // Everything below tolerates the wrong shape rather than throwing: a descriptor with
    // `tags: production` instead of a list should still draw.

    private fun Map<*, *>.mapAt(key: String): Map<String, Any?>? {
        @Suppress("UNCHECKED_CAST")
        return this[key] as? Map<String, Any?>
    }

    private fun Map<*, *>.stringAt(key: String): String? = when (val value = this[key]) {
        is String -> value
        is Number, is Boolean -> value.toString()
        else -> null
    }

    /** Reads a field that may be a single scalar or a list of them, and skips anything else. */
    private fun Map<*, *>.stringsAt(key: String): List<String> = when (val value = this[key]) {
        null -> emptyList()
        is String -> listOf(value)
        is Iterable<*> -> value.mapNotNull { it as? String }
        else -> emptyList()
    }
}
