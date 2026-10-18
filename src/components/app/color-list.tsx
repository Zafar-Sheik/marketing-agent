'use client';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';

/** Brand colour pickers that submit as repeated form fields. */
export function ColorList({ name, initial = [], max = 4 }: { name: string; initial?: string[]; max?: number }) {
  const [colors, setColors] = useState<string[]>(initial.length ? initial : []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((c, i) => (
        <div key={i} className="flex items-center gap-1 rounded-lg border border-line bg-panel-2 p-1 pr-2">
          <input
            type="color"
            name={name}
            value={c}
            onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
            className="size-7 cursor-pointer rounded border-0 bg-transparent"
            aria-label={`Colour ${i + 1}`}
          />
          <span className="font-mono text-xs text-muted">{c}</span>
          <button type="button" onClick={() => setColors(colors.filter((_, j) => j !== i))} className="text-muted hover:text-bad" aria-label="Remove colour">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {colors.length < max && (
        <button
          type="button"
          onClick={() => setColors([...colors, '#7C5CFF'])}
          className="flex items-center gap-1 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted hover:border-accent hover:text-fg"
        >
          <Plus className="size-3.5" /> Add colour
        </button>
      )}
    </div>
  );
}
