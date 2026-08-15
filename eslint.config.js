import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  // ─── server ────────────────────────────────────────────────────────────
  // server/ was linted by NOTHING until 2026-08-16. A missing import in
  // costing-sync.js passed `node --check` (syntax is fine) and passed the test
  // suite (the function was not called), and would have thrown ReferenceError
  // the first time the nightly sync ran — at midnight, unattended.
  //
  // This is the third time an unlinted server file has hidden a real fault:
  // the db.js template literal that crashed production on boot, and the
  // undefined variables in the CRM before no-undef was switched on. The rule
  // that matters here is no-undef; the rest is noise on a 5,900-line file.
  {
    files: ["server/src/**/*.js"],
    languageOptions: {
      globals: globals.node,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    rules: {
      "no-undef": "error",
    },
  },
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
    ],
    ignores: ["src/lib/**/*", "src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      // Spreading pluginJs.configs.recommended above sets a `rules` object,
      // but the explicit `rules` block here REPLACES it wholesale — so
      // no-undef was silently absent. It is the one rule that catches a
      // variable used in JSX but never declared, which renders as a blank
      // screen at runtime and which neither `npm run build` nor the test
      // suite detects. Turned on explicitly after exactly that bug reached
      // the Gift Cards tab on 2026-08-07.
      "no-undef": "error",
      // no-undef does NOT check JSX ELEMENT names — `<Foo/>` with no import of
      // Foo passes it cleanly. That is a blank screen at runtime, and it is
      // exactly how a missing CrmThemeProvider import survived lint, 845
      // passing tests and a production build on 2026-08-07. This rule is the
      // one that catches it.
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    // Test files run under Vitest/node, so `global`, `process` and friends are
    // legitimately defined there. Without this, no-undef flags them and the
    // rule gets turned off again — which is how it went missing in the first
    // place.
    files: ["**/*.test.{js,jsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
