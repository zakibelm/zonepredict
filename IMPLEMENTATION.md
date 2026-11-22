# ZonePredict — Dashboard permanent, plan et contrat d'exécution

**Version** : v1.0 / socle d'intégration préparé le 22 novembre 2026  
**Statut** : **code prêt à tester, NON DÉPLOYÉ, NON CONNECTÉ À L'API RÉELLE**  
**Périmètre** : projet ZonePredict uniquement. Ne modifie ni la tablette, ni la base SQLite du dispatch, ni les autres projets.  
**Cadence validée** : collecte toutes les **5 minutes**, prévision **chaque heure à `:50`** dans **America/Toronto**.  
**Source de vérité** : DataTaxi DB (SQLite derrière n8n). L'ancienne source Google Sheets n'est pas utilisée.

## 1. Objectif métier

Une seule application de pilotage persistante qui met à jour les indicateurs, sans créer un nouveau dashboard chaque heure. Les prévisions sont **des snapshots immuables**, recalculés pour la prochaine heure civile entière à `:50`. Après le créneau, le réel est enregistré séparément et comparé au snapshot original.

Le dashboard affiche :
- Total observé, éligible, exclu, jours avec données et zones actives ;
- Quotas **par type d'appel** (volumes et parts), y compris les types exclus du moteur prévisionnel ;
- Série quotidienne des observations et heatmap heure × jour (sans zéro inventé) ;
- Matrice **toutes zones / six tranches fixes de dix minutes**, occurrence historique, confiance historique Fort/Moyen/Faible ;
- Historique figé des bulletins et écarts **zone + tranche**, volume seulement si estimable ;
- États d'accès API et de fraîcheur, erreurs lisibles, dernier appel disponible.

## 2. Architecture fournie

```text
[Tablette Fraxion/dispatch] → POST ingestion (inchangé)
                           │
                           ▼
                 [DataTaxi DB / SQLite SOURCE]
                           │
                           ▼
           [n8n GET /webhook/datataxi-api]
                  Bearer READ-ONLY
                           │ HTTPS
                           ▼
         [Service Docker ZonePredict / FastAPI]
            ├── sync : 00,05,10,...,55 min
            │     GET vue=courses (hier + aujourd'hui)
            ├── backfill historique, par date, manuel
            ├── normalisation/filtrage/déduplication
            ├── SQLite dashboard distinct (volume Docker)
            │     ├── events
            │     ├── quarantine_events (date/heure absente)
            │     ├── sync_runs
            │     ├── forecasts [IMMUTABLES]
            │     └── evaluations [actualisables]
            ├── forecast à :50 (prochaine heure)
            └── GET /api/dashboard + /api/forecasts/latest + /api/evaluations/latest
                           │
                  Nginx TLS + auth
                           ▼
         [Un seul Dashboard HTML/CSS/JS]
          Rafraîchit sa vue toutes les 5 min
```

Le service est volontairement léger et **sans SDK de modèle IA** : les calculs métier déterministes, les dates et la déduplication sont audités en Python. Une couche IA interprétative pourrait être ajoutée ultérieurement derrière des preuves, mais n'est pas nécessaire à ce socle.

## 3. Contrat DataTaxi API

**GET** `https://n8n.xtream.space/webhook/datataxi-api`

En-têtes :

```text
Authorization: Bearer <JETON_DE_LECTURE_ROTÉ_ET_STOCKÉ_EN_SECRET>
Accept: application/json
```

Paramètres documentés par le propriétaire : `vue=courses|stats`, `depuis=AAAA-MM-JJ`, `jusqu_a=AAAA-MM-JJ`, `zone`, `limite`. `vue=openapi` sans jeton : `https://n8n.xtream.space/webhook/datataxi-api?vue=openapi`.

**Important :** impossible d'inspecter cette spécification depuis l'environnement de préparation ; le code accepte explicitement les enveloppes JSON `[]`, `{ "courses": [] }`, `{ "data": [] }`, `{ "rows": [] }`, `{ "items": [] }`, `{ "records": [] }`, `{ "results": [] }` et objets `data` contenant l'une de ces listes. Tout autre schéma est **refusé avec erreur visible** plutôt que converti silencieusement en zéro. À vérifier contre une vraie réponse de production avant GO.

### Champs requis sur les événements

| Champ | Requis | Traitement |
|---|---|---|
| Date de course (`date` ou `trip_date`) | Pour la prévision | `AAAA-MM-JJ`; sinon quarantaine, hors occurrences |
| Heure de réception/prise (`heure` ou `trip_time`) | Pour la prévision | `HH:MM:SS` ; `HH:MM` accepté ; sinon quarantaine |
| Zone unique (`zone` ou `departure_zone`) | Pour attribution zone | Sinon demande non localisable, événement conservé |
| Véhicule | Recommandé | Participe à la signature de déduplication |
| Service/type | Optionnel | `Autre / non précisé` si absent |
| Statut | Optionnel | `Non précisé` si absent |
| Destination | **Facultatif** | Aucune invention, segmentation distincte |
| Zone demandée en attente | **Facultatif** | Si absente et appel en attente : **ne pas confondre zone chauffeur et demande** |

En attente : lorsque `requested_zone` existe, c'est la zone de la demande. Si `destination_zone` décrit explicitement `vers Y` dans le schéma des appels en attente, elle peut servir de zone demandée. À défaut des deux, la zone demandée reste inconnue, tout en conservant l'événement.

Le client refuse les réponses dépassant `limite`, les indications de pagination non prise en charge et les dates en dehors de la requête. Une API qui ignore ces filtres nécessite une adaptation documentée du connecteur.

**Ne jamais coller le jeton Bearer dans un URL, une tâche ChatGPT, une conversation d'équipe, un log ou le JavaScript du navigateur.** Un jeton ayant déjà été partagé dans un échange doit être renouvelé dans le workflow n8n « DataTaxi - API lecture (SQLite) ».

## 4. Discipline de calcul conservée

1. **Événements** : conserver brut normalisé, mais exclure des calculs prédictifs **Transport adapté**, **Manuel**, **NoLoad**, **CISSS** et **Reprise système**. Les quotas affichent aussi ces types exclus.
2. **Heure** : heure reçue dans le journal, ou heure de prise pour les appels en attente. Ne pas créer une heure initiale absente.
3. **Dédoublonnage** : signature date + heure exacte + véhicule + zone d'origine/demandée + destination explicitement connue + service + statut ; jamais fusionner deux véhicules distincts. Sans véhicule, utiliser l'identifiant stable ou l'empreinte du champ brut. Garder trace des lectures successives via `first_seen`/`last_seen`.
4. **Fenêtres fixes** : `[HH:00,HH:10)`, `[HH:10,HH:20)`, ... `[HH:50,HH+1:00)`. Aucune fenêtre ±5 min additionnelle.
5. **Confiance métier** :
   - **Fort** : au moins deux **dates distinctes**, destination **connue identique pour tous les événements** de la cellule.
   - **Moyen** : au moins deux dates distinctes, destination absente ou partiellement connue, sans contradiction de destinations connues.
   - **Faible** : une seule date distincte ou destinations connues divergentes.
   - Ces libellés ne sont **pas** des probabilités calibrées de réussite. La destination facultative n'entraîne **jamais** l'exclusion de l'appel.
6. **Volume prévu** : médiane sur journées **dont la couverture est établie** ; les données actuelles à six champs ne prouvent pas ces journées. **Version fournie : valeur `null` / non estimable**, pas de volume numérique fictif.
7. **Semaine/week-end** : le moteur sauvegarde la date réelle. Version v1 n'applique pas de split faute de preuve de couverture par tranche et jour. Affiche « global, couverture insuffisante » au lieu de surinterpréter des dates éparses. Ajouter ultérieurement des métadonnées de couverture avant le split.
8. **Déploiement véhicule** : suggéré uniquement si un signal **Fort** existe. Sans destination, Fort n'est pas démontré par les seules six colonnes ; **pas de placement automatique**.
9. **Vérité prédite/réelle** : le snapshot est immuable (`INSERT OR IGNORE` par heure cible). Une évaluation peut s'actualiser après réception tardive de données, mais n'altère jamais l'ancien bulletin.
10. **Pas de zéro inventé** : toute heure sans appel observé conserve statut « couverture non établie » ; les métriques de concordance sont déclarées **provisoires**.

## 5. Mise en service sur le VPS (à exécuter par opérateur autorisé)

Copier le répertoire `ZonePredict_Dashboard_V1` sur le VPS, dans un emplacement **séparé** de l'application de dispatch, par exemple `/opt/zonepredict-dashboard`.

```bash
cd /opt/zonepredict-dashboard
cp .env.example .env
chmod 600 .env
# Modifier .env : coller uniquement le NOUVEAU jeton de lecture en local.
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 zonepredict-dashboard
```

**Initialisation historique contrôlée** :

```bash
# Date indiquée pour historique initial, à confirmer avec le premier jour réellement accessible.
docker compose run --rm zonepredict-dashboard python -m app.cli backfill --start 2026-09-01
# Le backfill relit jour par jour et est idempotent.
```

**Vérifier en local** :

```bash
curl -sS http://127.0.0.1:8199/api/health
curl -sS 'http://127.0.0.1:8199/api/dashboard?period=7d'
```

**Endpoints de consultation** : `GET /api/dashboard?period=7d|30d|all`, `GET /api/forecasts/latest`, `GET /api/evaluations/latest`, `GET /api/health`. Tous sont à protéger avec Nginx, y compris les métriques.

**Accès externe** : configurer un sous-domaine HTTPS via Nginx, appliquer le modèle dans `nginx/zonepredict.example.conf`, protéger par `htpasswd` ou mieux SSO, puis ouvrir la page. L'API dashboard doit être protégée au même titre que l'interface, pas seulement la page HTML. Le port Docker n'écoute que sur `127.0.0.1` du VPS.

**Sauvegarde** : garder le volume Docker `zonepredict_data` avec copies régulières/`sqlite3 .backup`, tester la restauration. Ne jamais monter ni modifier la base SQLite originelle du dispatch.

**⚠ Important** : ne PAS activer plusieurs workers Uvicorn. Dans cette version, le planificateur vit dans **un seul** processus ; avec plusieurs replicas, utiliser un worker planificateur dédié ou des verrous distribués.

## 6. Exécution horaire

À **HH:50** (heure Montréal) :

1. Lire `/vue=courses` pour les deux dates pertinentes (jour J-1 et J) ;
2. Refuser de créer un nouveau snapshot si la synchronisation du tour a échoué ;
3. Dédupliquer et enregistrer les nouveaux événements ;
4. Calculer les six tranches de **HH+1:00 à HH+2:00** selon l'historique antérieur ;
5. `INSERT OR IGNORE forecasts(target_start, issued_at, history_cutoff, result_json)` ;
6. Continuer les évaluations des créneaux clos avec les appels réellement reçus (statut provisoire si couverture inconnue).

Le navigateur actualise l'interface toutes les cinq minutes, mais **la collecte fonctionne côté VPS indépendamment des sessions ouvertes**. L'automatisation ChatGPT `Zone Predict — prochaine heure` à :50 reste séparée, inchangée : cette livraison ne prouve pas qu'elle consomme les snapshots locaux. Pour éviter des prévisions contradictoires, une intégration ultérieure devra faire **lire** au bulletin ChatGPT le snapshot du moteur VPS, sans le recalculer. Ne pas suspendre l'automatisation ChatGPT sans instruction explicite.

## 7. Qualité et critères de GO/NO-GO

| Gate | Critère de validation | Statut de ce livrable |
|---|---|---|
| G0 | Code + tests unitaires | **PASS (20 tests)** |
| G1 | Spécification OpenAPI réelle lue, réponse `vue=courses` vérifiée | **NON TESTÉ** (réseau inaccessible) |
| G2 | Authentification Bearer en production (200 / 401), jeton renouvelé | **NON TESTÉ** |
| G3 | Backfill complet, quotas, doublons et filtres vérifiés sur la base réelle | **NON TESTÉ** |
| G4 | Collecte 5 min pendant 24h, pas de faux zéro, fraîcheur visible | **NON TESTÉ** |
| G5 | Deux snapshots :50 consécutifs, écriture immuable, évaluations après clôture | **NON TESTÉ** |
| G6 | HTTPS + authentification dashboard + restauration SQLite | **NON TESTÉ** |

**Décision** : **NO-GO production** tant que G1–G6 ne sont pas passés sur le VPS réel. Le paquet livré est un socle à intégrer, pas une application déjà mise en ligne.

## 8. Améliorations à prévoir après intégration

- Extension optionnelle API : `destination_zone`, `requested_zone`, ID d'événement stable, statut de couverture de capture par zone et plage horaire, `observed_at`.
- Scoring quantitativement calibré par zone et tranche uniquement après backtesting temporel avec snapshots produits avant le réel.
- Numérique `volume prévu` seulement lorsque les périodes réellement couvertes sont attestées ; avec contrôle des intervalles de confiance et MAE / WAPE.
- Alimentation de l'ancienne automatisation ChatGPT avec le dernier snapshot VPS via un endpoint sécurisé, sans jeton dans le prompt.
- Scheduler dédié (Redis/RQ, cron ou n8n) si plusieurs réplicas ou SLA plus strict nécessaire.

## 9. Tests locaux

```bash
python -m pip install -r requirements.txt
PYTHONPATH=. pytest -q
node --check app/static/app.js
```

Niveau de preuve : tests unitaires sur événements synthétiques et transport HTTP simulé. Aucun test réel d'API authenticated, pas de déploiement ni mutation sur n8n, SQLite DataTaxi ou le VPS.
