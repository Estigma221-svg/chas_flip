/* eslint-disable react-refresh/only-export-components -- entry: GlobalFallback no es componente exportado solo */

import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

function GlobalFallback(error) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#050505',
        color: '#fff',
        fontFamily:
          'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <div
        style={{
          width: 'min(720px, 100%)',
          padding: 28,
          borderRadius: 24,
          background: 'rgba(15,15,15,0.85)',
          border: '1px solid rgba(255,77,77,0.35)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <div
          style={{
            fontSize: 12,
            letterSpacing: 3,
            fontWeight: 900,
            color: '#ff9b9b',
            textTransform: 'uppercase',
          }}
        >
          La aplicación falló
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 14,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.85)',
            wordBreak: 'break-word',
          }}
        >
          {String(error?.message ?? error)}
        </div>
        {error?.stack && (
          <pre
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 12,
              background: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(255,255,255,0.06)',
              fontSize: 11,
              color: 'rgba(255,200,200,0.75)',
              maxHeight: 220,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {String(error.stack)}
          </pre>
        )}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.06)',
              color: '#fff',
              fontWeight: 700,
              letterSpacing: 1,
              cursor: 'pointer',
            }}
          >
            Recargar
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem('chasflip:session:v1');
              } catch {
                /* ignore */
              }
              window.location.reload();
            }}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: '1px solid rgba(0,255,255,0.45)',
              background: 'rgba(0,255,255,0.08)',
              color: '#fff',
              fontWeight: 700,
              letterSpacing: 1,
              cursor: 'pointer',
            }}
          >
            Limpiar sesión y recargar
          </button>
        </div>
      </div>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.innerHTML =
    '<div style="font-family:sans-serif;padding:24px;background:#fafafa;color:#111">No se encontró #root — revisa index.html.</div>';
} else {
  try {
    createRoot(rootEl).render(
      <StrictMode>
        <ErrorBoundary fallback={GlobalFallback}>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
  } catch (err) {
    rootEl.innerHTML = '';
    const msg = err instanceof Error ? err.message : String(err);
    createRoot(rootEl).render(
      <div
        style={{
          minHeight: '100vh',
          background: '#050505',
          color: '#fff',
          padding: 24,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: 16, color: '#ff9b9b' }}>Error al iniciar</h1>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 12, opacity: 0.9 }}>
          {msg}
        </pre>
        <button
          type="button"
          style={{ marginTop: 16, padding: '10px 16px', cursor: 'pointer' }}
          onClick={() => window.location.reload()}
        >
          Recargar
        </button>
      </div>,
    );
  }
}
