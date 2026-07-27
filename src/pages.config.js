/**
 * pages.config.js - Page routing configuration
 *
 * Pages are registered here and routed automatically in App.jsx as `/${key}`
 * (React Router matches case-insensitively, so "About" serves /about).
 *
 * THE ONLY OTHER EDITABLE VALUE: mainPage — controls which page is the
 * landing page (shown when users visit "/"). It must match a key in PAGES.
 *
 * All pages are lazy-loaded (React.lazy + dynamic import) so Vite splits
 * each route into its own chunk instead of one ~1MB bundle. App.jsx wraps
 * the routes in <Suspense>. mainPage's chunk is fetched immediately on
 * load; the rest fetch on navigation.
 */
import { lazy } from 'react';

const Apps = lazy(() => import('./pages/Apps'));
const Audio = lazy(() => import('./pages/Audio'));
const Community = lazy(() => import('./pages/Community'));
const Edit = lazy(() => import('./pages/Edit'));
const Explore = lazy(() => import('./pages/Explore'));
const Image = lazy(() => import('./pages/Image'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Studio = lazy(() => import('./pages/Studio'));
const Templates = lazy(() => import('./pages/Templates'));
const Video = lazy(() => import('./pages/Video'));
const Account = lazy(() => import('./pages/Account'));
const About = lazy(() => import('./pages/About'));
const Contact = lazy(() => import('./pages/Contact'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
import __Layout from './Layout.jsx';


export const PAGES = {
    "Apps": Apps,
    "Audio": Audio,
    "Community": Community,
    "Edit": Edit,
    "Explore": Explore,
    "Image": Image,
    "Pricing": Pricing,
    "Studio": Studio,
    "Templates": Templates,
    "Video": Video,
    "Account": Account,
    "About": About,
    "Contact": Contact,
    "Privacy": Privacy,
    "Terms": Terms,
}

export const pagesConfig = {
    mainPage: "Explore",
    Pages: PAGES,
    Layout: __Layout,
};
