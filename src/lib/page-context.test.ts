import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractPageContext, MAX_PAGE_TEXT_CHARS } from './page-context';

function makeDocument(html: string, url = 'https://example.com/post') {
  return new JSDOM(`<!doctype html><html>${html}</html>`, { url }).window.document;
}

const paragraph = (n: number) =>
  `<p>Paragraph ${n}: an eigenvector of a linear transformation is a nonzero vector that changes at most by a scalar factor when that transformation is applied to it, and the factor is its eigenvalue.</p>`;

const ARTICLE = `
  <head><title>Understanding Eigenvalues | Math Blog</title></head>
  <body>
    <nav><a href="/">Home</a> <a href="/blog">Blog</a> <a href="/about">About us</a></nav>
    <aside class="sidebar">Subscribe to our newsletter for weekly deals!</aside>
    <article>
      <h1>Understanding Eigenvalues</h1>
      ${Array.from({ length: 8 }, (_, i) => paragraph(i + 1)).join('\n')}
    </article>
    <footer>Copyright 2026 Math Blog. All rights reserved.</footer>
    <script>window.secret = "do not include";</script>
  </body>`;

describe('extractPageContext', () => {
  it('extracts the main text of an article page with its title and URL', () => {
    const doc = makeDocument(ARTICLE, 'https://example.com/eigen');
    const context = extractPageContext(doc);
    expect(context.title).toBe('Understanding Eigenvalues | Math Blog');
    expect(context.url).toBe('https://example.com/eigen');
    expect(context.text).toContain('Paragraph 1: an eigenvector');
    expect(context.text).toContain('Paragraph 8:');
    expect(context.text).not.toContain('newsletter');
    expect(context.text).not.toContain('do not include');
    expect(context.truncated).toBe(false);
  });

  it('does not change the page it reads', () => {
    const doc = makeDocument(ARTICLE);
    const before = doc.documentElement.outerHTML;
    extractPageContext(doc);
    expect(doc.documentElement.outerHTML).toBe(before);
  });

  it("falls back to the page's visible text when Readability cannot parse it", () => {
    const doc = makeDocument(`
      <head><title>Dashboard</title></head>
      <body>
        <div><span>Revenue</span> <span>$1.2M</span></div>
        <div><span>Churn</span> <span>3.1%</span></div>
        <div hidden>Hidden admin note</div>
        <div style="display: none">Collapsed menu item</div>
        <div aria-hidden="true">Decorative label</div>
        <style>.x { color: red }</style>
        <noscript>Enable JavaScript</noscript>
        <iframe srcdoc="<p>Embedded frame text</p>"></iframe>
      </body>`);
    const context = extractPageContext(doc);
    expect(context.title).toBe('Dashboard');
    expect(context.text).toContain('Revenue');
    expect(context.text).toContain('$1.2M');
    expect(context.text).toContain('Churn');
    expect(context.text).not.toContain('Hidden admin note');
    expect(context.text).not.toContain('Collapsed menu item');
    expect(context.text).not.toContain('Decorative label');
    expect(context.text).not.toContain('color: red');
    expect(context.text).not.toContain('Enable JavaScript');
    expect(context.text).not.toContain('Embedded frame text');
  });

  it('separates block-level text with line breaks in the fallback', () => {
    const doc = makeDocument(`<body><div>First line</div><div>Second line</div><span>same</span> <span>line</span></body>`);
    const { text } = extractPageContext(doc);
    expect(text).toMatch(/First line\s*\n\s*Second line/);
    expect(text).toContain('same line');
  });

  it('caps a long page and says it was truncated', () => {
    const doc = makeDocument(`
      <head><title>Long read</title></head>
      <body><article><h1>Long read</h1>${Array.from({ length: 400 }, (_, i) => paragraph(i)).join('')}</article></body>`);
    const context = extractPageContext(doc);
    expect(context.truncated).toBe(true);
    expect(context.text.length).toBeLessThanOrEqual(MAX_PAGE_TEXT_CHARS);
    expect(context.text.length).toBeGreaterThan(MAX_PAGE_TEXT_CHARS * 0.9);
    expect(context.text).toContain('Paragraph 0:');
  });

  it('handles a page with almost no text', () => {
    const doc = makeDocument(`<head><title>Video</title></head><body><video src="v.mp4"></video><p>Hi</p></body>`);
    const context = extractPageContext(doc);
    expect(context).toEqual({ title: 'Video', url: 'https://example.com/post', text: 'Hi', truncated: false });
  });

  it('handles a page with no title or text at all', () => {
    const doc = makeDocument(`<body></body>`);
    expect(extractPageContext(doc)).toEqual({ title: '', url: 'https://example.com/post', text: '', truncated: false });
  });
});
