import * as vscode from 'vscode';

import { isCatalogFileName } from './core/catalogFiles';
import { CatalogGraphPanel } from './graphPanel';

/**
 * Entry point. Registers the two commands and keeps the `isCatalogFile` context key in step
 * with the active editor, which is what puts the toolbar button on catalog files only.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('backstageCatalogGraph.showToSide', () =>
      showForActiveEditor(context, vscode.ViewColumn.Beside),
    ),
    vscode.commands.registerCommand('backstageCatalogGraph.show', () =>
      showForActiveEditor(context, vscode.ViewColumn.Active),
    ),
    vscode.window.onDidChangeActiveTextEditor(updateContextKey),
  );

  updateContextKey(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  // Panels are disposed through the context subscriptions and their own onDidDispose.
}

function showForActiveEditor(
  context: vscode.ExtensionContext,
  column: vscode.ViewColumn,
): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open a catalog-info.yaml first.');
    return;
  }
  if (!isCatalogDocument(editor.document)) {
    void vscode.window.showInformationMessage(
      `${fileNameOf(editor.document.uri)} is not a Backstage catalog descriptor. ` +
        'Expected catalog-info.yaml, *.catalog-info.yaml, catalog-all.yaml or catalog-entities.yaml.',
    );
    return;
  }
  CatalogGraphPanel.show(context, editor.document, column);
}

function updateContextKey(editor: vscode.TextEditor | undefined): void {
  void vscode.commands.executeCommand(
    'setContext',
    'backstageCatalogGraph.isCatalogFile',
    editor !== undefined && isCatalogDocument(editor.document),
  );
}

function isCatalogDocument(document: vscode.TextDocument): boolean {
  return isCatalogFileName(fileNameOf(document.uri));
}

function fileNameOf(uri: vscode.Uri): string {
  const parts = uri.path.split('/');
  return parts[parts.length - 1] ?? '';
}
