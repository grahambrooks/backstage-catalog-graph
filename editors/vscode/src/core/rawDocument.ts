/**
 * One YAML document from a `catalog-info.yaml`, already reduced to plain objects, arrays and
 * scalars.
 *
 * Keeping the graph builder on this shape rather than on a parser's AST is what lets the core
 * be tested against the shared conformance corpus with no editor involved.
 */
export interface RawDocument {
  readonly data: Record<string, unknown>;
  /** Character offset of the document's start in the file, for caret navigation. */
  readonly offset: number;
}
