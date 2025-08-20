// netlify/functions/parse.js
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

function absolutify(html, baseUrl) {
    const { window } = new JSDOM(`<!doctype html><body>${html}</body>`);
    const { document } = window;

    document.querySelectorAll('[src]').forEach((el) => {
        const src = el.getAttribute('src');
        if (!src) return;
        try { el.setAttribute('src', new URL(src, baseUrl).href); } catch (_) {}
    });

    document.querySelectorAll('img[srcset], source[srcset]').forEach((el) => {
        const srcset = el.getAttribute('srcset');
        if (!srcset) return;
        try {
            const abs = srcset
                .split(',')
                .map((part) => {
                    const [url, size] = part.trim().split(/\s+/);
                    const absUrl = new URL(url, baseUrl).href;
                    return size ? `${absUrl} ${size}` : absUrl;
                })
                .join(', ');
            el.setAttribute('srcset', abs);
        } catch (_) {}
    });

    document.querySelectorAll('[href]').forEach((el) => {
        const href = el.getAttribute('href');
        if (!href) return;
        try { el.setAttribute('href', new URL(href, baseUrl).href); } catch (_) {}
    });

    return document.body.innerHTML;
}

export async function handler(event) {
    const url = new URL(event.rawUrl);
    const targetUrl = url.searchParams.get('url');

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (!targetUrl) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Parâmetro ?url é obrigatório' }) };
    }

    try {
        const resp = await fetch(targetUrl, {
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
            }
        });

        if (!resp.ok) {
            return { statusCode: resp.status, headers: corsHeaders, body: JSON.stringify({ error: `Falha ao buscar URL (${resp.status})` }) };
        }

        const html = await resp.text();
        const dom = new JSDOM(html, { url: targetUrl });

        const reader = new Readability(dom.window.document, { charThreshold: 500 });
        let article = reader.parse();

        if (!article) {
            const doc = dom.window.document;
            const main = doc.querySelector('article, main, [role="main"]') || doc.body;
            article = {
                title: doc.title || targetUrl,
                byline: '',
                dir: 'ltr',
                content: main ? main.innerHTML : doc.body.innerHTML,
                textContent: main ? main.textContent : doc.body.textContent,
                length: (main ? main.textContent : doc.body.textContent || '').length,
                excerpt: '',
                siteName: new URL(targetUrl).hostname,
            };
        }

        const cleanHTML = absolutify(article.content || '', targetUrl);

        const body = JSON.stringify({
            url: targetUrl,
            title: article.title || dom.window.document.title || targetUrl,
            byline: article.byline || '',
            excerpt: article.excerpt || '',
            length: article.length || (article.textContent || '').length,
            siteName: article.siteName || new URL(targetUrl).hostname,
            content: cleanHTML,
        });

        return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body };
    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Erro interno ao processar a página.' }) };
    }
}
