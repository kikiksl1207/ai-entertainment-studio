import {
  isLockedArtistPersona,
  selectArtistPersona,
  type ArtistPersonaSourceArtist,
} from '../../chat/artist-persona-lock';

export type SelectedPublicArtistCore = Readonly<{
  release: string;
  summary: string;
  publicStory: string;
  personalityKeywords: readonly string[];
}>;

// Project only existing public fields from a freshly issued genuine selection.
export function selectedPublicArtistCore(
  artist: ArtistPersonaSourceArtist,
): SelectedPublicArtistCore | null {
  const selection = selectArtistPersona(artist);
  if (!isLockedArtistPersona(selection)) return null;

  const fields = selection.approvedPublicFields;
  return Object.freeze({
    release: selection.release,
    summary: fields.summary,
    publicStory: fields.publicStory,
    personalityKeywords: Object.freeze([...fields.personalityKeywords]),
  });
}
