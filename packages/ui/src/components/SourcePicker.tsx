import { useEffect, useId, useRef, useState } from 'react';
import { rankResumeVariants, type VariantOption } from './resume-variant-search.js';
export function SourcePicker({ options, value, onSelect, label = "Source", disabled = false }: {
  options: readonly VariantOption[]; value: string; onSelect(id: string): void; label?: string; disabled?: boolean;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const selected = options.find(o => o.id === value);
  const selectedLabel = selected ? `${selected.name}${selected.type ? ` · ${selected.type}` : ""}` : "";
  const results = rankResumeVariants(options, query);
  const close = () => { setOpen(false); setQuery(''); setActive(-1); };
  const choose = (option: VariantOption) => { onSelect(option.id); close(); };
  useEffect(() => {
    root.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, query]);
  return <div ref={root} className="relative" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
  }}>
    <input role="combobox" aria-label={label} disabled={disabled} aria-autocomplete="list"
      aria-expanded={open} aria-controls={`${id}-list`}
      aria-activedescendant={open && results[active] ? `${id}-${active}` : undefined}
      value={open ? query : selectedLabel} placeholder="Search sources…"
      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onChange={e => { setQuery(e.target.value); setActive(-1); setOpen(true); }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); setOpen(true);
          setActive(n => results.length ? (e.key === 'ArrowDown' ? (n + 1) % results.length : (n <= 0 ? results.length - 1 : n - 1)) : -1);
        }
        if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); choose(results[active]); }
        if (e.key === 'Tab') close();
      }} />
    {open && <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-700 bg-slate-950 text-white shadow-lg">
      <ul id={`${id}-list`} role="listbox" aria-label={`${label} options`}>
        {results.map((option, index) => <li key={option.id} id={`${id}-${index}`} role="option"
          aria-selected={option.id === value} data-active={index === active}
          className={`cursor-pointer px-3 py-2 text-sm ${index === active ? 'bg-slate-700' : ''}`}
          onMouseDown={e => e.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => { if (!disabled) choose(option); }}>
          {option.name}{option.type ? ` · ${option.type}` : ""}
        </li>)}
      </ul>
      {!results.length && <p role="status" className="p-3 text-sm">No matching sources</p>}
    </div>}
  </div>;
}

