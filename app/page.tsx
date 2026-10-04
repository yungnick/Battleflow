import { RosterImport } from '@/components/landing/RosterImport'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

export default function Home() {
  return (
    <main style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      gap: 32,
      padding: '40px 20px',
      fontFamily: 'var(--f-ui)',
    }}>
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>

      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 40,
          fontWeight: 400,
          color: 'var(--fg)',
          margin: '0 0 8px',
          letterSpacing: '-0.02em',
        }}>Battleflow</h1>
        <p style={{ color: 'var(--fg-mute)', fontSize: 14, margin: 0 }}>
          Phase-filtered wargame reference
        </p>
      </div>

      <RosterImport />
    </main>
  )
}
