import { useState } from 'react'
import { PageFrame, PageTitle } from './layout/PageFrame'
import { Button, ButtonLink, Callout } from './controls'

/**
 * What the shell shows *instead of* a space, for the two reasons it may refuse
 * to open one. They are deliberately two screens rather than one with a
 * condition in it: a link that does not parse is broken, while a link to an
 * unfamiliar relay is fine and merely undecided, and telling a reader the
 * wrong one of those is worse than telling them nothing.
 * docs/09-security-privacy.md
 */

/**
 * The address in the URL is not `<host>'<group>`. There is no host in it to
 * ask about and nothing to connect to, so this screen names the one thing that
 * is actually known — the link is unreadable — and offers the way back.
 *
 * It replaces a silent fall back to the default relay: until CON-46 an
 * unparsable address still opened a connection to `DEFAULT_RELAY_URL` behind
 * an inline "Invalid group address." message, which connected to a relay the
 * reader had not asked for in order to show them an error.
 */
export function InvalidSpaceLink({ address }: { address: string }) {
  return (
    <PageFrame crumbs={[{ label: 'Unreadable link' }]}>
      <PageTitle
        below={
          <p className="text-base text-fg-muted">
            A space link reads <code className="font-mono text-sm">host&apos;space</code> — for
            example <code className="font-mono text-sm">relay.example&apos;engineering</code>. This
            one does not, so there is no relay to ask and no space to open.
          </p>
        }
      >
        This link is not a space address
      </PageTitle>

      <p className="mb-6 text-sm text-fg-subtle">
        What the address bar carried: <code className="font-mono break-all">{address}</code>
      </p>

      <ButtonLink to="/settings/spaces">Back to your spaces</ButtonLink>
    </PageFrame>
  )
}

/**
 * The address parses, and names a relay host this browser has no decision on
 * record for. Asked once per host, before anything is sent.
 *
 * The point of the screen is that the reader can read the host before their
 * browser talks to it, so the host is the largest thing on it and is spelled
 * out in a monospace face — a name being read to decide whether it is the one
 * you expected is a name that must not be re-rendered into something friendlier.
 *
 * "Remember this relay" is checked by default. Unchecked it still connects;
 * the difference is only whether the shell asks again after a reload. Making
 * the reader re-confirm their own team's relay on every visit would train them
 * to click through it, which is the failure mode this whole screen exists to
 * avoid.
 */
export function RelayTrustPrompt({
  host,
  onConnect,
}: {
  host: string
  /** `remember`: also keep the decision across reloads. */
  onConnect: (remember: boolean) => void
}) {
  const [remember, setRemember] = useState(true)

  return (
    <PageFrame crumbs={[{ label: 'New relay' }]}>
      <PageTitle
        below={
          <p className="text-base text-fg-muted">
            This space lives on <span className="font-mono text-fg">{host}</span>, a relay this
            browser has not talked to before. The link chose it — Akasha did not.
          </p>
        }
      >
        Connect to {host}?
      </PageTitle>

      <Callout tone="info" title="What connecting tells that relay">
        <ul className="list-disc space-y-1 pl-5">
          <li>Your IP address, and that you opened this link when you did.</li>
          <li>
            While you are signed in, an event signed with your key naming your npub — the relay
            asks for it (NIP-42) and the app answers automatically once connected.
          </li>
        </ul>
      </Callout>

      <label className="mt-6 flex cursor-pointer items-center gap-2.5 text-sm text-fg">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          className="size-4 accent-accent"
        />
        Remember this relay
      </label>
      <p className="mt-1.5 pl-6.5 text-xs text-fg-subtle">
        Kept in this browser only. Clearing the site&apos;s data asks again.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onConnect(remember)}>
          Connect
        </Button>
        <ButtonLink to="/settings/spaces">Back to your spaces</ButtonLink>
      </div>
    </PageFrame>
  )
}
