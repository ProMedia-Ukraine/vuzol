/* Progressive enhancement for the existing Instagram feed.
 * Runs on the public site, never uses an access token.
 */
(() => {
  'use strict';
  const feedUrl = new URL('assets/instagram-feed.json', document.baseURI).href;
  const clean = (url) => {
    try {
      const parsed = new URL(url, location.href);
      return /(^|\.)instagram\.com$/i.test(parsed.hostname)
        ? parsed.pathname.replace(/\/$/, '').toLowerCase() : '';
    } catch (_) { return ''; }
  };
  const preview = (post) => {
    return post.media_type === 'VIDEO'
      ? (post.thumbnail_url || post.media_url)
      : (post.media_url || post.thumbnail_url);
  };
  const normalize = (caption) => String(caption || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  const trimAtWord = (value, limit) => {
    if (value.length <= limit) return value;
    const part = value.slice(0, limit + 1);
    const space = part.lastIndexOf(' ');
    return (space > limit * .55 ? part.slice(0, space) : part.slice(0, limit)).trim();
  };
  const titleAndSummary = (caption) => {
    const raw = String(caption || '').replace(/\r/g, '').trim();
    const lines = raw.split(/\n+/).map(normalize).filter(Boolean);
    const full = normalize(raw);
    if (!full) return {title: 'Матеріал VUZOL', summary: 'Переглянути публікацію в Instagram'};
    let lead = lines[0] || full;
    if (lead.length > 85) {
      const sentence = lead.match(/^.{15,85}?[.!?…](?=\s|$)/u);
      if (sentence) lead = sentence[0];
    }
    const title = trimAtWord(lead, 85);
    const remainder = full.startsWith(title)
      ? full.slice(title.length).trim().replace(/^[.!?…,:;\s–—-]+/u, '')
      : full;
    return {title, summary: trimAtWord(remainder, 190)};
  };

  async function start() {
    let response;
    try {
      response = await fetch(feedUrl, {cache: 'no-cache'});
      if (!response.ok) return;
    } catch (_) { return; }
    let feed;
    try { feed = await response.json(); } catch (_) { return; }
    if (!Array.isArray(feed) || !feed.length) return;
    const posts = new Map(feed.filter(p => p && p.permalink).map(p => [clean(p.permalink), p]));

    const enhance = () => {
      document.querySelectorAll('a[href*="instagram.com/"]').forEach(anchor => {
        if (anchor.dataset.vuzolInstagramCard === 'true') return;
        const post = posts.get(clean(anchor.href));
        if (!post) return;
        const imageUrl = preview(post);
        if (!imageUrl) return;
        // Only transform visual cards, never ordinary text links to the same post.
        if (!anchor.querySelector('img, picture, svg, video')) return;

        const image = document.createElement('img');
        image.className = 'vuzol-ig-image';
        image.src = imageUrl;
        image.alt = normalize(post.caption).slice(0, 160) || 'Публікація VUZOL в Instagram';
        image.loading = 'lazy';
        image.decoding = 'async';

        const {title, summary} = titleAndSummary(post.caption);
        const copy = document.createElement('div');
        copy.className = 'vuzol-ig-copy';
        const heading = document.createElement('h3');
        heading.className = 'vuzol-ig-title';
        heading.textContent = title;
        copy.appendChild(heading);
        if (summary) {
          const description = document.createElement('p');
          description.className = 'vuzol-ig-description';
          description.textContent = summary;
          copy.appendChild(description);
        }

        const children = [image, copy];
        if (post.media_type === 'VIDEO') {
          const badge = document.createElement('span');
          badge.className = 'vuzol-ig-video-badge';
          badge.setAttribute('aria-hidden', 'true');
          badge.textContent = '▶';
          children.push(badge);
        }

        anchor.replaceChildren(...children);
        anchor.dataset.vuzolInstagramCard = 'true';
        anchor.removeAttribute('style');
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
        anchor.setAttribute('aria-label', 'Відкрити публікацію VUZOL в Instagram');
      });
    };
    enhance();
    const observer = new MutationObserver(() => enhance());
    observer.observe(document.body, {subtree: true, childList: true});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {once: true});
  } else start();
})();
