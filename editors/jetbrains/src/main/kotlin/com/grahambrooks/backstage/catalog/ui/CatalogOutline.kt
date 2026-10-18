package com.grahambrooks.backstage.catalog.ui

import com.grahambrooks.backstage.catalog.model.CatalogGraph
import com.grahambrooks.backstage.catalog.model.CatalogNode
import com.grahambrooks.backstage.catalog.model.EntityRef
import com.grahambrooks.backstage.catalog.model.Outline
import com.grahambrooks.backstage.catalog.model.OutlineEntity
import com.grahambrooks.backstage.catalog.model.OutlineRelation
import com.grahambrooks.backstage.catalog.model.OutlineSection
import com.intellij.ui.ColoredTreeCellRenderer
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.ui.tree.TreeUtil
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JTree
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreePath

/**
 * The outline view: the catalog as a tree of kind, entity, then each relation in or out (see
 * [Outline]). It reads at any size, which a picture of a large catalog does not.
 *
 * Selecting an entity selects its YAML, as clicking it in the graph does; selecting a relation
 * goes to the entity at its other end. A double-click also moves focus to the editor.
 */
class CatalogOutline : JBScrollPane() {

    /** Invoked to select a declared entity's YAML; `focus` is true for a double-click. */
    var onNavigate: ((node: CatalogNode, focus: Boolean) -> Unit)? = null

    private val root = DefaultMutableTreeNode()
    private val model = DefaultTreeModel(root)
    private val tree = Tree(model).apply {
        isRootVisible = false
        showsRootHandles = true
        cellRenderer = Renderer()
    }

    /** Set while the outline is following the caret, so that selection is not echoed back. */
    private var following = false

    init {
        setViewportView(tree)
        tree.addTreeSelectionListener { event ->
            if (!following) targetOf(event.path)?.let { onNavigate?.invoke(it, false) }
        }
        tree.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) {
                if (event.clickCount != 2) return
                val path = tree.getPathForLocation(event.x, event.y) ?: return
                targetOf(path)?.let { onNavigate?.invoke(it, true) }
            }
        })
    }

    /** Rebuilds from [graph], keeping which entities were expanded. */
    fun show(graph: CatalogGraph) {
        val expanded = entityNodes()
            .filter { tree.isExpanded(TreePath(it.path)) }
            .map { (it.userObject as OutlineEntity).node.ref }
            .toSet()

        root.removeAllChildren()
        for (section in Outline.of(graph)) {
            val sectionNode = DefaultMutableTreeNode(section)
            for (entity in section.entities) {
                val entityNode = DefaultMutableTreeNode(entity)
                entity.relations.forEach { entityNode.add(DefaultMutableTreeNode(it)) }
                sectionNode.add(entityNode)
            }
            root.add(sectionNode)
        }
        model.reload()

        root.children().toList().forEach { tree.expandPath(TreePath((it as DefaultMutableTreeNode).path)) }
        entityNodes()
            .filter { (it.userObject as OutlineEntity).node.ref in expanded }
            .forEach { tree.expandPath(TreePath(it.path)) }
    }

    /** Selects and scrolls to [ref]'s entry, without selecting its YAML again. */
    fun reveal(ref: EntityRef) {
        val node = entityNodes().firstOrNull { (it.userObject as OutlineEntity).node.ref == ref } ?: return
        following = true
        try {
            TreeUtil.selectPath(tree, TreePath(node.path), false)
        } finally {
            following = false
        }
    }

    private fun entityNodes(): List<DefaultMutableTreeNode> =
        root.children().toList().flatMap { section -> (section as DefaultMutableTreeNode).children().toList() }
            .map { it as DefaultMutableTreeNode }

    private fun targetOf(path: TreePath?): CatalogNode? {
        val node = when (val value = (path?.lastPathComponent as? DefaultMutableTreeNode)?.userObject) {
            is OutlineEntity -> value.node
            is OutlineRelation -> value.other
            else -> null
        }
        return node?.takeIf { !it.external }
    }

    private class Renderer : ColoredTreeCellRenderer() {
        override fun customizeCellRenderer(
            tree: JTree,
            value: Any?,
            selected: Boolean,
            expanded: Boolean,
            leaf: Boolean,
            row: Int,
            hasFocus: Boolean,
        ) {
            when (val item = (value as? DefaultMutableTreeNode)?.userObject) {
                is OutlineSection -> {
                    append(item.kind.displayName, SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES)
                    append("  ${item.entities.size}", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                }
                is OutlineEntity -> {
                    append(item.node.title, titleStyle(item.node))
                    append("  ${item.node.ref}", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                    if (item.node.external) append("  external", SimpleTextAttributes.GRAYED_ITALIC_ATTRIBUTES)
                }
                is OutlineRelation -> {
                    append(if (item.outgoing) "→ " else "← ", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                    append(
                        "${item.type.displayName}  ",
                        SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, CatalogPalette.relationColour(item.type)),
                    )
                    append(item.other.title, titleStyle(item.other))
                }
            }
        }

        private fun titleStyle(node: CatalogNode): SimpleTextAttributes =
            if (node.external) SimpleTextAttributes.REGULAR_ITALIC_ATTRIBUTES else SimpleTextAttributes.REGULAR_ATTRIBUTES
    }
}
