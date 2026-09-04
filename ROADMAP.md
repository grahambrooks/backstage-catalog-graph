# Editor roadmap

Which editors get an implementation, in what order, and why.

## The numbers

[Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/), 26,143
respondents, multiple selection so the column sums past 100%.

| Editor | Share | Status |
|---|---:|---|
| VS Code | 75.9% | **Shipped** — [`editors/vscode`](editors/vscode) |
| Visual Studio | 29.0% | Not planned |
| Notepad++ | 27.4% | Not viable |
| IntelliJ IDEA | 27.1% (84% of Java devs) | **Shipped** — [`editors/jetbrains`](editors/jetbrains) |
| Vim | 24.3% | **Next** |
| Neovim | 14.0% | **Next** |
| Sublime Text | 10.5% | Reached by the same work |
| Zed | 7.3% | Blocked upstream; reached partially |
| Emacs | 4.2% | Reached by the same work |
| Helix | 1.7% | Reached by the same work |

## The recommendation

**Vim and Neovim are next** — the largest remaining bloc, and the best audience fit left. A
Backstage catalog is maintained by platform and SRE people, who are over-represented in terminal
editors relative to the survey average.

**But not as a Neovim plugin.** Build a **language server** first, and put a thin Neovim plugin
on top of it. One Rust binary then reaches Vim, Neovim, Helix, Emacs, Sublime *and* Zed, where a
Lua plugin would reach one editor.

Three things drove that:

1. **Zed is blocked, and LSP is the only way in.** Zed extensions run as WASM in a Wasmtime
   sandbox with *no* GPU context, element tree or window handle — there is no webview and no DOM
   anywhere in Zed's rendering. A visual extension API is
   [an open proposal](https://github.com/zed-industries/zed/discussions/53403), not a feature.
   No amount of effort buys a Zed graph today. A language server, however, Zed supports fully.

2. **It resolves the third-implementation problem.** Two hand-written cores kept honest by
   [`conformance/`](conformance/spec.md) is a good trade. Three would start to strain it. A
   language server is still a third core — but one serving six editors instead of one, which
   changes the arithmetic entirely.

3. **The terminal audience will not install a runtime.** A single static binary is the only
   distribution that suits Vim and Neovim users. That rules out reusing either existing core
   (JVM, Node) and points at Rust, which is also the house language for standalone tools here —
   with a Homebrew formula in this repo, as usual.

### What a language server can and cannot do

LSP has no way to draw a picture. What it *can* deliver, everywhere, without any UI:

| LSP capability | What it gives a catalog descriptor |
|---|---|
| `textDocument/publishDiagnostics` | The problems — missing `kind`, unreadable references, duplicate entities. Today these are only visible inside the graph panel. |
| `textDocument/documentSymbol` | An outline of the entities in the file |
| `textDocument/hover` | Entity details, plus the relations it declares and which of them leave the file |
| `textDocument/definition` | Jump from a reference to the declaration, when it is in the same file |
| `textDocument/documentLink` | External references marked as such inline |
| `textDocument/codeLens` | *3 relations, 2 external* above each entity |

That is a genuinely useful product on its own, and it is strictly more than terminal users have
now. The graph itself travels over the same connection as a custom `backstage/graph` request,
which the Neovim plugin renders and which Zed could consume the day its UI API lands.

## Plan

Four phases. Each is independently shippable and has a completion condition that can be checked
from outside the code.

### Phase 1 — `backstage-catalog-lsp`, the core in Rust

New crate at `editors/lsp/`. Port the ~500-line core against
[`conformance/spec.md`](conformance/spec.md): reference resolution, the relation table, external
placeholders, layered layout. `tower-lsp` for the protocol, `serde_yaml`-free YAML via
`saphyr` or `yaml-rust2` (offsets are needed, so the parser must expose spans).

No editor integration in this phase. The deliverable is a binary that speaks LSP over stdio and
a third runner for the shared corpus.

> **Done when** `cargo test` runs all 18 conformance cases against `conformance/expected/` and
> passes, and `cargo clippy -- -D warnings` and `cargo fmt --check` are clean.

### Phase 2 — Diagnostics and navigation

Wire the core to `publishDiagnostics`, `documentSymbol`, `hover`, `definition` and
`documentLink`. Incremental sync, debounced the same 350 ms as the two existing editors.

Distribution: GitHub Actions release binaries for macOS (arm64, x86_64) and Linux (x86_64,
arm64), plus a Homebrew formula in this repo. CalVer, in step with the other editors.

> **Done when** the binary installs via `brew install`, and opening
> `examples/07-malformed/catalog-info.yaml` in Helix — the smallest LSP client to configure —
> shows all four problems as diagnostics at the right lines.

### Phase 3 — The Neovim plugin and the graph

`editors/neovim/`, a Lua plugin. It registers the server with `vim.lsp.config` (Neovim 0.11+),
adds `:BackstageCatalogGraph`, and renders the graph returned by the custom `backstage/graph`
request into a scratch buffer.

Rendering is box-drawing characters, not images. `image.nvim` over the
[Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) can display a real
picture, but only on Kitty and — imperfectly — WezTerm, so it is an enhancement and not the
baseline. The layered layout ports unchanged; only the sizer changes, from pixels to character
cells.

This is where most of the risk sits. A 38-entity catalog will not read well in a terminal, but
that is the outlier: a single repository's descriptor is usually 1–8 entities, which lays out
cleanly in text.

> **Done when** every scenario in [`examples/README.md`](examples/README.md) renders, and the
> entity, placeholder and relation counts shown match the table there.

### Phase 4 — Document the other clients

No new code. Configuration snippets and a short verification note for Vim (`vim-lsp` or `coc`),
Helix (`languages.toml`), Emacs (`eglot`), Sublime (`LSP` package) and Zed (a small extension
registering the language server). Each gets the diagnostics-and-navigation half; only Neovim
gets the graph.

> **Done when** each editor's snippet has been run once on this machine and shown to produce
> diagnostics on `examples/07-malformed/catalog-info.yaml`.

## Not planned, and why

**Visual Studio** has the second-highest raw share at 29% and is still the clearest "no". It is
overwhelmingly a .NET and C++ tool; the overlap with teams running a Backstage catalog is thin,
and a VSIX with a WPF graph would share nothing with either existing implementation. Popularity
without audience fit does not justify a third rendering stack. It does get the language server,
via Visual Studio's LSP client, if anyone asks.

**Notepad++** at 27.4% has no extension model that could host this.

**Zed** is not refused, it is blocked. When the
[visual extension API](https://github.com/zed-industries/zed/discussions/53403) lands, the graph
is a small addition on top of the Phase 2 server, because the data is already flowing.

**Sublime Text**, **Emacs** and **Helix** get diagnostics and navigation from Phase 4. A native
graph view in each is open to a contributor and is not on the maintainer's list.

## Adding an editor

1. Read [`conformance/spec.md`](conformance/spec.md). It is normative.
2. Port the core into `editors/<name>/`, in that ecosystem's own language — **or** reuse the
   language server, which is now the cheaper answer for anything that is not a full IDE.
3. Wire up a runner for the corpus and make all cases pass.
4. Build the view. Only now does the work become editor-specific.
5. Add a CI job that runs the corpus, and a row to the table above.

Step 3 before step 4 is the order that matters. Passing the corpus first means that when the
picture looks wrong, it is a rendering bug and not a disagreement about what the file means.
