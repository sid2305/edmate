// Task 9.4e item 3: the root layout had no test (0% coverage). It is a pure server component --
// no requireRole, no data fetch -- so this inspects the element tree it returns directly rather
// than mounting it into jsdom's document (which already has its own html/body).
import { describe, expect, it } from 'vitest';
import RootLayout, { metadata, viewport } from './layout';

describe('metadata and viewport', () => {
  it('sets the page title and description', () => {
    expect(metadata.title).toBe('Edmate');
    expect(metadata.description).toBeTruthy();
  });

  it('uses the standard device-width viewport, no pinch-zoom lockout (task 9.1)', () => {
    expect(viewport).toEqual({ width: 'device-width', initialScale: 1 });
  });
});

describe('RootLayout', () => {
  it('wraps its children in html[lang=en] > body', () => {
    const element = RootLayout({ children: 'hello' });
    expect(element.props.lang).toBe('en');
    const body = element.props.children;
    expect(body.type).toBe('body');
    expect(body.props.children).toBe('hello');
  });
});
