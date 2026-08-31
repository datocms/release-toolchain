# @datocms/release-toolchain

## 1.2.0

### Minor Changes

- 508dce4: Add `release-toolchain --assert-release`, a guard a package runs from
  `prepublishOnly`.
  
  `npm publish` typed by hand skips the tests, the changelog, the tag and the
  GitHub release, and npm accepts it whenever the version in the working tree is
  one the registry has not seen. The release script now sets `DATOCMS_RELEASE`
  around `changeset publish`, and the guard refuses when it is absent. `npm pack`
  runs `prepack` rather than `prepublishOnly`, so reading a tarball still works
  and preview builds are untouched.

## 1.1.0

### Minor Changes

- b71f042: Finish a release that died after `changeset publish`.
  
  Rehearsing the resume against a real registry and a real GitHub repo showed
  that it did not resume. Kill the script between `changeset publish` and
  `git push` and the packages are on the registry with their tags in the local
  repo, which is all `splitByTagStatus` looks at, so the next run reads an empty
  plan and aborts with "there is nothing to release" while the commit sits
  unpushed and no GitHub release exists.
  
  When the plan comes back empty the script now works out what is outstanding
  from the versions in the working tree: a tag that origin has not seen, or one
  with no GitHub release behind it. Both are steps this script owns rather than
  changesets, so nothing else was going to notice. A normal release pays nothing
  for this, since the check only runs when the plan is empty.
  
  The four monorepos carried this bug in every copy of the old script.
