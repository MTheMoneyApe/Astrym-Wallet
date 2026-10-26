import React, { useEffect, useRef, useState } from 'react';
import { validateMnemonic } from '@solanym/wallet-core/src/crypto/mnemonic.js';
import { sendIpcMessage } from './ipc.js';

type PhraseParseResult =
  | { ok: true; words: string[] }
  | { ok: false; message: string };

export function parseRecoveryPhrase(value: string): PhraseParseResult {
  const normalized = value.trim().split(/\s+/).filter(Boolean);
  if (normalized.length !== 12 && normalized.length !== 24) {
    return { ok: false, message: 'Enter a 12- or 24-word recovery phrase.' };
  }

  const phrase = normalized.join(' ');
  if (!validateMnemonic(phrase)) {
    return { ok: false, message: 'That recovery phrase is invalid. Check the words and try again.' };
  }

  return { ok: true, words: normalized };
}

export async function copyRecoveryPhrase(
  words: readonly string[],
  writeText: (text: string) => Promise<void>,
): Promise<void> {
  await writeText(words.join(' '));
}

export function validatePasswordPair(password: string, confirmation: string): string | null {
  if (password !== confirmation) return 'Passwords do not match.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [mode, setMode] = useState<'welcome' | 'create' | 'import'>('welcome');
  const [importStep, setImportStep] = useState<'phrase' | 'password'>('phrase');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [importPhraseStr, setImportPhraseStr] = useState('');
  const [validatedImportPhrase, setValidatedImportPhrase] = useState<string[] | null>(null);
  const [quizIndices, setQuizIndices] = useState<number[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<string[]>(['', '', '']);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | ''>('');
  const [loading, setLoading] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimer.current !== null) {
      window.clearTimeout(copyTimer.current);
    }
  }, []);

  const handleCreate = async () => {
    const passwordError = validatePasswordPair(password, confirmPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setError('');
    setLoading(true);
    try {
      const response = await sendIpcMessage('CREATE_VAULT', { password });
      setPhrase(response.recoveryPhrase);
      setQuizAnswers(['', '', '']);
      setCopyStatus('');

      const indices: number[] = [];
      while (indices.length < 3) {
        const index = Math.floor(Math.random() * 24);
        if (!indices.includes(index)) indices.push(index);
      }
      setQuizIndices(indices.sort((a, b) => a - b));
    } catch (cause) {
      setError(getErrorMessage(cause, 'Wallet creation failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const continueImport = () => {
    const result = parseRecoveryPhrase(importPhraseStr);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    setValidatedImportPhrase(result.words);
    setImportPhraseStr(result.words.join(' '));
    setError('');
    setImportStep('password');
  };

  const handleImport = async () => {
    if (!validatedImportPhrase) {
      setImportStep('phrase');
      setError('Enter and validate your recovery phrase to continue.');
      return;
    }
    const passwordError = validatePasswordPair(password, confirmPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setError('');
    setLoading(true);
    try {
      await sendIpcMessage('IMPORT_VAULT', {
        password,
        recoveryPhrase: validatedImportPhrase,
      });
      onComplete();
    } catch (cause) {
      setError(getErrorMessage(cause, 'Wallet import failed. Please check your details and try again.'));
    } finally {
      setLoading(false);
      setPassword('');
      setConfirmPassword('');
    }
  };

  const copyPhrase = async () => {
    if (!phrase) return;

    if (copyTimer.current !== null) {
      window.clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
    setCopyStatus('');

    try {
      const writeText = navigator.clipboard?.writeText.bind(navigator.clipboard);
      if (!writeText) throw new Error('Clipboard unavailable');
      await copyRecoveryPhrase(phrase, writeText);
      setCopyStatus('copied');
      copyTimer.current = window.setTimeout(() => {
        setCopyStatus('');
        copyTimer.current = null;
      }, 2500);
    } catch {
      setCopyStatus('failed');
    }
  };

  const verifyQuiz = () => {
    if (!phrase) return;
    const isCorrect = quizIndices.every((index, answerIndex) =>
      phrase[index] === quizAnswers[answerIndex]?.trim(),
    );
    if (isCorrect) {
      setPhrase(null);
      onComplete();
    } else {
      setError('One or more words are incorrect. Please try again.');
    }
  };

  const backToWelcome = () => {
    setError('');
    setPassword('');
    setConfirmPassword('');
    setMode('welcome');
  };

  const passwordFields = (
    <div className="onboarding-fields">
      <label className="onboarding-field">
        <span>Password <small>(at least 8 characters)</small></span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(error && password.length > 0 && password.length < 8)}
        />
      </label>
      <label className="onboarding-field">
        <span>Confirm password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={Boolean(error && password !== confirmPassword)}
        />
      </label>
    </div>
  );

  return (
    <div className="onboarding-screen">
      <style>{`
        .onboarding-screen {
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          overflow-y: auto;
          padding: 22px 24px;
          background: var(--bg-color);
          color: var(--text-main);
          display: flex;
          flex-direction: column;
        }
        .onboarding-welcome, .onboarding-flow {
          display: flex;
          width: 100%;
          min-height: 100%;
          flex: 1;
          flex-direction: column;
          align-items: center;
        }
        .onboarding-welcome {
          justify-content: center;
          text-align: center;
        }
        .onboarding-flow {
          max-width: 352px;
          margin: 0 auto;
          align-items: stretch;
        }
        .onboarding-logo {
          display: block;
          width: 104px;
          height: 104px;
          margin-bottom: 20px;
          object-fit: contain;
        }
        .onboarding-logo--small {
          width: 44px;
          height: 44px;
          margin: 0;
        }
        .onboarding-title {
          margin: 0;
          font-size: 1.45rem;
          font-weight: 700;
          letter-spacing: -0.035em;
        }
        .onboarding-welcome .onboarding-title {
          font-size: 1.65rem;
        }
        .onboarding-subtitle {
          margin: 8px 0 24px;
          color: var(--text-sec);
          font-size: 0.9rem;
          line-height: 1.45;
        }
        .onboarding-topbar {
          display: flex;
          min-height: 44px;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .onboarding-back {
          padding: 8px 0;
          border: 0;
          background: transparent;
          color: var(--text-sec);
          font: inherit;
          font-size: 0.85rem;
          cursor: pointer;
        }
        .onboarding-back:hover {
          color: var(--text-main);
        }
        .onboarding-copy {
          margin: 4px 0 18px;
          color: var(--text-sec);
          font-size: 0.86rem;
          line-height: 1.5;
        }
        .onboarding-actions, .onboarding-fields {
          display: flex;
          width: 100%;
          flex-direction: column;
          gap: 12px;
        }
        .onboarding-actions {
          max-width: 320px;
        }
        .onboarding-action {
          width: 100%;
          min-height: 48px;
          padding: 12px 18px;
          border: 1px solid transparent;
          border-radius: 9px;
          font: inherit;
          font-size: 0.9rem;
          font-weight: 650;
          cursor: pointer;
          transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease;
        }
        .onboarding-action:focus-visible, .onboarding-back:focus-visible,
        .onboarding-field input:focus-visible, .onboarding-field textarea:focus-visible,
        .onboarding-quiz input:focus-visible {
          outline: 2px solid var(--accent-color);
          outline-offset: 2px;
        }
        .onboarding-action:active:not(:disabled) {
          transform: translateY(1px);
        }
        .onboarding-action:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .onboarding-action--primary {
          background: var(--accent-color);
          color: var(--bg-color);
        }
        .onboarding-action--primary:hover:not(:disabled) {
          filter: brightness(1.06);
        }
        .onboarding-action--secondary {
          border-color: var(--border-dark);
          background: var(--surface-color);
          color: var(--text-main);
        }
        .onboarding-action--secondary:hover:not(:disabled) {
          border-color: var(--accent-color);
        }
        .onboarding-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-top: 4px;
        }
        .onboarding-field {
          display: flex;
          flex-direction: column;
          gap: 7px;
          color: var(--text-main);
          font-size: 0.84rem;
          font-weight: 600;
        }
        .onboarding-field small {
          color: var(--text-sec);
          font-size: 0.76rem;
          font-weight: 400;
        }
        .onboarding-field input, .onboarding-field textarea, .onboarding-quiz input {
          box-sizing: border-box;
          width: 100%;
          min-height: 44px;
          padding: 11px 12px;
          border: 1px solid var(--border-dark);
          border-radius: 8px;
          background: var(--surface-color);
          color: var(--text-main);
          font: inherit;
          font-size: 0.88rem;
        }
        .onboarding-field textarea {
          min-height: 124px;
          resize: vertical;
          line-height: 1.5;
        }
        .onboarding-field input[aria-invalid="true"], .onboarding-quiz input[aria-invalid="true"] {
          border-color: var(--error-color);
        }
        .onboarding-error {
          margin: 0;
          color: var(--error-color);
          font-size: 0.82rem;
          line-height: 1.45;
        }
        .onboarding-status {
          min-height: 18px;
          margin: 0;
          color: var(--accent-color);
          font-size: 0.8rem;
        }
        .onboarding-warning {
          margin: 0 0 14px;
          padding: 11px 12px;
          border: 1px solid var(--border-dark);
          border-radius: 8px;
          background: var(--surface-color);
          color: var(--text-sec);
          font-size: 0.8rem;
          line-height: 1.45;
        }
        .onboarding-phrase-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 7px;
          margin: 0 0 12px;
          padding: 0;
          list-style: none;
        }
        .onboarding-phrase-word {
          min-width: 0;
          padding: 8px 7px;
          border: 1px solid var(--border-dark);
          border-radius: 7px;
          background: var(--surface-color);
          font-size: 0.78rem;
          overflow-wrap: anywhere;
        }
        .onboarding-phrase-word strong {
          margin-right: 3px;
          color: var(--text-sec);
          font-size: 0.7rem;
        }
        .onboarding-quiz {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin: 10px 0 14px;
        }
        .onboarding-quiz label {
          display: flex;
          flex-direction: column;
          gap: 5px;
          color: var(--text-sec);
          font-size: 0.72rem;
        }
        .onboarding-quiz input {
          min-height: 38px;
          padding: 8px;
          font-size: 0.8rem;
        }
        @media (max-height: 480px) {
          .onboarding-screen { padding-top: 12px; padding-bottom: 12px; }
          .onboarding-welcome { justify-content: flex-start; }
          .onboarding-logo:not(.onboarding-logo--small) {
            width: 72px;
            height: 72px;
            margin-bottom: 12px;
          }
        }
      `}</style>

      {mode === 'welcome' ? (
        <main className="onboarding-welcome" aria-labelledby="onboarding-title">
          <img className="onboarding-logo" src="/icons/sym-logo.png" alt="Solanym logo" />
          <h1 className="onboarding-title" id="onboarding-title">Welcome to Solanym</h1>
          <p className="onboarding-subtitle">Your privacy-first Stellar wallet.</p>
          <div className="onboarding-actions">
            <button
              className="onboarding-action onboarding-action--primary"
              type="button"
              onClick={() => {
                setError('');
                setMode('create');
              }}
            >
              Create New Wallet
            </button>
            <button
              className="onboarding-action onboarding-action--secondary"
              type="button"
              onClick={() => {
                setError('');
                setImportPhraseStr('');
                setValidatedImportPhrase(null);
                setImportStep('phrase');
                setMode('import');
              }}
            >
              Import Existing Wallet
            </button>
          </div>
        </main>
      ) : phrase ? (
        <main className="onboarding-flow" aria-labelledby="onboarding-title">
          <header className="onboarding-topbar">
            <span />
            <img className="onboarding-logo onboarding-logo--small" src="/icons/sym-logo.png" alt="" />
          </header>
          <h1 className="onboarding-title" id="onboarding-title">Back up your recovery phrase</h1>
          <p className="onboarding-copy">Write these 24 words down in order and keep them somewhere private. They will not be shown again.</p>
          <ol className="onboarding-phrase-grid" aria-label="Recovery phrase">
            {phrase.map((word, index) => (
              <li className="onboarding-phrase-word" key={`${index}-${word}`}>
                <strong>{index + 1}.</strong>{word}
              </li>
            ))}
          </ol>
          <button
            className="onboarding-action onboarding-action--secondary"
            type="button"
            onClick={copyPhrase}
          >
            Copy Recovery Phrase
          </button>
          <p className="onboarding-status" role={copyStatus === 'failed' ? 'alert' : 'status'} aria-live="polite">
            {copyStatus === 'copied'
              ? 'Recovery phrase copied.'
              : copyStatus === 'failed'
                ? 'Could not access the clipboard. You can select and copy the words above manually.'
                : ''}
          </p>
          <h2 className="onboarding-title" style={{ marginTop: 6, fontSize: '1rem' }}>Verify your backup</h2>
          <p className="onboarding-copy">Enter the requested words to confirm you saved the phrase.</p>
          <div className="onboarding-quiz">
            {quizIndices.map((index, answerIndex) => (
              <label key={index}>
                Word {index + 1}
                <input
                  type="text"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  value={quizAnswers[answerIndex]}
                  onChange={(event) => {
                    const nextAnswers = [...quizAnswers];
                    nextAnswers[answerIndex] = event.target.value;
                    setQuizAnswers(nextAnswers);
                  }}
                  aria-invalid={Boolean(error)}
                />
              </label>
            ))}
          </div>
          {error && <p className="onboarding-error" role="alert">{error}</p>}
          <button className="onboarding-action onboarding-action--primary" type="button" onClick={verifyQuiz}>
            Verify and Finish
          </button>
        </main>
      ) : (
        <main className="onboarding-flow" aria-labelledby="onboarding-title">
          <header className="onboarding-topbar">
            <button
              className="onboarding-back"
              type="button"
              onClick={mode === 'import' && importStep === 'password'
                ? () => {
                    setImportStep('phrase');
                    setError('');
                    setPassword('');
                    setConfirmPassword('');
                  }
                : backToWelcome}
            >
              ← Back
            </button>
            <img className="onboarding-logo onboarding-logo--small" src="/icons/sym-logo.png" alt="" />
          </header>
          <h1 className="onboarding-title" id="onboarding-title">
            {mode === 'create'
              ? 'Create your wallet'
              : importStep === 'phrase'
                ? 'Import your wallet'
                : 'Set a wallet password'}
          </h1>
          <p className="onboarding-copy">
            {mode === 'create'
              ? 'Choose a password to encrypt and protect your wallet.'
              : importStep === 'phrase'
                ? 'Enter your 12- or 24-word BIP39 recovery phrase to continue.'
                : 'Choose a password to encrypt your imported wallet.'}
          </p>

          {mode === 'import' && importStep === 'phrase' ? (
            <form
              className="onboarding-form"
              onSubmit={(event) => {
                event.preventDefault();
                continueImport();
              }}
            >
              <label className="onboarding-field">
                <span>Recovery phrase</span>
                <textarea
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  value={importPhraseStr}
                  onChange={(event) => {
                    setImportPhraseStr(event.target.value);
                    setError('');
                  }}
                  placeholder="Enter your words separated by spaces"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'onboarding-error' : undefined}
                />
              </label>
              {error && <p className="onboarding-error" id="onboarding-error" role="alert">{error}</p>}
              <button className="onboarding-action onboarding-action--primary" type="submit">
                Continue
              </button>
            </form>
          ) : (
            <form
              className="onboarding-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (mode === 'create') void handleCreate();
                else void handleImport();
              }}
            >
              {mode === 'import' && (
                <p className="onboarding-warning">
                  Recovery phrase validated: {validatedImportPhrase?.length ?? 0} words. Your phrase stays in this wallet and is not sent to an external service.
                </p>
              )}
              {passwordFields}
              {error && <p className="onboarding-error" id="onboarding-error" role="alert">{error}</p>}
              <button
                className="onboarding-action onboarding-action--primary"
                type="submit"
                disabled={loading}
                aria-busy={loading}
              >
                {loading
                  ? mode === 'create' ? 'Creating wallet…' : 'Importing wallet…'
                  : mode === 'create' ? 'Create Wallet' : 'Import Wallet'}
              </button>
            </form>
          )}
        </main>
      )}
    </div>
  );
}
