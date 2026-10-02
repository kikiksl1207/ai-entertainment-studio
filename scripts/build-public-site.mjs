import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const root = fileURLToPath(new URL('../', import.meta.url));
const blocked = /(^|\/)(?:server|scripts|tests|docs|agents|qa-artifacts|node_modules|dist|outputs|hold|reference|reference-rebuild)(\/|$)|(^|\/)\.|(?:\.spec|\.test|\.bak|\.map|\.log|\.sql|\.md|\.dump)(?:\.|$)|(?:^|\/)(?:secrets?|credentials?|_check)(?:\.|\/|$)/i;

function publicPath(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || /[\x00-\x1f:?#]/.test(file) ||
      path.posix.isAbsolute(file) || file.split('/').some((part) => !part || part === '.' || part === '..') ||
      blocked.test(file) || !/\.(?:html|js|css|txt|png|webp|jpe?g|svg|ttf|woff2?|mp4|vtt)$/i.test(file)) {
    throw new Error('Non-public publication path');
  }
  return file;
}

export function publicationFiles(manifest) {
  const keys = ['version', 'files', 'routes', 'characterCovers', 'selectedGalleries', 'referenceGalleries'];
  if (!manifest || manifest.version !== 1 || Object.keys(manifest).some((key) => !keys.includes(key)) ||
      keys.slice(1).some((key) => !Array.isArray(manifest[key]) || !manifest[key].length)) {
    throw new Error('Invalid public publication manifest');
  }
  const files = [...manifest.files];
  for (const route of manifest.routes) {
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(route)) throw new Error('Invalid public route');
    files.push(`${route}/index.html`);
  }
  for (const folder of manifest.characterCovers) {
    if (!/^[a-z]+(?:-[a-z]+)*(?:\/site-selected)?$/.test(folder)) throw new Error('Invalid character cover folder');
    for (const type of ['cover', 'thumb']) files.push(`assets/characters/${folder}/${type}.png`);
  }
  for (const [key, selected] of [['selectedGalleries', true], ['referenceGalleries', false]]) {
    for (const slug of manifest[key]) {
      if (!/^[a-z]+(?:-[a-z]+)*$/.test(slug)) throw new Error('Invalid character gallery');
      for (let n = 1; n <= 14; n++) {
        const file = `${selected ? 'site-selected/gallery' : 'reference-final'}-${String(n).padStart(2, '0')}.png`;
        files.push(`assets/characters/${slug}/${file}`);
      }
    }
  }
  const names = new Set();
  for (const file of files) {
    publicPath(file);
    const normalized = file.normalize('NFC').toLowerCase();
    if (names.has(normalized)) throw new Error('Duplicate or colliding public path');
    names.add(normalized);
  }
  if (files.length > 2000 || !files.includes('index.html') || !files.includes('robots.txt')) throw new Error('Invalid publication inventory');
  return files.sort();
}

function checkedFile(directory, relative) {
  const absolute = path.resolve(directory, relative);
  if (!absolute.startsWith(directory + path.sep)) throw new Error('Escaping publication path');
  let current = directory;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (!existsSync(current) || lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) {
      throw new Error('Missing or linked publication input');
    }
  }
  const info = statSync(absolute);
  if (!info.isFile() || info.size > 256 * 1024 * 1024) throw new Error('Invalid publication input');
  return absolute;
}

export function verifyPublicArtifact(directory, records) {
  directory = path.resolve(directory);
  if (realpathSync(directory) !== directory) throw new Error('Linked publication output');
  const expected = new Map(records.map((record) => [publicPath(record.file), record.sha256]));
  if (expected.size !== records.length) throw new Error('Duplicate artifact record');
  const found = [];
  let visited = 0;
  const walk = (current) => {
    if (++visited > 4000 || lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw new Error('Invalid artifact directory');
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Linked artifact entry');
      if (entry.isDirectory()) walk(absolute);
      else {
        const file = path.relative(directory, absolute).split(path.sep).join('/');
        if (file === '.nojekyll') {
          if (readFileSync(absolute).length) throw new Error('Invalid nojekyll marker');
        } else if (!expected.has(publicPath(file)) || hash(readFileSync(checkedFile(directory, file))) !== expected.get(file)) {
          throw new Error('Unexpected or changed artifact file');
        }
        found.push(file);
      }
    }
  };
  walk(directory);
  if (found.length !== records.length + 1 || !found.includes('.nojekyll') || records.some((record) => !found.includes(record.file))) {
    throw new Error('Incomplete public artifact');
  }
  return { files: records.length, bytes: records.reduce((total, item) => total + item.bytes, 0), verified: true };
}

export function buildPublicSite({ sourceRoot, output, manifest }) {
  sourceRoot = path.resolve(sourceRoot);
  if (realpathSync(sourceRoot) !== sourceRoot) throw new Error('Linked source root');
  const files = publicationFiles(manifest);
  output = path.resolve(output);
  const relative = path.relative(sourceRoot, output).split(path.sep).join('/');
  if (!/^(?:build|qa-artifacts)\/[a-zA-Z0-9_/-]+$/.test(relative) || relative.split('/').some((part) => part === '..')) {
    throw new Error('Output must be a dedicated build or QA directory');
  }
  let parent = sourceRoot;
  for (const part of relative.split('/').slice(0, -1)) {
    parent = path.join(parent, part);
    if (existsSync(parent)) {
      if (!statSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink() || realpathSync(parent) !== parent) throw new Error('Linked output parent');
    } else mkdirSync(parent);
  }
  if (existsSync(output)) throw new Error('Refusing to overwrite an existing artifact');
  // Validate every input before creating the output. No recursive checkout copy or cleanup.
  const records = files.map((file) => {
    const bytes = readFileSync(checkedFile(sourceRoot, file));
    return { file, bytes: bytes.length, sha256: hash(bytes) };
  });
  if (records.reduce((sum, item) => sum + item.bytes, 0) > 1_000_000_000) throw new Error('Oversized publication');
  mkdirSync(output);
  for (const record of records) {
    const bytes = readFileSync(checkedFile(sourceRoot, record.file));
    if (hash(bytes) !== record.sha256) throw new Error('Publication input changed during build');
    const target = path.join(output, record.file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx' });
  }
  writeFileSync(path.join(output, '.nojekyll'), '', { flag: 'wx' });
  for (const record of records) {
    if (hash(readFileSync(checkedFile(sourceRoot, record.file))) !== record.sha256) throw new Error('Publication source changed during build');
  }
  return { ...verifyPublicArtifact(output, records), records, output };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hostedCheckout = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_WORKSPACE &&
    path.resolve(process.env.GITHUB_WORKSPACE) === path.resolve(root);
  if (process.platform === 'win32' && !hostedCheckout && !/^E:\\/i.test(root)) {
    throw new Error('Local Windows publication work must stay on E');
  }
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Expected at most one output path');
  const manifest = JSON.parse(readFileSync(new URL('public-site-manifest.json', import.meta.url), 'utf8'));
  const result = buildPublicSite({ sourceRoot: root, output: args[0] ?? path.join(root, 'build', 'public-site'), manifest });
  console.log(JSON.stringify({ files: result.files, bytes: result.bytes, verified: result.verified, output: result.output }));
}
