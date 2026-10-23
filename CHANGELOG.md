# @datocms/release-toolchain

## 1.3.2

### Patch Changes

- f54c761: Stop at a version that npm staged, and push the branch and the tags atomically.
  
  npm stages a version when the publish needs a 2FA approval. The registry does
  not show it, so the next run published it again and npm refused it with "409
  Cannot publish over previously staged version". The script now stops before the
  push when the publish staged a version, and before the publish when an earlier
  run staged one, with the `npm stage approve` command for each one.
  
  `git push` now uses `--atomic`. Without it, origin got the tags also when it
  refused the branch. The script also refuses a release tag that is not in the
  history of the branch, which happens after `git pull --rebase` of the release
  commit, and tells how to move the tag.

## 1.3.1

### Patch Changes

- e467a34: Publish a prerelease in changesets pre mode.
  
  In pre mode, `changeset publish --tag` stops with "Releasing under custom tag
  is not allowed in pre mode", after the release commit and before anything
  reaches npm. The script now leaves out `--tag` in pre mode, because changesets
  publishes under the tag of `.changeset/pre.json`. The preflight refuses a
  `--tag` that is not that tag. A normal release after `changeset pre exit` is no
  longer refused: the file stays with the mode "exit" until `changeset version`.

## 1.3.0

### Minor Changes

- 2e9a63f: Add the `releaseRepo` option and the `afterPush` hook to `release()`, for a
  private repository that releases from a public mirror.
  
  `releaseRepo` sends each `gh release` call to that repository with `--repo`,
  and the preflight refuses to start when the `gh` account cannot write to it.
  `afterPush` runs after `git push` and before the release notes, also in a
  resumed release, so the mirror can push its tags before `--verify-tag` looks
  for them.

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
