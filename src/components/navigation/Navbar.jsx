import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import VoxelLogo from '../VoxelLogo';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LoginModal from '../auth/LoginModal';

const primaryNavItems = [
  { name: 'Explore', path: 'Explore' },
  { name: 'Image', path: 'Image' },
  { name: 'Video', path: 'Video' },
  { name: 'Audio', path: 'Audio' },
  { name: 'Studio', path: 'Studio', badge: 'New' },
  { name: 'Edit', path: 'Edit', badge: 'Coming Soon' },
];

const secondaryNavItems = [
  { name: 'Apps', path: 'Apps' },
  { name: 'Community', path: 'Community' },
  { name: 'Pricing', path: 'Pricing' },
];

export default function Navbar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authModal, setAuthModal] = useState(null); // 'login' | 'signup'

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActive = (path) => {
    const currentPath = location.pathname;
    if (path === 'Explore') return currentPath === '/';
    return currentPath === `/${path.toLowerCase()}`;
  };

  return (
    <>
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'border-b border-border' : ''
      }`}
      style={{
        background: 'rgba(10, 10, 10, 0.92)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to={createPageUrl('Explore')} className="flex-shrink-0">
            <VoxelLogo size="default" />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-1">
            {/* Primary Nav */}
            {primaryNavItems.map((item) => (
              <Link
                key={item.name}
                to={createPageUrl(item.path)}
                className={`relative px-4 py-2 text-sm font-medium transition-colors group ${
                  isActive(item.path) 
                    ? 'text-white' 
                    : 'text-foreground-secondary hover:text-white'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {item.name}
                  {item.badge && (
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-primary text-white rounded-full">
                      {item.badge}
                    </span>
                  )}
                </span>
                {/* Active underline */}
                <span 
                  className={`absolute bottom-0 left-4 right-4 h-0.5 bg-primary transform origin-left transition-transform duration-300 ${
                    isActive(item.path) ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
                  }`}
                />
              </Link>
            ))}

            {/* Divider */}
            <div className="w-px h-6 bg-border mx-2" />

            {/* Secondary Nav */}
            {secondaryNavItems.map((item) => (
              <Link
                key={item.name}
                to={createPageUrl(item.path)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  isActive(item.path) 
                    ? 'text-white' 
                    : 'text-foreground-muted hover:text-foreground-secondary'
                }`}
              >
                {item.name}
              </Link>
            ))}
          </div>

          {/* Auth Buttons */}
          <div className="hidden lg:flex items-center gap-3">
            <Button variant="ghost" className="text-foreground-secondary hover:text-white" onClick={() => setAuthModal('login')}>
              Login
            </Button>
            <Button className="bg-primary hover:bg-primary-hover text-white" onClick={() => setAuthModal('signup')}>
              Sign Up →
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden p-2 text-foreground-secondary hover:text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border">
          <div className="px-4 py-4 space-y-1 bg-background-secondary">
            {primaryNavItems.map((item) => (
              <Link
                key={item.name}
                to={createPageUrl(item.path)}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive(item.path) 
                    ? 'bg-primary/10 text-white border border-primary/20' 
                    : 'text-foreground-secondary hover:bg-muted hover:text-white'
                }`}
              >
                {item.name}
                {item.badge && (
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-primary text-white rounded-full">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
            
            <div className="h-px bg-border my-2" />
            
            {secondaryNavItems.map((item) => (
              <Link
                key={item.name}
                to={createPageUrl(item.path)}
                onClick={() => setMobileOpen(false)}
                className="block px-4 py-3 text-sm font-medium text-foreground-muted hover:text-white transition-colors"
              >
                {item.name}
              </Link>
            ))}
            
            <div className="h-px bg-border my-2" />
            
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 border-border text-white" onClick={() => { setMobileOpen(false); setAuthModal('login'); }}>
                Login
              </Button>
              <Button className="flex-1 bg-primary hover:bg-primary-hover text-white" onClick={() => { setMobileOpen(false); setAuthModal('signup'); }}>
                Sign Up
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>

    {authModal && (
      <LoginModal
        initialMode={authModal}
        onClose={() => setAuthModal(null)}
      />
    )}
    </>
  );
}