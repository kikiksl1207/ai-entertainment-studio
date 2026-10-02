(function () {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const HASH = /^[a-f0-9]{64}$/;
  const LOCALES = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const positive = (value) => Number.isSafeInteger(value) && value > 0;
  const uuid = (value) => typeof value === "string" && UUID.test(value);
  const hash = (value) => typeof value === "string" && HASH.test(value);

  function validText(value) {
    if (typeof value !== "string" || value.length > 64000 || value.includes("\0") || Array.from(value.trim()).length < 2) return false;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    }
    return true;
  }

  function target(context) {
    if (!context || ![context.userId, context.progressId, context.workId, context.scene?.id, context.progress?.part?.id].every(uuid) ||
        context.sceneIdentity !== context.userId || !LOCALES.includes(context.locale)) return null;
    const { progress, scene, members } = context;
    if (progress.progressId !== context.progressId || progress.scene?.id !== scene.id ||
        !["active", "completed"].includes(progress.status) || !positive(progress.revision) ||
        !positive(progress.storyVersion) || !positive(progress.currentAct) || progress.currentGeneratedSceneId ||
        scene.isGenerated === true || scene.deliveryState === "ready" || !Array.isArray(members) || !members.length || members.length > 40) return null;
    const source = members.map((member) => {
      if (!uuid(member?.id) || !positive(member.position) || member.position > 40 ||
          !["paragraph", "narration", "dialogue"].includes(member.type) ||
          member.content?.locale !== context.locale || member.content?.fallback !== false || !validText(member.content.value)) return null;
      return Object.freeze({ id: member.id, position: member.position, type: member.type, text: member.content.value });
    });
    if (source.some((value) => !value) || new Set(source.map((value) => value.id)).size !== source.length ||
        new Set(source.map((value) => value.position)).size !== source.length ||
        source.some((value, index) => index > 0 && value.position <= source[index - 1].position)) return null;
    const value = { userId: context.userId, progressId: context.progressId, workId: context.workId,
      sceneId: scene.id, partId: progress.part.id, locale: context.locale, revision: progress.revision,
      storyVersion: progress.storyVersion, actNumber: progress.currentAct, members: Object.freeze(source) };
    return Object.freeze({ ...value, key: JSON.stringify(value) });
  }

  async function hashText(text, crypto) {
    if (!validText(text) || typeof crypto?.subtle?.digest !== "function") throw new Error("Canonical read hashing unavailable");
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== 32) throw new Error("Canonical read hashing invalid");
    return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function validPreview(value) {
    const pin = value?.identity;
    return value?.contract === "story-canonical-read-review-v1" && value.confirmationRecorded === false && value.readerMemoryApplied === false &&
      pin && [pin.userId, pin.progressId, pin.workId, pin.ownerUserId, pin.releaseId, pin.manuscriptVersionId,
        pin.partId, pin.sceneId, pin.beatId, pin.routeNodeId].every(uuid) &&
      [pin.releaseChecksum, pin.manuscriptHash, pin.sourceChecksum, pin.sourceTextHash, pin.routeHash, value.scopeChecksum].every(hash) &&
      positive(pin.beatPosition) && pin.beatPosition <= 40 && positive(pin.actNumber) && positive(pin.storyVersion) && positive(pin.progressRevision) &&
      LOCALES.includes(pin.locale) && value.sourceChecksum === pin.sourceChecksum && value.sourceTextHash === pin.sourceTextHash &&
      value.expectedRevision === pin.progressRevision;
  }

  function previewMatches(value, reading, member, textHash) {
    if (!validPreview(value) || !reading || !member || !hash(textHash)) return false;
    const pin = value.identity;
    return pin.userId === reading.userId && pin.progressId === reading.progressId && pin.workId === reading.workId &&
      pin.sceneId === reading.sceneId && pin.partId === reading.partId && pin.locale === reading.locale &&
      pin.progressRevision === reading.revision && pin.storyVersion === reading.storyVersion && pin.actNumber === reading.actNumber &&
      pin.beatId === member.id && pin.beatPosition === member.position && pin.sourceTextHash === textHash;
  }

  function pageScope(value) {
    if (!validPreview(value)) return null;
    const pin = value.identity;
    return JSON.stringify([pin.userId, pin.progressId, pin.workId, pin.ownerUserId, pin.releaseId, pin.releaseChecksum,
      pin.manuscriptVersionId, pin.manuscriptHash, pin.partId, pin.sceneId, pin.actNumber, pin.locale,
      pin.routeNodeId, pin.routeHash, pin.storyVersion, pin.progressRevision]);
  }

  function receiptMatches(value, preview) {
    if (!validPreview(preview) || value?.contract !== "story-canonical-read-receipt-v1" || !uuid(value.receiptId) ||
        value.invalidatedAt !== null || value.readerMemoryApplied !== false || typeof value.idempotentReplay !== "boolean" ||
        typeof value.confirmedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.confirmedAt) ||
        !Number.isFinite(Date.parse(value.confirmedAt))) return false;
    return ["progressId", "workId", "sceneId", "beatId", "sourceChecksum", "sourceTextHash", "locale", "routeNodeId", "progressRevision"]
      .every((key) => value[key] === preview.identity[key]) && value.scopeChecksum === preview.scopeChecksum;
  }

  window.LuminaCanonicalRead = Object.freeze({ target, hashText, previewMatches, pageScope, receiptMatches });
})();
