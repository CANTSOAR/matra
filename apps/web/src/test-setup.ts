import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest runs without `globals`, so RTL can't register its automatic cleanup — do it here.
afterEach(() => cleanup());
