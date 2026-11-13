import { Plus, X } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { Tag } from "../core/types.js";

export const sameTags = (a: Tag[], b: Tag[]): boolean => JSON.stringify(a) === JSON.stringify(b);

export const tagKey = (tag: Tag): string => `${tag.type}\u0000${tag.value}`;

function parseTag(input: string): Tag | null {
  const at = input.indexOf(":");
  const type = input.slice(0, at).trim();
  const value = input.slice(at + 1).trim();
  return at > 0 && type && value ? { type, value } : null;
}

export function TagPill({ tag, className, onRemove }: { tag: Tag; className?: string; onRemove?: () => void }) {
  return (
    <Badge variant="secondary" title={`${tag.type}: ${tag.value}`} className={cn("max-w-full", onRemove && "pr-1", className)}>
      <span className="opacity-70">{tag.type}</span>
      <span className="truncate">{tag.value}</span>
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${tag.type} ${tag.value}`}
          className="size-4 rounded-full opacity-70 hover:opacity-100 [&_svg:not([class*='size-'])]:size-3"
          onClick={onRemove}
        >
          <X />
        </Button>
      ) : null}
    </Badge>
  );
}

export function TagEditor({
  tags,
  onChange,
  suggestions,
  label,
}: {
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
  suggestions: Tag[];
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const listId = useId();

  const commit = (): void => {
    const tag = draft === null ? null : parseTag(draft);
    if (tag && !tags.some(existing => tagKey(existing) === tagKey(tag))) onChange([...tags, tag]);
    setDraft(null);
  };

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1">
      {tags.map((tag, index) => (
        <TagPill key={tagKey(tag)} tag={tag} onRemove={() => onChange(tags.filter((_, i) => i !== index))} />
      ))}
      {draft === null ? (
        <Button
          variant="outline"
          size="sm"
          aria-label={`Add tag to ${label}`}
          className="h-6 gap-1 rounded-full border-dashed px-2 text-muted-foreground has-[>svg]:px-2"
          onClick={() => setDraft("")}
        >
          <Plus />
          {tags.length === 0 ? "Tag" : null}
        </Button>
      ) : (
        <>
          <Input
            autoFocus
            aria-label={`New tag for ${label}`}
            list={listId}
            placeholder="type: value"
            className="h-6 w-44 rounded-full px-2.5 md:text-sm"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDraft(null);
              }
            }}
          />
          <datalist id={listId}>
            {suggestions.map(tag => (
              <option key={tagKey(tag)} value={`${tag.type}: ${tag.value}`} />
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}
