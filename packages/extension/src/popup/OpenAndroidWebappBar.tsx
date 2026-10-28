import { isWebappDocument, openAndroidWebapp } from '../webapp/openAndroidWebapp.js';

export function OpenAndroidWebappBar() {
  if (isWebappDocument()) return null;
  return (
    <div
      className="android-webapp-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--surface-color)',
      }}
    >
      <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
        Astrym
      </span>
      <button
        type="button"
        className="btn-primary"
        data-testid="open-android-webapp"
        onClick={() => openAndroidWebapp()}
        style={{ padding: '8px 12px', minHeight: 40, fontSize: '0.85rem' }}
      >
        Modo Android
      </button>
    </div>
  );
}
