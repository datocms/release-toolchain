#!/usr/bin/env node
//
// `release-toolchain [--tag <dist-tag>]`, the entry point for the nine repos
// that need no hook. The two that do run `release()` from their own script; see
// the README.

import { release, reportFailure } from './index.mjs';

try {
  await release();
} catch (error) {
  reportFailure(error);
  process.exit(1);
}
