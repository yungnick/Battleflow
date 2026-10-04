'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseGwText } from '@/lib/roster/parseGwText'
import type { ParsedArmy } from '@/lib/roster/parseGwText'
import { buildRoster } from '@/lib/roster/buildRoster'
import { saveRoster } from '@/lib/roster/storage'
import { loadManifest, loadFaction } from '@/lib/data/loader'
import type { DataManifest } from '@/lib/dataModel'
import { norm } from '@/lib/roster/normalize'
import styles from './RosterImport.module.css'

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; step: string }
  | { kind: 'error'; message: string }
  | { kind: 'pick-faction'; parsed: ParsedArmy; manifest: DataManifest; error?: string }

export function RosterImport() {
  const [text, setText] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [selectedFactionId, setSelectedFactionId] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const router = useRouter()

  async function handleFactionPick(e: React.FormEvent) {
    e.preventDefault()
    if (state.kind !== 'pick-faction') return
    const { parsed, manifest } = state
    const match = manifest.factions.find(f => f.factionId === selectedFactionId)
    if (!match) return

    const setPickerError = (message: string) =>
      setState({ kind: 'pick-faction', parsed, manifest, error: message })

    setState({ kind: 'loading', step: `Loading ${match.factionName}…` })
    try {
      const artifact = await loadFaction(match, manifest)
      const { roster, meta } = buildRoster(parsed, artifact)
      const isEmpty = Object.values(roster).every(units => !units?.length)
      if (isEmpty) {
        setPickerError(`No units matched in "${match.factionName}". Unit names must match the datasheet exactly. Check your army list text.`)
        return
      }
      const saved = saveRoster({ roster, meta })
      if (!saved) {
        setPickerError('Could not save roster — storage may be full or unavailable. Try disabling private browsing.')
        return
      }
      setState({ kind: 'idle' })
      router.push('/roster')
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return

    setState({ kind: 'loading', step: 'Parsing army list…' })
    try {
      const parsed = parseGwText(text)

      setState({ kind: 'loading', step: 'Loading faction index…' })
      const manifest = await loadManifest()

      // Match the GW header keyword (e.g. "DEATH GUARD") against each faction's
      // factionKeywords list (e.g. ["Death Guard", "Heretic Astartes"]).
      // Normalise both sides to lowercase + collapsed whitespace for comparison.
      const kwNorm = norm(parsed.factionKeyword)
      const matches = manifest.factions.filter(f =>
        f.factionKeywords.some(kw => norm(kw) === kwNorm)
      )

      // Disambiguate when multiple factions share a broad keyword (e.g. "ADEPTUS
      // ASTARTES" appears in every SM chapter).
      // Tier 1: exact primary-keyword match — the faction whose factionKeywords[0]
      //   equals the parsed keyword (e.g. ASURYANI → craftworlds, not ynnari).
      // Tier 2: single-keyword faction — the "generic" base catalogue
      //   (e.g. space-marines for ADEPTUS ASTARTES).
      // Tier 3: factionName match — New Recruit often exports the display name rather than
      //   a BSData keyword (e.g. "CHAOS DAEMONS" matches factionName "Chaos Daemons").
      // Tier 4: segment match — plain-text exports (BattleBase / NR app) emit just the
      //   short faction name, e.g. "Chaos Daemons" from "Chaos - Chaos Daemons". Split
      //   factionName on " - " and check each segment. Only auto-resolves when unique.
      // Fallback: show the picker rather than silently picking the wrong faction.
      const segMatches = manifest.factions.filter(f =>
        f.factionName.split(' - ').some(seg => norm(seg) === kwNorm)
      )
      const match = matches.length === 1
        ? matches[0]
        : (matches.find(f => norm(f.factionKeywords[0] ?? '') === kwNorm)
          ?? matches.find(f => f.factionKeywords.length === 1)
          ?? manifest.factions.find(f => norm(f.factionName) === kwNorm)
          ?? (segMatches.length === 1 ? segMatches[0] : null)
          ?? null)

      if (!match) {
        const sorted = [...manifest.factions].sort((a, b) =>
          a.factionName.localeCompare(b.factionName)
        )
        setSelectedFactionId(sorted[0]?.factionId ?? '')
        setState({ kind: 'pick-faction', parsed, manifest: { ...manifest, factions: sorted } })
        return
      }

      setState({ kind: 'loading', step: `Loading ${match.factionName}…` })
      const artifact = await loadFaction(match, manifest)

      const { roster, meta } = buildRoster(parsed, artifact)

      // Guard against a roster where every phase is empty (all unit names missed).
      // Surface a clear error rather than navigating to a blank screen.
      const isEmpty = Object.values(roster).every(units => !units?.length)
      if (isEmpty) {
        setState({
          kind: 'error',
          message: `No units matched in "${match.factionName}". Unit names must match the datasheet exactly. Check your army list text.`,
        })
        return
      }

      const saved = saveRoster({ roster, meta })
      if (!saved) {
        setState({
          kind: 'error',
          message: 'Could not save roster — storage may be full or unavailable. Try disabling private browsing.',
        })
        return
      }
      setState({ kind: 'idle' })
      router.push('/roster')
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Something went wrong.',
      })
    }
  }

  const loading = state.kind === 'loading'

  function handleClear() {
    setText('')
    setState({ kind: 'idle' })
    textareaRef.current?.focus()
  }

  if (state.kind === 'pick-faction') {
    return (
      <form className={styles.form} onSubmit={handleFactionPick} noValidate>
        <label className={styles.label} htmlFor="faction-pick">
          Faction not detected — pick yours
        </label>
        <select
          id="faction-pick"
          className={styles.select}
          value={selectedFactionId}
          onChange={e => setSelectedFactionId(e.target.value)}
        >
          {state.manifest.factions.map(f => (
            <option key={f.factionId} value={f.factionId}>
              {f.factionName}
            </option>
          ))}
        </select>
        {state.error && (
          <p className={styles.error} role="alert">{state.error}</p>
        )}
        <button type="submit" className={styles.submit} disabled={!selectedFactionId}>
          Use this faction →
        </button>
        <button
          type="button"
          className={styles.back}
          onClick={() => setState({ kind: 'idle' })}
        >
          ← Back
        </button>
      </form>
    )
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor="gw-army-text">
          Paste GW army list
        </label>
        {text && (
          <button
            type="button"
            className={styles.clear}
            onClick={handleClear}
            disabled={loading}
            aria-label="Clear army list"
          >
            Clear
          </button>
        )}
      </div>
      <textarea
        id="gw-army-text"
        ref={textareaRef}
        className={styles.textarea}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={
          '+++ My Army [SPACE MARINES] (1995 pts) +++\n\n== Detachment Name ==\n\nUnit Name (85 pts)\n• 1x Weapon'
        }
        rows={7}
        disabled={loading}
        spellCheck={false}
        autoComplete="off"
      />
      {state.kind === 'error' && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        className={styles.submit}
        disabled={loading || !text.trim()}
      >
        {loading ? state.step : 'Import Roster →'}
      </button>
    </form>
  )
}
