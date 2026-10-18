# Roadmap

Where the project is going, and as importantly, where it is not.

## Status

Two editors, both feature-complete for now: **JetBrains** ([`editors/jetbrains`](editors/jetbrains))
and **VS Code** ([`editors/vscode`](editors/vscode)), held to one behaviour contract by
[`conformance/`](conformance/spec.md).

The project is **not public yet**. The repository is private, and nothing is published to the
JetBrains Marketplace or the VS Code Marketplace. Testers get packages from a tagged GitHub
release in this private repository, or from `make package` (see the [README](README.md#building)).

## Deferred: going public

Publishing is deferred, not abandoned. Everything it needs is already in place and stays
switched off:

- [`publish-marketplace.yml`](.github/workflows/publish-marketplace.yml) is a manual
  `workflow_dispatch` behind the `marketplaces` environment. It has never been run, and nothing
  runs it automatically. Publishing a version cannot be undone, so it stays that way until the
  decision to go public is made.
- The release workflow still builds and attaches both packages to a GitHub release on a
  `v<version>` tag, which is all private distribution needs.

Before publishing, at minimum: make the repository public (or point the marketplace listings at
somewhere public), review both READMEs as store pages, and check the extension's `publisher` and
the plugin's vendor details.

## Not planned: more editors

No further editors will be added. JetBrains and VS Code (with its forks — Cursor, Windsurf,
VSCodium, Theia, Codespaces) are the supported surface.

This replaces an earlier plan for a Rust language server serving Vim, Neovim, Helix, Emacs,
Sublime and Zed. That plan's reasoning still holds if the question is ever reopened: a language
server is the only route into Zed, one binary would reach six editors instead of one, and it
would be a third implementation of the core, which the conformance corpus is built to keep
honest. The core keeps the language-server option open at no cost: `editors/vscode/src/core/`
never imports `vscode`, and the JetBrains model and layout never import IntelliJ APIs.

## Next

Improvements to the two existing editors, with no change of scope. The
[scope boundaries](README.md#deliberately-not-in-scope) still hold: one file, no network access, no
`Location` target expansion, read-only.
