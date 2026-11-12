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
3. ✅ **Fremmede tilmeldinger er spærret** i databasen (migration 0007): kun brugere oprettet af administrator i appen kan oprettes. (Kan desuden slås fra i Dashboard → Authentication → Sign In / Providers → "Allow new users to sign up".)
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

## Fase 2 – bestillinger og materialer
- **Materialebehov** dannes automatisk, når kunden bekræfter en ordreversion: skum, stof, lynlås og tilbehør pr. ordredel. "Fra lager" og "Kunden medbringer" markeres uden indkøb.
- **Skumlisten og stof-/tilbehørslisten** dannes på serveren (pg_cron, tjek hvert 5. minut) på de valgte bestillingsdage. Standard er kl. 18.30 dansk tid, mandag til fredag. Begge kan ændres under *Bestillinger → Tidsplan*. Det virker, selv når alle enheder er slukket.
  - Sommer- og vintertid håndteres via tidszonen Europe/Copenhagen.
  - Hvert indkøbsbehov kommer kun med én gang. Det sikres af en lås, en unik kørsel pr. type og dag og en kobling til én liste. Genkørsel og parallelle job er derfor ufarlige.
  - Ordrer bekræftet efter cutoff kommer med på næste liste.
  - Efter driftsstop indhentes manglende kørsler (op til 14 dage).
  - Ekstra kørsel: knapperne "Dan skumliste nu" og "Dan stofliste nu".
- **Status for en liste:** Klargjort → Godkendt → Sendt → Bekræftet → Modtaget. Stoflinjer skal have en mængde i meter, før listen kan markeres sendt.
- **Ændringer efter afsendelse:** den gamle linje markeres "Rettet" og skal følges op. Der oprettes en ny linje som rettelse, og butikken får en notifikation (fanen *Rettelser*).
- **Modtagelse** registreres pr. linje og delmængde (delvis modtaget). Skrædderen får besked, når materialer er modtaget, og ser materialestatus pr. del.
- **Eksport** som CSV (åbner i Excel) og udskrift/PDF.
- **Leverandører** og standardleverandør pr. kategori. Afsendelse til leverandøren sker indtil videre manuelt, og så markeres listen "Sendt".
- **Placering** af ordren, **indleverede ting** (fx kundens gamle hynder) med udlevering, og **QR-etiketter** pr. ordre og pr. del. QR-koden åbner ordren i appen og kræver login.

## Fase 3 – fakturaer og kundebeskeder
**Gøres én gang af administrator (Administration → Faktura):**
1. Kontrollér og godkend firmaoplysningerne (navn, CVR, adresse, kontakt). Der kan ikke udstedes fakturaer, før de er godkendt.
2. Opret mindst én bankprofil (reg.nr., kontonr., evt. IBAN/MobilePay) og vælg den som standard.
3. Hvis I fortsætter en eksisterende fakturanummerserie, indtast næste fakturanummer, før den første faktura udstedes. Nummeret kan ikke sættes lavere, når der først er udstedt fakturaer.
4. Mail og SMS: opret konti hos Resend (mail) og GatewayAPI (SMS). Læg nøglerne som hemmeligheder i Supabase (Edge Functions → Secrets): `RESEND_API_KEY` og `GATEWAYAPI_TOKEN`. Tilføj Resends DNS-poster (SPF, DKIM, DMARC) for skumbutikken.dk hos Gigahost. Indtil det er gjort, står beskeder i køen som "Integration ikke sat op" og sendes automatisk, når nøglerne er lagt ind.

**Daglig brug:**
- På ordren under "Faktura og betaling": udsted faktura (med forhåndsvisning), registrér betaling (kontant, kort, MobilePay, bankoverførsel) og lav kreditnota med begrundelse.
- En udstedt faktura kan ikke ændres eller slettes. Rettelser laves altid som kreditnota og eventuelt en ny faktura.
- PDF'en dannes på serveren efter skabelonen og gemmes privat. Den åbnes fra ordren, kundekortet eller siden Fakturaer.
- Når en ordre sættes til "Klar til afhentning", sendes fakturamail og en SMS om afhentning automatisk. Mislykkede forsøg prøves igen med stigende pause. Status for hver besked ses på ordren og kundekortet, og beskeder kan gensendes.
- Siden **Fakturaer** viser alle fakturaer med status for betaling og afsendelse, ordrer der mangler opfølgning, og eksport til CSV for bogholderiet.
- En påmindelse om ikke-afhentede ordrer dannes automatisk hver time efter de regler, der er sat i Administration.

## Endnu ikke bygget (fase 4)
- Delvis afhentning pr. del og restmaterialer
- Leveringskvitteringer fra mail/SMS (webhooks) og web-push
- Kobling til regnskabsprogram
- Kapacitet pr. skrædder, restmaterialer, reklamationer, prisregler og automatisk skummål
