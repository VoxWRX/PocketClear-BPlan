# PocketClear — Detailed User Guide / Guide d’Utilisateur Détaillé

![PocketClear Banner](public/banner.png)

Welcome to the official **PocketClear** user manual. This guide covers both **French** and **English** workflows so you can master every screen of the application in minutes.

---

## 🇫🇷 Guide d’Utilisateur (Français)

### 1. Configuration Initiale (Assistant de Bienvenue)
Au tout premier lancement sur une base de données vierge :
1. **Langue & Devise** : Choisissez **Français (FR)**, **English (EN)** ou **العربية (AR)** (avec bascule automatique de l’interface de droite à gauche RTL), ainsi que votre devise (**MAD**, **EUR**, **USD**, **GBP**).
2. **Solde Initial** : Indiquez le nom de votre compte principal (ex. *Poche Principale*) et le montant actuellement disponible.
3. **Catégories de Dépenses** : Sélectionnez 4 à 6 catégories de départ (*Loyer & Logement*, *Courses & Repas*, *Loisirs*, *Factures*, *Transport*, *Épargne*).

### 2. Feuille de Calcul Revenus / Dépenses (*Gestion Mensuelle*)
L’onglet **Feuille de calcule revenus / dépenses** vous permet de planifier chaque mois :
- **Créer un Mois** : Cliquez sur **`+ Nouveau Mois`**, saisissez son nom (ex. `Mois 11` ou `Novembre 2026`) et son **Montant de base alloué** (ex. `16 700,00 MAD`).
- **Ajouter les Dépenses du Mois** : **Cliquez directement sur la carte du mois créé**. PocketClear ouvre automatiquement le **Journal d’activité** filtré sur ce mois, avec une bannière récapitulative (*Montant de base alloué*, *Argent Dépensé*, *Solde Restant*). Cliquez sur **`- Ajouter Dépense`** pour enregistrer une dépense rattachée à ce mois.
- **Gérer les Catégories de Dépenses** : Basculez sur le sous-onglet **`Catégorie de dépenses`** pour créer, modifier ou supprimer vos catégories globales et définir des plafonds mensuels.

### 3. Suivis de Projet et d’Objectifs (*Épargne & Grands Projets*)
L’onglet **Suivis de projet et d’objectifs** fonctionne selon le même principe intuitif, mais **sépare vos projets de votre budget mensuel courant** :
- Cliquez sur **`+ Nouveau Projet / Objectif`** (ex. `Achat Voiture`, budget cible `50 000,00 MAD`).
- **Cliquez sur la carte du projet** pour ouvrir son journal d’activité dédié.
- Utilisez le bouton unique **`Contribuer`** pour enregistrer chaque apport financier vers ce projet.
- *Remarque importante* : Les contributions aux projets n’altèrent pas les indicateurs mensuels de votre feuille de calcul.

### 4. Journal d’Activité & Duplication Intelligente (`Ctrl/Cmd + D`)
- **Filtres rapides** : Filtrez par *Tout*, *Argent Reçu*, *Argent Dépensé*, *Récurrent* ou *Associés* (opérations liées à un mois ou un projet).
- **Raccourci `Ctrl + D` / `Cmd + D`** : Ouvre la fenêtre de **Duplication Intelligente de Facture** depuis n’importe quel écran pour enregistrer le paiement du mois en 2 clics.

### 5. Tableau de Bord (*Vue de Mois & Vue d’Année*)
Le **Tableau de bord** est un espace 100 % analytique :
- **Vue de mois** : Sélectionnez n’importe quel mois créé dans votre feuille de calcul pour afficher ses 3 cartes clés (*Argent Reçu ce Mois*, *Argent Dépensé ce Mois*, *Reste à Dépenser ce Mois*), la répartition *Où est passé mon argent ?* (Top 5 + Autre) et l’évolution temporelle.
- **Vue d’année** : Sélectionnez une année (ex. `2026`) pour visualiser le cumul annuel de vos mois et opérations.
- **Tableau récapitulatif des projets** : Consultez en bas de page l’état d’avancement de tous vos projets ainsi que le **Montant global de contribution**.

### 6. Paramètres, Sécurité PIN & Sauvegardes
Dans **Paramètres & Sauvegarde** :
- Activez un **Code PIN / Mot de passe maître** chiffré via **Argon2id** et réglez le délai de verrouillage automatique (`5`, `15` ou `30` minutes).
- Exportez ou restaurez votre base **SQLite (`.sqlite`)** ou utilisez l’**Assistant d’Import/Export CSV** avec aperçu de validation.

---

## 🇬🇧 Detailed User Guide (English)

### 1. First-Run Onboarding
1. **Language & Currency**: Pick **English**, **French**, or **Arabic (RTL)** and your default currency (**USD**, **EUR**, **MAD**, **GBP**).
2. **Starting Balance**: Name your main pocket and enter your current available balance.
3. **Starter Categories**: Choose 4–6 starter spending categories.

### 2. Income / Expense Worksheet (*Monthly Budgeting*)
- Click **`+ New Month`** to create a monthly worksheet entry with an **Allocated Base Amount**.
- **Click any Month card** to jump straight into its filtered **Activity Log** and add monthly expenses via **`- Add Money Out`**.
- Switch to the **`Expense Categories`** sub-tab to create, edit, or delete global spending categories.

### 3. Project & Goal Tracking
- Click **`+ New Project / Goal`** to track dedicated goals (e.g., *Emergency Fund*, *Car Purchase*).
- **Click any Project card** to open its dedicated Activity Log and click **`Contribute`** to log project contributions cleanly separated from monthly living expenses.

### 4. Dashboard Analytics (*Month View & Year View*)
- Toggle between **Month View** (powered by your Worksheet months) and **Year View** (annual summary).
- Review your **3 KPI Cards**, **Top 5 Categories + Other Donut Chart**, **Monthly Cashflow Bar Chart**, and the **Projects Summary & Global Contribution Table**.

### 5. Keyboard Shortcuts
| Shortcut | Action |
| :--- | :--- |
| `Ctrl + D` / `Cmd + D` | Open Smart Recurring Bill Duplication modal from anywhere |
| `Esc` | Close any active modal window |
| Click on Month / Project Card | Open filtered Activity Log for that specific Month or Project |
