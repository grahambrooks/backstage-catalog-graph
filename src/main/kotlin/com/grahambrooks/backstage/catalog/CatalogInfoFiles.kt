package com.grahambrooks.backstage.catalog

import com.intellij.openapi.vfs.VirtualFile

/**
 * Decides which files get a catalog graph tab.
 *
 * Backstage itself accepts any filename -- a location can point anywhere -- but attaching a
 * second editor tab to every YAML file in a project would be noise. The names below are the ones
 * the catalog conventionally uses, plus the `*.catalog-info.yaml` form that repositories with
 * several entities tend to adopt.
 */
object CatalogInfoFiles {

    private val EXTENSIONS = setOf("yaml", "yml")
    private val BASE_NAMES = setOf("catalog-info", "all", "entities")

    fun matches(file: VirtualFile): Boolean {
        if (file.isDirectory) return false
        if (file.extension?.lowercase() !in EXTENSIONS) return false
        return matchesName(file.nameWithoutExtension)
    }

    fun matchesName(nameWithoutExtension: String): Boolean {
        val name = nameWithoutExtension.lowercase()
        if (name == "catalog-info") return true
        if (name.endsWith(".catalog-info")) return true
        // `catalog/all.yaml`, `catalog/entities.yaml` -- only when explicitly prefixed.
        return BASE_NAMES.any { name == "catalog-$it" }
    }
}
