# Suivi ad ops — application de bureau

Application autonome, sans navigateur, sans serveur, sans réseau.
Mêmes fonctions que la version HTML : suivi opérationnel, référentiels Adserver (391 lignes) et Adverification (535 lignes).

## Lancer en développement

```bash
npm install      # une fois — télécharge Electron
npm start
```

## Produire l'exécutable Windows

```bash
npm run build:win        # dist/Suivi-ad-ops.exe — portable, aucun droit admin requis
npm run build:win-setup  # installeur classique, si vous préférez
```

Le `.exe` portable se copie sur une clé ou un dossier réseau et se lance par double-clic.
Pour macOS : `npm run build:mac`.

Prérequis de compilation : Node.js 18+. Seule la machine qui compile en a besoin, pas celle qui utilise l'application.

## Où vivent les données

| Élément | Emplacement |
|---|---|
| Base | `%APPDATA%\Suivi ad ops\data\*.json` (Windows) · `~/Library/Application Support/Suivi ad ops/data` (macOS) |
| Copie de sécurité | `*.json.bak` à côté de chaque fichier |
| Réglages | `settings.json` dans le même dossier parent |
| Sauvegarde automatique | dossier de votre choix (OneDrive, disque réseau) |

Chaque écriture est atomique : le contenu part dans un fichier temporaire, l'ancien est copié en `.bak`, puis le temporaire est renommé. Une coupure en pleine écriture ne peut pas corrompre la base. À la lecture, si le fichier principal est illisible, le `.bak` prend le relais automatiquement.

Le panneau **Sécurité** donne le chemin exact et un bouton pour ouvrir le dossier dans l'explorateur.

## Sécurité

- Aucune requête réseau : `connect-src 'none'` dans la politique de sécurité de contenu, `nodeIntegration` désactivé, `contextIsolation` activé, ouverture de fenêtres externes bloquée.
- Le rendu ne touche jamais au disque directement : il passe par un pont exposant sept fonctions et rien d'autre.
- Code d'accès optionnel : AES-256-GCM, clé dérivée en PBKDF2-SHA256 (250 000 itérations). Les fichiers sur le disque deviennent des blocs chiffrés. Auto-verrouillage après 15 minutes.
- 20 versions précédentes conservées et restaurables depuis le panneau Sécurité.
