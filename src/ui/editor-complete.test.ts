// @vitest-environment jsdom
// The mention source warms the profile cache, and that store lives on window.
import { describe, expect, it, vi } from 'vitest'
import { nip19 } from 'nostr-tools'
import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { emojiCompletion, mentionCompletion } from './editor-complete'

// The mention source warms the profile cache via the real store, which would
// open a WebSocket to VITE_PROFILE_RELAYS (a local relay during development).
// These tests only assert the chip's text, never a fetched name, so the store
// is replaced to keep the suite off the network.
vi.mock('../nostr/profile-store', () => ({
  peekProfile: () => null,
  primeProfiles: () => {},
  observeProfile: (_pubkey: string, listener: (profile: null) => void) => {
    listener(null)
    return () => {}
  },
}))

const ALICE = '1'.repeat(64)
const BOB = 'ab'.repeat(32)
const ALICE_NPUB = nip19.npubEncode(ALICE)

/** The context the editor would hand a source: cursor at the end of `doc`. */
function at(doc: string, explicit = false) {
  return new CompletionContext(EditorState.create({ doc }), doc.length, explicit)
}

const people = mentionCompletion(() => [ALICE, BOB])

describe('mentionCompletion', () => {
  it('opens on @ at the start of a word and offers everybody', () => {
    const result = people(at('ask @'))
    expect(result?.options).toHaveLength(2)
    // the replaced range starts at the @, not at the word before it
    expect(result?.from).toBe(4)
  })

  it('writes the nostr URI, never the name', () => {
    const result = people(at('@'))
    expect(result?.options[0].apply).toBe(`nostr:${ALICE_NPUB} `)
  })

  it('shows the key next to the name — a name alone identifies nobody', () => {
    const result = people(at('@'))
    expect(result?.options[0].detail).toMatch(/^npub1.+….+$/)
  })

  it('filters by npub while the profile has not arrived yet', () => {
    const query = ALICE_NPUB.slice(5, 12)
    expect(people(at(`@${query}`))?.options).toHaveLength(1)
    expect(people(at('@zzzzzzzz'))).toBeNull()
  })

  it('stays out of an e-mail address', () => {
    expect(people(at('write to me@'))).toBeNull()
  })

  it('opens after an opening bracket, which is a word boundary too', () => {
    expect(people(at('(@'))?.options).toHaveLength(2)
  })

  it('offers nothing when the space has no members yet', () => {
    expect(mentionCompletion(() => [])(at('@'))).toBeNull()
  })
})

describe('emojiCompletion', () => {
  it('needs a letter after the colon — a lone colon is punctuation', () => {
    expect(emojiCompletion(at('done :'))).toBeNull()
    // …unless the list was asked for by hand, with Ctrl-Space
    expect(emojiCompletion(at('done :', true))).not.toBeNull()
  })

  it('inserts the character, not the shortcode', () => {
    const result = emojiCompletion(at('nice :smile'))
    expect(result?.options[0].apply).toBe('😄')
    expect(result?.options[0].label).toBe(':smile:')
    // the dropdown leads with the emoji, because that is what is being chosen
    expect(result?.options[0].displayLabel?.startsWith('😄')).toBe(true)
  })

  it('replaces from the colon onwards', () => {
    const result = emojiCompletion(at('nice :smile'))
    expect(result?.from).toBe(5)
    expect(result?.to).toBe(11)
  })

  it('stays out of a URL and out of a time', () => {
    expect(emojiCompletion(at('https:'))).toBeNull()
    expect(emojiCompletion(at('at 12:30'))).toBeNull()
  })

  it('answers nothing for a shortcode nobody has', () => {
    expect(emojiCompletion(at(':zzzzz'))).toBeNull()
  })
})
