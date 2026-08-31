//
// A throwaway repository, a bare remote for it to push to, and the shims from
// ./shims first on $PATH. Everything the release script does to git really
// happens; everything it does to npm and GitHub is recorded instead.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHIMS = path.join(here, 'shims');
export const BIN = path.join(here, '..', 'src', 'bin.mjs');

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const write = (root, file, contents) => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(
    path.join(root, file),
    typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`,
  );
};

/**
 * @param {object} options
 * @param {object} options.rootPackageJson
 * @param {Record<string, object>} [options.workspacePackages] dir -> package.json
 * @param {string} [options.baseBranch]
 * @param {boolean} [options.pendingChangeset] whether a release is due
 * @param {Record<string, string>} [options.extraFiles]
 */
export const makeRepo = ({
  rootPackageJson,
  workspacePackages = {},
  baseBranch = 'main',
  pendingChangeset = true,
  extraFiles = {},
}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-toolchain-'));
  const root = path.join(dir, 'repo');
  const remote = path.join(dir, 'remote.git');
  mkdirSync(root, { recursive: true });

  if (rootPackageJson) {
    write(root, 'package.json', {
      scripts: { build: 'true', test: 'true' },
      ...rootPackageJson,
    });
  }
  write(root, '.changeset/config.json', { baseBranch });
  write(root, '.changeset/README.md', '# Changesets\n');
  if (pendingChangeset) {
    write(root, '.changeset/tidy-pandas-shout.md', '---\n---\n\nsomething\n');
  }
  for (const [subdir, json] of Object.entries(workspacePackages)) {
    write(root, path.join(subdir, 'package.json'), json);
  }
  for (const [file, contents] of Object.entries(extraFiles)) {
    write(root, file, contents);
  }

  execFileSync('git', ['init', '--bare', '-b', baseBranch, remote], { stdio: 'ignore' });
  git(root, 'init', '-b', baseBranch);
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'initial');
  git(root, 'push', '-q', 'origin', baseBranch);

  return { dir, root, remote, git: (...args) => git(root, ...args) };
};

/**
 * Runs the release script inside `cwd`, and returns its output together with the
 * log of every shimmed command it ran. `entry` stands in for the repos that call
 * `release()` from a script of their own instead of using the binary.
 */
export const runRelease = ({ cwd, root, scenario, argv = [], entry = BIN }) => {
  const log = path.join(root, '..', 'shim.log');
  const scenarioFile = path.join(root, '..', 'scenario.json');
  writeFileSync(log, '');
  writeFileSync(scenarioFile, JSON.stringify(scenario ?? { releases: [] }));

  const result = execFileSync(
    process.execPath,
    [entry, ...argv],
    {
      cwd: cwd ?? root,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOOK_OUTPUT: path.join(root, '..', 'hook.json'),
        PATH: `${SHIMS}:${process.env.PATH}`,
        SHIM_RUN: path.join(SHIMS, 'run.mjs'),
        SHIM_LOG: log,
        SHIM_SCENARIO: scenarioFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
    // execFileSync throws on a non-zero exit; we want the status either way.
  );
  return finish(result, log);
};

const finish = (result, log) => ({
  output: String(result),
  calls: readCalls(log),
});

const readCalls = (log) =>
  readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

/** Like `runRelease`, but for the runs that are supposed to fail. */
export const runReleaseExpectingFailure = (options) => {
  try {
    runRelease(options);
  } catch (error) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      calls: readCalls(path.join(options.root, '..', 'shim.log')),
    };
  }
  throw new Error('the release was expected to fail, and did not');
};

export const ran = (calls, tool, ...prefix) =>
  calls.some(
    (call) =>
      call.tool === tool &&
      prefix.every((arg, index) => call.args[index] === arg),
  );
