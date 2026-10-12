import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.post('/auth/otp/request', { email: email.trim().toLowerCase() });
      setMessage(res.data.message);
      setStep('code');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email.trim().toLowerCase(), code.trim());
      navigate(user.role === 'student' ? '/student' : '/teacher', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <div className="card" style={{ width: 380 }}>
        <h1>Attendance</h1>
        <p className="muted">Sign in with your college email. We email you a one-time code.</p>
        {step === 'email' ? (
          <form className="stack" onSubmit={requestCode}>
            <input
              type="email"
              placeholder="you@college.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <button disabled={busy}>Email me a code</button>
          </form>
        ) : (
          <form className="stack" onSubmit={verifyCode}>
            {message && <div className="message info">{message}</div>}
            <input
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
            />
            <button disabled={busy || code.length !== 6}>Sign in</button>
            <button type="button" className="secondary" onClick={() => { setStep('email'); setCode(''); }}>
              Use a different email
            </button>
          </form>
        )}
        {error && <div className="message error" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
