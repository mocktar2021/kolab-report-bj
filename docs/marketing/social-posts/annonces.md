# Ad posts for TikTok and Facebook

Text to paste with the images and videos of this folder (KRB-246). Everything comes in two versions:

- **lancement**: until Monday 26 October.
- **disponible**: from Tuesday 27 October at 09:00 (Cotonou).

Every link goes to `https://kolabreport.com/fr`. Before the launch the page takes a reminder e-mail, and from 09:00 on the 27th it leads to sign-up, so an ad approved on Monday still works on Tuesday.

The text only uses facts from the pricing page: 14 days free with no card, then from 15 000 FCFA per month (Indépendant), Mobile Money or card. Don't add a number that isn't on `kolabreport.com/fr/tarifs`.

## Which file goes where

| Placement | File |
| --- | --- |
| Facebook feed, one image | `out/<version>/fil/*.png` (1080x1350) |
| Facebook carousel | `out/<version>/carre/1-accroche.png` to `6-essai.png`, in that order (1080x1080) |
| Stories, WhatsApp status, TikTok photo post | `out/<version>/story/*.png` (1080x1920) |
| TikTok ad, Reels ad | `out/kolabreport_28s_<version>.mp4` |
| Organic video on TikTok and Facebook | the 52 s video from `../launch-ad` |

## Posting plan

| When | Where | What |
| --- | --- | --- |
| Sat 24 and Sun 25 | Facebook, TikTok | 52 s video, lancement. Facebook text: `../launch-ad/legende.txt`. TikTok: caption 1. |
| Sun 25 | Facebook | Carousel lancement, post A |
| Mon 26, 18:00 | Facebook, TikTok, WhatsApp status | `story/6-essai.png` lancement, post B |
| Tue 27, 09:00 | Facebook, TikTok | 52 s video, disponible. Facebook text: `../launch-ad/legende-disponible.txt`. TikTok: caption 2. Start the paid ads. |
| Tue 27, 17:00 | Facebook, TikTok | Carousel disponible with post C. On TikTok, the 6 story images as one photo post with caption 3. |
| Wed 28 | Facebook | `fil/2-plan.png`, post D |
| Thu 29 | Facebook | `fil/4-ia.png`, post E |
| Fri 30 | Facebook | `fil/3-equipe.png`, post F |
| Sat 31 | Facebook | `fil/5-rapport.png`, post G |

## Paid ads on a small budget

- Run few ads and stop the weak ones fast. On Facebook: one campaign with the Traffic objective, one ad set, three ads (the 28 s video, the carousel, `fil/4-ia.png`). Use the smallest daily budget Ads Manager accepts. After 3 days, turn off the two ads with the highest cost per link click.
- Audience: ages 25 to 60, French. Start with Bénin, then add the countries where FedaPay takes Mobile Money. For interests, type consulting, project management, NGO, international development, engineering and evaluation, and pick from what Ads Manager suggests.
- TikTok: the cheapest start is "Promouvoir" on the organic post that does best, from the app. For an ad in TikTok Ads Manager, first check that Bénin is in the location list. TikTok decides which countries an account can target from the country it was registered in. If Bénin isn't there, stay organic on TikTok and put the budget on Facebook.
- Text on the images is fine for Meta: the old 20% rule is gone.

## Facebook ad

### Primary text

The first 125 characters show before "Voir plus", so the hook sits in the first sentence.

Lancement 1:

```text
10 experts, 10 fichiers Word, 1 rapport à rendre. KolabReport ouvre le 27 octobre : chaque expert écrit sa section dans le même rapport. Laissez votre e-mail, nous vous prévenons à l'ouverture.
```

Lancement 2:

```text
Le 27 octobre, KolabReport ouvre. L'IA propose un premier jet de chaque section à partir de vos livrables, et l'expert décide. 14 jours d'essai gratuit, sans carte bancaire.
```

Disponible 1:

```text
10 experts, 10 fichiers Word, 1 rapport à rendre. Avec KolabReport, chaque expert écrit sa section dans le même rapport, et vous voyez qui avance. 14 jours d'essai gratuit, sans carte bancaire.
```

Disponible 2:

```text
Déposez vos livrables dans la section. L'IA de KolabReport propose un premier jet et cite ses sources. L'expert l'accepte, le modifie ou le rejette. 14 jours d'essai gratuit.
```

Disponible 3:

```text
Essayez KolabReport 14 jours, sans carte bancaire. Ensuite, dès 15 000 FCFA par mois, par Mobile Money ou carte. À la fin de la mission, un seul rapport en Word ou en PDF.
```

### Headline (40 characters at most)

| Version | Headline | Characters |
| --- | --- | --- |
| Lancement | `KolabReport ouvre le 27 octobre` | 31 |
| Lancement | `Vos rapports d'expertise, à plusieurs` | 37 |
| Disponible | `14 jours d'essai, sans carte bancaire` | 37 |
| Disponible | `Vos rapports d'expertise, à plusieurs` | 37 |
| Disponible | `Un seul rapport, en Word ou en PDF` | 34 |

### Description (30 characters at most)

| Version | Description | Characters |
| --- | --- | --- |
| Lancement | `Recevez un rappel par e-mail` | 28 |
| Disponible | `Dès 15 000 FCFA par mois` | 24 |
| Disponible | `Mobile Money ou carte` | 21 |

### Button

Lancement: **En savoir plus**. Disponible: **S'inscrire**.

## TikTok ad

Display name: `KolabReport`. Profile picture: `public/icons/icon-512.png`. Ad text: 100 characters at most, no emoji.

| Version | Ad text | Characters |
| --- | --- | --- |
| Lancement | `10 experts, 10 fichiers Word, 1 rapport. KolabReport ouvre le 27 octobre.` | 73 |
| Lancement | `Vos rapports d'expertise, écrits à plusieurs avec l'IA. Ouverture le 27 octobre.` | 80 |
| Disponible | `10 experts, 10 fichiers Word, 1 rapport. Essayez KolabReport 14 jours gratuits.` | 79 |
| Disponible | `L'IA écrit le premier jet, l'expert décide. 14 jours d'essai sans carte bancaire.` | 81 |
| Disponible | `Un seul rapport d'expertise, écrit à plusieurs. Dès 15 000 FCFA par mois.` | 73 |

Button: **En savoir plus** before the launch, **S'inscrire** after.

## Organic captions

Put `kolabreport.com` in the TikTok bio as well, because links in TikTok captions can't be clicked.

TikTok caption 1, lancement video:

```text
10 experts, 10 fichiers Word, 1 rapport à rendre. On connaît la fin : des nuits à tout recoller. KolabReport ouvre le 27 octobre. kolabreport.com
#consultant #bureaudetudes #rapport #travailenequipe #ia #kolabreport
```

TikTok caption 2, disponible video:

```text
KolabReport est ouvert. Chaque expert écrit sa section dans le même rapport, l'IA propose un premier jet et vous exportez en Word ou en PDF. 14 jours gratuits sur kolabreport.com
#consultant #bureaudetudes #rapport #travailenequipe #ia #kolabreport
```

TikTok caption 3, photo post:

```text
4 experts, 1 rapport, en 6 images. Essai gratuit de 14 jours sur kolabreport.com
#consultant #bureaudetudes #rapport #ia #kolabreport
```

On a local post you can add `#Bénin #Cotonou`. The ads themselves name no country.

### Facebook posts

Post A, carousel lancement:

```text
KolabReport en 6 images : le plan, l'équipe, l'IA et le rapport final. Ouverture le 27 octobre. Laissez votre e-mail sur kolabreport.com et nous vous prévenons à l'ouverture.
```

Post B, Monday evening:

```text
Demain mardi à 9 h (heure de Cotonou), KolabReport ouvre. Vous pourrez créer votre compte et l'essayer 14 jours, sans carte bancaire.
kolabreport.com
```

Post C, carousel disponible:

```text
KolabReport en 6 images : le plan, l'équipe, l'IA et le rapport final. Essai gratuit de 14 jours sur kolabreport.com
```

Post D, the outline:

```text
Importez vos termes de référence, en Word ou en PDF. KolabReport lit le plan et crée les sections. Vous vérifiez, puis vous confiez chaque section à un expert.
Essai gratuit de 14 jours : kolabreport.com
```

Post E, the AI:

```text
Chaque expert dépose ses livrables dans sa section : relevés, tableaux, notes. L'IA propose un premier jet et cite ses sources. L'expert l'accepte, le modifie ou le rejette. Rien n'entre dans le rapport sans son accord.
Essai gratuit de 14 jours : kolabreport.com
```

Post F, the team:

```text
Le chef de mission voit où en est chaque section, en temps réel : non commencée, en cours ou terminée. Plus besoin de relancer toute l'équipe pour savoir où en est le rapport.
Essai gratuit de 14 jours : kolabreport.com
```

Post G, the final report:

```text
À la fin de la mission, exportez le rapport complet en Word ou en PDF. Les lecteurs sont gratuits et illimités, sur toutes les offres.
Essai gratuit de 14 jours : kolabreport.com
```
