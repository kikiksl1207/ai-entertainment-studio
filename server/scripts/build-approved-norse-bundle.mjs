import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const [, , analysisPath, sourceMapPath, outputPath] = process.argv;
if (!analysisPath || !sourceMapPath || !outputPath) {
  throw new Error('Usage: node build-approved-norse-bundle.mjs <analysis.json> <source-map.json> <output.gz>');
}

const magic = Buffer.from('LUMINA_NORSE_BUNDLE_V1\0', 'ascii');
const sources = await Promise.all([readFile(analysisPath), readFile(sourceMapPath)]);
const lengthFields = sources.map((source) => {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(source.length);
  return length;
});
const bundle = Buffer.concat([
  magic,
  lengthFields[0],
  sources[0],
  lengthFields[1],
  sources[1],
]);
await writeFile(outputPath, gzipSync(bundle, { level: 9 }));
