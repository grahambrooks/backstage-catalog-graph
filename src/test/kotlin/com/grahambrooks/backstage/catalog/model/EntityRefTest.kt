package com.grahambrooks.backstage.catalog.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class EntityRefTest {

    @Test
    fun `bare name takes the default kind and namespace`() {
        val ref = EntityRef.parse("payments", defaultKind = "system")
        assertEquals(EntityRef("system", "default", "payments"), ref)
    }

    @Test
    fun `explicit kind overrides the default`() {
        val ref = EntityRef.parse("resource:payments-db", defaultKind = "component")
        assertEquals(EntityRef("resource", "default", "payments-db"), ref)
    }

    @Test
    fun `fully qualified reference is parsed in all three parts`() {
        val ref = EntityRef.parse("api:retail/checkout", defaultKind = "component")
        assertEquals(EntityRef("api", "retail", "checkout"), ref)
    }

    @Test
    fun `namespace without kind inherits the default kind`() {
        val ref = EntityRef.parse("retail/checkout", defaultKind = "component")
        assertEquals(EntityRef("component", "retail", "checkout"), ref)
    }

    @Test
    fun `references are case insensitive so two spellings compare equal`() {
        assertEquals(
            EntityRef.parse("Component:Default/Checkout", defaultKind = "system"),
            EntityRef.parse("component:checkout", defaultKind = "component"),
        )
    }

    @Test
    fun `the entity's own namespace is inherited by its references`() {
        val ref = EntityRef.parse("checkout", defaultKind = "component", defaultNamespace = "retail")
        assertEquals(EntityRef("component", "retail", "checkout"), ref)
    }

    @Test
    fun `text that cannot be a reference is rejected rather than guessed at`() {
        assertNull(EntityRef.parse("", defaultKind = "component"))
        assertNull(EntityRef.parse("   ", defaultKind = "component"))
        assertNull(EntityRef.parse("two words", defaultKind = "component"))
        assertNull(EntityRef.parse("component:", defaultKind = "component"))
        assertNull(EntityRef.parse(":name", defaultKind = "component"))
    }

    @Test
    fun `short label omits the default namespace only`() {
        assertEquals("component:checkout", EntityRef("component", "default", "checkout").shortLabel())
        assertEquals("component:retail/checkout", EntityRef("component", "retail", "checkout").shortLabel())
    }
}
