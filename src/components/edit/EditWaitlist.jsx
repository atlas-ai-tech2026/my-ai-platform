// ─── EditWaitlist.jsx ────────────────────────────────────────────────────────
// What a signed-out visitor sees at /edit.
//
// Moved out of src/pages/Edit.jsx on 2026-08-21 when the real editor landed:
// Edit.jsx is now a gate, and this is the half it shows to people who cannot
// use the editor yet. The waitlist logic is UNCHANGED — it is covered by a
// regression test for a bug that lost every address it collected, and that
// protection had to survive the move intact.
//
// ── THE FEATURE LIST WAS A LIE AND IS NOW A FACT ───────────────────────────
// It used to advertise "30+ transitions", "lipsync & voice sync", "4K export"
// and "colour grading AI" behind a Coming Soon overlay. None of those exist.
// Shipping a working editor under that copy would have made the first honest
// version look like a downgrade — the same failure as task #30, where the site
// contradicts itself.
//
// So the list is now split: what a signed-in customer can do TODAY, and what is
// genuinely next. Nothing is claimed that is not built.

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import VoxelLogo from '@/components/VoxelLogo';
import { CheckCircle2, Bell, Clock } from 'lucide-react';
import { toast } from 'sonner';

/** Live today, free, for anyone signed in. */
const liveNow = [
  'Trim any clip',
  'Resize for Reels, posts & YouTube',
  'Captions on the video',
  'Speed up or slow down',
];

/** Genuinely next. Named as not-yet-built, not as features. */
const comingNext = [
  'AI music & voice-over',
  'Background removal',
  'In-frame AI edits',
  'Multi-track timeline',
];

export default function EditWaitlist({ onSignIn }) {
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // This used to validate the address, show a success toast, and throw the
  // address away — no request, no table, no record. Everyone who ever asked
  // to hear about VOXEL Edit was lost while the page kept asking.
  //
  // The success message now only appears if the server actually stored it.
  const handleNotify = async () => {
    if (!email.includes('@')) {
      toast.error('Please enter a valid email');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'edit' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // Say what went wrong instead of thanking them for nothing.
        toast.error(data?.error || 'Could not save that — please try again.');
        return;
      }
      toast.success("You'll be notified when VOXEL Edit launches!");
      setEmail('');
    } catch {
      toast.error('Could not reach the server — please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 opacity-30 blur-sm" aria-hidden="true">
        <div className="h-14 bg-background-secondary border-b border-border flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-muted" />
            <div className="w-8 h-8 rounded bg-muted" />
            <div className="w-8 h-8 rounded bg-muted" />
          </div>
          <div className="w-20 h-8 rounded bg-primary/30" />
        </div>
        <div className="flex h-[calc(100vh-14rem)]">
          <div className="w-64 bg-background-secondary border-r border-border p-4">
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => <div key={i} className="h-16 rounded bg-muted" />)}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center bg-background p-8">
            <div className="w-full max-w-4xl aspect-video bg-card-gradient-2 rounded-lg" />
          </div>
          <div className="w-72 bg-background-secondary border-l border-border p-4">
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-12 rounded bg-muted" />)}
            </div>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center p-4 overflow-y-auto">
        <div className="max-w-2xl w-full glass rounded-2xl border border-primary/40 border-glow-red p-8 sm:p-12 text-center my-8">
          <div className="flex justify-center mb-6">
            <div className="animate-pulse"><VoxelLogo size="large" showText={false} /></div>
          </div>

          <h1 className="font-heading text-4xl sm:text-5xl tracking-wider text-white mb-2">
            VOXEL EDIT
          </h1>
          <p className="text-xl text-primary font-medium mb-4">
            Edit the videos you already made
          </p>

          <p className="text-foreground-secondary mb-8 max-w-md mx-auto">
            Cut your clips, reshape them for any platform, and add captions — all free,
            with no credits used. Sign in to start.
          </p>

          {onSignIn && (
            <Button
              onClick={onSignIn}
              className="bg-primary hover:bg-primary-hover text-white mb-8 px-8"
            >
              Sign in to start editing
            </Button>
          )}

          <div className="grid sm:grid-cols-2 gap-6 mb-8 text-left">
            <div>
              <p className="text-xs font-semibold tracking-widest text-primary mb-3">
                AVAILABLE NOW · FREE
              </p>
              <div className="space-y-2">
                {liveNow.map((f) => (
                  <div key={f} className="flex items-center gap-2 text-foreground-secondary text-sm">
                    <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-widest text-foreground-muted mb-3">
                COMING NEXT
              </p>
              <div className="space-y-2">
                {comingNext.map((f) => (
                  <div key={f} className="flex items-center gap-2 text-foreground-muted text-sm">
                    <Clock className="w-4 h-4 flex-shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 bg-background border-border text-white placeholder:text-foreground-muted"
            />
            <Button
              onClick={handleNotify}
              disabled={saving}
              className="bg-primary hover:bg-primary-hover text-white"
            >
              <Bell className="w-4 h-4 mr-2" />
              {saving ? 'Saving…' : 'Notify Me'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
