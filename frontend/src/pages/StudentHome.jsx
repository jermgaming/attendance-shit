import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../api.js';
import { useAuth } from '../auth.jsx';
import { getSocket } from '../socket.js';

export default function StudentHome() {
  const { user, logout } = useAuth();
  const [active, setActive] = useState(undefined);
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [stepUp, setStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/sessions/active');
      setActive(res.data);
    } catch (err) {
      if (err.response?.status === 404) setActive(null);
      else setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const socket = getSocket();
    socketRef.current = socket;
    const onOpened = () => refresh();
    const onClosed = () => refresh();
    socket.on('session:opened', onOpened);
    socket.on('session:closed', onClosed);
    return () => {
      socket.off('session:opened', onOpened);
      socket.off('session:closed', onClosed);
    };
  }, [refresh]);

  const mark = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post(`/sessions/${active.id}/mark`, { code });
      setResult(res.data);
      setCode('');
      refresh();
    } catch (err) {
      if (err.response?.data?.error?.details?.reason === 'STEP_UP_REQUIRED') {
        setStepUp(true);
        setError(null);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <strong>Attendance</strong>
        <nav>
          <span className="muted">{user.name} ({user.rollNumber})</span>
          <Link to="/history">My history</Link>
          <button className="secondary small" onClick={logout}>Log out</button>
        </nav>
      </header>

      <main className="page">
        {active === undefined && <p className="muted">Loading…</p>}

        {active === null && (
          <div className="card">
            <h2>No class in progress</h2>
            <p className="muted">When your teacher opens a session it will appear here automatically.</p>
          </div>
        )}

        {active && (
          <div className="grid cols-2">
            <div className="card">
              <h2>{active.subject}</h2>
              <p className="muted">
                {active.teacherName}{active.section ? ` · ${active.section}` : ''} · started{' '}
                {new Date(active.startedAt).toLocaleTimeString()}
              </p>
              {active.alreadyMarked || result ? (
                <div className="message success">
                  You are marked present{result ? ` in ${result.subject}` : ''}. Sit back and relax.
                </div>
              ) : (
                <form className="stack mark-form" onSubmit={mark}>
                  <input
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="· · · · · ·"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    required
                    autoFocus
                  />
                  <button disabled={busy || code.length !== 6}>Mark present</button>
                </form>
              )}
              {error && <div className="message error" style={{ marginTop: 12 }}>{error}</div>}
              {stepUp && !result && <StepUpBox onDone={() => { setStepUp(false); }} />}
            </div>
            <div className="card">
              <h3>How it works</h3>
              <p className="muted">
                Type the 6-digit code shown on the projector. The code rotates, so check the screen.
                You can only mark once per class, from this device.
              </p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function StepUpBox({ onDone }) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/auth/step-up/request');
      setMessage(res.data.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/step-up/verify', { code });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <p className="muted">Extra verification required before marking.</p>
      {!message ? (
        <button className="secondary" onClick={request} disabled={busy}>Send verification code</button>
      ) : (
        <form className="stack" onSubmit={verify}>
          <input
            inputMode="numeric" maxLength={6} placeholder="6-digit code"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required
          />
          <button disabled={busy || code.length !== 6}>Verify</button>
        </form>
      )}
      {error && <div className="message error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
