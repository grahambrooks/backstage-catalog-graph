package com.grahambrooks.backstage.catalog.ui

import com.grahambrooks.backstage.catalog.model.CatalogGraph
import com.grahambrooks.backstage.catalog.model.CatalogNode
import com.grahambrooks.backstage.catalog.model.EntityKind
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.Separator
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.actionSystem.ActionManager
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
import javax.swing.BorderFactory

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

    init {
        val toolbar = ActionManager.getInstance()
            .createActionToolbar(TOOLBAR_PLACE, buildActions(), true)
        toolbar.targetComponent = canvas

        val header = JBPanel<JBPanel<*>>(BorderLayout()).apply {
            add(toolbar.component, BorderLayout.WEST)
            add(problemsLabel, BorderLayout.CENTER)
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
    }

    fun show(graph: CatalogGraph, preserveViewport: Boolean) {
        canvas.setGraph(graph, preserveViewport)
        legend.kinds = graph.nodes.values.map { it.kind }.distinct().sortedBy { it.rank }
        legend.repaint()
        updateProblems(graph)
        updateStatus(graph, selected = null)
        canvas.onSelectionChanged = { node -> updateStatus(graph, node) }
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
            override fun setSelected(event: AnActionEvent, state: Boolean) = canvas.setShowExternal(state)
        })
        add(Separator.getInstance())
        add(simpleAction("Reload Graph", AllIcons.Actions.Refresh) { onRefresh() })
    }

    private fun simpleAction(text: String, icon: javax.swing.Icon, run: () -> Unit): AnAction =
        object : AnAction(text, text, icon) {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun actionPerformed(event: AnActionEvent) = run()
        }

    /** A compact key of the entity kinds actually present, so the accent colours mean something. */
    private class LegendStrip : JBPanel<LegendStrip>(FlowLayout(FlowLayout.LEFT, 12, 4)) {
        var kinds: List<EntityKind> = emptyList()

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
            } finally {
                g2.dispose()
            }
        }
    }

    private companion object {
        const val TOOLBAR_PLACE = "BackstageCatalogGraphToolbar"
        const val EXTERNAL_TOGGLE_HINT =
            "Show placeholders for entities referenced by this file but defined elsewhere"
    }
}
