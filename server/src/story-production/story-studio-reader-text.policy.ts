export function readerPartText(source: string, reviewedTitle: string): string {
  const firstLine = source.match(/^([^\r\n]+)(\r\n|\n|\r)/u);
  if (!firstLine) return source;
  const heading = firstLine[1].match(/^\uFEFF?(?:#{1,3}[ \t]*)?(?:(?:Part|Side|외전)[ \t]+[0-9]{1,4}[ \t]*[.·:：-][ \t]*|(?:제[ \t]*)?[0-9]{1,4}[ \t]*(?:화|장|편)[ \t]*(?:[.·:：-][ \t]*)?)(.+?)[ \t]*$/iu);
  if (!heading || heading[1].trim() !== reviewedTitle.trim()) return source;
  return source.slice(firstLine[0].length).replace(/^(?:\r\n|\n|\r)/u, '');
}
