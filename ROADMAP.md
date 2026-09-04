# Editor roadmap

Which editors get an implementation, in what order, and why.

## How the order was chosen

Raw popularity is the starting point, not the answer. Three things move an editor up or down:

1. **Share of developers** — [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/).
2. **Overlap with the audience.** This visualises a Backstage descriptor. Backstage users are
   platform and backend engineers, which is not the same population as the survey average — the
   same survey puts IntelliJ IDEA at 84% among Java developers against VS Code's 31%.
3. **What one implementation buys.** The VS Code extension API is shared by Cursor, Windsurf,
   VSCodium, Gitpod, GitHub Codespaces and Eclipse Theia. One extension reaches all of them, and
   nothing else on this list has a multiplier like it.

Effort is dominated by rendering, not by parsing. The core is ~500 lines and is specified once
in [`conformance/spec.md`](conformance/spec.md); porting it is a day. Drawing an interactive
graph in an unfamiliar UI toolkit is the rest of the work, which is why a terminal editor scores
"high" below despite reading the same YAML.

## Status

| Editor | Share | Audience fit | Effort | Status |
|---|---:|---|---|---|
| **VS Code** (+ Cursor, Windsurf, VSCodium, Theia, Codespaces) | 75.9% | High | — | **Shipped** — [`editors/vscode`](editors/vscode) |
| **JetBrains** (IDEA, PyCharm, GoLand, RustRover, …) | 27.1%<br>84% of Java devs | Very high | — | **Shipped** — [`editors/jetbrains`](editors/jetbrains) |
| Neovim / Vim | 24.3% | Medium | High | Planned — see below |
| Zed | ~5% and climbing | Medium | Medium | Planned |
| Visual Studio | 29% | Low | High | Not planned |
| Notepad++ | 27.4% | None | — | Not planned |
| Sublime Text | ~10% | Low | Medium | Not planned |
| Emacs | ~5% | Medium | Medium | Not planned |
| Eclipse | ~8% | Low | High | Not planned |

## The two that are shipped

**VS Code** is first on share alone, and the multiplier settles it: the same `.vsix` installs in
five other editors. It is a webview beside the document, which is the shape VS Code users
already know from Markdown preview.

**JetBrains** was built first and stays first-class. It is the highest-fit editor for this
particular audience — a Backstage catalog is usually maintained by the same people writing the
Java or Go service it describes — and it is where the reference implementation of the
conformance corpus lives.

## Planned

### Neovim / Vim

24.3% of developers, and a real slice of the platform-engineering audience. The obstacle is that
"draw a graph" means something different in a terminal. Two viable shapes:

- **A Lua plugin rendering to a scratch buffer** — box-drawing characters, the layered layout
  reused as-is with character-cell sizing instead of pixels. Self-contained, no external process,
  and the layout core ports cleanly because it is already resolution-independent.
- **A language server** speaking LSP, so the graph arrives as document symbols and code lenses
  rather than a picture. Much less useful, but it would serve every LSP-capable editor at once.

Leaning towards the Lua plugin. The corpus would need a third implementation of the core in Lua,
which is the point at which the "native per editor" decision deserves re-examining — three
implementations is where a shared WASM core starts to pay for itself.

### Zed

Smaller share but growing, and its extension API is WebAssembly-based, which would force the
core into a WASM-compilable language. That is a large enough change to be worth doing only if
Neovim lands first and a third core implementation is already on the table.

## Not planned, and why

**Visual Studio** has the second-highest raw share at 29%, and is still the clearest "no". It is
overwhelmingly a .NET and C++ tool; the overlap with teams running a Backstage catalog is thin,
and a VSIX with a WPF or WinForms graph shares nothing with either existing implementation.
Popularity without audience fit does not justify a third rendering stack.

**Notepad++** has no extension model that could host this.

**Sublime Text**, **Emacs** and **Eclipse** are each plausible and each cost a full rendering
implementation for a few percent of developers. They are open to a contributor — the conformance
corpus means a new implementation has an unambiguous target and a way to prove it is correct —
but they are not on the maintainer's list.

## Adding an editor

1. Read [`conformance/spec.md`](conformance/spec.md). It is normative.
2. Port the core into `editors/<name>/`, in that ecosystem's own language.
3. Wire up a runner for the corpus in `conformance/manifest.json` and make all cases pass.
4. Build the view. Only now does the work become editor-specific.
5. Add a CI job that runs the corpus, and a row to the table above.

Step 3 before step 4 is the order that matters. Passing the corpus first means that when the
picture looks wrong, it is a rendering bug and not a disagreement about what the file means.
