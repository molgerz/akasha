import type { Page } from './pages'

/**
 * Full-text search over a space's pages. Runs purely locally over the revisions
 * that are loaded anyway — not every relay supports NIP-50, and a search that
 * depends on the relay would break the moment you are offline.
 * docs/07-tech-stack.md
 */
export type SearchSnippet = {
  /** 1-based line number within the page content */
  line: number
  text: string
}

export type SearchHit = {
  page: Page
  score: number
  titleMatch: boolean
  snippets: SearchSnippet[]
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

/**
 * Scores a page's hits. The title weighs more than the content, and a page has
 * to contain **all** search terms — otherwise two words drown you in noise.
 */
export function searchPages(pages: Page[], query: string, maxSnippets = 3): SearchHit[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []

  const hits: SearchHit[] = []

  for (const page of pages) {
    // A hidden page is out of the navigation, and a search result is
    // navigation. Filtered here rather than at the call site so a new caller
    // cannot forget it — `space.pages` deliberately still carries hidden
    // pages, because the history and the page's own URL must still find them.
    if (page.hidden) continue
    const title = page.title.toLowerCase()
    const lines = page.head.content.split('\n')
    const lower = lines.map((line) => line.toLowerCase())

    const matchesAll = tokens.every(
      (token) => title.includes(token) || lower.some((line) => line.includes(token)),
    )
    if (!matchesAll) continue

    let score = 0
    const titleMatch = tokens.some((token) => title.includes(token))
    for (const token of tokens) {
      if (title.includes(token)) score += 10
      if (page.slug.includes(token)) score += 5
      score += lower.filter((line) => line.includes(token)).length
    }

    const snippets: SearchSnippet[] = []
    for (let index = 0; index < lines.length && snippets.length < maxSnippets; index += 1) {
      if (tokens.some((token) => lower[index].includes(token)) && lines[index].trim().length > 0) {
        snippets.push({ line: index + 1, text: lines[index].trim() })
      }
    }

    hits.push({ page, score, titleMatch, snippets })
  }

  return hits.sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
}

/** Marks the hits inside a text without building HTML. */
export function highlightParts(
  text: string,
  query: string,
): { text: string; hit: boolean }[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return [{ text, hit: false }]

  const lower = text.toLowerCase()
  const marks: boolean[] = new Array(text.length).fill(false)
  for (const token of tokens) {
    let from = lower.indexOf(token)
    while (from !== -1) {
      for (let i = from; i < from + token.length; i += 1) marks[i] = true
      from = lower.indexOf(token, from + token.length)
    }
  }

  const parts: { text: string; hit: boolean }[] = []
  let start = 0
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || marks[i] !== marks[start]) {
      parts.push({ text: text.slice(start, i), hit: marks[start] })
      start = i
    }
  }
  return parts
}
