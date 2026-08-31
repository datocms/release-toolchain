# @datocms/release-toolchain

**Install it from this repository by tag. It is not on npm and will not go there.**

```json
"devDependencies": {
  "@datocms/release-toolchain": "github:datocms/release-toolchain#v1.0.0"
}
```

One release script for the eleven DatoCMS repositories that publish to npm. It
applies the pending changesets, builds, tests, publishes, tags, pushes, then
writes the GitHub release notes.

Anything that can fail runs before anything irreversible, and among the
irreversible steps npm goes first and git second. `changeset publish` handles both halves in that order by itself: it publishes,
then tags the packages npm accepted, so a tag cannot outlive a failed publish.

There is no rollback, because each step repeats without harm. The publish skips
versions the registry holds, the tagging skips tags that exist, each GitHub
release skips itself. Rerun a release that died halfway and it picks up where it
stopped.

We keep the `@datocms` scope even though nothing goes to npm. The scope is ours,
so the name is ours, and someone who mistypes `npm i @datocms/release-toolchain`
finds nothing instead of a stranger's package.

## Using it

Nine of the eleven repositories add two scripts and no file of their own:

```json
"scripts": {
  "release": "release-toolchain",
  "release:next": "release-toolchain --tag next"
}
```

`npm run release` cuts a normal release. `npm run release:next` publishes under
the `next` npm dist-tag and marks the GitHub releases as prereleases, so
`latest` stays where it is.

Do not call the script `publish`. In a single-package repository the root is the
published package, so `changeset publish` shells out to `npm publish`, npm runs
the repository's own `publish` script, and you are back at the top of your own
release script.

## Derived, not configured

| Thing | Where it comes from |
|---|---|
| repository root | `@manypkg/get-packages`, asserted equal to the git root |
| release branch | `.changeset/config.json` → `baseBranch` |
| tag shape | `vX.Y.Z` in a single-package repo, `name@version` in a workspace |
| build, test | the root `package.json`'s `build` and `test` scripts |
| what to publish | `changeset publish-plan`, registry lookups included |

You get no options. A repository that needs a different build changes its own
`build` script, and contributors know where that lives.

## The one hook

Two repositories rewrite generated files between the version bump and the
release commit. They call `release()` rather than the binary:

```js
#!/usr/bin/env node
import { release, reportFailure, run } from '@datocms/release-toolchain';

try {
  await release({
    beforeCommit: ({ plan }) => {
      // ...rewrite whatever has to carry the new version number
    },
  });
} catch (error) {
  reportFailure(error);
  process.exit(1);
}
```

`beforeCommit({ root, packages, tool, plan, tagFor, distTag })` runs after
`changeset version` and the lockfile refresh, after the script has read the
publish plan, and before `git add -A && git commit`. You also get `run`,
`capture`, `succeeds`, `step`, `fail` and `Aborted`, so a hook that shells out
prints and fails the way a built-in step does.

## Refusing a publish nobody asked for

`npm publish` typed by hand skips the tests, the changelog, the tag and the
GitHub release, and npm accepts it whenever the version in the working tree is
one the registry has not seen. A package that wants that refused guards itself:

```json
"scripts": {
  "prepublishOnly": "release-toolchain --assert-release"
}
```

The check passes while this script runs the publish and fails everywhere else.
`npm pack` still works, so you can read the tarball without turning the guard
off. The seven single-package repositories carry it, because there `npm publish`
at the repository root is the accident that reaches the registry. In the four
workspaces the root is private, so the same slip publishes nothing.

## Releasing this package

Run `npx changeset` in the PR, then `npm run release` on `main`. The script
bumps the version, writes the changelog, commits, tags and publishes the release
notes. Nothing reaches npm.

Nothing changes in the eleven repositories until someone moves their
`devDependency` to the new tag. No bot does that today, so open those PRs by
hand. To spot a repository left behind, read its release log: the preflight
banner prints the toolchain version on every run.

## npm two-factor

`changeset publish` reads `NPM_CONFIG_OTP`. Given a TTY it publishes one package
at a time and hands npm's own prompt through to your terminal, so an interactive
release answers it as it goes. Without a TTY:

```
NPM_CONFIG_OTP=123456 npm run release
```
