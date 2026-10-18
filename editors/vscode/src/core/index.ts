/**
 * The editor-independent core: read a descriptor, build the graph, lay it out.
 *
 * Nothing under `core/` may import `vscode`. That is what allows the conformance corpus to run
 * it in plain Node, and what would let it move to a language server later.
 */
export * from './catalogGraph';
export * from './catalogGraphBuilder';
export * from './entityKind';
export * from './entityRef';
export * from './layeredLayout';
export * from './rawDocument';
export * from './relationType';
export * from './yamlDocuments';
export * from './ownerBadges';
export * from './focus';
export * from './edgeRouter';
export * from './navigation';
export * from './outline';
export * from './systemClusters';
