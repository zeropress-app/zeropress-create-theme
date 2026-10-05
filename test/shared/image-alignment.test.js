import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scopes = { minimal: 'prose', blog: 'article-content', magazine: 'prose-editorial', docs: 'prose', portfolio: 'prose' };

for (const [template, scope] of Object.entries(scopes)) {
  test(`${template} starter presents WordPress-compatible image alignment`, async () => {
    const css = await fs.readFile(
      path.join(packageRoot, 'src', 'templates', template, 'theme', 'assets', 'style.css'),
      'utf8',
    );
    const dom = new JSDOM(`<style>${css}</style><article class="${scope}">
      <img class="alignleft" alt="Left"><img class="aligncenter" alt="Center"><img class="alignright" alt="Right">
    </article>`);
    const { document } = dom.window;
    const style = (alignment) => dom.window.getComputedStyle(document.querySelector(`.align${alignment}`));
    try {
      assert.equal(style('left').float, 'left');
      assert.equal(style('right').float, 'right');
      assert.equal(style('center').float, 'none');
      assert.equal(style('center').marginLeft, 'auto');
      assert.equal(style('center').marginRight, 'auto');

      // JSDOM does not evaluate viewport media queries. Apply the mobile rules
      // through CSSOM so selector matching and the cascade still govern the result.
      const mobileRules = [...document.styleSheets[0].cssRules].filter(
        (rule) => rule instanceof dom.window.CSSMediaRule && /^\(max-width:\s*640px\)$/u.test(rule.conditionText),
      );
      assert.ok(mobileRules.length > 0);
      const mobileStyle = document.createElement('style');
      mobileStyle.textContent = mobileRules.flatMap((rule) => [...rule.cssRules].map((child) => child.cssText)).join('\n');
      document.head.append(mobileStyle);
      for (const alignment of ['left', 'center', 'right']) {
        assert.equal(style(alignment).float, 'none', alignment);
        assert.equal(style(alignment).marginLeft, 'auto', alignment);
        assert.equal(style(alignment).marginRight, 'auto', alignment);
      }
    } finally {
      dom.window.close();
    }
  });
}
