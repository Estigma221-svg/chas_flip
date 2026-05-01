export default function AppleHudAlert({
  open,
  title,
  message,
  onDismiss,
}) {
  if (!open || !title) return null;

  return (
    <div className="apple-hud-root" role="alertdialog" aria-modal="true" aria-labelledby="apple-hud-title">
      <div className="apple-hud-backdrop" onClick={onDismiss} aria-hidden />
      <div className="apple-hud-card">
        <p id="apple-hud-title" className="apple-hud-title">
          {title}
        </p>
        {message && <p className="apple-hud-message">{message}</p>}
        <button type="button" className="apple-hud-cta" onClick={onDismiss}>
          Aceptar
        </button>
      </div>
    </div>
  );
}
