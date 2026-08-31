---
"@datocms/release-toolchain": minor
---

Add `release-toolchain --assert-release`, a guard a package runs from
`prepublishOnly`.

`npm publish` typed by hand skips the tests, the changelog, the tag and the
GitHub release, and npm accepts it whenever the version in the working tree is
one the registry has not seen. The release script now sets `DATOCMS_RELEASE`
around `changeset publish`, and the guard refuses when it is absent. `npm pack`
runs `prepack` rather than `prepublishOnly`, so reading a tarball still works
and preview builds are untouched.
