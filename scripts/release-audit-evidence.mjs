import { existsSync, lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeCandidateReport(root, relative, report) {
  if (typeof relative !== 'string' || !/^qa-artifacts\/[a-zA-Z0-9_/-]+\.json$/.test(relative) ||
      relative.split('/').some((part) => !part || part === '..' || part === '.')) throw new Error('Invalid evidence path');
  root = path.resolve(root);
  if (realpathSync(root) !== root) throw new Error('Linked evidence root');
  let parent = root;
  for (const segment of relative.split('/').slice(0, -1)) {
    parent = path.join(parent, segment);
    if (existsSync(parent)) {
      if (lstatSync(parent).isSymbolicLink() || !statSync(parent).isDirectory() || realpathSync(parent) !== parent) throw new Error('Linked evidence directory');
    } else mkdirSync(parent);
  }
  const destination = path.join(root, relative);
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
}
