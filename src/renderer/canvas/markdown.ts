import { Marked, type Tokens } from 'marked'

/**
 * Markdown for text cards, rendered safely.
 *
 * What a card says is the user's own, but it is still written into the DOM of
 * a window that holds the whole vault, so three things are turned off rather
 * than trusted:
 *
 *   • Raw HTML is shown as the text it is. A `<img onerror>` in a card is a
 *     script, whoever typed it.
 *   • Images render as their alt text. Nexus makes no network calls it was not
 *     asked to, and `![](https://…)` in a card would be one on every redraw.
 *   • Links open outside the app, and only http(s) and mailto are links at all.
 *     A plain click on an anchor would navigate the window away from Nexus.
 *
 * `[[Title]]` and `[[Title|text]]` become page links, resolved by title when
 * clicked — see `CanvasTextNode`.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SAFE_HREF = /^(https?:|mailto:)/i

interface WikiLinkToken extends Tokens.Generic {
  type: 'wikilink'
  raw: string
  title: string
  label: string
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start: (src: string) => {
        const index = src.indexOf('[[')
        return index < 0 ? undefined : index
      },
      tokenizer(src: string): WikiLinkToken | undefined {
        const match = /^\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*))?\]\]/.exec(src)
        if (!match) return undefined
        const title = match[1].trim()
        return { type: 'wikilink', raw: match[0], title, label: (match[2] ?? '').trim() || title }
      },
      renderer(token) {
        const t = token as WikiLinkToken
        return `<a class="nx-md__wikilink" data-title="${escapeHtml(t.title)}">${escapeHtml(t.label)}</a>`
      }
    }
  ],
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    image({ text }) {
      return escapeHtml(text)
    },
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens)
      if (!SAFE_HREF.test(href)) return inner
      return `<a class="nx-md__link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${inner}</a>`
    }
  }
})

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string
}
