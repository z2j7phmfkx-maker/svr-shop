# Installation point par point

## 1. Sauvegarder l'ancien projet

Fais une copie privée du projet et de ses variables d'environnement avant de remplacer les fichiers. Ne publie jamais cette sauvegarde.

## 2. Remplacer les fichiers

Copie le contenu de ce dossier à la racine du projet :

- `server.js`
- `notificationService.js`
- `package.json`
- `data.json`
- tout le dossier `public/`

Le `data.json` livré conserve le catalogue et les réglages fournis, mais retire les identifiants Telegram, prénoms, usernames et `userTokens`.

## 3. Configurer les secrets

Recopie `.env.example` dans la configuration d'environnement de l'hébergeur. Ne crée pas de fichier `.env` public et ne commite aucun secret.

Génère un mot de passe administrateur long et aléatoire. Exemple :

```bash
openssl rand -base64 36
```

Définis ce résultat dans `ADMIN_PASSWORD`. Change aussi tout secret ayant pu être présent dans un dépôt ou un fichier exposé, notamment les anciens `userTokens`, le jeton Telegram, les identifiants Cloudinary et le jeton GitHub.

## 4. Retirer les données sensibles de GitHub

Le nouveau serveur ne pousse plus `data.json` vers GitHub. Place au minimum ceci dans `.gitignore` :

```gitignore
.env
data.json
node_modules/
```

Ajouter un fichier à `.gitignore` n'efface pas son ancien historique. Si le dépôt a contenu des secrets, révoque-les d'abord. Nettoie ensuite l'historique avec `git filter-repo` ou rends le dépôt privé avant de republier une copie propre.

## 5. Installer et vérifier

Utilise Node.js 20 ou supérieur :

```bash
npm install
npm run check
npm audit --omit=dev
```

Commit également le nouveau `package-lock.json` produit par `npm install`.

## 6. Configurer Telegram

`SITE_URL` doit être l'URL HTTPS exacte de la boutique et cette URL doit être autorisée dans BotFather. Le bouton Telegram ne transmet plus `?userId=...` : l'identité est prouvée par la signature de `Telegram.WebApp.initData`.

La variable `TELEGRAM_BOT_TOKEN` doit contenir le token du même bot que celui dont le bouton ouvre la boutique, sans espaces, guillemets ni retour à la ligne.

Pour publier les annonces quotidiennes dans un canal, ajoute également :

```env
SCHEDULED_CHAT_ID=@username_public_du_canal
```

Le bot doit être administrateur du canal et autorisé à publier. Les messages « La boutique est ouverte » et « La boutique est fermée » sont envoyés respectivement à 14:00 et 00:00 dans le fuseau `Europe/Paris`, qui suit automatiquement l'heure d'été et l'heure d'hiver.

Une commande ouverte directement dans un navigateur normal sera refusée. C'est volontaire : elle doit être envoyée depuis la Web App Telegram.

## 7. Vérifier l'administration

Ouvre `/admin`. Le navigateur doit demander `ADMIN_USERNAME` et `ADMIN_PASSWORD`. Vérifie ensuite :

1. qu'un mauvais mot de passe renvoie `401` ;
2. que `/api/admin/data` est également protégé ;
3. que les uploads trop gros ou non autorisés sont refusés ;
4. que `/api/catalog` ne contient aucune donnée utilisateur ni aucun token.

L'authentification HTTP Basic est acceptable uniquement sous HTTPS. Pour une équipe ou plusieurs administrateurs, remplace-la ensuite par un fournisseur d'identité avec MFA.

## 8. Tester les commandes

Depuis Telegram :

1. ajoute un tarif normal ;
2. vérifie que seuls les tarifs prédéfinis sont proposés ;
3. modifie manuellement le prix dans les outils du navigateur : le serveur doit l'ignorer et refuser tout tarif inexistant ;
4. tente une livraison sous 50 € : le serveur doit la refuser ;
5. renvoie exactement la même requête avec la même clé d'idempotence : une seule commande doit être créée ;
6. tente plus de huit commandes en dix minutes : le rate limiting doit intervenir.

## 9. Limites restantes à traiter en production

- Le stockage JSON atomique évite les fichiers partiellement écrits, mais une vraie base PostgreSQL est recommandée pour plusieurs instances serveur.
- Le cache d'idempotence est en mémoire. Utilise Redis ou une table SQL pour le partager entre instances et le conserver après redémarrage.
- Configure les sauvegardes chiffrées, la rotation des journaux et la surveillance des erreurs.
- Ne journalise jamais `initData`, les en-têtes d'autorisation ou le corps complet d'une commande.
- Vérifie les obligations juridiques et réglementaires applicables aux produits, à l'âge des utilisateurs, à la vente et aux données personnelles avant mise en production.

## 10. Contrôles HTTP attendus

En production, vérifie la présence de CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` et l'absence de `X-Powered-By` :

```bash
curl -I https://example.com/
curl -i https://example.com/api/admin/data
curl -s https://example.com/api/catalog
```
