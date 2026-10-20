//
// The outside world, replaced by something that writes down what it was asked.
//
// The release script touches npm, the registry and GitHub only by shelling out
// *by name*, so putting a directory of same-named executables first on PATH is
// enough to run the whole flow offline. `git` is deliberately left real: the
// commits, tags and pushes are the thing under test.
//
// Every call is appended to $SHIM_LOG as a JSON line. What `changeset` does is
// read from $SHIM_SCENARIO, so a test can describe a release — including a
// `changeset publish` that creates the *wrong* tag — as data.

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const scenario = () => JSON.parse(readFileSync(process.env.SHIM_SCENARIO, 'utf8'));

const tagFor = ({ name, version }, shape) =>
  shape === 'root' ? `v${version}` : `${name}@${version}`;

const applyVersion = (s) => {
  for (const release of s.releases) {
    const dir = release.dir ?? '.';
    const file = path.join(dir, 'package.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    json.version = release.version;
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    writeFileSync(
      path.join(dir, 'CHANGELOG.md'),
      `# ${release.name}\n\n## ${release.version}\n\n### Patch Changes\n\n- something happened\n`,
    );
  }
  for (const entry of readdirSync('.changeset')) {
    if (entry.endsWith('.md') && entry !== 'README.md') {
      rmSync(path.join('.changeset', entry));
    }
  }
};

const createTags = (s) => {
  const tags =
    s.tagsCreated ?? s.releases.map((release) => tagFor(release, s.tagShape));
  for (const tag of tags) execFileSync('git', ['tag', tag]);
};

export const main = (tool) => {
  const args = process.argv.slice(3);
  appendFileSync(
    process.env.SHIM_LOG,
    `${JSON.stringify({ tool, args, release: process.env.DATOCMS_RELEASE ?? null })}\n`,
  );

  if (tool === 'npm') {
    if (args[0] === 'whoami') console.log('test-user');
    return;
  }

  if (tool === 'npx') {
    const s = scenario();
    const [, command] = args; // ['changeset', <command>, ...]
    if (command === 'version') return applyVersion(s);
    if (command === 'publish-plan') {
      const output = args[args.indexOf('--output') + 1];
      const plan = s.releases.map(({ name, version, kind }) => ({
        kind: kind ?? 'publish',
        name,
        version,
      }));
      return writeFileSync(output, JSON.stringify({ plan: [plan] }));
    }
    if (command === 'publish') return createTags(s);
    return;
  }

  if (tool === 'gh') {
    // `release view` failing is the answer "no such release yet".
    if (args[0] === 'release' && args[1] === 'view') process.exit(1);
    if (args[0] === 'repo' && args[1] === 'view') {
      return console.log(scenario().permission ?? 'WRITE');
    }
    if (args[0] === 'release' && args[1] === 'list') {
      const s = scenario();
      return console.log(
        JSON.stringify((s.announced ?? []).map((tagName) => ({ tagName }))),
      );
    }
    return;
  }
};
