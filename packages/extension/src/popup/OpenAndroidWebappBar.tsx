import { isWebappDocument, openAndroidWebapp } from '../webapp/openAndroidWebapp.js';

export function OpenAndroidWebappBar() {
  const onWebapp = isWebappDocument();
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
        background: '#141416',
      }}
    >
      <img
        src="brand/astrym-logo.png"
        alt="Astrym"
        height={28}
        style={{ height: 28, width: 'auto', maxWidth: '58%' }}
      />
      {onWebapp ? null : (
        <button
          type="button"
          className="btn-primary"
          data-testid="open-android-webapp"
          onClick={() => openAndroidWebapp()}
          style={{ padding: '8px 12px', minHeight: 40, fontSize: '0.85rem' }}
        >
          Modo Android
        </button>
      )}
    </div>
  );
}
