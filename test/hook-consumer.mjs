// Stands in for the two repos that pass a `beforeCommit` hook. Writes what the
// hook was handed into HOOK_OUTPUT, and leaves a file for the commit to pick up.
import { writeFileSync } from 'node:fs';
import { release, reportFailure } from '../src/index.mjs';

try {
  await release({
    beforeCommit: ({ root, packages, tool, plan, tagFor, distTag }) => {
      writeFileSync(
        process.env.HOOK_OUTPUT,
        JSON.stringify({
          root,
          packageNames: packages.map((pkg) => pkg.packageJson.name),
          toolType: tool.type,
          tags: plan.map(tagFor),
          distTag,
        }),
      );
      writeFileSync('STAMPED', `${plan.map(tagFor).join('\n')}\n`);
    },
  });
} catch (error) {
  reportFailure(error);
  process.exit(1);
}
