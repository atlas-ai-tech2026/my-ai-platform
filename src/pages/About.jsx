import React from 'react';
import { Link } from 'react-router-dom';
import StaticPage from '@/components/common/StaticPage';

export default function About() {
  return (
    <StaticPage
      title="About VOXEL.AI"
      description="VOXEL.AI is an AI-powered creative studio for generating images, video, and audio — built for creators, marketers, and studios."
    >
      <p>
        VOXEL.AI is an AI-powered creative studio that turns text prompts into
        production-quality images, cinematic video, and audio. We bring the best
        generative models — Kling, Veo, Seedance, LTX, Sora, and more — into one
        interface, so creators can move from idea to finished asset without
        juggling a dozen tools and subscriptions.
      </p>

      <h2>What we believe</h2>
      <p>
        Great creative tools should feel like a camera, not a command line. That
        is why VOXEL.AI gives you real photographic controls — camera body, lens,
        focal length, aperture — and real directorial controls for video, like
        camera motion, duration, and aspect ratio. The model does the rendering;
        you keep the creative intent.
      </p>

      <h2>What you can make</h2>
      <ul>
        <li><Link to="/image">AI images</Link> with reference-based character consistency and photographic camera controls.</li>
        <li><Link to="/video">AI video</Link> from text or image, across the leading video models, with camera-motion direction.</li>
        <li><Link to="/audio">Voice and audio</Link> in the Audio Studio.</li>
        <li>Repeatable multi-model workflows on the <Link to="/node">Voxel Node canvas</Link>.</li>
      </ul>

      <h2>How we run</h2>
      <p>
        VOXEL.AI is an independent, self-funded product built and operated by a
        small dedicated team. We charge simple credit-based{' '}
        <Link to="/pricing">pricing</Link> with the same cost per credit on every
        plan — no watermarks, and commercial usage rights on all exports. Every
        generation you make is stored in your private history so your work is
        never lost.
      </p>

      <h2>Get in touch</h2>
      <p>
        Questions, feedback, or partnership ideas? Visit the{' '}
        <Link to="/contact">contact page</Link> or email{' '}
        <a href="mailto:info@voxel-ai.ai">info@voxel-ai.ai</a> — we read
        everything.
      </p>
    </StaticPage>
  );
}
