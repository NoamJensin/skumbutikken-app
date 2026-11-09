# Skumbutikken – intern app · driftsvejledning (fase 1)

## Hvad er sat op

| Del | Tjeneste | Status |
|---|---|---|
| Database, login, liveopdateringer, filer | Supabase-projekt `skumbutikken` (eu-north-1, Stockholm), ref `bxphyanqubgwehhqwzow` | Kører |
| Medarbejderadministration | Supabase Edge Function `admin-users` | Kører |
| Selve appen | GitHub Pages via `.github/workflows/deploy.yml` – **https://noamjensin.github.io/skumbutikken-app/** | Kører |

Appen er kun intern. Den kræver personligt login, viser `noindex` til søgemaskiner og er ikke linket fra skumbutikken.dk.

## Teknisk valg (kort)
- **Supabase** (PostgreSQL + Auth + Realtime + Storage + Edge Functions): én tjeneste dækker database, personligt login, adgangsregler på serveren (RLS), liveopdateringer via WebSockets og private filer. Det er en kendt stak.
- **React + Vite** som installerbar webapp (PWA): virker på Android-tablets, iPhone, Samsung og pc fra samme kode.
- Al forretningslogik, der skal være pålidelig (klargøring, kundebekræftelse, frigivelse til skrædder, fremdrift, kontrol, PIN), ligger i databasefunktioner. Den kan altså ikke omgås fra browseren.

## Første opsætning (gøres én gang)

1. ✅ GitHub-repo `NoamJensin/skumbutikken-app` (offentligt) med GitHub Pages via Actions – udgives automatisk ved hvert push til `main`.
2. ✅ Installér appen på tablets: åbn adressen i Chrome → menu → *Føj til startskærm*.
3. **Luk for fremmede tilmeldinger i Supabase:** Dashboard → Authentication → Sign In / Providers → slå **"Allow new users to sign up"** fra. Kun administrator opretter medarbejdere i appen.
4. **Slå beskyttelse mod lækkede adgangskoder til:** Authentication → Passwords → "Prevent use of leaked passwords" (kræver Pro-plan).
5. **Log ind** som `noam@jensin.net` med den midlertidige adgangskode, opret din PIN, og skift adgangskode under *Administration → Min profil*.
6. **Opret medarbejdere** under *Administration → Medarbejdere* (Jørn som Butik, Fehmina og Susanne som Skrædder). Appen viser en midlertidig adgangskode, som medarbejderen bruger første gang.

## Daglig brug af enheder
- **Jørns tablet:** Jørn logger ind én gang med adgangskode og opretter PIN. Derefter låser han op med PIN.
- **Syerskernes fælles tablet:** Begge logger ind én gang hver. Derefter vælger man sig selv på startskærmen og taster sin PIN (**Skift bruger**).
- Skærmen låses automatisk efter 10 minutter uden aktivitet.
- **Log ud** fjerner kontoen helt fra enheden og rydder lokale kladder.
- Efter 5 forkerte PIN-forsøg låses brugerens PIN i 15 minutter.
- **Deaktivering** af en medarbejder (Administration) logger personen ud på alle enheder med det samme.

## Arbejdsgang i fase 1
1. **Ny ordre:** vælg eller opret kunde. Appen advarer om mulige dubletter ud fra telefon og e-mail.
2. Udfyld aftale og ordredele (skum, hynde med betræk, betræk, andet). En del kan kopieres og derefter ændres.
3. **Klar til kundens bekræftelse:** serveren kontrollerer, at alle påkrævede felter er udfyldt, og markerer manglerne. Er alt i orden, låses en version.
4. **Kundevisning:** kunden ser hele oversigten, skal rulle helt ned, og trykker selv **Bekræft ordre**. Bagefter vises en kvittering med ordrenummer. Medarbejderen låser op med PIN for at komme tilbage.
5. Ændres pris, mål, materialer, kundedata eller levering efter klargøring, skal ordren gennemgås og bekræftes igen. Tidligere bekræftelser bevares i historikken.
6. **Skrædderen** får opgaven og en notifikation med det samme. Hun kan modtage, starte, sætte på pause med årsag, opdatere fremdrift pr. del (10–100 %), vælge stadie, stille spørgsmål, tilføje fotos og melde færdig.
7. **Kontrol:** butikken godkender (status *Klar til afhentning*) eller sender retur med en besked.
8. **Afhentning** registreres.

**Samlet fremdrift** beregnes som et antalsvægtet gennemsnit af ordredelenes fremdrift, rundet ned til nærmeste 10 %. Ved 100 % går opgaven automatisk til kontrol.

**Beløb** gemmes som heltal i øre. Moms er 25 %, og der rundes halvt op.
- Ekskl. moms: moms = rund(grundlag × 0,25). Eksempel: 3.250,00 kr. giver 812,50 kr. i moms og 4.062,50 kr. i alt.
- Inkl. moms: grundlag = rund(total / 1,25). Eksempel: 3.250,00 kr. giver grundlag 2.600,00 kr. og moms 650,00 kr.

## Udvikling
```
cd app
npm install
npm run dev      # lokal udvikling
npm run build    # produktion → app/dist
```
Supabase-adresse og publishable key ligger i `app/src/lib/supabase.js`. De kan overskrives med `VITE_SUPABASE_URL` og `VITE_SUPABASE_KEY`. Nøglen er offentlig efter Supabases design; adgangen styres af adgangsreglerne i databasen. Service-role-nøglen findes kun i Edge Function-miljøet og aldrig i appen.

Databaseændringer ligger i `supabase/migrations/` i den rækkefølge, de er anvendt.

## Backup
Gratis-planen har ingen automatiske daglige backups. Før appen bruges til rigtige ordrer, bør projektet opgraderes til **Pro** (daglige backups med 7 dages historik). Gendannelse skal afprøves én gang efter opgraderingen.

## Endnu ikke bygget (fase 2–4)
- Skum- og stofbestillingslister (kl. 18.30), leverandører og modtagelse af materialer
- Placering af varer, QR-mærkater og delvis afhentning
- Fakturaer efter skabelonen, bankprofiler, kreditnota og fakturamail
- SMS og e-mail til kunder, påmindelser, web-push
- Kapacitet pr. skrædder, restmaterialer, reklamationer, prisregler og automatisk skummål
