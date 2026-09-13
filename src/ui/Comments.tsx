import { useEffect, useRef, useState } from 'react'
import { buildCommentTree } from '../domain/comment'
import type { Comment, CommentNode } from '../domain/comment'
import { classifyRejection } from '../nostr/client'
import { publishComment } from '../nostr/publish-comment'
import { deleteGroupEvent } from '../nostr/moderation'
import { forgetEvent } from '../nostr/space-store'
import { useSession } from '../session/session'
import { SignInButton } from './SignInButton'
import { Author } from './Author'
import { Markdown } from './Markdown'
import { Button, TEXTAREA } from './controls'
import { CommentIcon } from './icons'

type Props = {
  relayUrl: string
  groupId: string
  slug: string
  comments: Comment[]
  /** admins may remove other people's comments from the relay (kind 9005) */
  isAdmin?: boolean
}

function timeLabel(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - seconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  return new Date(seconds * 1000).toLocaleDateString()
}

/**
 * Comments on a page, like the discussion below a Confluence page. Anchored to
 * (group, slug), not to a single revision — otherwise the thread would be
 * orphaned after the next edit.
 *
 * Each comment is a tinted band the width of the column, and a reply is a
 * band indented behind a rule that runs down the thread it belongs to. The
 * rule is what makes a three-deep thread readable: at 16px of indent alone
 * the second and third level are told apart by counting pixels.
 *
 * The composer itself stays collapsed behind a "Write a comment" trigger
 * until clicked, so an unread page doesn't open with an empty textarea
 * already sitting at the bottom of it.
 */
export function Comments({ relayUrl, groupId, slug, comments, isAdmin = false }: Props) {
  const { session, ensureSamePubkey } = useSession()
  const [open, setOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const composer = useRef<HTMLDivElement | null>(null)
  const field = useRef<HTMLTextAreaElement | null>(null)

  const tree = buildCommentTree(comments.filter((comment) => comment.slug === slug))

  // Opening the composer has to reveal what it opened, and at the foot of a
  // long page it does not on its own: it unfolds below the viewport and
  // nothing scrolls. Focusing the field would drag it into view by itself, but
  // only the field — the Send buttons under it would stay below the edge, and
  // signed out there is no field to focus at all. So the whole block brings
  // itself in, and the focus is told not to scroll so there is one movement
  // rather than two fighting.
  //
  // `nearest` scrolls the least it can, so a composer that was already fully
  // visible stays put instead of jumping. `scroll-mb-10` matches the frame's
  // bottom padding. The same handling as the editor's Formatting fold —
  // docs/13-editing.md.
  useEffect(() => {
    if (!open) return
    composer.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    field.current?.focus({ preventScroll: true })
    // replyTo as well: replying from a comment further up opens the composer
    // down here, and switching whom you reply to changes what it says.
  }, [open, replyTo?.id])

  const close = () => {
    setOpen(false)
    setReplyTo(null)
    setError(null)
  }

  const send = async () => {
    if (session.status !== 'signed-in') return
    if (text.trim().length === 0) {
      setError('Write something before sending.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setError(same.reason)
        return
      }
      const result = await publishComment(session.signer, {
        relayUrl,
        groupId,
        slug,
        content: text,
        parentId: replyTo?.id ?? null,
        parentAuthor: replyTo?.author ?? null,
      })
      if (result.ok) {
        setText('')
        close()
        return
      }
      const kind = classifyRejection(result.reason)
      setError(
        kind === 'permission'
          ? `The relay does not allow you to comment here: ${result.reason}`
          : `Not saved: ${result.reason}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'signing was cancelled')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (comment: Comment) => {
    if (session.status !== 'signed-in') return
    if (!window.confirm('Delete this comment on the relay?')) return
    setError(null)
    setBusy(true)
    try {
      const same = await ensureSamePubkey()
      if (!same.ok) {
        setError(same.reason)
        return
      }
      const result = await deleteGroupEvent(session.signer, {
        relayUrl,
        groupId,
        eventId: comment.id,
      })
      if (result.ok) forgetEvent(relayUrl, groupId, comment.id)
      else setError(`Not deleted: ${result.reason}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'signing was cancelled')
    } finally {
      setBusy(false)
    }
  }

  const renderNode = (node: CommentNode) => (
    <li key={node.id}>
      {/* Top rule only — the composer's own rule below closes the thread
          off, so two neighbouring bands share a single hairline instead of
          stacking two. */}
      <div className="border-t border-line bg-surface-1 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Author pubkey={node.author} avatar />
          <span className="text-fg-subtle">{timeLabel(node.createdAt)}</span>
        </div>
        <div className="mt-1.5">
          <Markdown density="compact">{node.content}</Markdown>
        </div>

        {session.status === 'signed-in' ? (
          <div className="mt-2 flex gap-1">
            <Button
              size="sm"
              variant="subtle"
              onClick={() => {
                setReplyTo(node)
                setOpen(true)
              }}
            >
              Reply
            </Button>
            {isAdmin ? (
              <Button
                size="sm"
                variant="subtle"
                className="text-danger hover:bg-danger-bg"
                disabled={busy}
                onClick={() => void remove(node)}
              >
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {node.replies.length > 0 ? (
        // The rule sits in the margin the replies are indented by, so it runs
        // the exact height of the thread hanging off this comment.
        <ul className="border-l-2 border-line pl-4">{node.replies.map(renderNode)}</ul>
      ) : null}
    </li>
  )

  return (
    <section className="mt-12">
      {tree.length > 0 ? (
        <>
          {/* Small and muted on purpose: a label for the section, not a
              title competing with the page's own h1/h2s. */}
          <h2 className="border-t border-line pt-7 text-lg font-semibold text-fg-muted">
            Comments
          </h2>
          <ul className="mt-5">{tree.map(renderNode)}</ul>
        </>
      ) : null}

      {/* Its own rule, always in the same relation to the composer — the
          thread above it (if any) never changes how this row sits. */}
      <div
        ref={composer}
        className={`scroll-mb-10 border-t border-line pt-7 ${tree.length > 0 ? 'mt-7' : ''}`}
      >
        {open ? (
          session.status === 'signed-in' ? (
            <div className="space-y-2">
              {replyTo ? (
                <div className="flex items-center gap-2 text-xs text-fg-subtle">
                  <span className="inline-flex items-center gap-1.5">
                    Replying to <Author pubkey={replyTo.author} />
                  </span>
                  <Button size="sm" variant="subtle" onClick={() => setReplyTo(null)}>
                    cancel
                  </Button>
                </div>
              ) : null}
              <textarea
                ref={field}
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={3}
                aria-label="Write a comment"
                placeholder="Write a comment — Markdown allowed"
                className={TEXTAREA}
              />
              {error ? <p className="text-xs text-danger">{error}</p> : null}
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => void send()} disabled={busy}>
                  {busy ? 'sending…' : replyTo ? 'Send reply' : 'Send comment'}
                </Button>
                <Button onClick={close}>Cancel</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-fg-subtle">
              <SignInButton variant="inline">Sign in</SignInButton> to comment — reading works
              without.
            </p>
          )
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 text-sm text-fg-muted hover:text-fg"
          >
            <CommentIcon className="size-4" />
            Write a comment
          </button>
        )}
      </div>
    </section>
  )
}
