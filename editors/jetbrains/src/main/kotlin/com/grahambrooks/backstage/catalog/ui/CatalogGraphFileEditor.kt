package com.grahambrooks.backstage.catalog.ui

import com.grahambrooks.backstage.catalog.model.CatalogGraph
import com.grahambrooks.backstage.catalog.model.CatalogGraphBuilder
import com.grahambrooks.backstage.catalog.model.CatalogNode
import com.grahambrooks.backstage.catalog.model.CatalogProblem
import com.grahambrooks.backstage.catalog.model.EntityRef
import com.grahambrooks.backstage.catalog.psi.YamlDocumentReader
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileEditor.FileEditorStateLevel
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiManager
import com.intellij.util.Alarm
import com.intellij.util.concurrency.AppExecutorUtil
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
    private var graph: CatalogGraph = CatalogGraph.EMPTY

    /** The entity under the caret when it last moved, so only a move into another entity reacts. */
    private var caretEntity: EntityRef? = null

    /**
     * Counts rebuilds, so that a background read finishing after a newer one started is
     * dropped rather than overwriting a fresher graph. `coalesceBy` would do this, but it
     * rejects this editor as a key ("Equality should be unique") and the rebuild never ran.
     */
    private var rebuildGeneration = 0

    /** The document stamp [graph] was built from; its offsets mean nothing for any other. */
    private var builtStamp: Long = -1

    /**
     * A caret move made while [graph] was behind the document, waiting for the rebuild. Its
     * offsets come from text the graph has not seen, so following it now could pick the wrong
     * entity -- and that choice would stick.
     */
    private var deferredCaret: Int? = null

    init {
        view.onNavigate = ::navigateTo
        view.onProblemChosen = { offset -> OpenFileDescriptor(project, file, offset).navigate(true) }

        document()?.addDocumentListener(
            object : DocumentListener {
                override fun documentChanged(event: DocumentEvent) = scheduleRebuild()
            },
            this,
        )

        // Follow the caret: moving into another entity's YAML selects it in the graph, panning
        // to it if needed but keeping the user's zoom. This reads the graph already built, so
        // it never touches PSI -- a caret event is no place to force a commit.
        EditorFactory.getInstance().eventMulticaster.addCaretListener(
            object : CaretListener {
                override fun caretPositionChanged(event: CaretEvent) {
                    val document = event.editor.document
                    if (document != document()) return
                    if (document.modificationStamp != builtStamp) {
                        deferredCaret = event.editor.caretModel.offset
                        return
                    }
                    followCaret(event.editor.caretModel.offset)
                }
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
        // in the plain text view costs nothing. Coming back to a tab whose document has not
        // changed costs nothing either.
        if (built && document()?.modificationStamp == builtStamp) return
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
     * The PSI is read in a background, non-blocking read action that waits for the documents to
     * be committed rather than forcing a commit: committing is a model change, and the callers --
     * [selectNotify] during editor open, and the debounce alarm -- run in write-unsafe contexts
     * where forcing one fails a platform assertion. Reading off the EDT keeps typing smooth in a
     * large file; a newer rebuild supersedes a pending one, and closing the editor cancels it.
     * Only the result is applied on the EDT, where the layout needs font metrics anyway.
     */
    private fun rebuild(preserveViewport: Boolean) {
        if (project.isDisposed || !file.isValid) return
        val generation = ++rebuildGeneration
        ReadAction.nonBlocking<Pair<CatalogGraph, Long>> {
            // The stamp is read with the PSI, so it names exactly the text the graph came from.
            readGraph() to (document()?.modificationStamp ?: -1)
        }
            .withDocumentsCommitted(project)
            .expireWith(this)
            .finishOnUiThread(ModalityState.defaultModalityState()) { (graph, stamp) ->
                if (generation != rebuildGeneration) return@finishOnUiThread
                built = true
                this.graph = graph
                builtStamp = stamp
                view.show(graph, preserveViewport)
                deferredCaret?.let { offset ->
                    deferredCaret = null
                    followCaret(offset)
                }
            }
            .submit(AppExecutorUtil.getAppExecutorService())
    }

    private fun followCaret(offset: Int) {
        val ref = graph.entityAt(offset)?.ref
        if (ref == caretEntity) return
        caretEntity = ref
        if (ref != null) view.reveal(ref)
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

    /**
     * Selects the YAML that defines [node], with the caret at its top so the caret still sits
     * inside that entity and the graph keeps it selected. Falls back to placing the caret at the
     * document when there is no definition range. Unless [focus], keyboard focus stays in the
     * graph, so a single click can select without taking the user out of it.
     */
    private fun navigateTo(node: CatalogNode, focus: Boolean) {
        val definition = node.definition
        val offset = definition?.start ?: node.sourceOffset ?: return
        val editor = FileEditorManager.getInstance(project)
            .openTextEditor(OpenFileDescriptor(project, file, offset), focus) ?: return
        // The descriptor has already put the caret at the start; selecting leaves it there.
        definition?.let { editor.selectionModel.setSelection(it.start, it.end) }
    }

    private companion object {
        const val REBUILD_DELAY_MS = 350
    }
}
