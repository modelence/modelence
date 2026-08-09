'use client';

import { ReactNode } from 'react';

/*
  Shown by AppProvider instead of the app when a development server reports it
  has no backend at all — no Modelence Cloud connection and no local database
  (see server-side isSetupRequired). This is the state of every fresh clone:
  .modelence.env holds the environment's credentials and is gitignored, so it
  never travels with the repo.

  Styled inline: this renders inside arbitrary user apps, so it can't rely on
  any CSS framework being present.
*/

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#f3f4f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 16px',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    color: '#111827',
  },
  container: {
    maxWidth: '576px',
    width: '100%',
  },
  logoWrap: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '32px',
  },
  title: {
    fontSize: '30px',
    lineHeight: '36px',
    fontWeight: 700,
    textAlign: 'center',
    margin: 0,
  },
  subtitle: {
    marginTop: '16px',
    color: '#4b5563',
    textAlign: 'center',
  },
  steps: {
    marginTop: '32px',
    listStyle: 'none',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  step: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-start',
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    padding: '16px',
  },
  stepNumber: {
    flex: 'none',
    width: '28px',
    height: '28px',
    borderRadius: '9999px',
    backgroundColor: '#111827',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    color: '#374151',
    lineHeight: '28px',
  },
  code: {
    fontSize: '14px',
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    padding: '2px 4px',
  },
  footer: {
    marginTop: '32px',
    fontSize: '14px',
    color: '#6b7280',
    textAlign: 'center',
  },
};

export default function SetupScreen() {
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.logoWrap}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="80"
            height="80"
            viewBox="0 0 48 48"
            fill="none"
            aria-label="Modelence Logo"
          >
            <path
              fill="#5509D9"
              d="M45 22.788V12L24 0l-9.437 5.392L45 22.788ZM25.152 35.24l10.589 6.052 8.107-4.632-10.589-6.052-8.107 4.632Zm9.26-15.872v9.264L45 34.684V25.42l-10.589-6.052ZM3 25.212V36l21 12 9.441-5.392L3 25.212ZM22.848 12.76 12.26 6.708 4.152 11.34l10.589 6.052 8.107-4.632Zm-9.26 15.872v-9.264L3 13.316v9.264l10.589 6.052Z"
            />
          </svg>
        </div>
        <h1 style={styles.title}>Connect this project to Modelence Cloud</h1>
        <p style={styles.subtitle}>One quick step before you can use this app locally.</p>

        <ol style={styles.steps}>
          <Step number={1}>
            Run <code style={styles.code}>npx modelence setup</code> in the project folder.
          </Step>
          <Step number={2}>Your browser opens &mdash; log in and choose your environment.</Step>
          <Step number={3}>
            Restart the dev server (<code style={styles.code}>npm run dev</code>).
          </Step>
        </ol>

        <p style={styles.footer}>
          This page refreshes automatically once the project is connected.
        </p>
      </div>
    </div>
  );
}

function Step({ number, children }: { number: number; children: ReactNode }) {
  return (
    <li style={styles.step}>
      <span style={styles.stepNumber}>{number}</span>
      <span style={styles.stepText}>{children}</span>
    </li>
  );
}
