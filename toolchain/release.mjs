#!/usr/bin/env node
//
// Releases this package, which is the one repository `release()` cannot release:
// nothing here goes to npm, so there is no publish plan to read and no registry
// to be idempotent against. What is left is the git half — bump, changelog,
// commit, tag, push, release notes — written against the same helpers, with the
// same failure semantics, so a broken step here reads like a broken step there.
//
// Consumers pin this repo by tag, so the tag *is* the release.

import { existsSync, readFileSync } from 'node:fs';
import {
  capture,
  fail,
  reportFailure,
  run,
  step,
  succeeds,
} from '../src/index.mjs';

const BRANCH = 'main';

const version = () => JSON.parse(readFileSync('package.json', 'utf8')).version;

const changelogSection = (release) => {
  if (!existsSync('CHANGELOG.md')) return '';
  const [, section = ''] = readFileSync('CHANGELOG.md', 'utf8').split(
    `\n## ${release}\n`,
  );
  return section.split('\n## ')[0].trim();
};

const main = async () => {
  step('Preflight');

  const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== BRANCH) fail(`you are not on ${BRANCH}.`);
  if (capture('git', ['status', '--porcelain'])) {
    fail('working tree is dirty. Commit or stash first.');
  }
  run('git', ['fetch', '--quiet', 'origin', branch]);
  if (
    !succeeds('git', ['merge-base', '--is-ancestor', `origin/${branch}`, 'HEAD'])
  ) {
    fail(
      `origin/${branch} has commits ${branch} doesn't. Pull (and rerun) first.`,
    );
  }
  if (!succeeds('gh', ['auth', 'status'])) {
    fail(
      "the GitHub CLI is missing or logged out, so the release notes can't be published.",
    );
  }

  step('Building');
  run('npm', ['run', 'build']);

  step('Testing');
  run('npm', ['test']);

  step('Applying pending changesets');
  run('npx', ['changeset', 'version']);

  const tag = `v${version()}`;

  if (succeeds('git', ['rev-parse', '--verify', `refs/tags/${tag}`])) {
    fail(
      `${tag} already exists. Describe your changes with 'npx changeset' first.`,
    );
  }

  step(`Committing and tagging ${tag}`);
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', `release: ${tag}`]);
  run('git', ['tag', '-a', tag, '-m', tag]);

  step('Pushing to GitHub');
  run('git', ['push', '--follow-tags', 'origin', branch]);

  step('Publishing the release notes');
  const notes = changelogSection(version()) || `Released \`${tag}\`.`;
  run('gh', ['release', 'create', tag, '--title', tag, '--verify-tag', '--notes-file', '-'], {
    input: notes,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  console.log(`\n\x1b[32mReleased ${tag}\x1b[0m`);
  console.log(
    'Consumers pin the tag, so nothing is live until their\n' +
      `devDependency moves to github:datocms/release-toolchain#${tag}.`,
  );
};

try {
  await main();
} catch (error) {
  reportFailure(error);
  process.exit(1);
}
