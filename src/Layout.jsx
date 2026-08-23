import React from 'react';
import Navbar from './components/navigation/Navbar';
import Footer from './components/navigation/Footer';
import ChatWidget from './components/common/ChatWidget';
import { Toaster } from '@/components/ui/sonner';
import { Plus } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const STUDIO_PAGE = '/studio';
const MINIMAL_FOOTER_PAGES = ['/image', '/video', '/edit', '/apps'];
// Pages that hide the global footer entirely (and the ChatWidget that
// lives inside it). Studio runs without any chrome at all; Audio keeps
// the navbar but drops the footer so the Voice Canvas takes the full
// remaining viewport — otherwise the Synthesize button gets pushed
// below the fold and users can't reach it.
// /timelinepreview is Voxel Edit Cut. Same reason as Audio, more sharply: a
// video editor fills the viewport and each panel scrolls inside itself. With
// the footer present the PAGE scrolled, which put the timeline — the one part
// you cannot work without — below the fold.
const NO_FOOTER_PAGES = ['/audio', '/timelinepreview'];

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const path = location.pathname.toLowerCase();
  const isMinimal = MINIMAL_FOOTER_PAGES.includes(path);
  const hideFooter = NO_FOOTER_PAGES.includes(path);

  const isStudio = path === STUDIO_PAGE;

  if (isStudio) {
    return (
      <>
        {children}
        <Toaster position="bottom-right" />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Keyboard users can jump past the navbar; visually hidden until focused */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-md"
      >
        Skip to main content
      </a>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="pt-16" style={(isMinimal || hideFooter) ? { height: 'calc(100vh - 0px)', overflow: 'hidden' } : {}}>
        {children}
      </main>
      {/* Tool pages (image/video/edit/apps) drop the footer black bar entirely
          but keep the floating chat bubble; everything else gets the full footer. */}
      {!hideFooter && (isMinimal ? <ChatWidget /> : <Footer />)}
      <Toaster position="bottom-right" />
      
      {/* Mobile Floating Create Button — hidden on Studio */}
      <Link
        to={createPageUrl('Image')}
        className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-semibold rounded-full shadow-lg border-glow-red transition-all"
      >
        <Plus size={20} />
        Create
      </Link>
    </div>
  );
}