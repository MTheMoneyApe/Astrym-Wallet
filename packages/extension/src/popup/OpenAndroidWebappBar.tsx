import { isWebappDocument, openAndroidWebapp } from '../webapp/openAndroidWebapp.js';

export function OpenAndroidWebappBar() {
  const onWebapp = isWebappDocument();
  return (
    <div className="android-webapp-bar">
      <img
        src="brand/astrym-logo.png"
        alt="Astrym"
        height={28}
      />
      {onWebapp ? null : (
        <button
          type="button"
          className="btn-primary"
          data-testid="open-android-webapp"
          onClick={() => openAndroidWebapp()}
        >
          Modo Android
        </button>
      )}
    </div>
  );
}
