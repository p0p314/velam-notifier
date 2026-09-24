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
app.set('trust proxy', 1); // derrière le proxy Render → vraie IP client (rate-limit)

// En-têtes de sécurité. CSP adaptée au SPA : JS/CSS bundlés en 'self', styles
// inline React tolérés, polices Google, API + worker same-origin.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      // Mapbox GL crée ses web workers depuis un blob → 'blob:' requis.
      scriptSrc:      ["'self'", "blob:"],
      styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:        ["'self'", "https://fonts.gstatic.com"],
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
