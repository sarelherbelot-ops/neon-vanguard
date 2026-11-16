# Neon Vanguard — mises à jour

Ce dépôt sert de serveur de mises à jour pour l'application Android Neon Vanguard.
Il doit être **public** pour que l'application puisse lire les fichiers.

- `update/version.json` : numéro de version, nouveautés, liste des fichiers du jeu.
- `update/www/` : les fichiers du jeu, téléchargés par l'application (sans réinstaller).
- `update/NeonVanguard.apk` : le dernier APK, proposé quand la partie Android change (`native`).

Publier une nouvelle version : remplacer les fichiers de `update/www/`, monter `version`
(et `native` + l'APK si la partie Android a changé) dans `version.json`, puis valider (commit).
