//
// The release flow, shared by every DatoCMS repository.
//
// The order of the steps is the whole point: everything that can fail (network,
// tests, credentials) runs BEFORE anything irreversible, and the irreversible
// steps go npm first, git second. `changeset publish` does both halves in that
// order by itself — it publishes, then tags only the packages npm accepted — so
// a tag can never outlive a failed publish.
//
// There is deliberately no rollback, because every step is idempotent: the
// publish skips versions already on the registry, the tagging skips tags that
// already exist, and each GitHub release skips itself. A release that dies
// halfway through is resumed by running this again.
//
// It is JavaScript rather than bash because under `set -e` the exit status of
// whatever a loop last evaluated becomes the loop's exit status, and the script
// this grew out of twice sat one non-matching last package away from dying
// between `npm publish` and `git push`.
//
// Nothing here is configurable. Every repository-specific fact is *derived* —
// the root and the tag shape from `@manypkg/get-packages`, the release branch
// from `.changeset/config.json`, the build and test commands from the root
// `package.json`. The single escape hatch is the `beforeCommit` hook, for the
// two repos that have to rewrite generated files between the version bump and
// the release commit. If a repo needs a different build, it changes its own
// `build` script.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getPackages } from '@manypkg/get-packages';

/** A refusal we wrote ourselves, as opposed to a step that failed. */
export class Aborted extends Error {}

export const fail = (message) => {
  throw new Aborted(message);
};

export const step = (message) => console.log(`\n\x1b[1m==> ${message}\x1b[0m`);

/** Runs a step the human is watching, and throws if it fails. */
export const run = (file, args, options = {}) =>
  execFileSync(file, args, { stdio: 'inherit', ...options });

/** Runs a command for its output, and throws if it fails. */
export const capture = (file, args, options = {}) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();

/**
 * Exit status as a question, for the commands whose failure is an answer rather
 * than an error: "am I logged in?", "does this release already exist?".
 */
export const succeeds = (file, args) => {
  try {
    execFileSync(file, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Prints what a failure was, and which step it happened in. Exported because a
 * repo with a hook runs `release()` from its own two-line script, and should
 * report a failure exactly the way the `release-toolchain` binary does.
 */
export const reportFailure = (error) => {
  // A step that failed has already said what it had to say on stderr; all we
  // add is which one, and the fact that nothing after it ran.
  const summary = [String(error.message).split('\n')[0], error.stderr]
    .filter(Boolean)
    .join('\n');
  const detail =
    error instanceof Aborted
      ? error.message
      : `${summary}\n  The step above printed the details.`;
  console.error(`\n\x1b[31mAborted: ${detail}\x1b[0m`);
};

const toolchainVersion = () =>
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    .version;

const pendingChangesets = () =>
  readdirSync('.changeset').filter(
    (entry) => entry.endsWith('.md') && entry !== 'README.md',
  );

/**
 * What this release covers, as `{ kind, name, version }` entries: `publish` for
 * a version not yet on the registry, `tag-only` for one that got there before a
 * previous run died. Asked of changesets rather than reconstructed here — it is
 * the same plan `changeset publish` is about to execute, registry lookups
 * included, so the two cannot disagree about what is being released.
 */
const publishPlan = () => {
  const file = path.join(tmpdir(), `publish-plan-${process.pid}.json`);
  try {
    // Captured, not shown: `changeset publish` prints the same registry
    // summary again a moment later.
    capture('npx', ['changeset', 'publish-plan', '--output', file]);
    return JSON.parse(readFileSync(file, 'utf8')).plan.flat();
  } finally {
    rmSync(file, { force: true });
  }
};

/**
 * The section of a package's CHANGELOG for one version, without its "## x.y.z"
 * heading — changesets has already written exactly the prose we want.
 */
const changelogSection = (dir, version) => {
  const file = path.join(dir, 'CHANGELOG.md');
  // A package released for the first time has no CHANGELOG.md yet.
  if (!existsSync(file)) return '';
  const [, section = ''] = readFileSync(file, 'utf8').split(
    `\n## ${version}\n`,
  );
  return section.split('\n## ')[0].trim();
};

/**
 * The git tag changesets will create for a release, in the two shapes it has:
 * `name@version` in a workspace, a bare `vX.Y.Z` in a repo that is one package.
 * Mirrors `buildGitTag` in @changesets/cli — deliberately not imported, since
 * it lives behind a mangled internal export.
 */
const tagShape = (tool) => (release) =>
  tool.type !== 'root'
    ? `${release.name}@${release.version}`
    : `v${release.version}`;

/**
 * The commit subject for a release, and its body when there is one.
 *
 * With independent versioning a release moves an arbitrary number of packages
 * at an arbitrary number of versions, so the full tag list goes in the *body*:
 * spelled into the subject, a release touching all ten ran to 442 characters.
 * The subject keeps a short exact form whenever there is one to state — the tag
 * itself when only one package moved (naming it, because calling a lone bump
 * "v5.8.1" would claim the rest of a linked group moved too), and `vX.Y.Z` when
 * everything landed on the same version, which is the usual outcome.
 */
const commitMessage = (plan, tagFor) => {
  const tags = plan.map(tagFor);
  const versions = new Set(plan.map((entry) => entry.version));
  if (tags.length === 1) return [`release: ${tags[0]}`];
  if (versions.size === 1) return [`release: v${[...versions][0]}`];
  // A second -m is a paragraph, not a second subject line.
  return [`release: ${tags.length} packages`, tags.join('\n')];
};

/**
 * @param {object} [options]
 * @param {(context: {
 *   root: string, packages: object[], tool: object,
 *   plan: object[], tagFor: (release: object) => string, distTag: string,
 * }) => void | Promise<void>} [options.beforeCommit]
 *   Runs after `changeset version` and the lockfile refresh, after the publish
 *   plan has been read, and before `git add -A && git commit` — the one place
 *   where a repo can rewrite files that have to carry the new version number.
 * @param {string[]} [options.argv] Defaults to the process arguments.
 */
export const release = async ({
  beforeCommit,
  argv = process.argv.slice(2),
} = {}) => {
  // The only flag: `--tag next` publishes under that npm dist-tag instead of
  // `latest`, and marks the GitHub releases as prereleases.
  const [flag, distTag = ''] = argv;
  if (flag && flag !== '--tag') fail(`unknown option: ${flag}`);
  if (flag && !distTag) fail('--tag needs a value.');

  // The repo root is asked of the workspace layout, never derived from this
  // file's own path: installed as a dependency, that path is inside
  // `node_modules` of whatever repo is releasing.
  const { packages, tool, rootDir } = await getPackages(process.cwd());
  process.chdir(rootDir);

  const tagFor = tagShape(tool);
  const dirOf = new Map(
    packages.map((pkg) => [pkg.packageJson.name, pkg.relativeDir]),
  );

  // -------------------------------------------------------------------------
  // Preflight: no mutations, just refuse to start from a state we can't finish.
  // -------------------------------------------------------------------------
  step(`Preflight (release-toolchain v${toolchainVersion()})`);

  // Two assertions on the derivations above, because everything downstream —
  // the branch, the tags, the commit — is written relative to this directory.
  // realpath on both sides: on macOS git reports /private/tmp for /tmp.
  const gitRoot = capture('git', ['rev-parse', '--show-toplevel']);
  if (realpathSync(rootDir) !== realpathSync(gitRoot)) {
    fail(
      `the workspace root (${rootDir}) is not the git root (${gitRoot}).\n` +
        '  Release from the repository root, not from a package inside it.',
    );
  }

  const rootScripts =
    JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
      .scripts ?? {};
  for (const script of ['build', 'test']) {
    if (!rootScripts[script]) {
      fail(
        `the root package.json has no "${script}" script, and the release gates on it.`,
      );
    }
  }

  // Normal releases happen on the branch changesets already compares against.
  // Prereleases are routinely cut from a feature branch, so --tag only asks
  // that the branch be clean and pushed.
  const releaseBranch = JSON.parse(
    readFileSync(path.join(rootDir, '.changeset/config.json'), 'utf8'),
  ).baseBranch;
  if (!releaseBranch) {
    fail('.changeset/config.json has no "baseBranch".');
  }

  const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

  if (!distTag) {
    if (branch !== releaseBranch) {
      fail(
        `you are not on ${releaseBranch}. Use --tag to publish a prerelease from a branch.`,
      );
    }
    if (existsSync('.changeset/pre.json')) {
      fail(
        'the repo is in changesets pre mode (.changeset/pre.json).\n' +
          "  Run 'npx changeset pre exit' before cutting a real release.",
      );
    }
  }

  if (capture('git', ['status', '--porcelain'])) {
    fail('working tree is dirty. Commit or stash first.');
  }

  run('git', ['fetch', '--quiet', 'origin', branch]);
  // Being *ahead* of origin is not a problem here, it's the normal resume
  // state: the release commit is made locally and pushed only once npm has
  // accepted the packages, so a run that died in between leaves exactly that.
  // What we can't work with is the other direction — commits on origin we
  // don't have, which we'd release without.
  if (
    !succeeds('git', [
      'merge-base',
      '--is-ancestor',
      `origin/${branch}`,
      'HEAD',
    ])
  ) {
    fail(
      `origin/${branch} has commits ${branch} doesn't. Pull (and rerun) first.`,
    );
  }

  if (!succeeds('npm', ['whoami']))
    fail("you are not logged in to npm. Run 'npm login'.");
  if (!succeeds('gh', ['auth', 'status'])) {
    fail(
      "the GitHub CLI is missing or logged out, so the release notes can't be published.",
    );
  }

  const npmUser = capture('npm', ['whoami']);
  console.log(`on ${branch}, in sync with origin, npm user: ${npmUser}`);

  // -------------------------------------------------------------------------
  // Everything that can fail. Nothing has been mutated yet, so a network
  // timeout here costs you nothing but the rerun.
  //
  // Skipped when there are no changesets to apply, which is what a resumed
  // release looks like: the versions were bumped and committed by the run that
  // died, and the plan below picks up whatever it didn't finish.
  // -------------------------------------------------------------------------
  const bumping = pendingChangesets().length > 0;

  if (bumping) {
    step('Building');
    run('npm', ['run', 'build']);

    step('Testing');
    run('npm', ['test']);

    // -----------------------------------------------------------------------
    // Mutations, local only. Still nothing pushed, still nothing published.
    // -----------------------------------------------------------------------
    step('Applying pending changesets');
    run('npx', ['changeset', 'version']);

    step('Refreshing the lockfile');
    run('npm', ['install', '--package-lock-only']);
  }

  step('Reading the publish plan');
  const plan = publishPlan();
  for (const entry of plan) {
    console.log(
      `  ${tagFor(entry)}${entry.kind === 'tag-only' ? ' (already on npm)' : ''}`,
    );
  }
  if (plan.length === 0) {
    fail(
      'there is nothing to release: every package is already published and tagged.\n' +
        "  Describe your changes with 'npx changeset' first.",
    );
  }

  if (bumping) {
    if (beforeCommit) {
      await beforeCommit({ root: rootDir, packages, tool, plan, tagFor, distTag });
    }

    step('Committing the release');
    const message = commitMessage(plan, tagFor);
    run('git', ['add', '-A']);
    run('git', ['commit', ...message.flatMap((part) => ['-m', part])]);
  }

  // -------------------------------------------------------------------------
  // The irreversible step: npm, then one annotated tag for each package npm
  // accepted.
  // -------------------------------------------------------------------------
  step('Publishing to npm and tagging');
  run('npx', ['changeset', 'publish', ...(distTag ? ['--tag', distTag] : [])]);

  // The tag shape is derived twice — here and inside changesets — so check that
  // the two agree while the only thing that has happened is a publish. Past
  // this point the tags are pushed and a GitHub release is created per tag; a
  // mismatch found *there* is found after the push, with npm already committed.
  step('Verifying the tags');
  const missing = plan
    .map(tagFor)
    .filter(
      (tag) => !succeeds('git', ['rev-parse', '--verify', `refs/tags/${tag}`]),
    );
  if (missing.length > 0) {
    fail(
      `'changeset publish' did not create ${missing.join(', ')}.\n` +
        '  The packages are on npm but nothing has been pushed. Check whether\n' +
        '  @changesets/cli still tags releases the way this script expects.',
    );
  }

  step('Pushing to GitHub');
  run('git', ['push', '--follow-tags', 'origin', branch]);

  // -------------------------------------------------------------------------
  // The release notes: one GitHub release per tag, its body the CHANGELOG
  // section changesets just wrote. Last, because it's the only step a human can
  // redo by hand from the changelog if it goes wrong.
  // -------------------------------------------------------------------------
  step('Publishing the release notes');
  for (const entry of plan) {
    const { name, version } = entry;
    const tag = tagFor(entry);
    if (succeeds('gh', ['release', 'view', tag])) {
      console.log(`${tag}: the release already exists, leaving it alone`);
      continue;
    }
    // A prerelease must not become the repo's "Latest release": that's reserved
    // for whatever is on the `latest` dist-tag. Decided per package, not once
    // for the run, so one prerelease version can't mark the others.
    const prerelease = distTag || version.includes('-') ? ['--prerelease'] : [];
    const notes =
      changelogSection(dirOf.get(name), version) || `Released \`${tag}\`.`;
    // --verify-tag: refuse to invent a release for a tag the push didn't carry.
    const args = ['--title', tag, '--verify-tag', '--notes-file', '-'];
    run('gh', ['release', 'create', tag, ...args, ...prerelease], {
      input: notes,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
  }

  console.log('\n\x1b[32mReleased\x1b[0m');
};
