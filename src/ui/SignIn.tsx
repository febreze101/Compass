import { GOOGLE_DESKTOP_CLIENT_ID } from '../config'
import { detectPlatform } from '../platform'
import { useApp } from '../state/store'

export function SignIn() {
  const signIn = useApp((s) => s.signIn)
  const configured = Boolean(GOOGLE_DESKTOP_CLIENT_ID)

  // Only browser development is pinned to the loopback address. The desktop
  // shell catches the redirect on its own server and doesn't care what the app
  // itself is served from — showing it that advice would just be confusing.
  const isBrowser = detectPlatform() === 'web'
  const onLoopback = typeof window !== 'undefined' && window.location.hostname === '127.0.0.1'

  return (
    <div className="signin">
      <div className="signin__inner">
        <h1 className="signin__mark">Compass</h1>
        <p className="signin__tagline">Your calendar, your tasks, and today’s note — on one page.</p>

        <button className="button-primary" onClick={() => void signIn()} disabled={!configured}>
          Connect Google
        </button>

        {!configured && (
          <p className="signin__hint">
            No Google client is configured yet. Copy <code>.env.example</code> to{' '}
            <code>.env.local</code>, follow <code>docs/google-setup.md</code>, then restart.
          </p>
        )}

        {configured && isBrowser && !onLoopback && (
          <p className="signin__hint">
            Open this page at <code>http://127.0.0.1:5173</code> before signing in. Google’s desktop
            OAuth clients accept the loopback address but reject <code>localhost</code>.
          </p>
        )}
      </div>
    </div>
  )
}
