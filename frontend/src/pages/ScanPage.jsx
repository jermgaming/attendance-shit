import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function ScanPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('s');
  const code = searchParams.get('c');
  const [state, setState] = useState('marking');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!user || !sessionId || !code || firedRef.current) return;
    firedRef.current = true;
    api.post(`/sessions/${sessionId}/mark`, { code })
      .then((res) => {
        setResult(res.data);
        setState('done');
      })
      .catch((err) => {
        setError(errorMessage(err));
        setState('done');
      });
  }, [user, sessionId, code]);

  if (!sessionId || !code) {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>Invalid QR</h1>
          <p className="muted">This QR code is missing attendance information.</p>
          <Link to="/">Open the app</Link>
        </div>
      </div>
    );
  }

  if (!user) {
    const returnTo = encodeURIComponent(`/scan?s=${sessionId}&c=${code}`);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }

  return (
    <div className="center-screen">
      <div className="card" style={{ width: 380 }}>
        {state === 'marking' && (
          <>
            <h1>Marking attendance…</h1>
            <p className="muted">Verifying the QR code.</p>
          </>
        )}
        {state === 'done' && result && (
          <>
            <div className="message success">You are marked present{result.subject ? ` in ${result.subject}` : ''}. Sit back and relax.</div>
          </>
        )}
        {state === 'done' && error && (
          <>
            <div className="message error">{error}</div>
          </>
        )}
        {state === 'done' && (
          <Link to="/student">Open the app</Link>
        )}
      </div>
    </div>
  );
}
