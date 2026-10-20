// Stands in for a private repo that releases from a public mirror. The
// `afterPush` hook writes a line in SHIM_LOG, thus a test can find its place
// among the commands, and writes what it got into HOOK_OUTPUT.
import { appendFileSync, writeFileSync } from 'node:fs';
import { release, reportFailure } from '../src/index.mjs';

try {
  await release({
    releaseRepo: 'acme/public-mirror',
    afterPush: ({ root, releases, tagFor, distTag, branch }) => {
      appendFileSync(
        process.env.SHIM_LOG,
        `${JSON.stringify({ tool: 'afterPush', args: releases.map(tagFor) })}\n`,
      );
      writeFileSync(
        process.env.HOOK_OUTPUT,
        JSON.stringify({ root, tags: releases.map(tagFor), distTag, branch }),
      );
    },
  });
} catch (error) {
  reportFailure(error);
  process.exit(1);
}
