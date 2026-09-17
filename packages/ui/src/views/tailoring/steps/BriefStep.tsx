import React from 'react';

/** Minimal renderer for the orchestrator's brief markdown (headings, bullets, emphasis). */
function renderInline(text: string, key: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) return <em key={`${key}-${i}`} className="text-slate-500">{part.slice(1, -1)}</em>;
    return <React.Fragment key={`${key}-${i}`}>{part}</React.Fragment>;
  });
}

export const BriefMarkdown: React.FC<{ markdown: string }> = ({ markdown }) => {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      blocks.push(
        <ul key={key} className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b, `${key}-${i}`)}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  markdown.split('\n').forEach((line, idx) => {
    const key = `b${idx}`;
    if (line.startsWith('- ')) {
      bullets.push(line.slice(2));
      return;
    }
    flush(`${key}-ul`);
    if (line.startsWith('# ')) blocks.push(<h3 key={key} className="text-lg font-bold text-slate-900 dark:text-white">{line.slice(2)}</h3>);
    else if (line.startsWith('## ')) blocks.push(<h4 key={key} className="pt-2 text-sm font-semibold uppercase tracking-wide text-vermilion-600 dark:text-vermilion-400">{line.slice(3)}</h4>);
    else if (line.startsWith('### ')) blocks.push(<h5 key={key} className="pt-1 text-sm font-semibold text-slate-900 dark:text-white">{renderInline(line.slice(4), key)}</h5>);
    else if (line.trim()) blocks.push(<p key={key} className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{renderInline(line, key)}</p>);
  });
  flush('end-ul');
  return <div className="space-y-2">{blocks}</div>;
};
