package com.grahambrooks.backstage.catalog.ui

import com.grahambrooks.backstage.catalog.model.CatalogGraph
import com.grahambrooks.backstage.catalog.model.CatalogGraphBuilder
import com.grahambrooks.backstage.catalog.model.CatalogNode
import com.grahambrooks.backstage.catalog.model.CatalogProblem
import com.grahambrooks.backstage.catalog.psi.YamlDocumentReader
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileEditor.FileEditorStateLevel
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiManager
import com.intellij.util.Alarm
import org.jetbrains.yaml.psi.YAMLFile
import java.beans.PropertyChangeListener
import javax.swing.JComponent

/**
 * The "Catalog" half of the split editor: keeps a [CatalogGraphView] in step with the YAML
 * document it is showing.
 *
 * Rebuilds are debounced. The graph is cheap to build, but re-laying it out on every keystroke
 * makes the picture jump while a name is being typed, which is worse than being a moment stale.
 */
class CatalogGraphFileEditor(
    private val project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor {

    private val view = CatalogGraphView(onRefresh = { rebuild(preserveViewport = false) })
    private val alarm = Alarm(Alarm.ThreadToUse.SWING_THREAD, this)
    private var built = false

    init {
        view.canvas.onNavigate = ::navigateTo

        document()?.addDocumentListener(
            object : DocumentListener {
                override fun documentChanged(event: DocumentEvent) = scheduleRebuild()
            },
            this,
        )
    }

    override fun getComponent(): JComponent = view

    override fun getPreferredFocusedComponent(): JComponent = view.canvas

    override fun getName(): String = "Catalog"

    override fun getFile(): VirtualFile = file

    override fun setState(state: FileEditorState) = Unit

    override fun getState(level: FileEditorStateLevel): FileEditorState = FileEditorState.INSTANCE

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = file.isValid

    override fun selectNotify() {
        // The first paint is deferred until the tab is actually shown, so opening a catalog file
        // in the plain text view costs nothing.
        rebuild(preserveViewport = built)
    }

    override fun addPropertyChangeListener(listener: PropertyChangeListener) = Unit

    override fun removePropertyChangeListener(listener: PropertyChangeListener) = Unit

    override fun dispose() = Unit

    private fun document(): Document? = FileDocumentManager.getInstance().getDocument(file)

    private fun scheduleRebuild() {
        alarm.cancelAllRequests()
        alarm.addRequest({ rebuild(preserveViewport = true) }, REBUILD_DELAY_MS)
    }

    /**
     * Must be called on the EDT.
     *
     * The rebuild is deferred until the PSI has caught up with the document rather than forcing
     * a commit here: committing is a model change, and both callers -- [selectNotify] during
     * editor open, and the debounce alarm -- run in write-unsafe contexts where forcing one
     * fails a platform assertion.
     */
    private fun rebuild(preserveViewport: Boolean) {
        if (project.isDisposed || !file.isValid) return
        PsiDocumentManager.getInstance(project).performWhenAllCommitted {
            if (project.isDisposed || !file.isValid) return@performWhenAllCommitted
            val graph = ReadAction.compute<CatalogGraph, RuntimeException> { readGraph() }
            built = true
            view.show(graph, preserveViewport)
        }
    }

    /** Reads the committed PSI. Must run under a read action. */
    private fun readGraph(): CatalogGraph {
        val psiFile = PsiManager.getInstance(project).findFile(file)
        if (psiFile !is YAMLFile) {
            return CatalogGraph(
                nodes = emptyMap(),
                edges = emptyList(),
                problems = listOf(CatalogProblem("This file is not being parsed as YAML")),
            )
        }
        return CatalogGraphBuilder.build(YamlDocumentReader.read(psiFile))
    }

    private fun navigateTo(node: CatalogNode) {
        val offset = node.sourceOffset ?: return
        OpenFileDescriptor(project, file, offset).navigate(true)
    }

    private companion object {
        const val REBUILD_DELAY_MS = 350
    }
}
