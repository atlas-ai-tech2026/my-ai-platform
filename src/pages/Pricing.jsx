import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CheckCircle2, Gift, Star, Crown, ChevronDown, Check, X, Sparkles, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const plans = [
  {
    name: 'Pro',
    icon: Star,
    monthlyPrice: 29,
    annualPrice: 17,
    credits: '600 credits/month',
    features: [
      'No watermark',
      'Access to Kling 2.6, Seedream 4.5, Soul 2.0',
      'Face Swap, Upscaler, Lipsync',
      'Priority generation queue',
      'Commercial usage rights',
    ],
    cta: 'Get Pro',
    popular: true,
    highlighted: true,
  },
  {
    name: 'Advanced',
    icon: Crown,
    monthlyPrice: 79,
    annualPrice: 49,
    credits: '2,000 credits/month',
    features: [
      'All models (Sora 2, Veo 3.1, all)',
      'Team collaboration tools',
      'API access',
      '4K export priority',
      'Premium support',
      'Custom enterprise pricing',
    ],
    cta: 'Get Advanced',
    popular: false,
    highlighted: false,
  },
  {
    name: 'Studio',
    icon: Crown,
    monthlyPrice: 129,
    annualPrice: 129,
    credits: '4,500 credits/month',
    features: [
      'Everything in Advanced',
      'Highest priority generation queue',
      'Dedicated support',
    ],
    cta: 'Get Studio',
    popular: false,
    highlighted: false,
  },
];

// STARTER-style card config (keyed by plan name). Credit math:
//   Nano Banana Pro 1K = 2 cr  → gens   = credits / 2
//   Kling 3.0 1080p 5s = 7.5 cr → videos = credits / 7.5
const STARTER_CARD_CONFIG = {
  Pro: {
    subtitle: 'For serious creators & professionals',
    creditsLabel: '600 credits/mo.',
    nanoGens: 300,
    klingVideos: 80,
    fixedLabel: 'Fixed amount of 600 credits/mo',
    features: [
      { ok: true,  label: 'Parallel generations: up to 2 Videos, 4 Images' },
      { ok: true,  label: 'No watermark on exports' },
      { ok: true,  label: 'Access to Kling 2.6, Seedream 4.5, Soul 2.0' },
      { ok: true,  label: 'Face Swap, Upscaler, Lipsync' },
      { ok: true,  label: 'Priority generation queue' },
      { ok: true,  label: 'Commercial usage rights' },
      { ok: false, label: 'Early access to advanced AI features' },
      { ok: false, label: 'Lowest cost per credit' },
    ],
    seedance: [
      { name: 'Seedance 2.0',      access: false },
      { name: 'Seedance 2.0 Mini', access: true },
      { name: 'Seedance 2.0 Fast', access: true },
    ],
  },
  Advanced: {
    subtitle: 'For studios, teams & power users',
    creditsLabel: '2,000 credits/mo.',
    nanoGens: 1000,
    klingVideos: 266,
    fixedLabel: 'Fixed amount of 2,000 credits/mo',
    features: [
      { ok: true, label: 'Parallel generations: up to 4 Videos, 8 Images' },
      { ok: true, label: 'All models (Sora 2, Veo 3.1, all)' },
      { ok: true, label: 'Team collaboration tools' },
      { ok: true, label: 'API access' },
      { ok: true, label: '4K export priority' },
      { ok: true, label: 'Premium support' },
      { ok: true, label: 'Early access to advanced AI features' },
      { ok: true, label: 'Lowest cost per credit' },
    ],
    seedance: [
      { name: 'Seedance 2.0',      access: true },
      { name: 'Seedance 2.0 Mini', access: true },
      { name: 'Seedance 2.0 Fast', access: true },
    ],
  },
  'Studio': {
    subtitle: 'For agencies & high-volume production',
    creditsLabel: '4,500 credits/mo.',
    nanoGens: 2250,
    klingVideos: 600,
    fixedLabel: 'Fixed amount of 4,500 credits/mo',
    features: [
      { ok: true, label: 'Parallel generations: up to 8 Videos, 16 Images' },
      { ok: true, label: 'Everything in Advanced' },
      { ok: true, label: 'All models, earliest access' },
      { ok: true, label: 'Highest priority generation queue' },
      { ok: true, label: 'Dedicated support' },
      { ok: true, label: 'Team collaboration tools' },
      { ok: true, label: 'API access' },
      { ok: true, label: 'Lowest cost per credit' },
    ],
    seedance: [
      { name: 'Seedance 2.0',      access: true },
      { name: 'Seedance 2.0 Mini', access: true },
      { name: 'Seedance 2.0 Fast', access: true },
    ],
  },
};

const faqs = [
  {
    question: 'How do credits work?',
    answer: 'Credits are consumed when you generate content. Image generation typically costs 0.1 credits, video generation costs 0.3-1.0 credits depending on length and quality, and audio generation costs 0.1-0.5 credits. Unused credits roll over to the next month up to 2x your monthly limit.',
  },
  {
    question: 'Can I change plans?',
    answer: 'Yes, you can upgrade or downgrade your plan at any time. When upgrading, you\'ll get immediate access to new features. When downgrading, the change takes effect at the end of your billing cycle.',
  },
  {
    question: 'Do credits expire?',
    answer: 'Credits roll over to the next month, up to 2x your monthly credit limit. After that, the oldest credits expire. For example, on Pro plan, you can accumulate up to 1,200 credits.',
  },
  {
    question: 'What are commercial usage rights?',
    answer: 'Pro and Advanced plans include commercial usage rights, meaning you can use generated content for business purposes, including marketing, advertising, and selling products featuring AI-generated content.',
  },
  {
    question: 'Are there enterprise options?',
    answer: 'Yes, we offer custom enterprise plans for larger teams and organizations. Contact our sales team for custom pricing, dedicated support, SLA guarantees, and volume discounts.',
  },
];

const comparisonFeatures = [
  { name: 'Monthly Credits', free: '50', pro: '600', advanced: '2,000' },
  { name: 'Image Generation', free: '✓', pro: '✓', advanced: '✓' },
  { name: 'Video Generation', free: 'Limited', pro: '✓', advanced: '✓' },
  { name: 'Audio Tools', free: 'Limited', pro: '✓', advanced: '✓' },
  { name: 'Premium Models', free: '—', pro: '✓', advanced: '✓' },
  { name: 'Watermark-free', free: '—', pro: '✓', advanced: '✓' },
  { name: 'Commercial License', free: '—', pro: '✓', advanced: '✓' },
  { name: 'API Access', free: '—', pro: '—', advanced: '✓' },
  { name: 'Team Features', free: '—', pro: '—', advanced: '✓' },
  { name: 'Priority Support', free: '—', pro: '—', advanced: '✓' },
];

export default function Pricing() {
  const [isAnnual, setIsAnnual] = useState(false);

  return (
    <div className="min-h-screen py-16 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-wider text-white mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-foreground-secondary mb-8">
            Choose the plan that fits your creative needs
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-4 px-4 py-2 bg-background-secondary rounded-full border border-border">
            <span className={cn("text-sm font-medium transition-colors", !isAnnual ? 'text-white' : 'text-foreground-muted')}>
              Monthly
            </span>
            <Switch checked={isAnnual} onCheckedChange={setIsAnnual} />
            <span className={cn("text-sm font-medium transition-colors", isAnnual ? 'text-white' : 'text-foreground-muted')}>
              Annual
              <span className="ml-2 px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full">
                Save 40%
              </span>
            </span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const price = isAnnual ? plan.annualPrice : plan.monthlyPrice;

            // ── STARTER-style design (Pro + Advanced) ───────────────────────
            const starter = STARTER_CARD_CONFIG[plan.name];
            if (starter) {
              const GREEN = '#E01E1E'; // brand red accent (was green)
              return (
                <div
                  key={plan.name}
                  style={{
                    position: 'relative', borderRadius: 18, padding: 24,
                    background: '#16181C', border: '1px solid #2A2F35',
                    display: 'flex', flexDirection: 'column', gap: 18,
                    fontFamily: '"DM Sans", sans-serif',
                  }}
                >
                  {/* Title + subtitle */}
                  <div>
                    <h3 style={{ fontFamily: 'Anton, sans-serif', fontSize: 30, letterSpacing: '0.02em', color: '#fff', textTransform: 'uppercase', margin: 0 }}>
                      {plan.name}
                    </h3>
                    <p style={{ color: '#9CA3AF', fontSize: 14, marginTop: 6 }}>{starter.subtitle}</p>
                  </div>

                  {/* Credits box */}
                  <div style={{ background: '#1F2227', border: '1px solid #2A2F35', borderRadius: 14, padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontWeight: 700, fontSize: 19 }}>
                      <Sparkles style={{ width: 17, height: 17, color: GREEN }} />
                      {starter.creditsLabel}
                    </div>
                    <div style={{ color: '#9CA3AF', fontSize: 13.5, marginTop: 12, lineHeight: 1.8 }}>
                      <div><span style={{ color: '#E5E7EB', fontWeight: 600 }}>= {starter.nanoGens}</span> Nano Banana Pro Generations</div>
                      <div><span style={{ color: '#E5E7EB', fontWeight: 600 }}>~ {starter.klingVideos}</span> Kling 3.0 videos</div>
                    </div>
                    <div style={{ marginTop: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid #2A2F35', borderRadius: 9, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8, color: '#9CA3AF', fontSize: 13 }}>
                      <Check style={{ width: 15, height: 15, color: GREEN }} />
                      {starter.fixedLabel}
                    </div>
                  </div>

                  {/* Price */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ fontFamily: 'Anton, sans-serif', fontSize: 46, color: '#fff', lineHeight: 1 }}>${price}</span>
                      <span style={{ color: '#9CA3AF', fontSize: 14 }}>{isAnnual ? 'Billed annually' : 'Billed monthly'}</span>
                    </div>
                    <p style={{ color: '#6B7280', fontSize: 13, marginTop: 8 }}>Renews at ${price}</p>
                  </div>

                  {/* CTA */}
                  <button
                    style={{
                      width: '100%', padding: '15px 0', borderRadius: 12, border: 'none',
                      background: '#fff', color: '#0F1113', fontSize: 16, fontWeight: 700,
                      cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
                    }}
                  >
                    Get Plan
                  </button>

                  {/* Features */}
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 13 }}>
                    {starter.features.map((f, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600, color: f.ok ? '#E5E7EB' : '#6B7280' }}>
                        {f.ok
                          ? <Check style={{ width: 16, height: 16, color: '#fff', flexShrink: 0 }} />
                          : <X style={{ width: 16, height: 16, color: '#6B7280', flexShrink: 0 }} />}
                        {f.label}
                      </li>
                    ))}
                  </ul>

                  {/* Seedance access box */}
                  <div style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(13,148,136,0.06))', border: '1px solid #2A2F35', borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <BarChart3 style={{ width: 16, height: 16, color: '#3B82F6' }} />
                      <span style={{ color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em' }}>SEEDANCE 2.0</span>
                    </div>
                    {starter.seedance.map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: s.access ? '#E5E7EB' : '#6B7280', textDecoration: s.access ? 'underline' : 'none', textDecorationColor: 'rgba(255,255,255,0.2)' }}>
                          {s.access
                            ? <Check style={{ width: 14, height: 14, color: '#fff' }} />
                            : <X style={{ width: 14, height: 14, color: '#6B7280' }} />}
                          {s.name}
                        </span>
                        {s.access ? (
                          <span style={{ background: GREEN, color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', padding: '3px 8px', borderRadius: 6 }}>FULL ACCESS</span>
                        ) : (
                          <span style={{ background: 'rgba(255,255,255,0.08)', color: '#9CA3AF', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', padding: '3px 8px', borderRadius: 6 }}>NO ACCESS</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={plan.name}
                className={cn(
                  "relative rounded-2xl border p-6 transition-all duration-300",
                  plan.highlighted
                    ? "bg-primary-dark/30 border-primary/50 scale-105 z-10 border-glow-red"
                    : "bg-background-secondary border-border hover:border-primary/30"
                )}
              >
                {/* Popular Badge */}
                {plan.popular && (
                  <div className="absolute -top-3 right-6 px-3 py-1 bg-primary text-white text-xs font-bold rounded-full">
                    MOST POPULAR
                  </div>
                )}

                {/* Icon */}
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center mb-4",
                  plan.highlighted ? "bg-primary/20" : "bg-muted"
                )}>
                  <Icon className={cn(
                    "w-6 h-6",
                    plan.highlighted ? "text-primary" : "text-foreground-muted"
                  )} />
                </div>

                {/* Plan Name & Price */}
                <h3 className="text-xl font-semibold text-white mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-bold text-white">${price}</span>
                  <span className="text-foreground-muted">/ month</span>
                </div>
                {isAnnual && plan.monthlyPrice > 0 && (
                  <p className="text-sm text-foreground-muted mb-4">
                    <span className="line-through">${plan.monthlyPrice}</span> billed annually
                  </p>
                )}
                <p className="text-primary font-medium mb-6">{plan.credits}</p>

                {/* Features */}
                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground-secondary">
                      <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* CTA Button */}
                <Button 
                  className={cn(
                    "w-full",
                    plan.highlighted
                      ? "bg-primary hover:bg-primary-hover text-white"
                      : "bg-background border border-border text-white hover:bg-muted"
                  )}
                >
                  {plan.cta} →
                </Button>
              </div>
            );
          })}
        </div>

        {/* Comparison Table */}
        <div className="mb-16">
          <h2 className="font-heading text-2xl tracking-wider text-white text-center mb-8">
            Feature Comparison
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-4 px-4 text-foreground-secondary font-medium">Feature</th>
                  <th className="text-center py-4 px-4 text-white font-medium">Free</th>
                  <th className="text-center py-4 px-4 text-primary font-medium">Pro</th>
                  <th className="text-center py-4 px-4 text-white font-medium">Advanced</th>
                </tr>
              </thead>
              <tbody>
                {comparisonFeatures.map((feature, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-4 px-4 text-foreground-secondary">{feature.name}</td>
                    <td className="text-center py-4 px-4 text-foreground-muted">{feature.free}</td>
                    <td className="text-center py-4 px-4 text-white bg-primary/5">{feature.pro}</td>
                    <td className="text-center py-4 px-4 text-foreground-secondary">{feature.advanced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="max-w-3xl mx-auto">
          <h2 className="font-heading text-2xl tracking-wider text-white text-center mb-8">
            Frequently Asked Questions
          </h2>
          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq, i) => (
              <AccordionItem 
                key={i} 
                value={`item-${i}`}
                className="bg-background-secondary rounded-xl border border-border px-6"
              >
                <AccordionTrigger className="text-white hover:no-underline py-4">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-foreground-secondary pb-4">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </div>
  );
}