import { deepStrictEqual, equal, ok } from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isCatalogFileName, matchesBaseName } from '../core/catalogFiles';
import { buildCatalogGraph } from '../core/catalogGraphBuilder';
import { declaredNodes, entityAt, externalNodes, keyOf } from '../core/catalogGraph';
import { formatRef, parseRef, shortLabel } from '../core/entityRef';
import { focusAround } from '../core/focus';
import { layoutGraph } from '../core/layeredLayout';
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
