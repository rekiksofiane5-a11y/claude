# My Work — fiche technique pour la DSI

Cette fiche sert à demander l'autorisation d'installer l'application sur un poste professionnel. Elle décrit ce que fait l'application, ce qu'elle ne fait pas, et comment la déployer.

## En bref

| Question | Réponse |
|---|---|
| Nature | Application de bureau autonome de suivi opérationnel (campagnes publicitaires, référentiels Adserver et Adverification). Usage individuel. |
| Technologie | Electron 44 (Chromium et Node.js), version maintenue par l'éditeur Electron au moment de la compilation |
| Réseau | **Aucun.** Aucune connexion entrante ni sortante, aucune télémétrie, aucune mise à jour automatique. |
| Droits nécessaires | Aucun droit administrateur pour l'utiliser. Seule l'installation MSI dans Program Files demande les droits administrateur. |
| Données | Fichiers JSON locaux dans le profil de l'utilisateur, chiffrables par un code d'accès |
| Registre | Rien d'écrit, sauf si l'utilisateur coche « Lancer au démarrage de Windows » (clé `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`) |
| Signature | **Non signé** par défaut. Voir [Signature](#signature). |

## Livrables

Chaque compilation (GitHub Actions, sur un runner `windows-latest`) produit :

| Fichier | Usage |
|---|---|
| `My-Work-<version>.msi` | **Déploiement par la DSI** (Intune, SCCM/MECM, GPO). Installation pour toutes les sessions, dans `C:\Program Files`. |
| `My-Work-Setup-<version>.exe` | Installation par l'utilisateur, sans droits administrateur, dans `%LOCALAPPDATA%\Programs`. |
| Dossier `My Work\` (artefact « prêt à l'emploi ») | Application décompressée, lancée directement par `My Work.exe`, sans installation. Mêmes fichiers que ceux que posent les installeurs. |
| `My-Work-navigateur.html` | Version de secours qui s'ouvre dans le navigateur déjà autorisé, sans rien installer |
| `SHA256SUMS.txt` | Empreintes SHA-256 des fichiers ci-dessus (y compris `My Work.exe`), pour vérifier leur intégrité |

Le code source et la chaîne de compilation se trouvent dans le dépôt, dossier `ad-ops-desktop/`.

### Installation silencieuse (MSI)

```bat
msiexec /i "My-Work-1.3.0.msi" /qn
msiexec /x "My-Work-1.3.0.msi" /qn
```

La désinstallation ne supprime pas les données de l'utilisateur.

## Réseau et isolation

L'application ne dépend d'aucun service. Quatre protections se cumulent :

1. **Filtre de session.** Toute requête dont l'adresse n'est pas un fichier local de l'application (`file:`, `data:`) est annulée avant de partir. Ce filtre couvre aussi les requêtes que Chromium pourrait émettre de lui-même. Un test automatique le vérifie : une requête HTTPS émise depuis le processus principal doit être refusée par l'application (`ERR_BLOCKED_BY_CLIENT`).
2. **Politique de sécurité du contenu :** `default-src 'none'; connect-src 'none'`.
3. **Aucune fenêtre externe, aucune navigation :** l'ouverture de fenêtres et le changement de page sont bloqués.
4. **Aucune autorisation :** caméra, micro, notifications, géolocalisation, presse-papiers en lecture… toute demande est refusée.

Le processus de rendu tourne dans le bac à sable Chromium (`sandbox`, `contextIsolation`, sans `nodeIntegration`). Il n'accède au disque que par un pont limité à neuf fonctions : lire et écrire une donnée de l'application, ouvrir le dossier des données, choisir un dossier de sauvegarde, écrire la sauvegarde, exporter et importer un fichier par une boîte de dialogue Windows, et enregistrer avant la fermeture.

Les outils de développement de Chromium sont désactivés dans la version installée.

## Données

| Élément | Emplacement |
|---|---|
| Base | `%APPDATA%\Suivi ad ops\data\*.json`, plus une copie `.bak` à côté de chaque fichier |
| Réglages | `%APPDATA%\Suivi ad ops\settings.json` : taille de la fenêtre, dossier de sauvegarde choisi |
| Cache Chromium | `%APPDATA%\Suivi ad ops\` (autres sous-dossiers) |
| Sauvegarde automatique | Facultative. Dossier choisi par l'utilisateur, par exemple OneDrive professionnel ou un partage réseau. |

Le dossier des données porte l'ancien nom de l'application (« Suivi ad ops »). Cet emplacement est fixé dans le code, pour que le changement de nom ne déplace aucune donnée.

`%APPDATA%` est le profil itinérant : si les profils itinérants ou la redirection de dossiers sont en place, les données suivent l'utilisateur.

- **Écritures atomiques.** Le fichier temporaire est écrit et vidé sur le disque (fsync), l'ancien fichier est copié en `.bak`, puis le temporaire le remplace. Une coupure ne corrompt pas la base.
- **Chiffrement facultatif.** Un code d'accès active le chiffrement AES-256-GCM, avec une clé dérivée en PBKDF2-SHA256 (250 000 itérations, sel aléatoire). Le code n'est stocké nulle part, et l'application se verrouille après 15 minutes d'inactivité.
- **Aucune donnée ne quitte le poste**, sauf les exports et la sauvegarde automatique, qui écrivent à l'endroit choisi par l'utilisateur.

## Contrôle applicatif (AppLocker, WDAC, Smart App Control)

Deux choses sont à savoir :

- Les règles AppLocker par défaut n'autorisent les exécutables que dans `Program Files` et `Windows`. L'installeur utilisateur (`.exe`) place l'application dans `%LOCALAPPDATA%`, donc **il sera bloqué sur un poste verrouillé**, tout comme la version sans installation décompressée dans le profil de l'utilisateur. C'est le MSI, déployé par la DSI dans `Program Files`, qui convient.
- Un exécutable non signé peut être refusé par WDAC, Smart App Control ou SmartScreen. La DSI peut autoriser l'application par son empreinte SHA-256 (`SHA256SUMS.txt`) ou la faire signer.

### Signature

electron-builder signe l'application et ses installeurs si un certificat de signature de code lui est fourni au moment de la compilation. Il peut s'agir du certificat de l'entreprise ou d'un service de signature comme Azure Trusted Signing. Le certificat se fournit par les variables d'environnement `CSC_LINK` (fichier `.pfx` en base64) et `CSC_KEY_PASSWORD`, déclarées comme secrets GitHub Actions. Aucune modification du code n'est nécessaire.

## Mises à jour

Il n'y a pas de mise à jour automatique : c'est un choix, pour ne dépendre d'aucun serveur. Une nouvelle version est un nouveau MSI, que la DSI déploie par-dessus l'ancienne. Le code de mise à niveau est stable, donc l'ancienne version est remplacée et les données sont conservées.

Pour recevoir les correctifs de sécurité de Chromium, il faut recompiler l'application régulièrement avec une version maintenue d'Electron (`npm i -D electron@latest`, puis relancer la compilation).
