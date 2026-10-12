/** URL normalization is for identity only, not permission to fetch a destination.
 * Retrieval must separately validate DNS results and every redirect.
 */
export function canonicalizeJobUrl(input: string): string {
  const value = input.trim();
  // Require an authority instead of letting URL repair extra leading slashes.
  if (!/^https:\/\/[^/?#]/i.test(value) || /[\\\u0000-\u0020\u007f]/.test(value)) {
    throw new Error('Enter an absolute HTTPS job URL without whitespace or backslashes.');
  }
  const url = new URL(value);
  // URL erases empty userinfo, so reject its delimiter in the original authority too.
  const hasUserinfo = /^https:\/\/[^/?#]*@/i.test(value);
  if (url.protocol !== 'https:' || hasUserinfo || url.username || url.password || url.port) {
    throw new Error('Job URLs must use HTTPS on port 443 and contain no credentials.');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(gh_src|gclid|fbclid|msclkid|dclid)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  // Stable sorting preserves the order of repeated parameters, which may matter.
  url.searchParams.sort();
  return url.href;
}

export type JobIntakeInput = { mode: 'urls' | 'text'; input: string };
export type JobIntakePreviewItem =
  | { index: number; original: string; valid: true; mode: 'urls'; canonical_url: string }
  | { index: number; original: string; valid: true; mode: 'text'; text: string }
  | { index: number; original: string; valid: false; error: string };

/** Pure preview: never retrieves URLs, persists jobs, or enables preparation. */
export function previewJobIntake(request: JobIntakeInput): JobIntakePreviewItem[] {
  if (request.mode === 'text') {
    const text = request.input.replace(/\r\n?/g, '\n').trim();
    return text
      ? [{ index: 0, original: request.input, valid: true, mode: 'text', text }]
      : [{ index: 0, original: request.input, valid: false, error: 'Posting text is required.' }];
  }
  if (!request.input.trim()) return [];
  return request.input.split(/\r\n?|\n/).map((original, index) => {
    try {
      return { index, original, valid: true, mode: 'urls', canonical_url: canonicalizeJobUrl(original) };
    } catch (error) {
      return { index, original, valid: false, error: error instanceof Error ? error.message : 'Invalid job URL.' };
    }
  });
}
