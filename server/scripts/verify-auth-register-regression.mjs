import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [controller, dto, contract] = await Promise.all([
  readFile(new URL('../src/auth/auth.controller.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/auth/dto/auth.dto.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/auth/auth-register-regression-contract.ts', import.meta.url), 'utf8'),
]);
const checks = {
  registerRoutePresent: controller.includes("@Post('register')"),
  verificationRoutesPresent:
    controller.includes("@Post('email-verifications')") &&
    controller.includes("@Post('email-verifications/confirm')"),
  validationDtoPresent: dto.includes('export class RegisterDto'),
  rateLimitsPresent: controller.includes('@Throttle'),
  safeFixtureBoundary:
    contract.includes('createsAccount: false') &&
    contract.includes('sessionMaterial: false'),
};
const failures = Object.entries(checks).filter(([, value]) => !value);
console.log(
  JSON.stringify(
    {
      runId: randomUUID(),
      publicPath: '/api/v1/auth/register',
      status: failures.length ? 'blocked' : 'passed',
      checks,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
