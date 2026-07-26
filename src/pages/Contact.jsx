import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageCircle, ShieldAlert } from 'lucide-react';
import StaticPage from '@/components/common/StaticPage';

export default function Contact() {
  return (
    <StaticPage
      title="Contact"
      description="Contact the VOXEL.AI team — support, billing, privacy, and partnership enquiries."
    >
      <p>
        We're a small team and we answer our own email. Whatever the question —
        support, billing, privacy, or partnerships — the fastest routes are
        below. We aim to reply within one business day.
      </p>

      <div className="grid sm:grid-cols-2 gap-4 not-prose my-8">
        <div className="rounded-xl border border-border p-5">
          <Mail className="text-white mb-3" size={22} />
          <h3 className="font-semibold text-white mb-1">Email</h3>
          <p className="text-sm">
            <a href="mailto:info@voxel-ai.ai">info@voxel-ai.ai</a>
            <br />
            For support, billing, and general enquiries.
          </p>
        </div>
        <div className="rounded-xl border border-border p-5">
          <MessageCircle className="text-white mb-3" size={22} />
          <h3 className="font-semibold text-white mb-1">Live chat</h3>
          <p className="text-sm">
            <button
              onClick={() => window.__voxelChatOpen?.()}
              className="underline underline-offset-2 text-white"
            >
              Open the chat widget
            </button>{' '}
            from any page for quick questions.
          </p>
        </div>
      </div>

      <h2>Privacy requests</h2>
      <p>
        <ShieldAlert className="inline mr-1 -mt-1" size={16} />
        To exercise a data right (access, correction, deletion, export), email{' '}
        <a href="mailto:info@voxel-ai.ai">info@voxel-ai.ai</a> with the subject
        line "Privacy request" from the address on your account. See the{' '}
        <Link to="/privacy">Privacy Policy</Link> for details.
      </p>

      <h2>Something broken?</h2>
      <p>
        If a generation failed or credits were charged incorrectly, include the
        approximate time of the generation and the model you used — we audit
        failed generations and refund credits kept in error.
      </p>
    </StaticPage>
  );
}
