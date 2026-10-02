import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCandidateReport } from './release-audit-evidence.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const ts = require('typescript');
const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
const expectedRoot = 'E:\\Codex\\LuminaStage\\ai-entertainment-studio-git';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const maxBytes = 8 * 1024 * 1024;

function checkedPath(root, relative, allowMissing = false) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || /[\x00-\x1f:?#]/.test(relative) ||
      path.posix.isAbsolute(relative) || relative.split('/').some((part) => !part || part === '.' || part === '..') ||
      !/^server\/(src\/[^]+\.ts|dist\/[^]+\.js|(?:tsconfig(?:\.build)?|nest-cli)\.json)$/i.test(relative)) {
    throw new Error('Unsafe build audit path');
  }
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      if (allowMissing) return null;
      throw new Error(`Missing build input: ${relative}`);
    }
    if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw new Error('Linked build audit path');
  }
  if (!statSync(current).isFile() || statSync(current).size > maxBytes) throw new Error('Invalid build audit file');
  return current;
}

export function compareBuildOutputs({ root, outputs, readBytes = readFileSync }) {
  root = path.resolve(root);
  if (realpathSync(root) !== root || !(outputs instanceof Map) || !outputs.size || outputs.size > 2000) {
    throw new Error('Invalid build audit inputs');
  }
  const collisions = new Set();
  const records = [];
  for (const [file, bytes] of [...outputs].sort(([a], [b]) => a.localeCompare(b))) {
    if (!file.startsWith('server/dist/') || !file.endsWith('.js') || !Buffer.isBuffer(bytes) || bytes.length > maxBytes) {
      throw new Error('Invalid expected JavaScript output');
    }
    const normalized = file.normalize('NFC').toLowerCase();
    if (collisions.has(normalized)) throw new Error('Colliding JavaScript output');
    collisions.add(normalized);
    const absolute = checkedPath(root, file, true);
    const current = absolute ? readBytes(absolute) : null;
    if (current && !Buffer.isBuffer(current)) throw new Error('Expected compiled bytes');
    records.push({ file, expectedSha256: hash(bytes), actualSha256: current ? hash(current) : null,
      bytes: current?.length ?? 0, state: !current ? 'missing' : current.equals(bytes) ? 'matches' : 'changed' });
  }
  // Inventory extra JavaScript too; an old build can leave unreferenced modules behind.
  const extras = [];
  const directory = path.join(root, 'server', 'dist');
  let visited = 0;
  let found = new Set();
  const walk = (absolute, collectExtras = true) => {
    if (++visited > 6000 || lstatSync(absolute).isSymbolicLink() || realpathSync(absolute) !== absolute) {
      throw new Error('Invalid compiled directory');
    }
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (++visited > 6000) throw new Error('Oversized compiled inventory');
      const target = path.join(absolute, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Linked compiled entry');
      if (entry.isDirectory()) walk(target, collectExtras);
      else if (/\.js$/i.test(entry.name)) {
        const file = path.relative(root, target).split(path.sep).join('/');
        found.add(file);
        if (collectExtras && !outputs.has(file)) {
          const bytes = readBytes(checkedPath(root, file));
          if (!Buffer.isBuffer(bytes)) throw new Error('Expected compiled bytes');
          extras.push({ file, bytes: bytes.length, sha256: hash(bytes) });
        }
      }
    }
  };
  if (existsSync(directory)) walk(directory);
  const firstInventory = [...found].sort();
  for (const record of records.filter((item) => item.state !== 'missing')) {
    if (hash(readBytes(checkedPath(root, record.file))) !== record.actualSha256) throw new Error('Compiled file changed during audit');
  }
  for (const record of extras) {
    if (hash(readBytes(checkedPath(root, record.file))) !== record.sha256) throw new Error('Extra compiled file changed during audit');
  }
  visited = 0;
  found = new Set();
  if (existsSync(directory)) walk(directory, false);
  if (JSON.stringify([...found].sort()) !== JSON.stringify(firstInventory)) throw new Error('Compiled inventory changed during audit');
  return { files: records, extraJavaScript: extras.sort((a, b) => a.file.localeCompare(b.file)),
    localJavaScriptMatches: records.every((item) => item.state === 'matches') && extras.length === 0 };
}

export function validateBuildConfiguration(build, base, nest) {
  if (!build || build.extends !== './tsconfig.json' || Object.hasOwn(build, 'references') ||
      !base || Object.hasOwn(base, 'extends') || Object.hasOwn(base, 'references') ||
      !nest || nest.sourceRoot !== 'src' || Object.hasOwn(nest, 'compilerOptions') || Object.hasOwn(nest, 'projects')) {
    throw new Error('Unsupported build configuration inheritance or compiler');
  }
}

export function auditLocalBuild(root) {
  root = path.resolve(root);
  if (realpathSync(root) !== root) throw new Error('Linked build root');
  const captured = new Map();
  const capture = (file) => {
    const bytes = readFileSync(checkedPath(root, file));
    if (!captured.has(file)) captured.set(file, hash(bytes));
    return bytes.toString('utf8');
  };
  const configs = ['server/tsconfig.build.json', 'server/tsconfig.json', 'server/nest-cli.json'];
  const [build, base, nest] = configs.map((file) => JSON.parse(capture(file)));
  validateBuildConfiguration(build, base, nest);
  const configPath = path.join(root, 'server', 'tsconfig.build.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error('Invalid TypeScript build configuration');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), undefined, configPath);
  if (parsed.errors.length || !parsed.fileNames.length || parsed.options.module !== ts.ModuleKind.CommonJS ||
      path.resolve(parsed.options.outDir ?? '') !== path.join(root, 'server', 'dist')) throw new Error('Unexpected build configuration');
  for (const file of parsed.fileNames) capture(path.relative(root, file).split(path.sep).join('/'));
  const options = { ...parsed.options, incremental: false, tsBuildInfoFile: undefined };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  host.readFile = (file) => {
    const relative = path.relative(root, file).split(path.sep).join('/');
    return relative.startsWith('server/src/') && relative.endsWith('.ts') ? capture(relative) : originalRead(file);
  };
  const program = ts.createProgram(parsed.fileNames, options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(`TypeScript build diagnostics: ${diagnostics.map((item) => item.code).join(',')}`);
  const outputs = new Map();
  // Compiler output is held in memory, never written over the existing build.
  const emitted = program.emit(undefined, (file, contents) => {
    if (!file.endsWith('.js')) return;
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (!relative.startsWith('server/dist/') || outputs.has(relative)) throw new Error('Unexpected compiler output');
    outputs.set(relative, Buffer.from(contents, 'utf8'));
  });
  if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error('TypeScript build emit failed');
  const comparison = compareBuildOutputs({ root, outputs });
  for (const [file, fingerprint] of captured) {
    if (hash(readFileSync(checkedPath(root, file))) !== fingerprint) throw new Error('Build input changed during audit');
  }
  const finalParsed = ts.parseJsonConfigFileContent(build, ts.sys, path.dirname(configPath), undefined, configPath);
  if (JSON.stringify([...finalParsed.fileNames].sort()) !== JSON.stringify([...parsed.fileNames].sort())) {
    throw new Error('TypeScript source inventory changed during audit');
  }
  return { version: 1, scope: 'Current TypeScript compiler JavaScript output compared with local dist only',
    production: false, deployment: false, realAi: false, compilerVersion: ts.version,
    sourceFiles: [...captured].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ file, sha256 })),
    expectedJavaScriptCount: outputs.size, ...comparison,
    limitations: ['No artifact is executed, uploaded or replaced',
      'Declarations, source maps, build info and native/package dependencies are not certified',
      'Not a complete static website, media, container or production deployment bundle audit',
      'Uses the installed local TypeScript compiler and trusted repository configuration, not a clean-room reproducible build',
      'Only the checked build-to-base tsconfig inheritance and default Nest compiler are supported; inventory rechecks are not an atomic filesystem snapshot',
      'No operational settings, migration history, rollout or rollback approval is inferred'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'win32' || realpathSync(rootDirectory) !== expectedRoot) throw new Error('CLI requires the authorized E repository');
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: node scripts/release-build-audit.mjs --output qa-artifacts/report.json');
    const report = auditLocalBuild(rootDirectory);
    writeCandidateReport(rootDirectory, args[1], report);
    process.stdout.write(`${JSON.stringify({ evidence: args[1], compilerVersion: report.compilerVersion,
      expectedJavaScriptCount: report.expectedJavaScriptCount, missing: report.files.filter((f) => f.state === 'missing').length,
      changed: report.files.filter((f) => f.state === 'changed').length, extras: report.extraJavaScript.length,
      localJavaScriptMatches: report.localJavaScriptMatches })}\n`);
    process.exitCode = report.localJavaScriptMatches ? 0 : 2;
  } catch (error) {
    process.stderr.write(`Build audit stopped: ${error.message}\n`);
    process.exitCode = 1;
  }
}
