"use client";

import { XIcon } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type TagInputProps = {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Offered as the user types. Rendered in the browser only. */
  suggestions?: () => string[];
  invalid?: boolean;
  /** Styles each entry. */
  tagClassName?: string;
  "aria-describedby"?: string;
  ref?: React.Ref<HTMLInputElement>;
};

const subscribeNever = () => () => {};

/**
 * A list of short values, such as countries or technologies. Enter or a comma
 * adds what's typed, Backspace in an empty box removes the last one, and a
 * pasted comma-separated list becomes separate entries.
 */
export function TagInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  suggestions,
  invalid,
  tagClassName,
  ref,
  ...props
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  function setInput(node: HTMLInputElement | null) {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }
  // Suggestions such as time zone names can differ between the server and the
  // browser, so they render only after hydration.
  const isClient = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  function add(text: string) {
    const known = new Set(value.map((item) => item.toLowerCase()));
    const additions: string[] = [];
    for (const part of text.split(",")) {
      const item = part.trim();
      if (item && !known.has(item.toLowerCase())) {
        known.add(item.toLowerCase());
        additions.push(item);
      }
    }
    if (additions.length > 0) onChange([...value, ...additions]);
    setDraft("");
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div
      data-invalid={invalid || undefined}
      className={cn(
        "flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 data-[invalid]:border-destructive data-[invalid]:ring-3 data-[invalid]:ring-destructive/20 dark:bg-input/30",
      )}
    >
      {value.map((item, index) => (
        <Badge
          key={item}
          variant="secondary"
          className={cn("h-6 gap-1 pr-1", tagClassName)}
        >
          {item}
          <button
            type="button"
            onClick={() => {
              remove(index);
              // The button is gone once the tag is, so keep focus in the box.
              inputRef.current?.focus();
            }}
            className="-my-1 rounded-full p-1 outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Remove ${item}`}
          >
            <XIcon aria-hidden className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        {...props}
        ref={setInput}
        id={id}
        value={draft}
        list={suggestions && isClient ? listId : undefined}
        placeholder={value.length === 0 ? placeholder : undefined}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          const next = event.target.value;
          if (next.includes(",")) add(next);
          else setDraft(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(draft);
          } else if (
            event.key === "Backspace" &&
            draft === "" &&
            value.length > 0
          ) {
            remove(value.length - 1);
          }
        }}
        onBlur={() => {
          add(draft);
          onBlur?.();
        }}
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      {suggestions && isClient && (
        <datalist id={listId}>
          {suggestions().map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </div>
  );
}
