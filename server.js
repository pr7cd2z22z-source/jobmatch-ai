require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const APP_SECRET = process.env.APP_SECRET || '';

if (!ANTHROPIC_API_KEY) {
  console.warn('WARNUNG: ANTHROPIC_API_KEY ist nicht gesetzt. Die Route /api/claude wird fehlschlagen, bis du sie in der .env Datei eintraegst.');
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function checkAppSecret(req, res, next) {
  if (!APP_SECRET) return next();
  const provided = req.header('x-app-secret');
  if (provided !== APP_SECRET) {
    return res.status(401).json({ error: 'Ungueltiger oder fehlender x-app-secret Header.' });
  }
  next();
}

app.post('/api/claude', checkAppSecret, async (req, res) => {
  try {
    const { system, prompt, maxTokens } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'Feld "prompt" fehlt.' });
    }
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Server ist nicht konfiguriert: ANTHROPIC_API_KEY fehlt in der .env Datei.' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: Math.min(Number(maxTokens) || 1000, 4000),
        system: system || undefined,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const message = (data && data.error && data.error.message) || 'Anthropic API Fehler.';
      return res.status(response.status).json({ error: message });
    }

    const text = (data.content || [])
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();

    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Interner Serverfehler: ' + err.message });
  }
});

app.post('/api/fetch-url', checkAppSecret, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'Feld "url" fehlt.' });
    }

    let target;
    try {
      target = new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Ungueltige URL.' });
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return res.status(400).json({ error: 'Nur http/https URLs sind erlaubt.' });
    }

    const response = await fetch(target.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobMatchAI/1.0)' }
    });
    if (!response.ok) {
      return res.status(502).json({ error: `Zielseite antwortete mit Status ${response.status}.` });
    }

    const html = await response.text();
    const text = htmlToText(html);
    if (text.length < 50) {
      return res.status(422).json({ error: 'Konnte keinen sinnvollen Text extrahieren (evtl. JavaScript-basierte Seite).' });
    }
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Abruf fehlgeschlagen: ' + err.message });
  }
});

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

app.listen(PORT, () => {
  console.log(`JobMatch AI Backend laeuft auf http://localhost:${PORT}`);
});
