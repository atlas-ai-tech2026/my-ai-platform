import React from 'react';
import { Link } from 'react-router-dom';
import StaticPage from '@/components/common/StaticPage';

export default function Terms() {
  return (
    <StaticPage
      title="Terms of Service"
      description="The terms that govern your use of VOXEL.AI — accounts, credits, content ownership, and acceptable use."
      updated="2026-07-26"
    >
      <p>
        These terms govern your use of VOXEL.AI at{' '}
        <a href="https://voxel-ai.ai">voxel-ai.ai</a> ("the Service"). By
        creating an account or using the Service you agree to them. If you do
        not agree, do not use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        VOXEL.AI lets you generate images, video, and audio using third-party AI
        models. Generation consumes credits from your plan. Model availability,
        features, and credit costs may change as upstream providers change; the
        current costs are always shown before you generate.
      </p>

      <h2>2. Your account</h2>
      <p>
        You must provide accurate information and keep your credentials safe.
        You are responsible for activity under your account. We may suspend
        accounts that violate these terms or threaten the integrity of the
        Service.
      </p>

      <h2>3. Credits and payments</h2>
      <ul>
        <li>Credits are consumed per generation at the rates displayed in the app.</li>
        <li>If a generation fails on our side, the charged credits are refunded to your balance — we audit for this.</li>
        <li>Credits have no cash value, are non-transferable, and unused credits are not refundable except where required by law.</li>
      </ul>

      <h2>4. Your content</h2>
      <p>
        You retain ownership of the prompts and reference media you upload, and
        — to the maximum extent permitted by law and the licenses of the
        underlying model providers — you own the outputs you generate, including
        for commercial use, on every plan. If you choose to share a creation to
        the public community feed, you grant us a non-exclusive license to
        display it there; you can remove it at any time.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to use the Service to create or distribute:</p>
      <ul>
        <li>Illegal content, or content that sexualizes minors in any form;</li>
        <li>Non-consensual intimate imagery or deepfakes of real people intended to deceive, harass, or defame;</li>
        <li>Content that infringes third-party intellectual-property or privacy rights;</li>
        <li>Malware, spam, or content designed to mislead (e.g. fraudulent impersonation).</li>
      </ul>
      <p>
        Use of specific models is also subject to the acceptable-use policies of
        the upstream model providers. We may refuse generations, remove content,
        or suspend accounts that break these rules.
      </p>

      <h2>6. Disclaimers</h2>
      <p>
        The Service is provided "as is". Generative AI output can be inaccurate,
        unexpected, or resemble existing works; you are responsible for
        reviewing outputs before using them. To the maximum extent permitted by
        law, we disclaim all warranties and our total liability for any claim is
        limited to the amount you paid us in the three months before the claim
        arose.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update these terms as the Service evolves. Material changes will
        be announced in the app or by email, and the "last updated" date above
        always reflects the current version. Continued use after a change means
        you accept the updated terms.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions about these terms:{' '}
        <a href="mailto:info@voxel-ai.ai">info@voxel-ai.ai</a> or the{' '}
        <Link to="/contact">contact page</Link>.
      </p>
    </StaticPage>
  );
}
