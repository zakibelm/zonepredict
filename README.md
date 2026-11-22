# ZonePredict — Dashboard permanent

Une application Web persistante à déployer sur le VPS, avec récupération de DataTaxi DB toutes les **5 minutes** et création d'un snapshot de prévision immuable **à :50**, fuseau **America/Toronto**.

**Commencer par [IMPLEMENTATION.md](IMPLEMENTATION.md)** : contrat API, architecture, règles métier, instructions Docker/Nginx, critères de validation et limites.

## Démarrage rapide

```bash
cp .env.example .env
# Configurer un jeton READ-ONLY renouvelé dans .env (jamais dans le frontend).
chmod 600 .env
docker compose up -d --build
# Initialisation historique après validation du schéma / de l'API :
docker compose run --rm zonepredict-dashboard python -m app.cli backfill --start 2026-09-01
```

Ouvrir sur le VPS `http://127.0.0.1:8199/` (puis HTTPS derrière Nginx avec authentification). Les vues Web et API sont en **lecture seule**. Le dashboard ne modifie jamais la base dispatch source.

Statut : **prototype déployable**, non déployé / non connecté sur le VPS dans cette livraison.

## Front sur Vercel + API sur le VPS

Le dashboard statique (`app/static`) se déploie sur Vercel ; la fonction `api/[...path].js` relaie **en lecture seule** `/api/*` vers le backend du VPS.

Variables Vercel (Project → Settings → Environment Variables) :

| Variable | Valeur |
|---|---|
| `ZONEPREDICT_BACKEND_URL` | URL HTTPS du backend, ex. `https://zonepredict.votre-domaine.tld` (sans `/` final) |
| `ZONEPREDICT_PROXY_KEY` | Même clé que dans le `.env` du VPS (≥ 24 caractères, `openssl rand -hex 32`) |

Tant que ces variables sont absentes, la page répond « Backend non configuré » : aucune donnée n'est inventée. Activer **Vercel Authentication** sur le projet (accès privé). Le jeton DataTaxi reste uniquement dans le `.env` du VPS.
