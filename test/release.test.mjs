import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
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
