// Vitest global setup — adds @testing-library/jest-dom matchers and ensures
// React Testing Library unmounts between tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
