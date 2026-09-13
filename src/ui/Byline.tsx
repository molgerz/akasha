import { Author } from './Author'
import type { Revision } from '../domain/revision'

function relativeTime(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - seconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  return new Date(seconds * 1000).toLocaleDateString()
}

/**
 * Who last touched the page. Only the name here, not the key: this line is a
 * byline, and the place to check who actually signed which revision is the
 * history, whose Details view prints the full npub.
 *
 * The change note follows on a line of its own rather than after another dot.
 * It is a sentence somebody wrote, and strung onto the end of the metadata it
 * read as a fourth field.
 */
export function Byline({ revision }: { revision: Revision }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-fg-subtle">
        <Author pubkey={revision.author} avatar />
        <span>edited {relativeTime(revision.createdAt)}</span>
      </div>
      {revision.summary ? (
        <div className="text-xs text-fg-subtle italic">“{revision.summary}”</div>
      ) : null}
    </div>
  )
}
