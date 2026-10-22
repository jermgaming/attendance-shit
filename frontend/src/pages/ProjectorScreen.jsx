import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import api, { errorMessage } from '../api.js';
import { getSocket } from '../socket.js';

export default function ProjectorScreen() {
  const { sessionId } = useParams();
  const [code, setCode] = useState(null);
  const [validFor, setValidFor] = useState(0);
  const [intervalSeconds, setIntervalSeconds] = useState(20);
  const [markMode, setMarkMode] = useState('code');
  const [subject, setSubject] = useState('');
  const [counts, setCounts] = useState({ present: 0, total: 0 });
  const [closed, setClosed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lan, setLan] = useState(null);
  const [error, setError] = useState(null);
  const countdownRef = useRef(null);

  const applyPayload = useCallback((p) => {
    if (!p) return;
    setCode(p.code);
    setPaused(!!p.paused);
    setIntervalSeconds(p.intervalSeconds);
    setValidFor(p.validForSeconds ?? p.intervalSeconds);
    setMarkMode(p.markMode ?? 'code');
  }, []);

  const fetchCode = useCallback(async () => {
    try {
      const res = await api.get(`/sessions/${sessionId}/code`);
      applyPayload(res.data);
      setError(null);
    } catch (err) {
      if (err.response?.status === 409) setClosed(true);
      else setError(errorMessage(err));
    }
  }, [sessionId, applyPayload]);

  useEffect(() => {
    api.get(`/sessions/${sessionId}`).then((r) => {
      setSubject(r.data.subject);
      setCounts({ present: r.data.presentCount, total: r.data.rosterCount });
      if (r.data.status === 'closed') setClosed(true);
    }).catch(() => {});
    api.get('/health').then((r) => setLan(r.data.lan)).catch(() => {});

    fetchCode();
    const socket = getSocket();
    socket.emit('session:join', { sessionId });
    const onCode = (p) => { if (p.sessionId === sessionId) applyPayload(p); };
    const onMarked = (p) => {
      if (p.sessionId === sessionId) setCounts({ present: p.counts.present, total: p.counts.total });
    };
    const onUpdated = (p) => {
      if (p.sessionId === sessionId) setCounts({ present: p.counts.present, total: p.counts.total });
    };
    const onClosed = (p) => {
      if (p.sessionId === sessionId) {
        setClosed(true);
        setCounts({ present: p.counts.present, total: p.counts.total });
      }
    };
    socket.on('code:updated', onCode);
    socket.on('attendance:marked', onMarked);
    socket.on('attendance:updated', onUpdated);
    socket.on('session:closed', onClosed);
    return () => {
      socket.emit('session:leave', { sessionId });
      socket.off('code:updated', onCode);
      socket.off('attendance:marked', onMarked);
      socket.off('attendance:updated', onUpdated);
      socket.off('session:closed', onClosed);
    };
  }, [sessionId, fetchCode, applyPayload]);

  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setValidFor((v) => {
        if (v <= 1) {
          fetchCode();
          return intervalSeconds;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [intervalSeconds, fetchCode]);

  const qrValue = lan || window.location.origin;
  const scanUrl = `${qrValue}/scan?s=${sessionId}&c=${code || ''}`;

  if (error && !code) {
    return <div className="projector"><h1>{error}</h1></div>;
  }

  return (
    <div className="projector">
      <h1>{subject || 'Attendance'}</h1>
      {closed ? (
        <h1>Session closed — {counts.present}/{counts.total} present</h1>
      ) : paused ? (
        <div className="big-code" style={{ color: '#facc15', fontSize: 'clamp(40px, 10vw, 110px)' }}>PAUSED</div>
      ) : markMode === 'qr' && code ? (
        <>
          <div style={{ background: '#fff', padding: 20, borderRadius: 12, display: 'inline-block' }}>
            <QRCodeSVG value={scanUrl} size={300} />
          </div>
          <p className="muted" style={{ marginTop: 12, fontSize: 20 }}>Scan to mark present — code {code}</p>
          <div className="code-progress">
            <div style={{ width: `${Math.max(0, Math.min(100, (validFor / intervalSeconds) * 100))}%` }} />
          </div>
        </>
      ) : (
        <>
          <div className="big-code">{code || '······'}</div>
          <div className="code-progress">
            <div style={{ width: `${Math.max(0, Math.min(100, (validFor / intervalSeconds) * 100))}%` }} />
          </div>
        </>
      )}
      <div className="meta">
        <span className="count">{counts.present}<span className="muted"> / {counts.total} present</span></span>
        <span className="qr">
          <QRCodeSVG value={qrValue} size={110} />
        </span>
      </div>
      <p className="muted" style={{ color: '#94a3b8' }}>Scan to open {qrValue}</p>
    </div>
  );
}
