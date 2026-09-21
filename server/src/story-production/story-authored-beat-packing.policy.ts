import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  AUTHORED_INITIAL_IMPORT_LIMITS,
  AuthoredScenePacking,
  AuthoredSceneText,
} from './story-authored-import.contract';

function invalid(code: string): never {
  throw new BadRequestException({ code, message: 'Authored scene packing failed bounded validation' });
}

function validateText(text: string) {
  if (!text.trim() || text.includes('\0')) invalid('AUTHORED_SCENE_TEXT_INVALID');
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = text.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) invalid('AUTHORED_SCENE_UNICODE_INVALID');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      invalid('AUTHORED_SCENE_UNICODE_INVALID');
    }
  }
}

// Only packs already verified narrative. It neither classifies private syntax
// nor treats a source checksum, type assertion, or ready flag as approval.
export function packAuthoredSceneBeats(scenes: readonly AuthoredSceneText[]): AuthoredScenePacking {
  const limits = AUTHORED_INITIAL_IMPORT_LIMITS;
  if (!scenes.length || scenes.length > limits.beatsPerPart) invalid('AUTHORED_SCENE_COUNT_INVALID');
  const result: AuthoredScenePacking = { beats: [], scenes: [] };
  const keys = new Set<string>();
  for (const scene of scenes) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(scene.sourceSceneKey) || keys.has(scene.sourceSceneKey)) {
      invalid('AUTHORED_SCENE_KEY_INVALID');
    }
    keys.add(scene.sourceSceneKey);
    if (scene.text.length > limits.beatTextUnits * limits.beatsPerPart) invalid('AUTHORED_BEAT_COUNT_EXCEEDED');
    validateText(scene.text);
    const firstBeatPosition = result.beats.length + 1;
    for (let start = 0; start < scene.text.length;) {
      if (result.beats.length === limits.beatsPerPart) invalid('AUTHORED_BEAT_COUNT_EXCEEDED');
      let end = Math.min(start + limits.beatTextUnits, scene.text.length);
      if (end < scene.text.length) {
        const paragraphEnd = scene.text.lastIndexOf('\n\n', end - 2);
        const crlfEnd = scene.text.lastIndexOf('\r\n\r\n', end - 4);
        const breakAfter = Math.max(paragraphEnd >= start ? paragraphEnd + 2 : 0,
          crlfEnd >= start ? crlfEnd + 4 : 0);
        if (breakAfter > start) end = breakAfter;
        else if (scene.text.charCodeAt(end - 1) >= 0xd800 && scene.text.charCodeAt(end - 1) <= 0xdbff) end--;
        if (scene.text[end - 1] === '\r' && scene.text[end] === '\n') end--;
      }
      result.beats.push({ position: result.beats.length + 1, sourceSceneKey: scene.sourceSceneKey,
        text: scene.text.slice(start, end), sceneTextStart: start, sceneTextEnd: end });
      start = end;
    }
    result.scenes.push({ sourceSceneKey: scene.sourceSceneKey,
      textSha256: createHash('sha256').update(scene.text, 'utf8').digest('hex'),
      textBytes: Buffer.byteLength(scene.text), firstBeatPosition,
      beatCount: result.beats.length - firstBeatPosition + 1 });
  }
  return result;
}
