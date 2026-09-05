import { useEffect } from 'react'
import { useApp } from './state/store'
import { SignIn } from './ui/SignIn'
import { TodayPage } from './ui/TodayPage'

export default function App() {
  const status = useApp((s) => s.status)
  const error = useApp((s) => s.error)
  const scopeGap = useApp((s) => s.scopeGap)
  const dismissError = useApp((s) => s.dismissError)
  const disconnect = useApp((s) => s.disconnect)
  const boot = useApp((s) => s.boot)

  useEffect(() => {
    void boot()
  }, [boot])

  return (
    <>
      {(scopeGap || error) && (
        <div className="shell" style={{ paddingBottom: 0 }}>
          {/* A permission gap isn't dismissible — nothing works until it's
              fixed, so it offers the fix instead of a close button. */}
          {scopeGap && (
            <div className="banner" role="alert">
              <span style={{ flex: 1 }}>{scopeGap}</span>
              <button className="textbutton" onClick={() => void disconnect()}>
                Reconnect
              </button>
            </div>
          )}
          {error && (
            <div className="banner" role="alert">
              <span style={{ flex: 1 }}>{error}</span>
              <button className="banner__dismiss" onClick={dismissError} aria-label="Dismiss">
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {status === 'booting' && <main className="shell" />}
      {status === 'signed-out' && <SignIn />}
      {status === 'signed-in' && <TodayPage />}
    </>
  )
}
