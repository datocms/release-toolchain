#!/usr/bin/env node
//
// `release-toolchain [--tag <dist-tag>]` cuts a release, and is the entry point
// for the nine repos that need no hook. The two that do call `release()` from a
// script of their own; see the README.
//
// `release-toolchain --assert-release` is the other job: a package runs it from
// `prepublishOnly` so that a hand-typed `npm publish` refuses to go through.

import { assertRelease, release, reportFailure } from './index.mjs';

try {
  if (process.argv[2] === '--assert-release') {
    assertRelease();
  } else {
    await release();
  }
} catch (error) {
  reportFailure(error);
  process.exit(1);
}
