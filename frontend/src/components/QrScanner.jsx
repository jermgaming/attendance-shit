import { useEffect, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

function cameraErrorMessage(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was denied. Allow camera access in your browser, or type the code below.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device. Type the code below instead.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is busy in another app. Close it and try again, or type the code below.';
  }
  return 'The camera could not be opened. On http:// connections the browser blocks the camera — open the app over https:// or type the code below.';
}

export default function QrScanner({ onScan, onClose }) {
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let scanner;
    try {
      scanner = new Html5Qrcode('attendance-qr-scanner', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
    } catch (err) {
      setError(err);
      return undefined;
    }
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (decodedText) => {
        if (cancelled) return;
        scanner.stop().then(() => onScan(decodedText)).catch(() => onScan(decodedText));
      },
      () => { /* per-frame misses are normal, ignore */ },
    ).catch((err) => {
      if (!cancelled) setError(err);
    });
    return () => {
      cancelled = true;
      if (scanner && scanner.isScanning) scanner.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack">
      <div id="attendance-qr-scanner"
        style={{ width: '100%', maxWidth: 320, margin: '0 auto', borderRadius: 8, overflow: 'hidden' }} />
      {error && <div className="message error" style={{ marginTop: 10 }}>{cameraErrorMessage(error)}</div>}
      <button type="button" className="secondary small" onClick={onClose}>Cancel</button>
    </div>
  );
}
