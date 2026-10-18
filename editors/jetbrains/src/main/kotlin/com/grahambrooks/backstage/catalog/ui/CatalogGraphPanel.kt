package com.grahambrooks.backstage.catalog.ui

import com.grahambrooks.backstage.catalog.model.CatalogEdge
import com.grahambrooks.backstage.catalog.model.CatalogGraph
import com.grahambrooks.backstage.catalog.model.CatalogNode
import com.grahambrooks.backstage.catalog.model.EntityRef
import com.grahambrooks.backstage.catalog.model.Focus
import com.grahambrooks.backstage.catalog.model.OwnerBadges
import com.grahambrooks.backstage.catalog.layout.GraphLayout
import com.grahambrooks.backstage.catalog.layout.LayeredLayout
import com.grahambrooks.backstage.catalog.layout.NodeBounds
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.AlphaComposite
import java.awt.BasicStroke
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseWheelEvent
import java.awt.geom.AffineTransform
import java.awt.geom.CubicCurve2D
import java.awt.geom.Ellipse2D
import java.awt.geom.NoninvertibleTransformException
import java.awt.geom.Path2D
import java.awt.geom.Point2D
import java.awt.geom.RoundRectangle2D
import javax.swing.SwingUtilities
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The catalog canvas: draws the entity graph, and handles zoom, pan, hover and selection.
 *
 * Drawing is plain Java2D rather than a diagram framework or an embedded browser. The IntelliJ
 * diagram API (`com.intellij.diagram`) is Ultimate-only, and a JCEF view would mean shipping a
 * JavaScript bundle for a picture this simple. Java2D keeps the plugin working in Community
 * editions with no bundled runtime of its own.
 */
class CatalogGraphPanel : JBPanel<CatalogGraphPanel>() {

    /** Invoked when the user double-clicks a node declared in the file. */
    var onNavigate: ((CatalogNode) -> Unit)? = null

    /** Invoked whenever the selection changes, including on deselect. */
    var onSelectionChanged: ((CatalogNode?) -> Unit)? = null

    private var graph: CatalogGraph = CatalogGraph.EMPTY

    /** What is actually laid out and painted: [graph] after the external and owner toggles. */
    var drawnGraph: CatalogGraph = CatalogGraph.EMPTY
        private set
    private var allOwners: Map<EntityRef, List<CatalogNode>> = emptyMap()

    /** Owners drawn as badges: [allOwners] while the toggle is on, otherwise nothing. */
    private var owners: Map<EntityRef, List<CatalogNode>> = emptyMap()
    private var layout: GraphLayout = GraphLayout.EMPTY

    /** The layout before focus mode cuts it down; Find searches and orders by this one. */
    private var fullLayout: GraphLayout = GraphLayout.EMPTY

    /** Invoked whenever what is drawn changes -- a toggle, a new file, or a focus move. */
    var onLayoutChanged: (() -> Unit)? = null

    private var scale: Double = 1.0
    private var originX: Double = 0.0
    private var originY: Double = 0.0

    private var selected: EntityRef? = null
    private var hovered: EntityRef? = null
    private var highlighted: Set<EntityRef> = emptySet()

    private var showExternal: Boolean = true
    private var ownersAsBadges: Boolean = true
    private var focusMode: Boolean = false

    /** Set when a fit was asked for before the panel had a size to fit into. */
    private var fitPending: Boolean = false

    private var dragAnchor: Point2D? = null
    private var dragOrigin: Pair<Double, Double>? = null

    init {
        isOpaque = true
        background = CatalogPalette.background
        // The canvas pans and zooms itself, so it must never ask its container for the room the
        // graph needs: a preferred size that tracks the layout makes the split editor grow past
        // the window instead of clipping.
        preferredSize = Dimension(720, 520)
        minimumSize = Dimension(0, 0)
        toolTipText = ""
        installMouseHandlers()
        addComponentListener(object : ComponentAdapter() {
            override fun componentResized(event: ComponentEvent) {
                if (fitPending) fitToWindow() else clampOrigin()
                repaint()
            }
        })
    }

    // --- Public API -----------------------------------------------------------------------

    fun setGraph(graph: CatalogGraph, preserveViewport: Boolean = true) {
        this.graph = graph
        rebuildLayout()
        if (selected != null && selected !in graph.nodes) {
            select(null)
        }
        if (!preserveViewport) {
            fitPending = true
            fitToWindow()
        }
        repaint()
    }

    fun setShowExternal(show: Boolean) {
        if (showExternal == show) return
        showExternal = show
        rebuildLayout()
        repaint()
    }

    fun isShowingExternal(): Boolean = showExternal

    fun setOwnersAsBadges(badges: Boolean) {
        if (ownersAsBadges == badges) return
        ownersAsBadges = badges
        rebuildLayout()
        repaint()
    }

    fun isShowingOwnersAsBadges(): Boolean = ownersAsBadges

    /**
     * With focus on, only the selection and what it is joined to are drawn, laid out afresh, and
     * the focus follows the selection. Nothing selected draws the whole graph.
     */
    fun setFocusMode(on: Boolean) {
        if (focusMode == on) return
        focusMode = on
        rebuildLayout()
        fitToWindow()
        repaint()
    }

    fun isFocusMode(): Boolean = focusMode

    fun zoomBy(factor: Double) {
        zoomAround(factor, Point2D.Double(width / 2.0, height / 2.0))
    }

    /**
     * Selects [ref] and pans to it if it is not already wholly on screen. With [zoomToRead], a
     * view zoomed out too far to read is first brought back to actual size -- right for Find,
     * wrong for following the caret, where the user chose the zoom and should keep it.
     */
    fun reveal(ref: EntityRef, zoomToRead: Boolean) {
        if (ref !in fullLayout.nodes) return
        // Selecting first: in focus mode it re-lays the graph out around [ref].
        select(ref)
        val bounds = layout.nodes[ref] ?: return
        val zoomed = zoomToRead && scale < LABEL_SCALE_THRESHOLD
        if (zoomed) scale = 1.0
        val left = originX + bounds.x * scale
        val top = originY + bounds.y * scale
        val onScreen = left >= 0 && top >= 0 &&
            left + bounds.width * scale <= width && top + bounds.height * scale <= height
        if (zoomed || !onScreen) {
            originX = width / 2.0 - bounds.centerX * scale
            originY = height / 2.0 - bounds.centerY * scale
            clampOrigin()
        }
        repaint()
    }

    /**
     * Drawn entities whose title or reference contains [query], ignoring case, in reading order:
     * top row first, then left to right.
     */
    fun matching(query: String): List<EntityRef> {
        val needle = query.trim()
        if (needle.isEmpty()) return emptyList()
        return fullLayout.nodes.values
            .filter { it.node.title.contains(needle, ignoreCase = true) || it.node.ref.toString().contains(needle, ignoreCase = true) }
            .sortedWith(compareBy({ it.y }, { it.x }))
            .map { it.node.ref }
    }

    fun resetZoom() {
        scale = 1.0
        centreContent()
        repaint()
    }

    /** Scales and centres so the whole graph is visible, with a little breathing room. */
    fun fitToWindow() {
        // The first fit usually arrives before the tab has been laid out; the resize that
        // follows completes it.
        if (layout.width <= 0 || layout.height <= 0 || width <= 0 || height <= 0) return
        fitPending = false
        val fit = min(width / layout.width, height / layout.height)
        scale = fit.coerceIn(MIN_SCALE, 1.0)
        centreContent()
        repaint()
    }

    // --- Layout ---------------------------------------------------------------------------

    private fun visibleGraph(): CatalogGraph {
        if (showExternal) return graph
        val nodes = graph.nodes.filterValues { !it.external }
        return graph.copy(
            nodes = nodes,
            edges = graph.edges.filter { it.from in nodes && it.to in nodes },
        )
    }

    private fun rebuildLayout() {
        // Badges come from the whole graph: an owner written in this file is a fact about the
        // entity, not a placeholder, so hiding external references does not hide it.
        allOwners = OwnerBadges.fold(graph).owners
        owners = if (ownersAsBadges) allOwners else emptyMap()
        val unfocused = if (ownersAsBadges) OwnerBadges.fold(visibleGraph()).graph else visibleGraph()
        val focus = selected?.takeIf { focusMode && it in unfocused.nodes }
        drawnGraph = focus?.let { ref ->
            Focus.around(unfocused, ref, owned = owners.filterValues { list -> list.any { it.ref == ref } }.keys)
        } ?: unfocused

        val metrics = getFontMetrics(titleFont())
        val subMetrics = getFontMetrics(subtitleFont())
        val badgeMetrics = getFontMetrics(labelFont())
        val engine = LayeredLayout(sizer = { node ->
            val titleWidth = metrics.stringWidth(node.title).toDouble()
            val subtitleWidth = subMetrics.stringWidth(subtitleOf(node)).toDouble()
            val badge = badgeText(node.ref)
            val badgeWidth = badge?.let { badgeMetrics.stringWidth(it) + BADGE_CHROME } ?: 0.0
            val width = (maxOf(titleWidth, subtitleWidth, badgeWidth) + TEXT_INSET * 2 + ACCENT_WIDTH)
                .coerceIn(MIN_NODE_WIDTH, MAX_NODE_WIDTH)
            width to if (badge == null) NODE_HEIGHT else NODE_HEIGHT_WITH_BADGE
        })
        fullLayout = engine.layout(unfocused)
        layout = if (focus == null) fullLayout else engine.layout(drawnGraph)
        onLayoutChanged?.invoke()
    }

    private fun badgeText(ref: EntityRef): String? =
        owners[ref]?.takeIf { it.isNotEmpty() }?.joinToString(", ") { it.title }

    private fun centreContent() {
        originX = (width - layout.width * scale) / 2
        originY = (height - layout.height * scale) / 2
    }

    /** Keeps at least a sliver of the graph on screen, so panning can never lose it entirely. */
    private fun clampOrigin() {
        if (layout.nodes.isEmpty()) return
        val keepX = min(KEEP_VISIBLE, width / 2.0)
        val keepY = min(KEEP_VISIBLE, height / 2.0)
        originX = originX.coerceIn(keepX - layout.width * scale, width - keepX)
        originY = originY.coerceIn(keepY - layout.height * scale, height - keepY)
    }

    // --- Painting -------------------------------------------------------------------------

    override fun paintComponent(g: Graphics) {
        super.paintComponent(g)
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
            g2.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE)

            g2.color = CatalogPalette.background
            g2.fillRect(0, 0, width, height)

            if (layout.nodes.isEmpty()) {
                paintEmptyState(g2)
                return
            }

            g2.transform(viewTransform())

            for (edge in drawnGraph.edges) paintEdge(g2, edge)
            for (bounds in layout.nodes.values) paintNode(g2, bounds)
        } finally {
            g2.dispose()
        }
    }

    private fun paintEmptyState(g2: Graphics2D) {
        val message = if (graph.problems.isEmpty()) {
            "No Backstage entities found in this file"
        } else {
            "No entities could be read -- see the problems above"
        }
        g2.font = titleFont()
        g2.color = CatalogPalette.subtitle
        val metrics = g2.fontMetrics
        g2.drawString(
            message,
            (width - metrics.stringWidth(message)) / 2,
            height / 2,
        )
    }

    private fun viewTransform(): AffineTransform =
        AffineTransform().apply {
            translate(originX, originY)
            scale(scale, scale)
        }

    private fun paintNode(g2: Graphics2D, bounds: NodeBounds) {
        val node = bounds.node
        val dimmed = highlighted.isNotEmpty() && node.ref !in highlighted
        val composite = g2.composite
        if (dimmed) g2.composite = AlphaComposite.getInstance(AlphaComposite.SRC_OVER, DIM_ALPHA)

        val shape = RoundRectangle2D.Double(bounds.x, bounds.y, bounds.width, bounds.height, ARC, ARC)

        g2.color = if (node.external) CatalogPalette.externalFill else CatalogPalette.nodeFill
        g2.fill(shape)

        // A tinted band behind the accent bar ties the node to its kind without shouting.
        g2.color = CatalogPalette.tintFor(node.kind, if (node.external) 24 else 40)
        g2.fill(RoundRectangle2D.Double(bounds.x, bounds.y, bounds.width, bounds.height, ARC, ARC))

        g2.color = CatalogPalette.accentFor(node.kind)
        val accent = Path2D.Double()
        accent.append(RoundRectangle2D.Double(bounds.x, bounds.y, ACCENT_WIDTH * 2, bounds.height, ARC, ARC), false)
        // Restore the previous clip, never null it: a null clip lifts Swing's clip to this
        // component's bounds, and everything painted afterwards spills across the whole window.
        val clip = g2.clip
        g2.clip(shape)
        g2.fill(accent)
        g2.clip = clip

        val isSelected = node.ref == selected
        val isHovered = node.ref == hovered
        g2.stroke = when {
            isSelected -> BasicStroke(2.4f)
            node.external -> BasicStroke(1.4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND, 4f, EXTERNAL_DASH, 0f)
            else -> BasicStroke(1.2f)
        }
        g2.color = when {
            isSelected -> CatalogPalette.selection
            isHovered -> CatalogPalette.edgeHighlight
            node.external -> CatalogPalette.externalBorder
            else -> CatalogPalette.nodeBorder
        }
        g2.draw(shape)

        val textX = (bounds.x + ACCENT_WIDTH + TEXT_INSET).toFloat()
        g2.font = if (node.external) titleFont().deriveFont(Font.ITALIC) else titleFont()
        g2.color = CatalogPalette.title
        val available = (bounds.width - ACCENT_WIDTH - TEXT_INSET * 2).toInt()
        g2.drawString(
            truncate(node.title, g2, available),
            textX,
            (bounds.y + 22).toFloat(),
        )

        g2.font = subtitleFont()
        g2.color = CatalogPalette.subtitle
        g2.drawString(
            truncate(subtitleOf(node), g2, available),
            textX,
            (bounds.y + 39).toFloat(),
        )

        badgeText(node.ref)?.let { paintOwnerBadge(g2, bounds, it, available) }

        g2.composite = composite
    }

    /**
     * A pill under the subtitle naming the owner, tinted with the owner's kind. It replaces the
     * `ownedBy` edge, so it carries the same dashed outline when the owner is a placeholder.
     */
    private fun paintOwnerBadge(g2: Graphics2D, bounds: NodeBounds, text: String, available: Int) {
        val owner = owners.getValue(bounds.node.ref).first()
        g2.font = labelFont()
        val metrics = g2.fontMetrics
        val label = truncate(text, g2, (available - BADGE_CHROME).toInt())
        val x = bounds.x + ACCENT_WIDTH + TEXT_INSET - BADGE_PADDING / 2
        val y = bounds.y + BADGE_TOP
        val pill = RoundRectangle2D.Double(
            x, y, metrics.stringWidth(label) + BADGE_CHROME, BADGE_HEIGHT, BADGE_HEIGHT, BADGE_HEIGHT,
        )

        g2.color = CatalogPalette.tintFor(owner.kind, 44)
        g2.fill(pill)
        if (owner.external) {
            g2.color = CatalogPalette.externalBorder
            g2.stroke = BasicStroke(1f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND, 4f, BADGE_DASH, 0f)
            g2.draw(pill)
        }

        g2.color = CatalogPalette.accentFor(owner.kind)
        val dot = BADGE_HEIGHT - 8
        g2.fill(Ellipse2D.Double(x + BADGE_PADDING, y + 4, dot, dot))

        g2.color = CatalogPalette.title
        if (owner.external) g2.font = labelFont().deriveFont(Font.ITALIC)
        g2.drawString(
            label,
            (x + BADGE_PADDING + dot + BADGE_GAP).toFloat(),
            (y + (BADGE_HEIGHT + metrics.ascent - metrics.descent) / 2).toFloat(),
        )
    }

    private fun paintEdge(g2: Graphics2D, edge: CatalogEdge) {
        val from = layout.nodes[edge.from] ?: return
        val to = layout.nodes[edge.to] ?: return

        val active = highlighted.isEmpty() || (edge.from in highlighted && edge.to in highlighted)
        val composite = g2.composite
        if (!active) g2.composite = AlphaComposite.getInstance(AlphaComposite.SRC_OVER, DIM_ALPHA)

        val dangling = edge.isDangling(graph.nodes)
        // The relation keeps its colour when highlighted; a selection thickens it instead.
        val emphasis = if (highlighted.isNotEmpty() && active) 0.9f else 0f
        g2.color = CatalogPalette.relationColour(edge.type)
        g2.stroke = if (dangling) {
            BasicStroke(1.3f + emphasis, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND, 4f, EXTERNAL_DASH, 0f)
        } else {
            BasicStroke(1.5f + emphasis, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
        }

        val (start, end) = anchors(from, to)
        val curve = CubicCurve2D.Double(
            start.x, start.y,
            start.x, start.y + (end.y - start.y) * CURVE_TENSION,
            end.x, end.y - (end.y - start.y) * CURVE_TENSION,
            end.x, end.y,
        )
        g2.draw(curve)
        paintArrowHead(g2, curve)

        if (scale >= LABEL_SCALE_THRESHOLD) {
            paintEdgeLabel(g2, curve, edge)
        }

        g2.composite = composite
    }

    /**
     * Picks which side of each node the edge leaves and enters. Relations run both up (a
     * component to its system) and down (a component to its owning group), so anchoring purely
     * bottom-to-top would draw half the edges backwards through their own nodes.
     */
    private fun anchors(from: NodeBounds, to: NodeBounds): Pair<Point2D.Double, Point2D.Double> {
        val sameLayer = kotlin.math.abs(from.centerY - to.centerY) < 1.0
        return when {
            sameLayer && to.centerX >= from.centerX ->
                Point2D.Double(from.right, from.centerY) to Point2D.Double(to.x, to.centerY)
            sameLayer ->
                Point2D.Double(from.x, from.centerY) to Point2D.Double(to.right, to.centerY)
            to.centerY > from.centerY ->
                Point2D.Double(from.centerX, from.bottom) to Point2D.Double(to.centerX, to.y)
            else ->
                Point2D.Double(from.centerX, from.y) to Point2D.Double(to.centerX, to.bottom)
        }
    }

    private fun paintArrowHead(g2: Graphics2D, curve: CubicCurve2D.Double) {
        val tipX = curve.x2
        val tipY = curve.y2
        val angle = atan2(tipY - curve.ctrly2, tipX - curve.ctrlx2)
        val head = Path2D.Double().apply {
            moveTo(tipX, tipY)
            lineTo(
                tipX - ARROW_LENGTH * cos(angle - ARROW_SPREAD),
                tipY - ARROW_LENGTH * sin(angle - ARROW_SPREAD),
            )
            lineTo(
                tipX - ARROW_LENGTH * cos(angle + ARROW_SPREAD),
                tipY - ARROW_LENGTH * sin(angle + ARROW_SPREAD),
            )
            closePath()
        }
        g2.stroke = BasicStroke(1f)
        g2.fill(head)
    }

    private fun paintEdgeLabel(g2: Graphics2D, curve: CubicCurve2D.Double, edge: CatalogEdge) {
        val mid = pointOnCurve(curve, 0.5)
        val text = edge.type.displayName
        g2.font = labelFont()
        val metrics = g2.fontMetrics
        val textWidth = metrics.stringWidth(text)
        val boxWidth = textWidth + 10.0
        val boxHeight = metrics.height + 2.0
        val boxX = mid.x - boxWidth / 2
        val boxY = mid.y - boxHeight / 2

        g2.color = CatalogPalette.background
        g2.fill(RoundRectangle2D.Double(boxX, boxY, boxWidth, boxHeight, 6.0, 6.0))
        g2.color = CatalogPalette.subtitle
        g2.drawString(text, (boxX + 5).toFloat(), (boxY + metrics.ascent).toFloat())
    }

    private fun pointOnCurve(curve: CubicCurve2D.Double, t: Double): Point2D.Double {
        val u = 1 - t
        val x = u * u * u * curve.x1 + 3 * u * u * t * curve.ctrlx1 +
            3 * u * t * t * curve.ctrlx2 + t * t * t * curve.x2
        val y = u * u * u * curve.y1 + 3 * u * u * t * curve.ctrly1 +
            3 * u * t * t * curve.ctrly2 + t * t * t * curve.y2
        return Point2D.Double(x, y)
    }

    // --- Interaction ----------------------------------------------------------------------

    private fun installMouseHandlers() {
        val handler = object : MouseAdapter() {
            override fun mousePressed(event: MouseEvent) {
                requestFocusInWindow()
                dragAnchor = event.point
                dragOrigin = originX to originY
            }

            override fun mouseReleased(event: MouseEvent) {
                dragAnchor = null
                dragOrigin = null
                cursor = Cursor.getDefaultCursor()
            }

            override fun mouseDragged(event: MouseEvent) {
                val anchor = dragAnchor ?: return
                val origin = dragOrigin ?: return
                cursor = Cursor.getPredefinedCursor(Cursor.MOVE_CURSOR)
                originX = origin.first + (event.x - anchor.x)
                originY = origin.second + (event.y - anchor.y)
                clampOrigin()
                repaint()
            }

            override fun mouseClicked(event: MouseEvent) {
                if (!SwingUtilities.isLeftMouseButton(event)) return
                val hit = nodeAt(event)
                if (event.clickCount == 2 && hit != null && !hit.node.external) {
                    onNavigate?.invoke(hit.node)
                    return
                }
                select(hit?.node?.ref)
            }

            override fun mouseMoved(event: MouseEvent) {
                val hit = nodeAt(event)?.node?.ref
                if (hit != hovered) {
                    hovered = hit
                    cursor = if (hit == null) {
                        Cursor.getDefaultCursor()
                    } else {
                        Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
                    }
                    repaint()
                }
            }

            override fun mouseExited(event: MouseEvent) {
                if (hovered != null) {
                    hovered = null
                    repaint()
                }
            }

            override fun mouseWheelMoved(event: MouseWheelEvent) {
                if (!event.isControlDown && !event.isMetaDown) {
                    // Plain wheel scrolls the canvas vertically; Shift scrolls it sideways.
                    val delta = event.preciseWheelRotation * WHEEL_PAN_STEP
                    if (event.isShiftDown) originX -= delta else originY -= delta
                    clampOrigin()
                    repaint()
                    return
                }
                val factor = if (event.preciseWheelRotation < 0) ZOOM_STEP else 1 / ZOOM_STEP
                zoomAround(factor, event.point)
            }
        }
        addMouseListener(handler)
        addMouseMotionListener(handler)
        addMouseWheelListener(handler)
    }

    private fun select(ref: EntityRef?) {
        if (selected == ref) return
        selected = ref
        highlighted = ref?.let { graph.neighbourhoodOf(it) }.orEmpty()
        if (focusMode) {
            rebuildLayout()
            fitToWindow()
        }
        onSelectionChanged?.invoke(ref?.let { graph.nodes[it] })
        repaint()
    }

    /** Zooms about [anchor] in component coordinates, so the point under the cursor stays put. */
    private fun zoomAround(factor: Double, anchor: Point2D) {
        val next = (scale * factor).coerceIn(MIN_SCALE, MAX_SCALE)
        if (next == scale) return
        val graphPoint = toGraphSpace(anchor) ?: return
        scale = next
        originX = anchor.x - graphPoint.x * scale
        originY = anchor.y - graphPoint.y * scale
        clampOrigin()
        repaint()
    }

    private fun nodeAt(event: MouseEvent): NodeBounds? {
        val point = toGraphSpace(event.point) ?: return null
        return layout.at(point.x to point.y)
    }

    private fun toGraphSpace(point: Point2D): Point2D.Double? = try {
        val inverse = viewTransform().createInverse()
        inverse.transform(point, Point2D.Double()) as Point2D.Double
    } catch (_: NoninvertibleTransformException) {
        null
    }

    override fun getToolTipText(event: MouseEvent): String? {
        val node = nodeAt(event)?.node ?: return null
        return buildString {
            append("<html><body style='width:280px'>")
            append("<b>").append(escape(node.title)).append("</b><br/>")
            append("<code>").append(escape(node.ref.toString())).append("</code>")
            node.description?.takeIf { it.isNotBlank() }?.let {
                append("<br/><br/>").append(escape(it))
            }
            val facts = buildList {
                node.type?.let { add("type: $it") }
                node.lifecycle?.let { add("lifecycle: $it") }
                if (node.tags.isNotEmpty()) add("tags: ${node.tags.joinToString(", ")}")
                allOwners[node.ref]?.let { list ->
                    add("owner: ${list.joinToString(", ") { it.ref.toString() }}")
                }
            }
            if (facts.isNotEmpty()) {
                append("<br/><br/>").append(escape(facts.joinToString(" &middot; ")))
            }
            if (node.external) {
                append("<br/><br/><i>Referenced but not defined in this file.</i>")
            } else {
                append("<br/><br/><i>Double-click to jump to the definition.</i>")
            }
            append("</body></html>")
        }
    }

    // --- Text helpers ---------------------------------------------------------------------

    private fun subtitleOf(node: CatalogNode): String {
        if (node.external) return "${node.kind.displayName} · external"
        val extras = listOfNotNull(node.type, node.lifecycle)
        return if (extras.isEmpty()) {
            node.kind.displayName
        } else {
            "${node.kind.displayName} · ${extras.joinToString(" · ")}"
        }
    }

    private fun truncate(text: String, g2: Graphics2D, available: Int): String {
        val metrics = g2.fontMetrics
        if (metrics.stringWidth(text) <= available) return text
        val ellipsis = "…"
        var end = text.length
        while (end > 1 && metrics.stringWidth(text.take(end) + ellipsis) > available) end--
        return text.take(end) + ellipsis
    }

    private fun escape(text: String): String = text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")

    private fun titleFont(): Font = UIUtil.getLabelFont().deriveFont(Font.BOLD, JBUI.scaleFontSize(13f).toFloat())
    private fun subtitleFont(): Font = UIUtil.getLabelFont().deriveFont(Font.PLAIN, JBUI.scaleFontSize(11f).toFloat())
    private fun labelFont(): Font = UIUtil.getLabelFont().deriveFont(Font.PLAIN, JBUI.scaleFontSize(10f).toFloat())

    private companion object {
        const val NODE_HEIGHT = 52.0
        const val NODE_HEIGHT_WITH_BADGE = 70.0
        const val BADGE_TOP = 47.0
        const val BADGE_HEIGHT = 16.0
        const val BADGE_PADDING = 6.0
        const val BADGE_GAP = 4.0
        /** Padding both sides, the kind dot and the gap after it. */
        const val BADGE_CHROME = BADGE_PADDING * 2 + (BADGE_HEIGHT - 8) + BADGE_GAP
        const val MIN_NODE_WIDTH = 150.0
        const val MAX_NODE_WIDTH = 320.0
        const val ACCENT_WIDTH = 5.0
        const val TEXT_INSET = 12.0
        const val ARC = 10.0
        const val CURVE_TENSION = 0.45
        const val ARROW_LENGTH = 9.0
        const val ARROW_SPREAD = 0.42
        const val ZOOM_STEP = 1.12
        // Low enough that Fit to Window can show a catalog of a few dozen entities whole.
        const val MIN_SCALE = 0.1
        const val MAX_SCALE = 3.0
        const val WHEEL_PAN_STEP = 48.0
        const val KEEP_VISIBLE = 48.0
        const val LABEL_SCALE_THRESHOLD = 0.72
        const val DIM_ALPHA = 0.22f
        val EXTERNAL_DASH = floatArrayOf(5f, 4f)
        val BADGE_DASH = floatArrayOf(3f, 2f)
    }
}
