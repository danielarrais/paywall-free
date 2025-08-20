// server.js
// Servidor que busca páginas externas, extrai o conteúdo “legível” (estilo Reader Mode)
// e serve a UI estática em / (pasta public)

import express from 'express';
import {JSDOM} from 'jsdom';
import {Readability} from '@mozilla/readability';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public', {extensions: ['html']}));

// Utilitário: transforma src/href relativos em absolutos, com base na URL da página original
function absolutify(html, baseUrl) {
    const {window} = new JSDOM(`<!doctype html><body>${html}</body>`);
    const {document} = window;

    // src (img, source, video, audio, iframe)
    document.querySelectorAll('[src]').forEach((el) => {
        const src = el.getAttribute('src');
        if (!src) return;
        try {
            el.setAttribute('src', new URL(src, baseUrl).href);
        } catch (_) {
        }
    });

    // srcset (imagens responsivas)
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
        } catch (_) {
        }
    });

    // href (links, folhas de estilo — embora estilos não sejam usados no conteúdo lido)
    document.querySelectorAll('[href]').forEach((el) => {
        const href = el.getAttribute('href');
        if (!href) return;
        try {
            el.setAttribute('href', new URL(href, baseUrl).href);
        } catch (_) {
        }
    });

    return document.body.innerHTML;
}

app.get('/api/parse', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({error: 'Parâmetro ?url é obrigatório'});
    }

    try {
        const resp = await fetch(targetUrl, {
            redirect: 'follow',
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
            }
        });

        if (!resp.ok) {
            return res.status(resp.status).json({
                error: `Falha ao buscar URL (${resp.status})`,
            });
        }

        const html = await resp.text();

        // Cria DOM baseado na página original (URL é importante para resolver relativos)
        const dom = new JSDOM(html, {url: targetUrl});

        // Executa Readability
        const reader = new Readability(dom.window.document, {
            charThreshold: 500, // mínimo de caracteres para considerar bloco
        });

        let article = reader.parse();

        // Fallback simples caso Readability não encontre um artigo
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

        // Normaliza URLs do conteúdo extraído
        const cleanHTML = absolutify(article.content || '', targetUrl);

        res.set('Access-Control-Allow-Origin', '*');
        return res.json({
            url: targetUrl,
            title: article.title || dom.window.document.title || targetUrl,
            byline: article.byline || '',
            excerpt: article.excerpt || '',
            length: article.length || (article.textContent || '').length,
            siteName: article.siteName || new URL(targetUrl).hostname,
            content: cleanHTML,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({error: 'Erro interno ao processar a página.'});
    }
});

app.listen(PORT, () => {
    console.log(`▶ Reader server rodando em http://localhost:${PORT}`);
});
