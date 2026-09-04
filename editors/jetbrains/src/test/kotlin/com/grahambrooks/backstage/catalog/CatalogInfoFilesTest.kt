package com.grahambrooks.backstage.catalog

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CatalogInfoFilesTest {

    @Test
    fun `the conventional names are recognised`() {
        assertTrue(CatalogInfoFiles.matchesName("catalog-info"))
        assertTrue(CatalogInfoFiles.matchesName("CATALOG-INFO"))
        assertTrue(CatalogInfoFiles.matchesName("payments.catalog-info"))
        assertTrue(CatalogInfoFiles.matchesName("catalog-all"))
        assertTrue(CatalogInfoFiles.matchesName("catalog-entities"))
    }

    @Test
    fun `ordinary YAML files are left alone`() {
        assertFalse(CatalogInfoFiles.matchesName("app-config"))
        assertFalse(CatalogInfoFiles.matchesName("all"))
        assertFalse(CatalogInfoFiles.matchesName("catalog"))
        assertFalse(CatalogInfoFiles.matchesName("info"))
    }
}
