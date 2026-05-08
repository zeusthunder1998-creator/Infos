import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Infos',
  description: 'Privacy policy for the Infos admin portal',
};

// Privacy policy page. Standalone, server-rendered, no client JS needed.
// Linked from the About modal footer in the main app.
// Designed to satisfy Play Store privacy policy requirements.
export default function PrivacyPolicyPage() {
  return (
    <main style={{
      maxWidth: '720px',
      margin: '0 auto',
      padding: '2rem 1.25rem 4rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      lineHeight: 1.6,
      color: 'var(--text-primary)',
      background: 'var(--bg)',
      minHeight: '100vh',
    }}>
      <a href="/" style={{
        display: 'inline-block',
        marginBottom: '1.5rem',
        color: 'var(--accent)',
        textDecoration: 'none',
        fontSize: '14px',
        fontWeight: 500,
      }}>← Back to app</a>

      <h1 style={{ fontSize: '28px', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>Privacy Policy</h1>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '2rem' }}>
        Last updated: November 2025
      </p>

      <section style={{ marginBottom: '2rem' }}>
        <p>
          This Privacy Policy describes how the Infos admin portal (&ldquo;Infos&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;)
          handles your information when you use the web application or the Android app distributed via Google Play Store.
        </p>
      </section>

      <h2 style={H2}>1. Information we collect</h2>
      <p>When you use Infos, the following information is stored on our backend (Supabase) so the app can function:</p>
      <ul style={UL}>
        <li><strong>Account credentials:</strong> the username and password you set for admin or sub-admin accounts.</li>
        <li><strong>Workspace content:</strong> notices, game entries, backend entries, and Id &amp; Pass credentials (game passwords or account credentials) you create within the app.</li>
        <li><strong>Sub-admin assignments:</strong> which sub-admins are assigned to which entries.</li>
        <li><strong>Copy &amp; Paste entries:</strong> short-lived credential snippets shared between your own devices, automatically deleted after 5 minutes.</li>
        <li><strong>Theme preference:</strong> light or dark mode, stored locally on your device only.</li>
      </ul>
      <p>
        We do <strong>not</strong> collect your name, email, phone number, location, contacts, photos, or any device identifiers
        unless you choose to enter them as content within the app.
      </p>

      <h2 style={H2}>2. How your data is stored</h2>
      <p>
        Your data is stored in a managed PostgreSQL database hosted by{' '}
        <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" style={A}>Supabase Inc.</a>
        Data is encrypted at rest and in transit (HTTPS / TLS) according to Supabase&apos;s standard infrastructure.
      </p>
      <p>
        Theme preference and your active session token are stored in your device&apos;s local storage. They are never sent to our backend.
      </p>

      <h2 style={H2}>3. Who can see your data</h2>
      <p>Visibility is enforced by the app&apos;s role-based access model:</p>
      <ul style={UL}>
        <li><strong>Zeus admin:</strong> sees all data within their workspace, plus the platform&apos;s editable About content.</li>
        <li><strong>Co-admins:</strong> see only the data within their own isolated workspace. They cannot see Zeus&apos;s workspace or other co-admins&apos; workspaces.</li>
        <li><strong>Sub-admins:</strong> see only the entries assigned to them by their workspace admin, plus their own Copy &amp; Paste entries (which are private even to other sub-admins and admins).</li>
      </ul>

      <h2 style={H2}>4. What we do NOT do</h2>
      <ul style={UL}>
        <li>We do not use third-party analytics (no Google Analytics, no Facebook Pixel, no Mixpanel, etc.).</li>
        <li>We do not display ads or use ad networks.</li>
        <li>We do not sell, rent, or share your data with third parties.</li>
        <li>We do not use cookies for tracking. The only browser storage used is localStorage for theme and session.</li>
        <li>We do not access your device&apos;s contacts, location, camera, microphone, or other sensors.</li>
      </ul>

      <h2 style={H2}>5. Data retention &amp; deletion</h2>
      <ul style={UL}>
        <li>Active workspace data is retained until manually deleted by an admin.</li>
        <li>Copy &amp; Paste entries are automatically deleted from the database 5 minutes after they are created.</li>
        <li>When a sub-admin account is deleted, all their personal data (Copy &amp; Paste entries) is also deleted.</li>
        <li>When a co-admin&apos;s workspace is deleted, all sub-admins, content, and Copy &amp; Paste entries within that workspace are cascade-deleted.</li>
        <li>You may request full deletion of your account and data by contacting us at the email shown in the app&apos;s About section.</li>
      </ul>

      <h2 style={H2}>6. Your rights</h2>
      <ul style={UL}>
        <li><strong>Access:</strong> admins can export their entire workspace as a JSON file via the in-app Settings &gt; Backup feature.</li>
        <li><strong>Deletion:</strong> admins can delete sub-admins, individual entries, or entire co-admin workspaces from within the app.</li>
        <li><strong>Correction:</strong> all content can be edited directly within the app.</li>
      </ul>

      <h2 style={H2}>7. Children&apos;s privacy</h2>
      <p>
        Infos is intended for use by adults managing administrative tasks. We do not knowingly collect data from children
        under 13. If you believe a child has provided us with personal information, please contact us so we can delete it.
      </p>

      <h2 style={H2}>8. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. The &ldquo;Last updated&rdquo; date at the top of this page reflects
        the most recent change. Continued use of the app after a policy update constitutes acceptance of the new policy.
      </p>

      <h2 style={H2}>9. Contact</h2>
      <p>
        For questions about this Privacy Policy or to request data deletion, please reach out via the contact email shown
        in the app&apos;s About section.
      </p>

      <hr style={{ margin: '3rem 0 2rem', border: 'none', borderTop: '1px solid var(--border)' }} />

      <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
        <a href="/" style={A}>← Back to Infos</a>
      </p>
    </main>
  );
}

const H2 = {
  fontSize: '18px',
  marginTop: '2rem',
  marginBottom: '0.75rem',
  letterSpacing: '-0.01em',
  fontWeight: 600,
};

const UL = {
  paddingLeft: '1.5rem',
  marginBottom: '1rem',
};

const A = {
  color: 'var(--accent)',
  textDecoration: 'underline',
};
