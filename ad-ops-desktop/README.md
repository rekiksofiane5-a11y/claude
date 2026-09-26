# Suivi ad ops — logiciel Windows

Un vrai logiciel de bureau, qui s'installe et s'ouvre comme Teams. Il n'a besoin ni de navigateur, ni de serveur, ni de réseau.
Il fait la même chose que la version HTML : le suivi opérationnel et les référentiels Adserver (391 lignes) et Adverification (535 lignes).

## Installer

1. Lancez `Suivi-ad-ops-Setup-1.2.0.exe`. L'installation se fait sans question, **sans droits administrateur**, dans votre profil Windows, comme Teams.
2. L'application s'ouvre toute seule. Un raccourci **Suivi ad ops** est ajouté sur le bureau et dans le menu Démarrer. Vous pouvez l'épingler à la barre des tâches.
3. Pour qu'elle se lance à l'ouverture de votre session Windows : **Fichier → Lancer au démarrage de Windows**.

Si vous relancez l'application alors qu'elle est déjà ouverte, c'est la fenêtre existante qui revient au premier plan. Elle ne s'ouvre jamais en double.
La taille et la position de la fenêtre sont conservées d'une ouverture à l'autre.

Pour la désinstaller : Paramètres Windows → Applications. **Vos données sont conservées** après la désinstallation.

## Sur un poste professionnel verrouillé

Sur un PC d'entreprise, l'installation peut être bloquée : AppLocker, WDAC, SmartScreen ou une interdiction d'installer. **Ne contournez pas ces restrictions : faites valider l'application par votre DSI.** Tout ce qu'il lui faut est prévu :

- **`DSI.md`** : la fiche technique à lui transmettre. Elle couvre le réseau (aucun), les données, les droits, le chiffrement, la signature et le déploiement.
- **`Suivi-ad-ops-1.2.0.msi`** : l'installeur que la DSI déploie elle-même (Intune, SCCM, GPO) dans `Program Files`, là où les règles de contrôle applicatif l'autorisent.
- **`SHA256SUMS.txt`** : les empreintes qui permettent à la DSI d'autoriser exactement ces fichiers.
- **`Suivi-ad-ops-navigateur.html`** : une solution d'attente si rien ne peut être installé. Elle s'ouvre dans le navigateur déjà autorisé. Dans ce mode, pensez à activer la sauvegarde automatique dans un dossier (panneau **Sécurité**), car le navigateur peut effacer ses données locales.

Tous ces fichiers sont dans l'artefact **Suivi-ad-ops-Windows** de GitHub Actions.

## Tout s'enregistre tout seul

Vous n'avez rien à faire :

- Chaque modification est écrite sur le disque au moment où vous la faites.
- Une fiche ouverte s'enregistre en continu. **Fermer** la fiche l'enregistre, et **fermer l'application** aussi. Seul le bouton **Annuler** abandonne les changements, et il vous demande de confirmer.
- En cas de coupure de courant ou de plantage, la fiche en cours de saisie est rouverte au lancement suivant.
- Avant de se verrouiller après 15 minutes d'inactivité, l'application enregistre la fiche ouverte.
- Les 20 dernières versions sont conservées. Vous pouvez les restaurer depuis le panneau **Sécurité**.

### Où sont les données

| Élément | Emplacement |
|---|---|
| Base | `%APPDATA%\Suivi ad ops\data\*.json` |
| Copie de secours | un fichier `*.json.bak` à côté de chaque fichier |
| Réglages (fenêtre, dossier de sauvegarde) | `%APPDATA%\Suivi ad ops\settings.json` |
| Sauvegarde automatique | dossier de votre choix, par exemple OneDrive ou un disque réseau : panneau **Sécurité → Sauvegarde automatique** |

Chaque écriture se fait en trois temps : un fichier temporaire est écrit et vidé sur le disque, l'ancien fichier est copié en `.bak`, puis le fichier temporaire prend sa place. Une coupure en pleine écriture ne peut donc pas corrompre la base. Si le fichier principal devient illisible, le `.bak` prend le relais automatiquement.

Les écritures d'un même fichier passent l'une après l'autre. À la fermeture, l'application attend que tout soit sur le disque.

Pour ouvrir le dossier des données : **Fichier → Ouvrir le dossier des données**, ou le panneau **Sécurité**.

## Sécurité

- Aucune requête réseau : la politique de sécurité du contenu bloque toute connexion (`connect-src 'none'`), la navigation et l'ouverture de fenêtres externes sont bloquées, et le rendu tourne dans le bac à sable (`sandbox`, `contextIsolation`, sans `nodeIntegration`).
- Toute requête qui ne vise pas un fichier de l'application est annulée, et toute demande d'autorisation (caméra, micro, notifications…) est refusée. Les outils de développement sont désactivés dans la version installée.
- Le rendu ne touche jamais directement au disque. Il passe par un pont qui n'expose que neuf fonctions.
- Code d'accès facultatif : chiffrement AES-256-GCM, avec une clé dérivée en PBKDF2-SHA256 (250 000 itérations). Les fichiers sur le disque deviennent des blocs chiffrés, et l'application se verrouille après 15 minutes d'inactivité. Le code se saisit directement dans le panneau **Sécurité**.

## Pour le développeur

```bash
npm install
npm start            # lancer en développement
npm test             # test de bout en bout sur la vraie application (Linux : xvfb-run -a npm test)
npm run build:win    # → dist/Suivi-ad-ops-Setup-1.2.0.exe et dist/Suivi-ad-ops-1.2.0.msi
npm run build:win-portable   # → dist/Suivi-ad-ops-portable.exe (un seul fichier, sans installation)
```

Pour compiler, il faut Node.js 18 ou plus récent. Seule la machine qui compile en a besoin : le poste qui utilise l'application n'en a pas besoin.

Sans Node.js, vous pouvez utiliser GitHub Actions : à chaque modification de ce dossier, le workflow **ad-ops-desktop** teste l'application, construit l'installeur sous Windows et le dépose dans l'onglet **Actions** du dépôt, sous l'artefact **Suivi-ad-ops-Windows**.
