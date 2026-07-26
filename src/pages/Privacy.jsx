import React from 'react';
import { Link } from 'react-router-dom';
import StaticPage from '@/components/common/StaticPage';

export default function Privacy() {
  return (
    <StaticPage
      title="Privacy Policy"
      description="How VOXEL.AI collects, uses, and protects your data — including the sub-processors that handle it."
      updated="2026-07-26"
    >
      <p>
        This policy explains what data VOXEL.AI ("we", "us") collects when you
        use <a href="https://voxel-ai.ai">voxel-ai.ai</a>, why we collect it, who
        processes it on our behalf, and the rights you have over it. If anything
        here is unclear, email{' '}
        <a href="mailto:info@voxel-ai.ai">info@voxel-ai.ai</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong className="text-white">Account data</strong> — your email
          address and a hashed password (we never store passwords in plain
          text).
        </li>
        <li>
          <strong className="text-white">Creations</strong> — the prompts you
          write, settings you choose (model, camera, duration, etc.), reference
          images or media you upload, and the images, video, and audio you
          generate. These are stored so your history survives between sessions.
        </li>
        <li>
          <strong className="text-white">Credits and transactions</strong> — your
          plan, credit balance, and a ledger of credit charges and refunds.
          Payment card details are handled entirely by our payment processor and
          never touch our servers.
        </li>
        <li>
          <strong className="text-white">Technical data</strong> — IP address
          and request metadata, used for security, rate limiting, and abuse
          prevention. Our infrastructure sits behind Cloudflare, which processes
          this data to filter malicious traffic.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To run the service: generate your content, keep your history, and manage your credits.</li>
        <li>To secure the service: rate limiting, fraud and abuse prevention.</li>
        <li>To support you: answering questions and auditing failed generations for refunds.</li>
      </ul>
      <p>
        We do not sell your personal data, and we do not use your prompts,
        uploads, or generations to train AI models.
      </p>

      <h2>Sub-processors</h2>
      <p>
        To provide the service, the following third parties process data on our
        behalf (GDPR Art. 28). We keep this list current; a change to it will be
        reflected here with a new "last updated" date.
      </p>
      <ul>
        <li><strong className="text-white">fal.ai</strong> — AI model inference. Receives prompts and reference media for generation (USA).</li>
        <li><strong className="text-white">Kie.ai</strong> — AI model inference for selected models. Receives prompts and reference media for generation.</li>
        <li><strong className="text-white">DigitalOcean</strong> — application hosting, managed database, and object storage for your generated media and history (USA/EU).</li>
        <li><strong className="text-white">Cloudflare</strong> — CDN, TLS, and security filtering. Processes IP addresses and request metadata (global).</li>
        <li><strong className="text-white">Google Fonts</strong> — webfont delivery. Your browser requests font files from Google's servers (global).</li>
      </ul>

      <h2>Cookies and local storage</h2>
      <p>
        We use a small number of strictly necessary items: a session token in
        your browser's local storage to keep you signed in, and a Cloudflare
        security cookie (<code>__cf_bm</code>) for bot protection. We do not use
        advertising or cross-site tracking cookies.
      </p>

      <h2>Retention</h2>
      <p>
        Your account, history, and credit ledger are kept while your account is
        active. When you delete your account (or ask us to), we delete your
        personal data and stored creations within 30 days, except records we
        must keep for legal or accounting reasons.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live (including under GDPR and CCPA), you may
        have the right to access, correct, export, or delete your personal
        data, and to object to or restrict certain processing. To exercise any
        of these, email <a href="mailto:info@voxel-ai.ai">info@voxel-ai.ai</a>{' '}
        with the subject "Privacy request" from your account email. We respond
        within 30 days.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions or complaints:{' '}
        <a href="mailto:info@voxel-ai.ai">info@voxel-ai.ai</a>, or via the{' '}
        <Link to="/contact">contact page</Link>.
      </p>
    </StaticPage>
  );
}
