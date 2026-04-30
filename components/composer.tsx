import type { FormEvent } from "react";

type ComposerProps = {
  value: string;
  onChange: (nextValue: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
};

export function Composer({ value, onChange, onSubmit, isLoading }: ComposerProps) {
  return (
    <div className="composer">
      <form className="composer-form" onSubmit={onSubmit}>
        <textarea
          className="composer-input"
          placeholder="Ask about a category, search term, or specific SKU..."
          value={value}
          rows={2}
          onChange={(event) => onChange(event.target.value)}
        />
        <button className="composer-button" type="submit" disabled={isLoading || !value.trim()}>
          {isLoading ? "Working..." : "Send"}
        </button>
      </form>
    </div>
  );
}
