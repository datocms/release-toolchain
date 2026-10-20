---
"@datocms/release-toolchain": minor
---

Add the `releaseRepo` option and the `afterPush` hook to `release()`, for a
private repository that releases from a public mirror.

`releaseRepo` sends each `gh release` call to that repository with `--repo`,
and the preflight refuses to start when the `gh` account cannot write to it.
`afterPush` runs after `git push` and before the release notes, also in a
resumed release, so the mirror can push its tags before `--verify-tag` looks
for them.
