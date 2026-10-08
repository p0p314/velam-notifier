// Construction de l'app Express (sécurité, montage des routers, service du build
// SPA en prod), sans démarrage : importable telle quelle par les tests d'intégration.
// Les routes vivent dans routes/ (un router par domaine) ; le boot est dans server.js.
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const path    = require('path');
const fs      = require('fs');
// Origine(s) du frontend autorisée(s) en dev (CORS). En prod, front et back
// partagent le même domaine → pas de CORS. Surcharge via CORS_ORIGIN.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://192.168.1.110:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
// Nombre de proxys devant l'app (Render) : Express lit l'IP du client à cette position depuis la
// droite de X-Forwarded-For. Trop bas : tous les clients partagent l'IP du proxy (et donc les
// limites de tentatives) ; trop haut : un client pourrait forger son IP. TRUST_PROXY (défaut 1),
// à régler d'après le diagnostic journalisé ci-dessous.
const TRUST_PROXY = /^\d+$/.test(process.env.TRUST_PROXY ?? '') ? Number(process.env.TRUST_PROXY) : 1;
app.set('trust proxy', TRUST_PROXY);

// Diagnostic, une fois par démarrage en production et sans aucune adresse : combien de proxys
// ont ajouté une entrée à X-Forwarded-For (= la bonne valeur de TRUST_PROXY sur une requête
// normale), et quels en-têtes d'IP client le fournisseur ajoute.
let proxyChecked = false;
app.use('/api', (req, res, next) => {
  if (!proxyChecked && process.env.NODE_ENV === 'production') {
    proxyChecked = true;
    const entries = String(req.headers['x-forwarded-for'] ?? '').split(',').filter((s) => s.trim()).length;
    const extra = ['cf-connecting-ip', 'true-client-ip', 'x-real-ip'].filter((h) => req.headers[h]);
    console.log(`[proxy] X-Forwarded-For : ${entries} entrée(s) ; trust proxy = ${TRUST_PROXY}${extra.length ? ` ; en-têtes : ${extra.join(', ')}` : ''}`);
  }
  next();
});

// En-têtes de sécurité. CSP adaptée au SPA : JS/CSS bundlés en 'self', styles
// inline React tolérés, polices Google, API + worker same-origin.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      // Mapbox GL crée ses web workers depuis un blob → 'blob:' requis.
      scriptSrc:      ["'self'", "blob:"],
      // Polices auto-hébergées (@fontsource) : plus aucune origine Google.
      styleSrc:       ["'self'", "'unsafe-inline'"],
      fontSrc:        ["'self'"],
      imgSrc:         ["'self'", "data:", "blob:"],
      connectSrc:     ["'self'", "https://api.mapbox.com", "https://events.mapbox.com", "https://*.tiles.mapbox.com"],
      manifestSrc:    ["'self'"],
      workerSrc:      ["'self'", "blob:"],
      childSrc:       ["'self'", "blob:"],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// CORS : whitelist explicite. En prod le domaine public, en dev localhost/LAN.
const corsOptions = process.env.NODE_ENV === 'production'
  ? { origin: process.env.FRONTEND_URL || 'https://velam-notifier.onrender.com' }
  : { origin: ALLOWED_ORIGINS };
app.use(cors(corsOptions));

app.use(express.json({ limit: '16kb' })); // borne la taille des corps (anti-DoS)

// ── Routes (un router par domaine, chemins complets définis dans chaque module) ──
app.use(require('./routes/health'));
app.use(require('./routes/stations'));
app.use(require('./routes/rentalApps'));
app.use(require('./routes/auth'));
app.use(require('./routes/favorites'));
app.use(require('./routes/push'));
app.use(require('./routes/alerts'));
app.use(require('./routes/trains'));

// ── Production : sert le build Vite (SPA) après toutes les routes /api ───────────

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, 'frontend', 'dist');
  // Garde-fou : alerte uniquement si le build frontend est absent.
  if (!fs.existsSync(distPath)) console.error('[server] build frontend introuvable à :', distPath);
  app.use(express.static(distPath));
  // Fallback SPA : toute route non-API renvoie index.html.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

module.exports = { app, ALLOWED_ORIGINS };
