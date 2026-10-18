package com.grahambrooks.backstage.catalog.ui

import com.grahambrooks.backstage.catalog.model.CatalogGraph
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
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.SearchTextField
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
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

    private val problemsLabel = JBLabel().apply {
        icon = AllIcons.General.Warning
        border = JBUI.Borders.empty(4, 8)
        isVisible = false
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
        toolbar.targetComponent = canvas

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
        add(canvas, BorderLayout.CENTER)
        add(footer, BorderLayout.SOUTH)

        installFind()
        canvas.onLayoutChanged = ::updateLegend
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
        matches = canvas.matching(findField.text)
        if (restart) matchIndex = 0
        matchIndex = matchIndex.coerceIn(0, (matches.size - 1).coerceAtLeast(0))
        matches.getOrNull(matchIndex)?.let { canvas.reveal(it, zoomToRead = true) }
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
        updateProblems(graph)
        updateStatus(graph, selected = null)
        canvas.onSelectionChanged = { node -> updateStatus(graph, node) }
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
        problemsLabel.isVisible = graph.problems.isNotEmpty()
        if (graph.problems.isEmpty()) return
        val first = graph.problems.first().message
        problemsLabel.text = if (graph.problems.size == 1) {
            first
        } else {
            "$first (+${graph.problems.size - 1} more)"
        }
        problemsLabel.toolTipText = graph.problems.joinToString("<br/>", "<html>", "</html>") { it.message }
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
        add(object : ToggleAction("Focus on Selection", FOCUS_TOGGLE_HINT, AllIcons.General.Locate) {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun isSelected(event: AnActionEvent) = canvas.isFocusMode()
            override fun setSelected(event: AnActionEvent, state: Boolean) = canvas.setFocusMode(state)
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
            preferredSize = Dimension(0, 26)
        }

        override fun paintComponent(g: Graphics) {
            super.paintComponent(g)
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.font = UIUtil.getLabelFont().deriveFont(Font.PLAIN, JBUI.scaleFontSize(10f).toFloat())
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
        const val FOCUS_TOGGLE_HINT =
            "Draw only the selected entity and what it is joined to; the focus follows the selection"
        const val OWNER_TOGGLE_HINT =
            "Show each entity's owner as a badge instead of drawing an ownedBy edge to it"
    }
}
