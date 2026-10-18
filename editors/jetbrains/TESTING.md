# Backstage Catalog Graph — testing build

This bundle contains an unreleased build of the **Backstage Catalog Graph** plugin, the example
descriptors to test it against, and this guide. Nothing here talks to the network, reads
anything outside the file you open, or writes to your projects.

```
backstage-catalog-graph-<version>-testkit/
├── backstage-catalog-graph-<version>.zip   the plugin — install this file, do not unzip it
├── examples/                               descriptors to test against
│   └── README.md                           what to check in each one
├── TESTING.md                              this file
└── LICENSE
```

## What you need

- A JetBrains IDE, **2025.2 or newer**. Verified against IntelliJ IDEA Community 2025.2.6;
  it should also load in PyCharm, WebStorm, GoLand, RustRover, CLion, Rider, RubyMine and
  PhpStorm, all of which bundle the YAML support the plugin depends on.
- Nothing else. No JDK, no Gradle, no Backstage instance.

## Install

1. **Settings/Preferences → Plugins**
2. The gear icon (⚙) beside the search box → **Install Plugin from Disk…**
3. Choose `backstage-catalog-graph-<version>.zip` — the ZIP itself, not an unpacked folder.
4. Restart if prompted.

To remove it afterwards: **Settings → Plugins → Installed**, find *Backstage Catalog Graph*,
and use the gear icon → **Uninstall**.

## Try it

Open the `examples/` directory as a project (**File → Open**, pick the folder), then open
`examples/01-minimal/catalog-info.yaml`.

The editor should split: your YAML on the left, a **Backstage Catalog** graph on the right. You
should see one solid node (`Storefront Web`) and two dashed ones (`storefront-team`,
`storefront`) — the dashed nodes are entities this file refers to but does not declare.

Then work through [`examples/README.md`](examples/README.md). It lists eleven scenarios, the exact
entity, placeholder, relation and problem counts each should produce, and what to check in each.
Ignore the `./gradlew runIde` line at the top of that file — that is for building from source;
you have the plugin already.

## Controls

| | |
|---|---|
| Click a node | Select it, dim everything outside its neighbourhood, and select the YAML that defines it; focus stays in the graph |
| Double-click a node | As a click, and move keyboard focus to the editor |
| Hover a node | Details, and whether it is declared here or elsewhere |
| Move the caret into an entity's YAML | Select it in the graph, panning to it if it is off screen (zoom is kept) |
| Type in **Find entity** (Ctrl/Cmd+F) | Select and reveal the first entity whose title or reference matches; Enter / Shift+Enter for next / previous, Escape to clear |
| Ctrl/Cmd + scroll | Zoom about the cursor |
| Scroll / Shift + scroll | Pan vertically / horizontally |
| Drag | Pan |
| Arrow keys (graph focused) | Move the selection to the nearest node that way, selecting its YAML |
| Enter / Escape | Select the YAML and focus the editor / deselect |
| + / − / 0 | Zoom in / zoom out / fit |
| Toolbar | Zoom in/out, Fit to Window, Actual Size, Show External References, Show Owners as Badges, Group by System, Focus on Selection, Show Outline, Reload |
| **Focus on Selection** on | Draw only the selected entity and what it is joined to, laid out afresh; the focus follows each click, Find and caret move |
| **Group by System** on | Each System is a box around the entities that are part of it; the `partOf` edges into the box are not drawn |
| **Show Outline** on | The catalog as a tree of kind, entity and relations; selecting a row selects its YAML |
| Click the problems warning | List every problem; picking one moves the caret to it |

Edge labels appear above roughly 75% zoom and are hidden below it, on purpose. Edges are coloured
by relation, with inverse pairs (`childOf`/`parentOf`) sharing a colour, and the legend lists the
relations drawn. With **Show Owners as Badges** on (the default) each entity's owner is a pill under its
subtitle rather than an `ownedBy` edge, and a placeholder that was only an owner is not drawn.
Edges are routed through the gaps in the rows they cross rather than over the nodes there, edges
within one row arc over it, and a row wider than about 1200px wraps onto several.

## Reporting a problem

Please include:

- The IDE and its exact build number (**Help → About**, "Copy" button).
- The descriptor you were looking at, or the smallest version of it that still misbehaves.
- What you expected versus what the graph drew. If it is a count, `examples/README.md` says
  what each example should produce — quoting the mismatch is enough.
- If the IDE showed an error balloon: **Help → Show Log in Finder/Explorer**, and the tail of
  `idea.log` around the time it appeared.

Known limits, so they are not worth reporting as bugs:

- The graph covers **one file**. References to entities declared elsewhere in the project are
  deliberately drawn as external placeholders rather than resolved.
- `Location` entities produce no edges; `spec.targets` holds paths and URLs, not entity
  references.
- The graph is read-only. Editing happens in the YAML pane.
