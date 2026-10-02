import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const qaRoot = process.env.LUMINA_QA_ROOT || 'E:\\Codex\\LuminaStage';
const temp = process.env.LUMINA_QA_TEMP || 'E:\\Temp';
const fixture = process.env.OTT_UI_MEDIA_FIXTURE || join(qaRoot, 'qa-fixtures', 'synthetic-clip.mp4');
const browsers = [
  process.env.STORY_UI_BROWSER,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browser = browsers.find((path) => path && existsSync(path));
const bundledModules = join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes',
  'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const nodePaths = (process.env.NODE_PATH || '').split(delimiter).filter(Boolean);
if (existsSync(join(bundledModules, 'playwright', 'package.json'))) nodePaths.push(bundledModules);

for (const [name, path] of [['QA root', qaRoot], ['temporary directory', temp], ['test video', fixture]]) {
  if (!/^E:[\\/]/i.test(path)) throw new Error(`${name} must be on E: for local QA`);
}
if (!browser) throw new Error('Microsoft Edge is required for full browser QA');
if (!existsSync(fixture)) throw new Error(`Local synthetic test video is missing: ${fixture}`);
if (!nodePaths.some((path) => existsSync(join(path, 'playwright', 'package.json')))) {
  throw new Error('Playwright is unavailable; set NODE_PATH to its node_modules directory');
}

if (process.argv.includes('--check-env')) {
  process.stdout.write(`QA environment ready: ${qaRoot}\n`);
} else {
  const artifacts = process.env.STORY_UI_ARTIFACTS || join(qaRoot, 'qa-full-site-latest');
  const ottArtifacts = process.env.OTT_PUBLIC_BROWSER_ARTIFACTS || join(qaRoot, 'qa-public-ott-latest');
  for (const path of [artifacts, ottArtifacts]) {
    if (!/^E:[\\/]/i.test(path)) throw new Error('Browser artifacts must be on E: for local QA');
    mkdirSync(path, { recursive: true });
  }
  mkdirSync(temp, { recursive: true });
  const tests = readdirSync(join(root, 'tests')).filter((name) => name.endsWith('.test.mjs'))
    .sort().map((name) => `tests/${name}`);
  if (!tests.length) throw new Error('No site tests found');
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...tests], {
    cwd: root, stdio: 'inherit', env: { ...process.env, TEMP: temp, TMP: temp,
      NODE_PATH: [...new Set(nodePaths)].join(delimiter), STORY_UI_BROWSER: browser,
      PLAYWRIGHT_CHROMIUM_EXECUTABLE: browser, STORY_UI_ARTIFACTS: artifacts,
      OTT_PUBLIC_BROWSER_ARTIFACTS: ottArtifacts, OTT_UI_MEDIA_FIXTURE: fixture },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
