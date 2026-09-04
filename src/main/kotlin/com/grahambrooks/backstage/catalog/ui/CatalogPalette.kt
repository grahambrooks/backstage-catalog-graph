package com.grahambrooks.backstage.catalog.ui

import com.grahambrooks.backstage.catalog.model.EntityKind
import com.intellij.ui.JBColor
import java.awt.Color

/**
 * Colours for the graph, one accent per entity kind.
 *
 * Every colour is a [JBColor] so the graph reads correctly in both light and dark themes; the
 * dark variants are lightened rather than merely darkened, because a saturated mid-tone that
 * works on white disappears on the dark editor background.
 */
object CatalogPalette {

    private val ACCENTS: Map<EntityKind, JBColor> = mapOf(
        EntityKind.DOMAIN to JBColor(Color(0x6A3DE8), Color(0xB39DFF)),
        EntityKind.SYSTEM to JBColor(Color(0x3949AB), Color(0x8C9EFF)),
        EntityKind.COMPONENT to JBColor(Color(0x1565C0), Color(0x64B5F6)),
        EntityKind.API to JBColor(Color(0x00796B), Color(0x4DB6AC)),
        EntityKind.RESOURCE to JBColor(Color(0xE65100), Color(0xFFB74D)),
        EntityKind.GROUP to JBColor(Color(0xAD1457), Color(0xF06292)),
        EntityKind.USER to JBColor(Color(0x2E7D32), Color(0x81C784)),
        EntityKind.TEMPLATE to JBColor(Color(0x00838F), Color(0x4DD0E1)),
        EntityKind.LOCATION to JBColor(Color(0x546E7A), Color(0x90A4AE)),
        EntityKind.OTHER to JBColor(Color(0x616161), Color(0x9E9E9E)),
    )

    val background: JBColor = JBColor(Color(0xFBFCFD), Color(0x2B2D30))
    val nodeFill: JBColor = JBColor(Color(0xFFFFFF), Color(0x393B40))
    val nodeBorder: JBColor = JBColor(Color(0xD3D5DB), Color(0x4E5157))
    val externalFill: JBColor = JBColor(Color(0xF2F3F5), Color(0x323438))
    val externalBorder: JBColor = JBColor(Color(0xADB1B8), Color(0x6B6F76))
    val title: JBColor = JBColor(Color(0x1F2329), Color(0xDFE1E5))
    val subtitle: JBColor = JBColor(Color(0x6C707E), Color(0x9DA0A8))
    val edge: JBColor = JBColor(Color(0x9AA0AA), Color(0x6E727A))
    val edgeHighlight: JBColor = JBColor(Color(0x3574F0), Color(0x548AF7))
    val selection: JBColor = JBColor(Color(0x3574F0), Color(0x548AF7))
    val problem: JBColor = JBColor(Color(0xC9211E), Color(0xF07C7A))

    fun accentFor(kind: EntityKind): Color = ACCENTS[kind] ?: ACCENTS.getValue(EntityKind.OTHER)

    /** Same accent at low opacity, for the tint behind a node's title bar. */
    fun tintFor(kind: EntityKind, alpha: Int): Color =
        accentFor(kind).let { Color(it.red, it.green, it.blue, alpha) }
}
