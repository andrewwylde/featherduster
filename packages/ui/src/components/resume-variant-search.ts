export interface VariantOption { id: string; name: string; type: string }
const normalize = (s: string) => s.toLocaleLowerCase().trim().replace(/\s+/g, ' ');
function subsequence(query: string, text: string): boolean {
  let i = 0;
  for (const c of text) if (c === query[i]) i++;
  return i === query.length;
}
export function rankResumeVariants<T extends VariantOption>(options: readonly T[], query: string): T[] {
  const q = normalize(query);
  if (!q) return [...options];
  return options.map((option, index) => {
    const name = normalize(option.name), text = `${name} ${normalize(option.type)}`;
    const rank = name === q ? 0 : name.startsWith(q) ? 1 : text.includes(q) ? 2
      : subsequence(q.replace(/\s/g, ''), text.replace(/\s/g, '')) ? 3 : 4;
    return { option, index, rank };
  }).filter(x => x.rank < 4).sort((a, b) => a.rank - b.rank || a.index - b.index).map(x => x.option);
}

