# @datocms/release-toolchain

**Installed from this repository by tag. It is not on npm, and never will be.**

```json
"devDependencies": {
  "@datocms/release-toolchain": "github:datocms/release-toolchain#v1.0.0"
}
```

One release script, shared by every DatoCMS repository that publishes to npm.
It applies the pending changesets, builds, tests, publishes, tags, pushes and
writes the GitHub release notes — in that order, which is the whole point:
everything that can fail runs before anything irreversible, and the irreversible
steps go npm first, git second.

The scoped name is deliberate even though nothing is published: `@datocms` is
ours, so nobody else can take it, and a mistyped `npm i @datocms/release-toolchain`
finds nothing rather than finding a stranger's package.

## Using it

Nine of the eleven repos need no file of their own:

```json
"scripts": {
  "release": "release-toolchain",
  "release:next": "release-toolchain --tag next"
}
```

`npm run release` cuts a normal release. `npm run release:next` publishes under
the `next` npm dist-tag and marks the GitHub releases as prereleases, leaving
`latest` alone.

The script **must not** be called `publish`: in a single-package repo the root
*is* the published package, so `changeset publish` → `npm publish` would run the
repo's own `publish` script and the release would re-enter itself.

## What it derives, and what it refuses to configure

| Thing | Where it comes from |
|---|---|
| repository root | `@manypkg/get-packages`, asserted equal to the git root |
| release branch | `.changeset/config.json` → `baseBranch` |
| tag shape | `vX.Y.Z` in a single-package repo, `name@version` in a workspace |
| build, test | the root `package.json`'s `build` and `test` scripts |
| what to publish | `changeset publish-plan`, registry lookups included |

There are no options. If a repo needs a different build, it changes its own
`build` script — that is the knob, and it is one every contributor already
knows about.

## The one hook

Two repos have to rewrite generated files between the version bump and the
release commit. They call `release()` instead of using the binary:

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
`changeset version` and the lockfile refresh, after the publish plan has been
read, and before `git add -A && git commit`. `run`, `capture`, `succeeds`,
`step`, `fail` and `Aborted` are exported alongside it, so a hook that shells
out prints and fails like a built-in step.

## Releasing this package

`npx changeset` in the PR, `npm run release` on `main`. That bumps the version,
writes the changelog, commits, tags and publishes the release notes — no npm.
Nothing is live until the consuming repos move their `devDependency` to the new
tag; Renovate opens those eleven PRs.

## npm two-factor

`changeset publish` honours `NPM_CONFIG_OTP`, and when it has a TTY it publishes
sequentially with npm's own prompt wired through, so an interactive release just
answers it. For a non-interactive one:

```
NPM_CONFIG_OTP=123456 npm run release
```
