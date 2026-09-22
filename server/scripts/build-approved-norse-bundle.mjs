import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
} from 'node:zlib';

const [, , analysisPath, sourceMapPath, outputPath] = process.argv;
if (!analysisPath || !sourceMapPath || !outputPath) {
  throw new Error('Usage: node build-approved-norse-bundle.mjs <analysis.json> <source-map.json> <output.gz|output.br>');
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
const compressed = extname(outputPath).toLowerCase() === '.br'
  ? brotliCompressSync(bundle, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 10 },
    })
  : gzipSync(bundle, { level: 9 });
await writeFile(outputPath, compressed);
