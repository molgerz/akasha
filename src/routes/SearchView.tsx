import { Link, useSearchParams } from 'react-router-dom'
import { useSpaceRoute } from './space-route'
import { highlightParts, searchPages } from '../domain/search'
import { Author } from '../ui/Author'
import { SpaceHiddenNotice } from '../ui/SpaceHiddenNotice'
import { spaceAccess } from '../domain/space-access'
import { useSession } from '../session/session'
import { PageFrame, PageTitle } from '../ui/layout/PageFrame'
import { Card } from '../ui/controls'
import { PageIcon, SearchIcon } from '../ui/icons'

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.hit ? (
          <mark key={index} className="rounded bg-accent-bg px-0.5 text-accent-fg">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  )
}

export function SearchView() {
  const { group, space, base } = useSpaceRoute()
  const { session } = useSession()
  const [params] = useSearchParams()
  const query = params.get('q') ?? ''

  if (!group || !base) {
    return (
      <PageFrame>
        <p className="text-sm text-danger">Invalid address.</p>
      </PageFrame>
    )
  }

  const spaceName = space.metadata?.name ?? group.id
  const empty = query.trim().length === 0
  const hits = searchPages(space.pages, query)
  // The denominator has to be what the search can actually return. Archived
  // pages are skipped inside `searchPages` (src/domain/search.ts), so counting
  // them here would promise matches in pages that are out of the navigation —
  // "0 of 12" where three of the twelve can never be a hit. The full list is
  // still what goes *into* the search, which owns the filter.
  const searchable = space.pages.filter((page) => !page.archived)
  // Search runs over the pages the store holds. In a space the relay is
  // withholding that is none, so "Nothing found in 0 pages" would be true and
  // useless — it sounds like the search failed, not like the door is shut.
  const hidden =
    spaceAccess(session.status === 'signed-in' ? session.pubkey : null, space).state === 'hidden'

  return (
    <PageFrame
      width="wide"
      crumbs={[{ label: spaceName, to: base }, { label: 'Search' }]}
    >
      <PageTitle
        below={
          empty || hidden ? null : (
            <p className="text-sm text-fg-subtle">
              {hits.length} of {searchable.length} pages
            </p>
          )
        }
      >
        {empty ? 'Search' : `“${query}”`}
      </PageTitle>

      {hidden ? (
        <SpaceHiddenNotice />
      ) : empty ? (
        // Nothing found yet is not an error, so it gets the shape of an empty
        // state rather than a paragraph: the icon says which field to go to.
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line py-14 text-center">
          <SearchIcon className="size-7 text-fg-subtle" />
          <p className="max-w-[46ch] text-sm text-fg-muted">
            Type a search term in the field at the top. Search runs locally over the loaded pages
            of this space — titles and content, and every word has to appear.
          </p>
        </div>
      ) : hits.length === 0 ? (
        <p className="text-base text-fg-muted">
          {space.loading ? 'loading pages…' : `Nothing found in ${searchable.length} pages.`}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {hits.map((hit) => (
            <li key={hit.page.slug}>
              <Card className="p-3.5 hover:border-line-strong">
                <div className="flex items-center gap-2">
                  <PageIcon className="size-4 text-fg-subtle" />
                  <Link
                    to={`${base}/${hit.page.slug}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium text-fg hover:text-accent-fg"
                  >
                    <Highlighted text={hit.page.title} query={query} />
                  </Link>
                  <span className="shrink-0 text-xs">
                    <Author pubkey={hit.page.head.author} />
                  </span>
                </div>

                {/* The matching lines, each with its line number: the number is
                    what turns "it is in there somewhere" into a place. */}
                <ul className="mt-2.5 space-y-1 border-l-2 border-line pl-3">
                  {hit.snippets.map((snippet) => (
                    <li key={snippet.line} className="flex gap-2.5 text-xs">
                      <span className="w-8 shrink-0 text-right font-mono text-fg-subtle">
                        {snippet.line}
                      </span>
                      <span className="min-w-0 text-fg-muted">
                        <Highlighted text={snippet.text} query={query} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageFrame>
  )
}
