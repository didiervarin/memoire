# Mise en ligne de Mémoire

Compte environ 15 minutes. Tout tient dans l'offre gratuite de Cloudflare.
Même organisation que Bring2Do : un Worker Cloudflare, une base D1, un mot de passe en secret Cloudflare.

Les intitulés des menus Cloudflare peuvent varier légèrement selon les mises à jour de leur interface.

## 1. Code sur GitHub

Le code est déjà dans le dépôt `didiervarin/memoire`.

Ne mets jamais le fichier de sauvegarde de tes cartes sur GitHub : le dépôt peut être public.

## 2. Créer la base de données D1

1. Ouvre dash.cloudflare.com → **Storage & Databases → D1** → **Create database**.
2. Nomme-la `memoire`, puis clique **Create**.
3. Copie le **Database ID** affiché.
4. Sur GitHub, ouvre `wrangler.toml`, clique le crayon ✏️ et remplace `REMPLACER_PAR_L_ID_DE_TA_BASE_D1` par l'ID copié.
5. Clique **Commit changes**.

Les tables se créent automatiquement au premier lancement : il n'y a pas de SQL à exécuter.

## 3. Relier GitHub à Cloudflare

1. Dans Cloudflare, ouvre **Workers & Pages → Create → Import a repository** (onglet Workers).
2. Choisis le dépôt **memoire**.
3. Nom du projet : **`memoire`**. Il doit être identique au `name` de `wrangler.toml`.
4. Commande de déploiement : `npx wrangler deploy` (valeur par défaut).
5. Clique **Deploy**.

Ensuite, chaque modification poussée sur GitHub redéploie le site automatiquement.

## 4. Définir le mot de passe

1. Ouvre le Worker `memoire`, puis **Settings → Variables and Secrets → Add**.
2. Ajoute une variable de **type Secret** : `MEMOIRE_PASSWORD`, avec le mot de passe de ton choix.
3. Enregistre.

L'adresse du site ressemblera à `https://memoire.didier-varin.workers.dev`.

## 5. Récupérer tes cartes actuelles

1. Ouvre l'adresse, connecte-toi.
2. Dans **Sauvegarde**, touche **Importer une sauvegarde** et choisis `memoire-sauvegarde-2026-10-23.json`.
3. La bibliothèque « Anglais-Français » réapparaît avec ses 26 cartes et leur progression.

## 6. Installer l'app sur l'iPhone

1. Ouvre l'adresse dans **Safari**.
2. Touche **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. Ouvre l'app depuis l'icône et connecte-toi : l'app installée a sa propre session, distincte de Safari.

## Sécurité

- Sans le mot de passe, aucune donnée n'est lisible : toutes les routes `/api/` exigent une session.
- La session est un cookie `HttpOnly` et `Secure`, valable 1 an ; « Se déconnecter » l'annule.
- Après 8 mots de passe faux en 15 minutes, la connexion est bloquée 15 minutes.
- Les modifications venant d'un autre site sont refusées (protection CSRF).
- Pour changer le mot de passe, modifie simplement le secret. Les sessions déjà ouvertes restent valides.

## Développement local (facultatif)

```bash
npm install
printf 'MEMOIRE_PASSWORD=test\n' > .dev.vars
npm run dev      # http://localhost:8787
```
