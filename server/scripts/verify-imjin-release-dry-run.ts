import { readFileSync } from 'fs';
import { HttpException } from '@nestjs/common';
import {
  prepareImjinReleasePlan,
  projectImjinDryRun,
} from '../src/story-production/story-imjin-release-bridge.policy';

const sourcePath = process.argv[2];
if (!sourcePath) {
  process.stderr.write('Usage: npm run qa:imjin-release-dry-run -- <source.md>\n');
  process.exitCode = 2;
} else {
  try {
    const report = projectImjinDryRun(prepareImjinReleasePlan(readFileSync(sourcePath)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const response = error instanceof HttpException ? error.getResponse() : null;
    const code = response && typeof response === 'object' && 'code' in response
      ? String(response.code)
      : 'IMJIN_DRY_RUN_FAILED';
    process.stderr.write(`${JSON.stringify({ valid: false, code })}\n`);
    process.exitCode = 1;
  }
}
