package com.grahambrooks.backstage.catalog.ui

import com.grahambrooks.backstage.catalog.model.CatalogGraph
import com.grahambrooks.backstage.catalog.model.CatalogProblem
import com.grahambrooks.backstage.catalog.model.CatalogNode
import com.grahambrooks.backstage.catalog.model.EntityKind
import com.grahambrooks.backstage.catalog.model.EntityRef
import com.grahambrooks.backstage.catalog.model.RelationType
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.Separator
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.CommonShortcuts
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.ui.SearchTextField
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Cursor
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.BorderFactory
import javax.swing.event.DocumentEvent

/**
 * The whole graph tab: toolbar, canvas, a legend, and a strip that surfaces anything the
 * descriptor got wrong.
 */
class CatalogGraphView(
    private val onRefresh: () -> Unit,
) : JBPanel<CatalogGraphView>(BorderLayout()) {

    val canvas = CatalogGraphPanel()
    private val outline = CatalogOutline()

    /** The canvas and the outline share the centre; only one shows at a time. */
    private val centre = JBPanel<JBPanel<*>>(CardLayout()).apply {
        add(canvas, GRAPH_CARD)
        add(outline, OUTLINE_CARD)
    }
    private var showingOutline = false

    /** Invoked to select a declared entity's YAML, from the graph or the outline. */
    var onNavigate: ((node: CatalogNode, focus: Boolean) -> Unit)? = null

    /** Invoked with a problem's source offset when it is picked from the problems list. */
    var onProblemChosen: ((offset: Int) -> Unit)? = null

    private var problems: List<CatalogProblem> = emptyList()

    private val problemsLabel = JBLabel().apply {
        icon = AllIcons.General.Warning
        border = JBUI.Borders.empty(4, 8)
        isVisible = false
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    private val statusLabel = JBLabel().apply {
        border = JBUI.Borders.empty(4, 8)
        foreground = CatalogPalette.subtitle
    }

    private val legend = LegendStrip()

    private val findField = SearchTextField(false).apply {
        textEditor.emptyText.text = "Find entity"
        textEditor.columns = 14
    }

    private val findStatus = JBLabel().apply {
        border = JBUI.Borders.empty(0, 6)
        foreground = CatalogPalette.subtitle
    }

    private var matches: List<EntityRef> = emptyList()
    private var matchIndex = 0

    init {
        val toolbar = ActionManager.getInstance()
            .createActionToolbar(TOOLBAR_PLACE, buildActions(), true)
        // The view, not the canvas: the toolbar updates its buttons from its target, and the
        // canvas is hidden while the outline shows -- which left Show Outline unable to switch back.
        toolbar.targetComponent = this

        val find = JBPanel<JBPanel<*>>(BorderLayout()).apply {
            add(findStatus, BorderLayout.WEST)
            add(findField, BorderLayout.CENTER)
            border = JBUI.Borders.empty(2, 4)
        }

        val header = JBPanel<JBPanel<*>>(BorderLayout()).apply {
            add(toolbar.component, BorderLayout.WEST)
            add(problemsLabel, BorderLayout.CENTER)
            add(find, BorderLayout.EAST)
            border = JBUI.Borders.customLineBottom(CatalogPalette.nodeBorder)
        }

        val footer = JBPanel<JBPanel<*>>(BorderLayout()).apply {
            add(legend, BorderLayout.WEST)
            add(statusLabel, BorderLayout.EAST)
            border = JBUI.Borders.customLineTop(CatalogPalette.nodeBorder)
        }

        add(header, BorderLayout.NORTH)
        add(centre, BorderLayout.CENTER)
        add(footer, BorderLayout.SOUTH)

        installFind()
        canvas.onLayoutChanged = ::updateLegend
        canvas.onNavigate = { node, focus -> onNavigate?.invoke(node, focus) }
        outline.onNavigate = { node, focus ->
            canvas.reveal(node.ref, zoomToRead = false)
            onNavigate?.invoke(node, focus)
        }
        problemsLabel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) = showProblems()
        })
    }

    /** Selects [ref] in whichever view is showing, following the caret in the YAML. */
    fun reveal(ref: EntityRef) {
        canvas.reveal(ref, zoomToRead = false)
        if (showingOutline) outline.reveal(ref)
    }

    /**
     * Every problem in a popup under the warning. Picking one with a source offset moves the
     * caret there; one without -- there are none today, but the model allows it -- does nothing.
     */
    private fun showProblems() {
        if (problems.isEmpty()) return
        JBPopupFactory.getInstance()
            .createPopupChooserBuilder(problems)
            .setRenderer(SimpleListCellRenderer.create("") { it.message })
            .setItemChosenCallback { problem -> problem.sourceOffset?.let { onProblemChosen?.invoke(it) } }
            .setTitle(if (problems.size == 1) "1 problem" else "${problems.size} problems")
            .createPopup()
            .showUnderneathOf(problemsLabel)
    }

    private fun setOutlineShowing(show: Boolean) {
        showingOutline = show
        (centre.layout as CardLayout).show(centre, if (show) OUTLINE_CARD else GRAPH_CARD)
        if (show) outline.show(canvas.visibleEntities())
    }

    /**
     * Typing selects and reveals the first match; Enter and Shift+Enter step through the rest,
     * and Escape clears the field and hands focus back to the graph. Ctrl/Cmd+F on the graph
     * jumps here.
     */
    private fun installFind() {
        findField.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(event: DocumentEvent) = runFind(restart = true)
        })
        findField.textEditor.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(event: KeyEvent) {
                when (event.keyCode) {
                    KeyEvent.VK_ENTER -> {
                        step(if (event.isShiftDown) -1 else 1)
                        event.consume()
                    }
                    KeyEvent.VK_ESCAPE -> {
                        findField.text = ""
                        canvas.requestFocusInWindow()
                        event.consume()
                    }
                }
            }
        })
        object : AnAction() {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun actionPerformed(event: AnActionEvent) {
                findField.requestFocusInWindow()
                findField.selectText()
            }
        }.registerCustomShortcutSet(CommonShortcuts.getFind(), this)
    }

    private fun runFind(restart: Boolean) {
        refreshMatches(restart)
        matches.getOrNull(matchIndex)?.let { canvas.reveal(it, zoomToRead = true) }
    }

    /**
     * Recomputes the matches and the "2 of 5" status without moving to one -- for when the graph
     * changes under an unchanged query, where jumping would pull the view away mid-edit.
     */
    private fun refreshMatches(restart: Boolean) {
        matches = canvas.matching(findField.text)
        if (restart) matchIndex = 0
        matchIndex = matchIndex.coerceIn(0, (matches.size - 1).coerceAtLeast(0))
        findStatus.text = when {
            findField.text.isBlank() -> ""
            matches.isEmpty() -> "No matches"
            else -> "${matchIndex + 1} of ${matches.size}"
        }
    }

    private fun step(direction: Int) {
        if (matches.isEmpty()) return
        matchIndex = (matchIndex + direction).mod(matches.size)
        runFind(restart = false)
    }

    fun show(graph: CatalogGraph, preserveViewport: Boolean) {
        canvas.setGraph(graph, preserveViewport)
        if (showingOutline) outline.show(canvas.visibleEntities())
        updateProblems(graph)
        updateStatus(graph, canvas.selectedNode())
        canvas.onSelectionChanged = { node -> updateStatus(graph, node) }
        refreshMatches(restart = false)
    }

    /** The legend describes what is drawn, so it follows the toolbar toggles as well as the file. */
    private fun updateLegend() {
        val drawn = canvas.drawnGraph
        legend.kinds = drawn.nodes.values.map { it.kind }.distinct().sortedBy { it.rank }
        legend.relations = drawn.edges.map { it.type }.distinct().sortedBy { it.ordinal }
        legend.revalidate()
        legend.repaint()
    }

    private fun updateProblems(graph: CatalogGraph) {
        problems = graph.problems
        problemsLabel.isVisible = graph.problems.isNotEmpty()
        if (graph.problems.isEmpty()) return
        val first = graph.problems.first().message
        problemsLabel.text = if (graph.problems.size == 1) {
            first
        } else {
            "$first (+${graph.problems.size - 1} more)"
        }
        problemsLabel.toolTipText = "Click to list every problem and jump to it"
    }

    private fun updateStatus(graph: CatalogGraph, selected: CatalogNode?) {
        statusLabel.text = when {
            selected != null -> selected.ref.toString()
            graph.isEmpty -> "No entities"
            else -> {
                val declared = graph.declaredNodes.size
                val external = graph.externalNodes.size
                val relations = graph.edges.size
                buildString {
                    append(declared).append(if (declared == 1) " entity" else " entities")
                    append(", ").append(relations).append(if (relations == 1) " relation" else " relations")
                    if (external > 0) append(", ").append(external).append(" external")
                }
            }
        }
    }

    private fun buildActions(): DefaultActionGroup = DefaultActionGroup().apply {
        add(simpleAction("Zoom In", AllIcons.General.ZoomIn) { canvas.zoomBy(1.2) })
        add(simpleAction("Zoom Out", AllIcons.General.ZoomOut) { canvas.zoomBy(1 / 1.2) })
        add(simpleAction("Fit to Window", AllIcons.General.FitContent) { canvas.fitToWindow() })
        add(simpleAction("Actual Size", AllIcons.General.ActualZoom) { canvas.resetZoom() })
        add(Separator.getInstance())
        add(object : ToggleAction("Show External References", EXTERNAL_TOGGLE_HINT, AllIcons.Nodes.Related) {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun isSelected(event: AnActionEvent) = canvas.isShowingExternal()
            override fun setSelected(event: AnActionEvent, state: Boolean) {
                canvas.setShowExternal(state)
                runFind(restart = false)
                if (showingOutline) outline.show(canvas.visibleEntities())
            }
        })
        add(object : ToggleAction("Show Owners as Badges", OWNER_TOGGLE_HINT, AllIcons.Nodes.Tag) {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun isSelected(event: AnActionEvent) = canvas.isShowingOwnersAsBadges()
            override fun setSelected(event: AnActionEvent, state: Boolean) {
                canvas.setOwnersAsBadges(state)
                runFind(restart = false)
            }
        })
        add(object : ToggleAction("Group by System", GROUP_TOGGLE_HINT, AllIcons.Actions.GroupBy) {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun isSelected(event: AnActionEvent) = canvas.isGroupingBySystem()
            override fun setSelected(event: AnActionEvent, state: Boolean) {
                canvas.setGroupBySystem(state)
                refreshMatches(restart = false)
            }
        })
        add(object : ToggleAction("Focus on Selection", FOCUS_TOGGLE_HINT, AllIcons.General.Locate) {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun isSelected(event: AnActionEvent) = canvas.isFocusMode()
            override fun setSelected(event: AnActionEvent, state: Boolean) = canvas.setFocusMode(state)
        })
        add(object : ToggleAction("Show Outline", OUTLINE_TOGGLE_HINT, AllIcons.Actions.ListFiles) {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun isSelected(event: AnActionEvent) = showingOutline
            override fun setSelected(event: AnActionEvent, state: Boolean) = setOutlineShowing(state)
        })
        add(Separator.getInstance())
        add(simpleAction("Reload Graph", AllIcons.Actions.Refresh) { onRefresh() })
    }

    private fun simpleAction(text: String, icon: javax.swing.Icon, run: () -> Unit): AnAction =
        object : AnAction(text, text, icon) {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun actionPerformed(event: AnActionEvent) = run()
        }

    /**
     * A compact key of the entity kinds and relations actually drawn, so the accent and edge
     * colours mean something.
     */
    private class LegendStrip : JBPanel<LegendStrip>(FlowLayout(FlowLayout.LEFT, 12, 4)) {
        var kinds: List<EntityKind> = emptyList()
        var relations: List<RelationType> = emptyList()

        init {
            border = BorderFactory.createEmptyBorder()
        }

        private fun legendFont(): Font = UIUtil.getLabelFont().deriveFont(Font.PLAIN, JBUI.scaleFontSize(10f).toFloat())

        /**
         * As wide as what [paintComponent] draws. The footer gives the legend its preferred width
         * and no more, so a fixed width here -- it used to be zero -- hides the legend entirely.
         */
        override fun getPreferredSize(): Dimension {
            val metrics = getFontMetrics(legendFont())
            var width = 8
            kinds.forEach { width += 12 + metrics.stringWidth(it.displayName) + 14 }
            if (relations.isNotEmpty()) width += 14
            relations.forEach { width += 16 + metrics.stringWidth(it.displayName) + 14 }
            return Dimension(width, JBUI.scale(26))
        }

        override fun paintComponent(g: Graphics) {
            super.paintComponent(g)
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.font = legendFont()
                var x = 8
                val metrics = g2.fontMetrics
                val baseline = height / 2 + metrics.ascent / 2 - 1
                for (kind in kinds) {
                    g2.color = CatalogPalette.accentFor(kind)
                    g2.fillRoundRect(x, height / 2 - 4, 8, 8, 3, 3)
                    x += 12
                    g2.color = CatalogPalette.subtitle
                    g2.drawString(kind.displayName, x, baseline)
                    x += metrics.stringWidth(kind.displayName) + 14
                }
                if (relations.isNotEmpty()) {
                    g2.color = CatalogPalette.nodeBorder
                    g2.drawLine(x, height / 2 - 6, x, height / 2 + 6)
                    x += 14
                }
                g2.stroke = java.awt.BasicStroke(2f)
                for (relation in relations) {
                    g2.color = CatalogPalette.relationColour(relation)
                    g2.drawLine(x, height / 2, x + 12, height / 2)
                    x += 16
                    g2.color = CatalogPalette.subtitle
                    g2.drawString(relation.displayName, x, baseline)
                    x += metrics.stringWidth(relation.displayName) + 14
                }
            } finally {
                g2.dispose()
            }
        }
    }

    private companion object {
        const val TOOLBAR_PLACE = "BackstageCatalogGraphToolbar"
        const val EXTERNAL_TOGGLE_HINT =
            "Show placeholders for entities referenced by this file but defined elsewhere"
        const val GRAPH_CARD = "graph"
        const val OUTLINE_CARD = "outline"
        const val GROUP_TOGGLE_HINT =
            "Draw each System as a box around the entities that are part of it"
        const val OUTLINE_TOGGLE_HINT =
            "Show the catalog as a tree of kind, entity and relations instead of a graph"
        const val FOCUS_TOGGLE_HINT =
            "Draw only the selected entity and what it is joined to; the focus follows the selection"
        const val OWNER_TOGGLE_HINT =
            "Show each entity's owner as a badge instead of drawing an ownedBy edge to it"
    }
}
