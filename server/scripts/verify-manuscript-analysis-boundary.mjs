// Read-only local execution of the real DTO, analysis policy and JSON parser.
// Dependencies are reused from an existing server installation, never installed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const [artifactDirectory, dependenciesDirectory] = process.argv.slice(2);
assert(artifactDirectory && dependenciesDirectory, 'usage: node verifier.mjs ARTIFACT_DIRECTORY SERVER_NODE_MODULES');
const server = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependencyRequire = createRequire(resolve(dependenciesDirectory, '../package.json'));
const ts = dependencyRequire('typescript');
dependencyRequire('reflect-metadata');
const require = createRequire(import.meta.url);
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, filename) => {
  assert(filename.startsWith(resolve(server, 'src')), 'only local server TypeScript is permitted');
  module.paths = [resolve(dependenciesDirectory), ...module.paths];
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true, emitDecoratorMetadata: true },
  });
  module._compile(outputText, filename);
};

try {
  const bytes = readFileSync(resolve(artifactDirectory, 'analysis-input.json'));
  const checksums = JSON.parse(readFileSync(resolve(artifactDirectory, 'checksums.json')));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, checksums['analysis-input.json'].sha256, 'analysis payload checksum mismatch');
  const input = JSON.parse(bytes);
  assert.equal(Buffer.byteLength(JSON.stringify(input)), bytes.length, 'wire byte measurement differs');
  const { CreateManuscriptVersionDto } = require(resolve(server, 'src/story-production/dto/story-production.dto.ts'));
  const policy = require(resolve(server, 'src/story-production/story-production.policy.ts'));
  const { plainToInstance } = dependencyRequire('class-transformer');
  const { validateSync } = dependencyRequire('class-validator');
  const errors = validateSync(plainToInstance(CreateManuscriptVersionDto, input), {
    whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
    validationError: { target: false, value: false },
  });
  const constraints = [];
  function collect(items, prefix = '') {
    for (const item of items) {
      for (const constraint of Object.keys(item.constraints ?? {})) constraints.push(`${prefix}${item.property}:${constraint}`);
      collect(item.children ?? [], `${prefix}${item.property}.`);
    }
  }
  collect(errors);
  const analysis = policy.analyzeStructuredManuscript(input.parts);
  const jsonParser = dependencyRequire('body-parser').json({ verify: (_req, _res, body) => assert(Buffer.isBuffer(body)) });
  // A local Readable is not a socket; no HTTP server or network transmission.
  const request = Readable.from([bytes]);
  request.headers = { 'content-type': 'application/json', 'content-length': String(bytes.length) };
  const parserResult = await new Promise((done) => jsonParser(request, {}, error => {
    done(error ? { status: error.status, type: error.type, limit: error.limit, length: error.length } : { status: 200 });
  }));
  const prismaRuntime = readFileSync(dependencyRequire.resolve('@prisma/client/runtime/library'), 'utf8');
  const transactionDefaults = {
    maxWait2000Observed: /maxWait.{0,100}(?:2000|2e3)/.test(prismaRuntime),
    timeout5000Observed: /timeout.{0,100}(?:5000|5e3)/.test(prismaRuntime),
  };
  console.log(JSON.stringify({ offlineOnly: true, parts: input.parts.length, payloadBytes: bytes.length,
    payloadSha256: digest, structuredBodyHash: policy.manuscriptContentHash({ parts: input.parts }),
    dtoConstraints: constraints, parserResult,
    analysisEvidenceCount: analysis.evidence.length, analysisCounts: analysis.counts,
    transactionDefaults, databaseCapacityTested: false, proxyLimitVerified: false, publishReady: false }));
} finally {
  if (previous) Module._extensions['.ts'] = previous;
  else delete Module._extensions['.ts'];
}
