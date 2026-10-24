# Roadmap

Where the project is going, and as importantly, where it is not.

## Status

Two editors, both feature-complete for now: **JetBrains** ([`editors/jetbrains`](editors/jetbrains))
and **VS Code** ([`editors/vscode`](editors/vscode)), held to one behaviour contract by
[`conformance/`](conformance/spec.md).

The repository is public, and packages are distributed through **GitHub Releases** (see the
[README](README.md#installing)), or built locally with `make package`. Nothing is published to
the JetBrains Marketplace or the VS Code Marketplace.

## Deferred: marketplace publishing

Publishing to the marketplaces is deferred, not abandoned. Everything it needs is already in
place and stays switched off:

- [`publish-marketplace.yml`](.github/workflows/publish-marketplace.yml) is a manual
  `workflow_dispatch` behind the `marketplaces` environment. It has never been run, and nothing
  runs it automatically. Publishing a version cannot be undone, so it stays that way until the
  decision to publish is made.
- The release workflow builds and attaches both packages to a GitHub release on a
  `v<version>` tag, which is all distribution needs for now.

Before publishing, at minimum: review both READMEs as store pages, register the extension's
`publisher`, and check the plugin's vendor details.

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
