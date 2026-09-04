package com.grahambrooks.backstage.catalog.ui

import com.grahambrooks.backstage.catalog.CatalogInfoFiles
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.TextEditorWithPreview
import com.intellij.openapi.fileEditor.impl.text.TextEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * Attaches a split "Text / Catalog" editor to `catalog-info.yaml` files.
 *
 * A split editor rather than a tool window: the graph is about *this* descriptor, so it belongs
 * beside the descriptor, and the split gives the source and the picture the same lifecycle.
 */
class CatalogGraphEditorProvider : FileEditorProvider, DumbAware {

    override fun accept(project: Project, file: VirtualFile): Boolean = CatalogInfoFiles.matches(file)

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        val textEditor = TextEditorProvider.getInstance().createEditor(project, file) as TextEditor
        return TextEditorWithPreview(
            textEditor,
            CatalogGraphFileEditor(project, file),
            "Backstage Catalog",
            TextEditorWithPreview.Layout.SHOW_EDITOR_AND_PREVIEW,
        )
    }

    override fun getEditorTypeId(): String = EDITOR_TYPE_ID

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR

    private companion object {
        const val EDITOR_TYPE_ID = "backstage-catalog-graph-editor"
    }
}
