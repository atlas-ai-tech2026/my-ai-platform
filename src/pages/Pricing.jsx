import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CheckCircle2, Gift, Star, Crown, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const plans = [
  {
    name: 'Free',
    icon: Gift,
    monthlyPrice: 0,
    annualPrice: 0,
    credits: '50 credits/month',
    features: [
      '3–4 images per day',
      'Watermark on exports',
      'Access to basic models',
      'Community access',
    ],
    cta: 'Start Free',
    popular: false,
    highlighted: false,
  },
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
];

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