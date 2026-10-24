# Security

Please report a vulnerability privately, through
[GitHub's private vulnerability reporting](https://github.com/grahambrooks/backstage-catalog-graph/security/advisories/new),
rather than in a public issue.

Both plugins are read-only views of a local file: they make no network requests and write
nothing to disk. The surface most worth a look is the VS Code webview, which renders content
taken from the YAML being viewed.

Only the latest release is supported.
