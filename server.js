require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const APP_SECRET = process.env.APP_SECRET || '';

if (!GEMINI_API_KEY) {
  console.warn('WARNUNG: GEMINI_API_KEY ist nicht gesetzt. Die Route /api/claude wird fehlschlagen, bis du sie in der .env Datei eintraegst.');
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

// Proxy zu Google Gemini (kostenlose Stufe): haelt den API-Key serverseitig.
app.post('/api/claude', checkAppSecret, async (req, res) => {
  try {
    const { system, prompt, maxTokens } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'Feld "prompt" fehlt.' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server ist nicht konfiguriert: GEMINI_API_KEY fehlt in der .env Datei.' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: {
          maxOutputTokens: Math.min(Number(maxTokens) || 1000, 4000)
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const message = (data && data.error && data.error.message) || 'Gemini API Fehler.';
      return res.status(response.status).json({ error: message });
    }

    const candidate = data.candidates && data.candidates[0];
    const text = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map((p) => p.text || '').join('\n').trim()
      : '';

    if (!text) {
      return res.status(502).json({ error: 'Gemini hat keinen Text zurueckgegeben (moeglicherweise durch einen Sicherheitsfilter blockiert oder Tageslimit erreicht).' });
    }

    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Interner Serverfehler: ' + err.message });
  }
});

// Server-seitiger Abruf von Stellenausschreibungen - umgeht CORS-Probleme im Browser.
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

// Fallback: alles, was keine API-Route ist, bekommt die App-Seite ausgeliefert.
// Das verhindert "Cannot GET /" in serverless Umgebungen wie Vercel.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`JobMatch AI Backend laeuft auf http://localhost:${PORT}`);
});

module.exports = app;
