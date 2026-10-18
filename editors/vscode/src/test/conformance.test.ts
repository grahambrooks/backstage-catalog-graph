import { deepStrictEqual, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

import { buildCatalogGraph } from '../core/catalogGraphBuilder';
import { CatalogGraph, isEmpty } from '../core/catalogGraph';
import { layoutGraph } from '../core/layeredLayout';
import { formatRef } from '../core/entityRef';
import { readDocuments } from '../core/yamlDocuments';

/**
 * Runs the cross-editor conformance corpus against this implementation.
 *
 * The corpus at `conformance/` is the contract; the JetBrains implementation generates the
 * golden files. A failure here means this implementation and that one disagree about what a
 * descriptor means -- which is exactly what the corpus exists to catch.
 *
 * The goldens are parsed and compared structurally rather than as text, so the generator's
 * exact formatting is not accidentally part of the contract.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const CONFORMANCE = join(REPO_ROOT, 'conformance');

/** Layout is measured at a fixed node size so layers can be compared across editors. */
const FIXED_NODE_WIDTH = 100;
const FIXED_NODE_HEIGHT = 50;

interface Case {
  readonly id: string;
  readonly input: string;
}

interface Golden {
  nodes: unknown[];
  edges: unknown[];
  problems: string[];
  layers: string[][];
}

function manifest(): Case[] {
  const text = readFileSync(join(CONFORMANCE, 'manifest.json'), 'utf8');
  return (JSON.parse(text) as { cases: Case[] }).cases;
}

function render(graph: CatalogGraph): Golden {
  const nodes = [...graph.nodes.values()]
    .map((node) => ({
      ref: formatRef(node.ref),
      kind: node.kind.displayName,
      title: node.title,
      type: node.type ?? null,
      lifecycle: node.lifecycle ?? null,
      tags: [...node.tags],
      external: node.external,
    }))
    .sort((a, b) => compare(a.ref, b.ref));

  const edges = graph.edges
    .map((edge) => ({ from: edge.from, to: edge.to, type: edge.type }))
    .sort(
      (a, b) =>
        compare(a.from, b.from) || compare(a.type, b.type) || compare(a.to, b.to),
    );

  const problems = graph.problems.map((problem) => problem.message).sort(compare);

  return { nodes, edges, problems, layers: layersOf(graph) };
}

/**
 * Node references per logical layer, top layer first, in contract order. Read from the layout's
 * own layers rather than by grouping on y, because a layer with an internal hierarchy is drawn
 * as several rows.
 */
function layersOf(graph: CatalogGraph): string[][] {
  if (isEmpty(graph)) {
    return [];
  }
  const layout = layoutGraph(graph, () => ({
    width: FIXED_NODE_WIDTH,
    height: FIXED_NODE_HEIGHT,
  }));
  return layout.layers.map((layer) => [...layer]);
}

/** By UTF-16 code unit, matching the generator. `localeCompare` is machine-dependent. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

describe('conformance corpus', () => {
  const cases = manifest();

  test('the manifest is not empty', () => {
    ok(cases.length > 0, 'conformance/manifest.json lists no cases');
  });

  for (const testCase of cases) {
    test(testCase.id, () => {
      const input = readFileSync(join(REPO_ROOT, testCase.input), 'utf8');
      const actual = render(buildCatalogGraph(readDocuments(input)));

      const goldenPath = join(CONFORMANCE, 'expected', `${testCase.id}.json`);
      const expected = JSON.parse(readFileSync(goldenPath, 'utf8')) as Golden;

      deepStrictEqual(actual.nodes, expected.nodes, 'nodes');
      deepStrictEqual(actual.edges, expected.edges, 'edges');
      deepStrictEqual(actual.problems, expected.problems, 'problems');
      deepStrictEqual(actual.layers, expected.layers, 'layers');
    });
  }
});
