# Cose da fare

Una lista delle cose da fare da condividere in famiglia: si usa dal browser o come app sul telefono, anche senza connessione.

**Il sito:** https://gfabozzo.github.io/lista-cose-da-fare/

## Cosa sa fare

- **Accesso senza password**: un link (o un codice) arriva via email.
- **Più liste** (per esempio Spesa, Casa, Vacanze), ognuna condivisa con chi vuoi.
- **Liste condivise**: chi ha creato una lista invita le persone con la loro email, e può toglierle. Gli altri membri possono uscire.
- **Tempo reale**: quello che aggiunge un'altra persona compare subito.
- **Chi ha aggiunto cosa**: accanto a ogni voce, il nome di chi l'ha scritta, con il suo colore.
- **Quantità** (− ×2 +), anche scrivendo direttamente "Latte x2".
- **Scadenze**: rosse se in ritardo, arancioni se per oggi o domani, con il filtro "In scadenza".
- **Promemoria all'apertura**: un riquadro in cima ricorda le cose in ritardo, di oggi e di domani di tutte le liste. Con ✕ si nasconde fino al giorno dopo.
- **Notifiche sul telefono**: ogni mattina alle 8 una notifica con le cose in ritardo, di oggi e di domani, anche con l'app chiusa. E quando qualcuno aggiunge una voce a una lista condivisa, gli altri membri ricevono subito una notifica.
- **Voci ricorrenti**: ogni giorno, settimana, mese o anno. Quando le spunti si spostano alla prossima data.
- **Riordinare** le voci trascinandole dalla maniglia ⠿.
- **Suggerimenti** mentre scrivi e **Annulla** dopo un'eliminazione.
- **Esportare** la lista: come testo, file per Excel, stampa o PDF.
- **Offline**: senza rete si vede l'ultima copia e si possono spuntare le voci, che vengono salvate quando torna la connessione.
- **Installabile come app** su Android e iPhone, con tema chiaro e scuro.

## Come è fatto

Il sito è fatto di file semplici, senza programmi da installare o compilare.

| File | Cosa contiene |
|---|---|
| `index.html` | La struttura della pagina: titolo, campi, pulsanti, sezioni. |
| `stile.css` | La grafica: colori, tema scuro, dimensioni del testo, versione per telefono e per la stampa. |
| `app.js` | Il funzionamento: accesso, database, liste, tempo reale, offline. |
| `service-worker.js` | Rende il sito installabile come app e lo fa aprire senza connessione. |
| `manifest.webmanifest` | Nome, colori e icone dell'app installata. |
| `icone/` | Le icone dell'app, create da `strumenti/crea_icone.py`. |
| `supabase/` | Il codice SQL che prepara il database (vedi sotto). |
| `supabase/functions/promemoria/` | La funzione che ogni mattina manda le notifiche. |
| `strumenti/crea_chiavi_notifiche.py` | Crea le chiavi per le notifiche (una volta sola). |

Usa due servizi gratuiti:

- **GitHub Pages** pubblica il sito a partire dal ramo `main` di questo repository.
- **Supabase** contiene il database e gestisce l'accesso. Le regole di protezione nel database fanno sì che ognuno veda solo le liste di cui fa parte.

Le librerie esterne arrivano da jsDelivr, con la versione scritta nell'indirizzo: [supabase-js](https://github.com/supabase/supabase-js) e [SortableJS](https://github.com/SortableJS/Sortable).

## Rimetterlo in piedi da zero

### 1. Il database su Supabase

1. Crea un progetto su [supabase.com](https://supabase.com).
2. In **SQL Editor** esegui i file della cartella `supabase/`, **uno alla volta e in quest'ordine**:
   1. `schema.sql`
   2. `condivisione.sql`
   3. `tempo-reale.sql`
   4. `piu-liste.sql`
   5. `nomi.sql`
   6. `ordine.sql`
   7. `quantita.sql`
   8. `scadenze.sql`
   9. `inviti-creatore.sql`
   10. `ricorrenti.sql`
   11. `notifiche.sql` (solo dopo aver fatto i passi del punto 4 qui sotto)

   Supabase può avvisare che alcuni comandi sono "distruttivi": in questi file `drop policy` toglie solo regole di protezione per sostituirle con quelle nuove, non cancella dati.
3. In **Authentication → URL Configuration** imposta:
   - **Site URL**: l'indirizzo del sito (per esempio `https://gfabozzo.github.io/lista-cose-da-fare/`);
   - **Redirect URLs**: lo stesso indirizzo, più `http://localhost:8766/` per le prove sul computer.

### 2. Le email di accesso

Il servizio email incluso in Supabase invia solo poche email all'ora e non permette di modificarle. Per questo progetto è collegato un account Gmail:

1. Sull'account Google attiva la verifica in due passaggi e crea una **password per le app**.
2. In Supabase, **Authentication → Emails → Set up SMTP**: host `smtp.gmail.com`, porta `465`, utente e mittente l'indirizzo Gmail, password quella per le app.
3. In **Authentication → Rate Limits** alza il limite di email all'ora.
4. Nel modello **Magic link or OTP** aggiungi il codice, che serve per entrare dall'app installata su iPhone:

   ```html
   <p>Oppure scrivi questo codice nell'app: <strong>{{ .Token }}</strong></p>
   ```

### 3. Collegare il sito al database

In cima ad `app.js` ci sono due valori, presi da Supabase (**Connect** o **Project Settings → API Keys**):

```js
const SUPABASE_URL = 'https://…supabase.co';
const SUPABASE_CHIAVE = 'sb_publishable_…';
```

La chiave **publishable** è fatta per stare in una pagina pubblica: la protezione dei dati sta nelle regole del database. La chiave **secret** (o `service_role`) invece non va mai messa nel sito né condivisa.

### 4. Le notifiche

1. Dalla cartella del progetto, nel Terminale: `python3 strumenti/crea_chiavi_notifiche.py`. Scrive la chiave pubblica in `app.js` e nella funzione, e mostra la chiave **privata**.
2. In Supabase, **Edge Functions → Secrets**: aggiungi `CHIAVE_PRIVATA_NOTIFICHE` con la chiave privata. Non va scritta da nessun'altra parte.
3. In **Edge Functions → Deploy a new function → Via Editor**: nome `promemoria`, incolla il contenuto di `supabase/functions/promemoria/index.ts` e pubblica. Poi, nelle impostazioni della funzione, **disattiva "Verify JWT"** (la funzione controlla da sola chi la chiama).
4. Esegui `supabase/notifiche.sql`: crea la tabella dei dispositivi e l'orologio che chiama la funzione ogni mattina.

Se cambi la funzione, va incollata di nuovo in Supabase: non si aggiorna con `git push`. Per copiarla senza rovinare emoji e accenti: `LANG=en_US.UTF-8 pbcopy < supabase/functions/promemoria/index.ts`.

### 5. Pubblicare

Nelle impostazioni del repository su GitHub, **Pages** pubblica dal ramo `main`, cartella principale. Dopo ogni `git push` il sito si aggiorna in circa un minuto.

## Lavorare sul progetto

Per provare il sito sul computer, dalla cartella del progetto:

```bash
python3 -m http.server 8766
```

e apri http://localhost:8766/.

Il modo di lavorare usato finora:

1. un **ramo** nuovo per ogni modifica (`git switch -c nome-modifica`);
2. modifiche e prova su localhost;
3. **commit**;
4. unione in `main` (`git switch main`, `git merge nome-modifica`) e `git push`.

Da ricordare:

- Se una modifica ha un nuovo file SQL, va eseguito in Supabase **prima** di aprire la pagina nuova, altrimenti compare l'errore "column … does not exist". Va poi aggiunto all'elenco qui sopra.
- Se cambi l'indirizzo di una libreria (per esempio la versione di supabase-js), aggiornalo sia in `index.html` sia in `service-worker.js`, e cambia il nome `CACHE` nel service worker (per esempio da `cose-da-fare-v4` a `cose-da-fare-v5`), così i telefoni scaricano la versione nuova.
- Dopo un aggiornamento, sul telefono può servire chiudere e riaprire l'app.
