# Changesets

This folder holds the pending release notes for the next version.

Whenever you change something worth mentioning in a release, run `npx changeset`
and answer the two prompts (which packages, and whether it's a patch/minor/major).
That writes a small markdown file here, which you commit along with your changes.

At release time `npm run release` consumes every pending file: it computes the
resulting version, updates `package.json` and `CHANGELOG.md`, and deletes the
files.

## Which bump level?

This package is the release path for eleven repositories, so read the levels as
promises to *them*:

- `patch` — a fix inside a step that already existed.
- `minor` — a new step, a new hook argument, a new export.
- `major` — a hook signature changed, a step was removed, or a repo has to edit
  something of its own to keep releasing. Every consumer has to be updated
  deliberately, so say so in the changeset.

## No prereleases

Unlike the repos this releases, nothing here goes to npm — a release is a
version bump, a changelog entry, a commit and a tag. Try a change by pointing
one consumer's `devDependency` at a branch (`github:datocms/release-toolchain#my-branch`)
and cutting a real prerelease *there*.
