---
"@datocms/release-toolchain": patch
---

Publish a prerelease in changesets pre mode.

In pre mode, `changeset publish --tag` stops with "Releasing under custom tag
is not allowed in pre mode", after the release commit and before anything
reaches npm. The script now leaves out `--tag` in pre mode, because changesets
publishes under the tag of `.changeset/pre.json`. The preflight refuses a
`--tag` that is not that tag. A normal release after `changeset pre exit` is no
longer refused: the file stays with the mode "exit" until `changeset version`.
