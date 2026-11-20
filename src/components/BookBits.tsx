import { goodreadsUrl } from "../../supabase/functions/_shared/goodreads.ts";

export function Cover({ url, title }: { url: string | null; title: string }) {
  if (!url) return <div className="cover cover-blank" aria-hidden="true">{title}</div>;
  return <img className="cover" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />;
}

export function GoodreadsLink(props: {
  book: { goodreads_id?: string | null; isbn13?: string | null; isbn10?: string | null; title: string; author?: string | null };
  className?: string;
  label?: string;
}) {
  return (
    <a className={props.className ?? "btn btn-sm"} href={goodreadsUrl(props.book)} target="_blank" rel="noreferrer">
      {props.label ?? "Goodreads"} <span aria-hidden="true">↗</span>
    </a>
  );
}

export function bookMeta(b: { author: string | null; published_year: number | null; pages: number | null }): string {
  return [b.author, b.published_year, b.pages ? `${b.pages} pages` : null].filter(Boolean).join(" · ");
}

export function Stars({ value }: { value: number | null }) {
  if (!value) return null;
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <span className="muted" aria-label={`${value} out of 5`}>
      <span aria-hidden="true">
        {"★".repeat(full)}
        {half && "½"}
        {"☆".repeat(5 - full - (half ? 1 : 0))}
      </span>
    </span>
  );
}
