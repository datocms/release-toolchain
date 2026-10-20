import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  BIN,
  makeRepo,
  ran,
  runRelease,
  runReleaseExpectingFailure,
} from './harness.mjs';

const single = (overrides = {}) =>
  makeRepo({
    rootPackageJson: { name: 'lonely-package', version: '0.0.1' },
    ...overrides,
  });

const workspace = (overrides = {}) =>
  makeRepo({
    rootPackageJson: {
      name: 'root',
      private: true,
      version: '0.0.0',
      workspaces: ['packages/*'],
    },
    // npm workspaces are only detected next to a lockfile, and the tag shape
    // hangs off that detection.
    extraFiles: { 'package-lock.json': '{ "lockfileVersion": 3 }\n' },
    workspacePackages: {
      'packages/a': { name: '@scope/a', version: '1.0.0' },
      'packages/b': { name: '@scope/b', version: '1.0.0' },
      'packages/c': { name: '@scope/c', version: '1.0.0' },
    },
    ...overrides,
  });

describe('a repository that is one package', () => {
  it('tags vX.Y.Z, never name@version', () => {
    const repo = single();
    const { calls } = runRelease({
      root: repo.root,
      scenario: {
        tagShape: 'root',
        releases: [{ name: 'lonely-package', version: '0.0.2' }],
      },
    });

    assert.equal(repo.git('tag', '--list'), 'v0.0.2');
    assert.equal(repo.git('log', '-1', '--format=%s'), 'release: v0.0.2');

    const release = calls.find(
      (call) => call.tool === 'gh' && call.args[1] === 'create',
    );
    assert.deepEqual(release.args.slice(0, 3), ['release', 'create', 'v0.0.2']);
    assert.ok(release.args.includes('--verify-tag'));
  });
});

describe('the commit subject', () => {
  it('names the package when one of a group moved', () => {
    const repo = workspace();
    runRelease({
      root: repo.root,
      scenario: {
        releases: [{ dir: 'packages/a', name: '@scope/a', version: '1.1.0' }],
      },
    });
    assert.equal(
      repo.git('log', '-1', '--format=%s'),
      'release: @scope/a@1.1.0',
    );
  });

  it('states the version when everything landed on one', () => {
    const repo = workspace();
    runRelease({
      root: repo.root,
      scenario: {
        releases: [
          { dir: 'packages/a', name: '@scope/a', version: '2.0.0' },
          { dir: 'packages/b', name: '@scope/b', version: '2.0.0' },
        ],
      },
    });
    assert.equal(repo.git('log', '-1', '--format=%s'), 'release: v2.0.0');
  });

  it('counts the packages, and lists the tags in the body', () => {
    const repo = workspace();
    runRelease({
      root: repo.root,
      scenario: {
        releases: [
          { dir: 'packages/a', name: '@scope/a', version: '2.0.0' },
          { dir: 'packages/b', name: '@scope/b', version: '1.4.1' },
          { dir: 'packages/c', name: '@scope/c', version: '1.0.1' },
        ],
      },
    });
    assert.equal(repo.git('log', '-1', '--format=%s'), 'release: 3 packages');
    assert.equal(
      repo.git('log', '-1', '--format=%b').trim(),
      '@scope/a@2.0.0\n@scope/b@1.4.1\n@scope/c@1.0.1',
    );
  });
});

describe('the derivations', () => {
  it('takes the release branch from .changeset/config.json', () => {
    // The repo is on `main`; changesets says releases happen on `master`.
    const repo = single({
      extraFiles: { '.changeset/config.json': '{ "baseBranch": "master" }\n' },
    });
    const { output } = runReleaseExpectingFailure({
      root: repo.root,
      scenario: { releases: [] },
    });
    assert.match(output, /you are not on master/);
  });

  it('refuses to release from a package that is not the git root', () => {
    const repo = makeRepo({
      rootPackageJson: false,
      workspacePackages: { app: { name: 'app', version: '1.0.0' } },
    });
    const { output } = runReleaseExpectingFailure({
      root: repo.root,
      cwd: path.join(repo.root, 'app'),
      scenario: { releases: [] },
    });
    assert.match(output, /is not the git root/);
  });

  it('refuses to release a repo with no build or test script', () => {
    const repo = single({
      extraFiles: {
        'package.json': '{ "name": "lonely-package", "version": "0.0.1" }\n',
      },
    });
    const { output } = runReleaseExpectingFailure({
      root: repo.root,
      scenario: { releases: [] },
    });
    assert.match(output, /no "build" script/);
  });
});

describe('a resumed release', () => {
  it('skips the build, the tests and the version bump', () => {
    const repo = single({ pendingChangeset: false });
    const { calls } = runRelease({
      root: repo.root,
      scenario: {
        tagShape: 'root',
        releases: [
          { name: 'lonely-package', version: '0.0.1', kind: 'tag-only' },
        ],
      },
    });

    assert.equal(ran(calls, 'npm', 'run', 'build'), false);
    assert.equal(ran(calls, 'npm', 'test'), false);
    assert.equal(ran(calls, 'npx', 'changeset', 'version'), false);
    // Nothing to commit, but the tag and the release notes still happen.
    assert.equal(repo.git('log', '--format=%s').split('\n').length, 1);
    assert.equal(repo.git('tag', '--list'), 'v0.0.1');
    assert.ok(ran(calls, 'gh', 'release', 'create'));
  });
});

describe('the tag check', () => {
  it('aborts before the push when changesets tagged something else', () => {
    const repo = single();
    const { output, calls } = runReleaseExpectingFailure({
      root: repo.root,
      scenario: {
        tagShape: 'root',
        releases: [{ name: 'lonely-package', version: '0.0.2' }],
        tagsCreated: ['lonely-package@0.0.2'],
      },
    });

    assert.match(output, /did not create v0\.0\.2/);
    assert.equal(ran(calls, 'gh', 'release', 'create'), false);
    // The release commit exists locally and nothing reached the remote, which
    // is precisely the state a rerun is designed to pick up.
    assert.equal(repo.git('log', '-1', '--format=%s'), 'release: v0.0.2');
    assert.equal(
      repo.git('rev-parse', 'HEAD') === repo.git('rev-parse', 'origin/main'),
      false,
    );
  });
});

describe('the beforeCommit hook', () => {
  it('runs after the plan is read and before the commit', () => {
    const repo = workspace();
    runRelease({
      root: repo.root,
      entry: fileURLToPath(new URL('hook-consumer.mjs', import.meta.url)),
      argv: ['--tag', 'next'],
      scenario: {
        releases: [
          { dir: 'packages/a', name: '@scope/a', version: '2.0.0-next.0' },
          { dir: 'packages/b', name: '@scope/b', version: '2.0.0-next.0' },
        ],
      },
    });

    const handed = JSON.parse(
      readFileSync(path.join(repo.root, '..', 'hook.json'), 'utf8'),
    );
    assert.deepEqual(handed.tags, [
      '@scope/a@2.0.0-next.0',
      '@scope/b@2.0.0-next.0',
    ]);
    assert.equal(handed.toolType, 'npm');
    assert.equal(handed.distTag, 'next');
    assert.deepEqual(handed.packageNames.sort(), [
      '@scope/a',
      '@scope/b',
      '@scope/c',
    ]);

    // What the hook wrote is part of the release commit, not left behind in the
    // working tree.
    assert.equal(repo.git('status', '--porcelain'), '');
    assert.match(repo.git('show', '--stat', '--format=', 'HEAD'), /STAMPED/);
  });
});

describe('a release from a public mirror', () => {
  const mirrorConsumer = fileURLToPath(
    new URL('mirror-consumer.mjs', import.meta.url),
  );
  const ghReleases = (calls) =>
    calls.filter((call) => call.tool === 'gh' && call.args[0] === 'release');

  it('sends every gh release to the release repository', () => {
    const repo = single({ pendingChangeset: false });
    repo.git('tag', '-a', 'v0.0.1', '-m', 'v0.0.1');
    repo.git('commit', '--allow-empty', '-m', 'release: v0.0.1');

    const { calls } = runRelease({
      root: repo.root,
      entry: mirrorConsumer,
      scenario: { tagShape: 'root', releases: [], announced: [] },
    });

    const subcommands = ghReleases(calls).map((call) => call.args[1]);
    assert.deepEqual(subcommands, ['list', 'view', 'create']);
    for (const call of ghReleases(calls)) {
      const at = call.args.indexOf('--repo');
      assert.equal(call.args[at + 1], 'acme/public-mirror');
    }
  });

  it('runs afterPush after the push and before the release notes', () => {
    const repo = workspace();
    const { calls } = runRelease({
      root: repo.root,
      entry: mirrorConsumer,
      argv: ['--tag', 'next'],
      scenario: {
        releases: [
          { dir: 'packages/a', name: '@scope/a', version: '1.1.0-next.0' },
        ],
      },
    });

    const order = calls.map((call) => call.tool);
    const hook = order.indexOf('afterPush');
    const notes = calls.findIndex(
      (call) => call.tool === 'gh' && call.args[1] === 'create',
    );
    assert.ok(hook !== -1 && hook < notes);
    const publish = calls.findIndex(
      (call) => call.tool === 'npx' && call.args[1] === 'publish',
    );
    assert.ok(hook > publish);

    const handed = JSON.parse(
      readFileSync(path.join(repo.root, '..', 'hook.json'), 'utf8'),
    );
    assert.deepEqual(handed.tags, ['@scope/a@1.1.0-next.0']);
    assert.equal(handed.distTag, 'next');
    assert.equal(handed.branch, 'main');
  });

  it('runs afterPush again in a resumed release', () => {
    const repo = single({ pendingChangeset: false });
    repo.git('tag', '-a', 'v0.0.1', '-m', 'v0.0.1');
    repo.git('push', '-q', 'origin', 'main', 'v0.0.1');

    const { calls } = runRelease({
      root: repo.root,
      entry: mirrorConsumer,
      scenario: { tagShape: 'root', releases: [], announced: [] },
    });

    assert.ok(ran(calls, 'afterPush', 'v0.0.1'));
    assert.ok(ran(calls, 'gh', 'release', 'create', 'v0.0.1'));
  });

  it('refuses before the publish without write access', () => {
    const repo = single();
    const { output, calls } = runReleaseExpectingFailure({
      root: repo.root,
      entry: mirrorConsumer,
      scenario: {
        tagShape: 'root',
        releases: [{ name: 'lonely-package', version: '0.0.2' }],
        permission: 'READ',
      },
    });

    assert.match(output, /cannot write to acme\/public-mirror/);
    assert.equal(ran(calls, 'npx', 'changeset', 'publish'), false);
  });
});

describe('changesets pre mode', () => {
  const preMode = (mode, tag) =>
    single({
      extraFiles: { '.changeset/pre.json': { mode, tag, initialVersions: {} } },
    });
  const prerelease = {
    tagShape: 'root',
    releases: [{ name: 'lonely-package', version: '0.0.2-next.0' }],
  };
  const publishArgs = (calls) =>
    calls.find((call) => call.tool === 'npx' && call.args[1] === 'publish')
      .args;

  it('publishes under the tag of pre.json, without --tag', () => {
    const repo = preMode('pre', 'next');
    const { calls } = runRelease({
      root: repo.root,
      argv: ['--tag', 'next'],
      scenario: prerelease,
    });

    assert.deepEqual(publishArgs(calls), ['changeset', 'publish']);
    const notes = calls.find(
      (call) => call.tool === 'gh' && call.args[1] === 'create',
    );
    assert.ok(notes.args.includes('--prerelease'));
  });

  it('refuses another tag before it changes anything', () => {
    const repo = preMode('pre', 'next');
    const { output, calls } = runReleaseExpectingFailure({
      root: repo.root,
      argv: ['--tag', 'beta'],
      scenario: prerelease,
    });

    assert.match(output, /pre mode with the tag "next"/);
    assert.equal(ran(calls, 'npx', 'changeset', 'version'), false);
  });

  it('refuses a release without --tag', () => {
    const repo = preMode('pre', 'next');
    const { output } = runReleaseExpectingFailure({
      root: repo.root,
      scenario: prerelease,
    });

    assert.match(output, /changeset pre exit/);
  });

  it('lets a release through after pre exit', () => {
    const repo = preMode('exit', 'next');
    const { calls } = runRelease({
      root: repo.root,
      scenario: {
        tagShape: 'root',
        releases: [{ name: 'lonely-package', version: '0.0.2' }],
      },
    });

    assert.deepEqual(publishArgs(calls), ['changeset', 'publish']);
  });
});

describe('a release that died after the publish', () => {
  // The hardest resume: the package is on the registry AND its tag is here, so
  // changesets reports an empty plan. Only the push and the release notes are
  // missing, and nothing but this script knows that.
  it('pushes and announces what changesets considers finished', () => {
    const repo = single({ pendingChangeset: false });
    // The wreckage a SIGKILL between `changeset publish` and `git push` leaves.
    repo.git('tag', '-a', 'v0.0.1', '-m', 'v0.0.1');
    repo.git('commit', '--allow-empty', '-m', 'release: v0.0.1');

    const { calls, output } = runRelease({
      root: repo.root,
      scenario: { tagShape: 'root', releases: [], announced: [] },
    });

    assert.match(output, /v0\.0\.1 \(already on npm\)/);
    assert.ok(ran(calls, 'gh', 'release', 'create'));
    assert.equal(
      repo.git('rev-parse', 'HEAD'),
      repo.git('rev-parse', 'origin/main'),
    );
  });

  it('still refuses when the tag is pushed and the release exists', () => {
    const repo = single({ pendingChangeset: false });
    repo.git('tag', '-a', 'v0.0.1', '-m', 'v0.0.1');
    repo.git('push', '-q', 'origin', 'v0.0.1');

    const { output } = runReleaseExpectingFailure({
      root: repo.root,
      scenario: { tagShape: 'root', releases: [], announced: ['v0.0.1'] },
    });

    assert.match(output, /there is nothing to release/);
  });
});

describe('the publish guard', () => {
  const assertRelease = (env) => {
    try {
      execFileSync(process.execPath, [BIN, '--assert-release'], {
        encoding: 'utf8',
        env: { ...process.env, DATOCMS_RELEASE: undefined, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, output: '' };
    } catch (error) {
      return { status: error.status, output: String(error.stderr) };
    }
  };

  it('refuses a publish nobody asked for', () => {
    const { status, output } = assertRelease({});
    assert.equal(status, 1);
    assert.match(output, /published by 'npm run release'/);
    assert.match(output, /npm pack/);
  });

  it('lets the release through', () => {
    assert.equal(assertRelease({ DATOCMS_RELEASE: '1' }).status, 0);
  });

  it('is set for the publish step and nothing else', () => {
    const repo = single();
    const { calls } = runRelease({
      root: repo.root,
      scenario: {
        tagShape: 'root',
        releases: [{ name: 'lonely-package', version: '0.0.2' }],
      },
    });

    const publish = calls.find(
      (call) => call.tool === 'npx' && call.args[1] === 'publish',
    );
    assert.equal(publish.release, '1');
    // The build and the tests must not look like a release to a guarded
    // package that happens to run one.
    assert.equal(
      calls.find((call) => call.tool === 'npm' && call.args[0] === 'test')
        .release,
      null,
    );
  });
});
