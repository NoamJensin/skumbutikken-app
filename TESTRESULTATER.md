# Testresultater – fase 1 (9. november 2026)

Testene er kørt direkte mod produktionsdatabasen i en transaktion, der blev rullet tilbage. Hver test kørte som en separat testbruger: én butiksbruger og én skræddersbruger, hver med sine egne JWT-claims.

| # | Test | Resultat |
|---|---|---|
| T1 | Ordre med manglende oplysninger → "Klar til kundens bekræftelse" | ✅ Afvist. Mangler returneres pr. felt og pr. ordredel (færdigdato, længde, bredde, tykkelse, skumtype, stof), og ordren forbliver kladde |
| T2 | Klargøring med forældet rækkeversion (samtidig ændring) | ✅ Afvist med `konflikt` |
| T3 | Klargøring af komplet ordre + beløb | ✅ Version 1 låst. 2 × 1.625,00 kr. ekskl. moms → moms 812,50 kr., total 4.062,50 kr., rest efter 500,00 kr. depositum: 3.562,50 kr. |
| T4 | Prisændring under kundens gennemgang, derefter bekræftelse af den gamle version | ✅ Ordren falder tilbage til kladde, og bekræftelse af version 1 afvises (`ny_version`) |
| T5 | Ny version, bekræftelse og dobbelttryk | ✅ Version 2 bekræftet. Andet tryk returnerer samme bekræftelse, og der gemmes præcis 1 bekræftelse. Skrædderopgaven oprettes |
| T6 | Skrædderens rettigheder | ✅ Ser 0 kunder og 0 ordrer direkte. Ser 1 opgave via sin opgaveliste, uden priser. Adgang til totaler afvises. Får notifikationen "Ny opgave" |
| T7 | Fremdrift 50 % → 100 % | ✅ Status `i_gang` ved 50 %. Ved 100 % meldes opgaven automatisk færdig, og ordren går til kontrol |
| T8 | Skrædder forsøger at ændre pris direkte via API | ✅ 0 rækker ændret, og prisen er uændret |
| T9 | Spørgsmål fra skrædder og færdigmelding | ✅ Butikken får notifikationerne `spoergsmaal` og `kontrol` |
| T11 | Ændring af mål efter frigivelse | ✅ Ordren markeres "kræver ny kundebekræftelse", og kontrolgodkendelse blokeres indtil da |
| T12 | Ny bekræftelse og godkendelse | ✅ Version 2 bekræftet og godkendt, og ordren er klar til afhentning |
| T13 | Auditlog kun for administrator | ✅ Butiksbrugeren ser 0 rækker |

## Brugerflade
Brugerfladen er gennemgået visuelt med testdata i følgende størrelser:
- tablet liggende (1280×800): login, overblik, ordreformular med dele, kundevisning, skrædderens opgavevisning
- tablet stående (800×1280): ordreformular, skrædderens opgaveliste
- telefon (390×844): ordreliste

## Ikke testet endnu (kræver den udgivne app på rigtige enheder)
Arbejdsmiljøet, hvor appen blev bygget, har ikke netværksadgang til Supabase. Disse tests skal derfor køres på tablets, når appen er udgivet:
- Liveopdatering mellem to enheder og måling af forsinkelsen (mål: 95 % inden for 2 sekunder)
- Afbrudt netværk → kladde → genopretning
- Redigering af samme ordre fra to enheder i brugerfladen
- Upload af fotos fra tablet-kamera
- PIN-skift på den fælles tablet og deaktivering af en medarbejder med aktiv session
