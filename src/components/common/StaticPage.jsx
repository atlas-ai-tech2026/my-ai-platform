import React, { useEffect } from 'react';

// Shared shell for the static company/legal pages (About, Contact, Privacy,
// Terms). Sets the document title + meta description per page and renders
// long-form text with consistent typography. Content pages pass plain JSX;
// headings inside use <h2>/<h3> — the single <h1> lives here.
export default function StaticPage({ title, description, updated, children }) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${title} — VOXEL.AI`;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute('content');
    if (meta && description) meta.setAttribute('content', description);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc) meta.setAttribute('content', prevDesc);
    };
  }, [title, description]);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-heading text-4xl sm:text-5xl tracking-wide text-white mb-3">{title}</h1>
      {updated && (
        <p className="text-sm text-foreground-muted mb-10">
          Last updated: <time dateTime={updated}>{updated}</time>
        </p>
      )}
      <div className="space-y-6 text-foreground-muted leading-relaxed [&_h2]:font-heading [&_h2]:text-2xl [&_h2]:tracking-wide [&_h2]:text-white [&_h2]:mt-10 [&_h2]:mb-3 [&_h3]:font-semibold [&_h3]:text-white [&_h3]:mt-6 [&_h3]:mb-2 [&_a]:text-white [&_a]:underline [&_a]:underline-offset-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1">
        {children}
      </div>
    </div>
  );
}
