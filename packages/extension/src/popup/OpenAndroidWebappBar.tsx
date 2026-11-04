import { isWebappDocument } from '../webapp/openAndroidWebapp.js';

/**
 * Compact brand bar for the Astrym webapp / PWA shell only.
 * Desktop extension popup must not mount this component (see App.tsx).
 * "Modo Android" CTA lives on the landing page — never in the MV3 popup.
 */
export function OpenAndroidWebappBar() {
  const onWebapp = isWebappDocument();
  return (
    <div className="android-webapp-bar" data-testid="astrym-webapp-brand-bar">
      <img
        className="android-webapp-bar__logo"
        src="brand/astrym-logo.png"
        alt="Astrym"
        width={96}
        height={22}
      />
      {onWebapp ? (
        <span className="android-webapp-bar__label text-secondary">Astrym Webapp</span>
      ) : null}
    </div>
  );
}
