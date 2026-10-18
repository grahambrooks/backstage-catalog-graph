import { deepStrictEqual, equal, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

import { isCatalogFileName, matchesBaseName } from '../core/catalogFiles';
import { buildCatalogGraph } from '../core/catalogGraphBuilder';
import { declaredNodes, entityAt, externalNodes, keyOf } from '../core/catalogGraph';
import { formatRef, parseRef, shortLabel } from '../core/entityRef';
import { EdgeRouter } from '../core/edgeRouter';
import { focusAround } from '../core/focus';
import { step } from '../core/navigation';
import { outlineOf } from '../core/outline';
import { systemClusters } from '../core/systemClusters';
import { NodeBounds, bottom, layoutGraph, right } from '../core/layeredLayout';
import { foldOwners } from '../core/ownerBadges';
import { readDocuments } from '../core/yamlDocuments';
import { fromWire, toWire } from '../core/wire';

/**
 * Unit tests for behaviour the shared conformance corpus does not cover: filename matching,
 * source offsets, and the extension-host-to-webview wire format. Everything about how a
 * descriptor is *interpreted* is covered by `conformance.test.ts` instead, so that it is tested
 * once, against the same corpus as the other editors.
 */

describe('entity references', () => {
  test('a bare name takes the default kind and namespace', () => {
    deepStrictEqual(parseRef('payments', 'system'), {
      kind: 'system',
      namespace: 'default',
      name: 'payments',
    });
  });

  test('text that cannot be a reference is rejected rather than guessed at', () => {
    for (const input of ['', '   ', 'two words', 'component:', ':name']) {
      equal(parseRef(input, 'component'), undefined, `should reject ${JSON.stringify(input)}`);
    }
  });

  test('short label omits the default namespace only', () => {
    equal(shortLabel({ kind: 'component', namespace: 'default', name: 'x' }), 'component:x');
    equal(shortLabel({ kind: 'component', namespace: 'retail', name: 'x' }), 'component:retail/x');
  });
});

describe('catalog file names', () => {
  test('the conventional names are recognised', () => {
    ok(isCatalogFileName('catalog-info.yaml'));
    ok(isCatalogFileName('catalog-info.yml'));
    ok(isCatalogFileName('CATALOG-INFO.YAML'));
    ok(isCatalogFileName('payments.catalog-info.yaml'));
    ok(isCatalogFileName('catalog-all.yaml'));
    ok(isCatalogFileName('catalog-entities.yaml'));
  });

  test('ordinary YAML files are left alone', () => {
    for (const name of ['app-config.yaml', 'all.yaml', 'catalog.yaml', 'info.yml']) {
      ok(!isCatalogFileName(name), `${name} should not match`);
    }
  });

  test('non-YAML extensions never match', () => {
    ok(!isCatalogFileName('catalog-info.json'));
    ok(!isCatalogFileName('catalog-info'));
  });

  test('base-name matching agrees with the JetBrains implementation', () => {
    ok(matchesBaseName('catalog-info'));
    ok(!matchesBaseName('catalog'));
  });
});

describe('source offsets', () => {
  const text = [
    'apiVersion: backstage.io/v1alpha1',
    'kind: Component',
    'metadata:',
    '  name: first',
    '---',
    'apiVersion: backstage.io/v1alpha1',
    'kind: Component',
    'metadata:',
    '  name: second',
    '',
  ].join('\n');

  test('each document reports where it starts, so nodes can carry the caret back', () => {
    const documents = readDocuments(text);
    equal(documents.length, 2);
    equal(documents[0].offset, 0);
    // The second document's range starts at its `---` separator, which is what you want the
    // caret to land on: the top of that entity's block, not its first key.
    ok(documents[1].offset > 0, 'the second document should not start at zero');
    ok(text.slice(documents[1].offset).startsWith('---'));
    ok(text.slice(documents[1].offset).includes('name: second'));
  });

  test("each entity's definition is its mapping, without the separator", () => {
    const graph = buildCatalogGraph(readDocuments(text));
    const second = declaredNodes(graph).find((node) => node.title === 'second')!;
    const definition = text.slice(second.definition!.start, second.definition!.end);
    ok(definition.startsWith('apiVersion:'), definition);
    ok(definition.trimEnd().endsWith('name: second'), definition);
    ok(!definition.includes('---'));
    // The caret lands at the top of the selection, which must map back to the same entity.
    equal(entityAt(graph, second.definition!.start)?.title, 'second');
  });

  test('a caret offset maps to the entity whose document contains it', () => {
    const graph = buildCatalogGraph(readDocuments(text));
    equal(entityAt(graph, 0)?.title, 'first');
    equal(entityAt(graph, text.indexOf('name: first'))?.title, 'first');
    equal(entityAt(graph, text.indexOf('name: second'))?.title, 'second');
    equal(entityAt(graph, text.length)?.title, 'second');
  });

  test('a file with no declared entity maps no offset', () => {
    equal(entityAt(buildCatalogGraph(readDocuments('# just a comment\n')), 0), undefined);
  });

  test('declared nodes carry an offset and placeholders do not', () => {
    const graph = buildCatalogGraph(
      readDocuments('kind: Component\nmetadata:\n  name: a\nspec:\n  owner: group:b\n'),
    );
    equal(declaredNodes(graph).length, 1);
    ok(declaredNodes(graph)[0].sourceOffset !== undefined);
    equal(externalNodes(graph).length, 1);
    equal(externalNodes(graph)[0].sourceOffset, undefined);
  });

  test('a comment-only file is not a broken file', () => {
    const graph = buildCatalogGraph(readDocuments('# nothing here yet\n'));
    equal(graph.nodes.size, 0);
    equal(graph.problems.length, 0);
  });
});

describe('wire format', () => {
  const graph = buildCatalogGraph(
    readDocuments(
      [
        'kind: Component',
        'metadata:',
        '  name: web',
        '  title: Web',
        '  tags: [ts]',
        'spec:',
        '  type: website',
        '  lifecycle: production',
        '  owner: group:team',
        '',
      ].join('\n'),
    ),
  );

  test('a graph survives the round trip to the webview', () => {
    const restored = fromWire(toWire(graph));

    equal(restored.nodes.size, graph.nodes.size);
    deepStrictEqual([...restored.nodes.keys()], [...graph.nodes.keys()]);
    deepStrictEqual(restored.edges, graph.edges);

    for (const [key, original] of graph.nodes) {
      const copy = restored.nodes.get(key);
      ok(copy, `missing ${key}`);
      equal(formatRef(copy.ref), formatRef(original.ref));
      equal(copy.kind.displayName, original.kind.displayName);
      equal(copy.kind.rank, original.kind.rank);
      equal(copy.title, original.title);
      equal(copy.type, original.type);
      equal(copy.lifecycle, original.lifecycle);
      equal(copy.external, original.external);
      deepStrictEqual([...copy.tags], [...original.tags]);
    }
  });

  test('keys are the canonical reference, so the webview can match edges to nodes', () => {
    for (const [key, node] of graph.nodes) {
      equal(key, keyOf(node.ref));
    }
    for (const edge of graph.edges) {
      ok(graph.nodes.has(edge.from), `edge from ${edge.from} has no node`);
      ok(graph.nodes.has(edge.to), `edge to ${edge.to} has no node`);
    }
  });

  test('the payload is structured-clone safe', () => {
    // postMessage structured-clones; a Map or a class instance would not survive.
    const wire = toWire(graph);
    deepStrictEqual(JSON.parse(JSON.stringify(wire)), wire);
  });
});

describe('owner badges', () => {
  const graph = buildCatalogGraph(
    readDocuments(`
apiVersion: backstage.io/v1alpha1
kind: Component
metadata: { name: service }
spec: { owner: team, providesApis: [service-api] }
---
apiVersion: backstage.io/v1alpha1
kind: API
metadata: { name: service-api }
spec: { owner: outsider }
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata: { name: worker }
spec: { owner: org }
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata: { name: team }
spec: { parent: org }
`),
  );
  const folded = foldOwners(graph);
  const titles = (key: string) => (folded.owners.get(key) ?? []).map((node) => node.title);

  test('ownedBy edges become badges', () => {
    deepStrictEqual(titles('component:default/service'), ['team']);
    deepStrictEqual(titles('api:default/service-api'), ['outsider']);
    ok(folded.graph.edges.every((edge) => edge.type !== 'ownedBy'));
  });

  test('other relations are kept', () => {
    deepStrictEqual(
      new Set(folded.graph.edges.map((edge) => edge.type)),
      new Set(['providesApi', 'childOf']),
    );
  });

  test('a placeholder that is only an owner is dropped', () => {
    equal(folded.graph.nodes.has('group:default/outsider'), false);
  });

  test('a placeholder still joined by another relation stays', () => {
    ok(folded.graph.nodes.has('group:default/org'));
  });

  test('a declared owner stays', () => {
    ok(folded.graph.nodes.has('group:default/team'));
  });
});

describe('hierarchy inside a layer', () => {
  const graph = buildCatalogGraph(
    readDocuments(`
apiVersion: backstage.io/v1alpha1
kind: Group
metadata: { name: org }
spec: { type: department, children: [payments] }
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata: { name: platform }
spec: { type: team, parent: org }
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata: { name: payments }
spec: { type: team }
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata: { name: sre }
spec: { type: team, parent: platform }
`),
  );
  const layout = layoutGraph(graph, () => ({ width: 100, height: 50 }));
  const y = (name: string) => layout.nodes.get(`group:default/${name}`)!.y;

  test('is drawn parents above children', () => {
    ok(y('org') < y('platform'));
    equal(y('platform'), y('payments'));
    ok(y('platform') < y('sre'));
  });

  test('leaves the logical layer whole', () => {
    equal(layout.layers.length, 1);
    equal(layout.layers[0].length, 4);
  });
});

describe('focus', () => {
  const graph = buildCatalogGraph(
    readDocuments(`
kind: System
metadata: { name: shop }
---
kind: Component
metadata: { name: cart }
spec: { system: shop, providesApis: [cart-api], owner: team }
---
kind: Component
metadata: { name: payments }
spec: { system: shop, owner: team }
---
kind: API
metadata: { name: cart-api }
---
kind: Component
metadata: { name: unrelated }
spec: { consumesApis: [cart-api] }
---
kind: Group
metadata: { name: team }
`),
  );
  const drawn = foldOwners(graph).graph;
  const keys = (focused: ReturnType<typeof focusAround>) => new Set(focused.nodes.keys());

  test('keeps the entity, its drawn neighbours and the edges among them', () => {
    const focused = focusAround(drawn, 'component:default/cart');
    deepStrictEqual(
      keys(focused),
      new Set(['component:default/cart', 'system:default/shop', 'api:default/cart-api']),
    );
    equal(focused.edges.length, 2);
  });

  test('a focused owner keeps the entities it owns', () => {
    const focused = focusAround(drawn, 'group:default/team', [
      'component:default/cart',
      'component:default/payments',
    ]);
    deepStrictEqual(
      keys(focused),
      new Set(['group:default/team', 'component:default/cart', 'component:default/payments']),
    );
  });

  test('focusing on something not drawn changes nothing', () => {
    equal(focusAround(drawn, 'component:default/hidden'), drawn);
  });
});

/** One of the shared `examples/`, from the repository root above `out-test/test/`. */
function example(name: string) {
  const root = resolve(__dirname, '../../../..');
  return buildCatalogGraph(
    readDocuments(readFileSync(join(root, 'examples', name, 'catalog-info.yaml'), 'utf8')),
  );
}

const FIXED = () => ({ width: 100, height: 50 });

describe('Systems as containers', () => {
  const large = example('08-large-catalog');
  const clusters = systemClusters(large);
  const boxed = layoutGraph(large, FIXED, { clusters });
  const overlaps = (a: NodeBounds, box: { x: number; y: number; width: number; height: number }) =>
    a.x < box.x + box.width && right(a) > box.x && a.y < box.y + box.height && bottom(a) > box.y;

  test('subcomponents belong to their parent\'s System', () => {
    const graph = buildCatalogGraph(
      readDocuments(`
kind: System
metadata: { name: shop }
---
kind: Component
metadata: { name: cart }
spec: { system: shop }
---
kind: Component
metadata: { name: cart-widget }
spec: { subcomponentOf: cart }
`),
    );
    deepStrictEqual(
      systemClusters(graph),
      new Map([
        ['component:default/cart', 'system:default/shop'],
        ['component:default/cart-widget', 'system:default/shop'],
      ]),
    );
  });

  test('boxes hold their members and nothing else', () => {
    equal(boxed.clusters.length, new Set(clusters.values()).size);
    for (const box of boxed.clusters) {
      for (const [key, bounds] of boxed.nodes) {
        const member = clusters.get(key) === box.system || key === box.system;
        const inside =
          bounds.x >= box.x &&
          right(bounds) <= box.x + box.width &&
          bounds.y >= box.y &&
          bottom(bounds) <= box.y + box.height;
        if (member) {
          ok(inside, `${key} outside ${box.system}`);
        } else {
          ok(!overlaps(bounds, box), `${key} intrudes on ${box.system}`);
        }
      }
    }
  });

  test('the logical layers are unchanged', () => {
    deepStrictEqual(boxed.layers, layoutGraph(large, FIXED).layers);
  });
});

describe('wrapping wide rows', () => {
  const large = example('08-large-catalog');
  const wrapped = layoutGraph(large, FIXED, { maxRowWidth: 700 });

  test('no row is wider than the limit, and the layers are unchanged', () => {
    const rows = new Map<number, number>();
    for (const bounds of wrapped.nodes.values()) {
      rows.set(bounds.y, (rows.get(bounds.y) ?? 0) + 1);
    }
    for (const count of rows.values()) {
      ok(count === 1 || count * 100 + (count - 1) * 32 <= 700, `row of ${count} too wide`);
    }
    deepStrictEqual(wrapped.layers, layoutGraph(large, FIXED).layers);
  });
});

describe('edge routing', () => {
  const large = example('08-large-catalog');
  const layout = layoutGraph(large, FIXED);
  const router = new EdgeRouter(layout);

  test('no straight leg of a route passes through a node it does not join', () => {
    for (const edge of large.edges) {
      const from = layout.nodes.get(edge.from)!;
      const to = layout.nodes.get(edge.to)!;
      const route = router.route(from, to);
      if (route.sameRow) {
        continue;
      }
      for (let leg = 0; leg + 1 < route.points.length; leg++) {
        const [a, b] = [route.points[leg], route.points[leg + 1]];
        for (const node of layout.nodes.values()) {
          if (node === from || node === to) {
            continue;
          }
          for (let sample = 1; sample < 20; sample++) {
            const x = a.x + ((b.x - a.x) * sample) / 20;
            const y = a.y + ((b.y - a.y) * sample) / 20;
            const inside = x > node.x && x < right(node) && y > node.y && y < bottom(node);
            ok(!inside, `${edge.from} -> ${edge.to} crosses ${keyOf(node.node.ref)}`);
          }
        }
      }
    }
  });

  test('edges within one row arc over it', () => {
    const [first] = layout.nodes.values();
    const a = { ...first, x: 0, y: 0 };
    const b = { ...first, x: 400, y: 0 };
    const route = new EdgeRouter(layout).route(a, b);
    ok(route.sameRow);
    deepStrictEqual(route.points, [
      { x: 50, y: 0 },
      { x: 450, y: 0 },
    ]);
  });
});

describe('keyboard navigation', () => {
  //   a   b   c        row 0
  //     d       e      row 1
  const graph = buildCatalogGraph(
    readDocuments(['a', 'b', 'c', 'd', 'e'].map((n) => `kind: Component\nmetadata: { name: ${n} }\n`).join('---\n')),
  );
  const place = { a: [0, 0], b: [150, 0], c: [300, 0], d: [60, 120], e: [360, 120] } as const;
  const nodes = new Map(
    [...graph.nodes].map(([key, node]) => {
      const [x, y] = place[node.title as keyof typeof place];
      return [key, { node, x, y, width: 100, height: 50 }];
    }),
  );
  const layout = { nodes, width: 460, height: 170, layers: [], clusters: [] };
  const k = (name: string) => `component:default/${name}`;

  test('with nothing selected any arrow starts at the first node in reading order', () => {
    equal(step(layout, undefined, 'down'), k('a'));
  });

  test('left and right stay in the row', () => {
    equal(step(layout, k('b'), 'right'), k('c'));
    equal(step(layout, k('b'), 'left'), k('a'));
    equal(step(layout, k('d'), 'right'), k('e'));
  });

  test('up and down go to the horizontally closest node in the next row', () => {
    equal(step(layout, k('a'), 'down'), k('d'));
    equal(step(layout, k('c'), 'down'), k('e'));
    equal(step(layout, k('e'), 'up'), k('c'));
  });

  test('with nowhere to go the selection stays', () => {
    equal(step(layout, k('a'), 'left'), k('a'));
    equal(step(layout, k('b'), 'up'), k('b'));
  });
});

describe('outline', () => {
  const graph = example('02-storefront-system');
  const outline = outlineOf(graph);

  test('sections follow the layer order', () => {
    const ranks = outline.map((section) => section.kind.rank);
    deepStrictEqual(ranks, [...ranks].sort((a, b) => a - b));
  });

  test('every entity is listed once and every relation appears from both ends', () => {
    equal(outline.reduce((sum, s) => sum + s.entities.length, 0), graph.nodes.size);
    equal(
      outline.reduce((sum, s) => sum + s.entities.reduce((n, e) => n + e.relations.length, 0), 0),
      graph.edges.length * 2,
    );
  });

  test('declared relations come before incoming ones', () => {
    for (const entity of outline.flatMap((section) => section.entities)) {
      const directions = entity.relations.map((relation) => relation.outgoing);
      deepStrictEqual(directions, [...directions].sort((a, b) => Number(b) - Number(a)));
    }
  });
});
