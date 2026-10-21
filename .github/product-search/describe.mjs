// Product Search: the product description from a Screwfix product page, as jina's text read gives it (the same read
// the collector already makes for the name and age check, so no extra requests).
//
// On the page the description sits straight under the heading "# <name>(<CODE>)", after the star rating "(5209)" and
// "Ask a Question": a paragraph or two, then the features as "*   " bullets, ending at the "More Info" link to
// #product_additional_details_container. Age restricted products have the Challenge 25 sentence first (left out
// here: the page shows an "Age restricted" badge for that). Checked on real pages, 21 Oct 2026: 16497, 123XR, 10048.
//
// describe(text, code) -> {t: 'paragraphs, blank line between', b: ['bullet', ...]} | null (no description found)

const MAX_TEXT = 2000;      // characters of paragraph text kept
const MAX_BULLETS = 25;
const MAX_BULLET = 200;     // characters per bullet

const AGE_LINE = /challenge[\s-]*25|proof\s+of\s+age|\b18\s*years?\s*old\s*or\s*over/i;

// [text](url) -> text, images dropped, **bold** / _italic_ / `code` marks dropped, spaces tidied
function plain(s) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/\(Opens in new tab\.?\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function describe(text, code) {
  if (!text || !code) return null;
  const esc = String(code).replace(/[^A-Za-z0-9]/g, '');
  const head = new RegExp('^#\\s+.*\\(\\s*' + esc + '\\s*\\)\\s*$', 'im').exec(text);
  if (!head) return null;
  const from = head.index + head[0].length;
  const end = text.indexOf('#product_additional_details_container', from);
  if (end < 0 || end - from > 20000) return null;
  // up to the start of the "More Info" line
  const block = text.slice(from, text.lastIndexOf('\n', end) + 1 || end);

  const paras = [], bullets = [];
  let para = [];
  const endPara = () => { if (para.length) { paras.push(para.join(' ')); para = []; } };
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) { endPara(); continue; }
    if (/^\(\d[\d,]*\)$/.test(line)) continue;                        // the number of reviews
    if (/^ask a question$/i.test(line)) continue;
    if (/^\[?!\[/.test(line)) continue;                                // a picture, or a picture link (green star badge)
    if (/^#/.test(line)) { endPara(); continue; }                      // another heading: not description
    const bullet = /^[*\-•]\s+(.*)$/.exec(line);
    if (bullet) {
      endPara();
      const b = plain(bullet[1]);
      if (b && bullets.length < MAX_BULLETS) bullets.push(b.slice(0, MAX_BULLET));
      continue;
    }
    if (AGE_LINE.test(line)) { endPara(); continue; }
    const p = plain(line);
    if (p) para.push(p);
  }
  endPara();

  let t = paras.filter((p) => p.length > 1).join('\n\n');
  if (t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT).replace(/\s+\S*$/, '') + '...';
  if (!t && !bullets.length) return null;
  return { t, b: bullets };
}
