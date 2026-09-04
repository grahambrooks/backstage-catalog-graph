# Conformance corpus

The single source of truth for **what a `catalog-info.yaml` means**. Read
[`spec.md`](spec.md) first — it is normative.

```
spec.md            the contract, in prose
manifest.json      case id -> the descriptor it reads
cases/             edge cases that make poor demos but pin real behaviour
expected/          one golden document per case
```

Inputs come from two places. Most cases read the descriptors in
[`../examples`](../examples/README.md), so the files a human reads to understand the plugin are
the same files the machines check it against. `cases/` holds the rest: reference spellings,
casing, wrong shapes, cycles — worth pinning, not worth demonstrating.

## Running it

```bash
cd editors/jetbrains && ./gradlew test    # Kotlin
cd editors/vscode    && npm test          # TypeScript
```

Both read `manifest.json` and diff their output against `expected/`. The JetBrains side compares
canonical text and is also the generator; the VS Code side parses the JSON and compares
structurally, so the generator's exact formatting never becomes part of the contract by
accident.

## Changing it

The goldens are generated from the JetBrains implementation:

```bash
cd editors/jetbrains && ./gradlew test -Dconformance.update=true
```

Then **read the diff**. A changed golden is a changed contract, and every other implementation
now has to meet it. See "Changing the contract" in [`spec.md`](spec.md).
