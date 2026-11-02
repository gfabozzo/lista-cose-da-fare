// Tutto il funzionamento della lista: accesso, database, liste condivise, tempo reale, offline

// Collegamento a Supabase: questi due valori sono pensati per stare in una pagina pubblica.
// La protezione dei dati è data dalle regole nel database (vedi supabase/schema.sql).
const SUPABASE_URL = 'https://nfhcggivsdorubguqfgy.supabase.co';
const SUPABASE_CHIAVE = 'sb_publishable_D9I38RUtZvfA7FI6B1kefA_dgnK2ONY';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_CHIAVE);

const form = document.getElementById('form');
const testo = document.getElementById('testo');
const lista = document.getElementById('lista');
const conteggio = document.getElementById('conteggio');
const svuota = document.getElementById('svuota');
const accesso = document.getElementById('accesso');
const app = document.getElementById('app');
const messaggio = document.getElementById('messaggio');

// Chiave della vecchia lista salvata solo nel browser
const CHIAVE = 'cose-da-fare';

// Qualsiasi errore imprevisto viene mostrato sulla pagina, invece di restare nascosto
window.addEventListener('error', (e) => mostraMessaggio('Errore imprevisto: ' + e.message, true));
window.addEventListener('unhandledrejection', (e) => mostraMessaggio('Errore imprevisto: ' + (e.reason?.message || e.reason), true));

function mostraMessaggio(testoMessaggio, errore = false) {
  messaggio.textContent = testoMessaggio;
  messaggio.classList.toggle('errore', errore);
  messaggio.hidden = !testoMessaggio;
}

// Se il database risponde con un errore, lo mostra e ricarica la lista vera
function gestisciErrore(error) {
  if (!error) return false;
  console.error(error);
  if (eErroreDiRete(error)) {
    mostraMessaggio('Sei senza connessione: questa modifica non è stata salvata.', true);
    return true;
  }
  mostraMessaggio('Non sono riuscito a salvare la modifica: ' + error.message, true);
  caricaVoci();
  return true;
}

// ---- Senza connessione ----
// La pagina tiene una copia delle liste nel browser: senza rete mostra quella,
// e le spunte fatte nel frattempo vengono inviate appena torna la connessione.

function eErroreDiRete(error) {
  return !navigator.onLine || /offline|fetch|network|load failed|internet/i.test(error?.message || '');
}

function leggiCopia(chiave, predefinito) {
  try { return JSON.parse(localStorage.getItem('copia-' + chiave)) ?? predefinito; } catch { return predefinito; }
}

function scriviCopia(chiave, valore) {
  try { localStorage.setItem('copia-' + chiave, JSON.stringify(valore)); } catch {}
}

// Salva le voci della lista attiva così come si vedono
function salvaCopiaVoci() {
  if (!listaAttiva) return;
  scriviCopia('voci-' + listaAttiva, [...lista.children].map((li) => ({
    id: li.dataset.id,
    testo: li.querySelector('span')?.textContent ?? li.querySelector('.modifica')?.value ?? '',
    fatto: li.classList.contains('fatto'),
    user_id: li.querySelector('.chi')?.dataset.utente,
    posizione: Number(li.dataset.posizione),
    quantita: Number(li.dataset.quantita) || 1,
    scadenza: li.dataset.scadenza || null,
    ripeti: li.dataset.ripeti || null,
  })));
}

// Modifiche fatte senza connessione: { id della voce: { campi da salvare } }
// (le versioni precedenti salvavano solo sì/no per "fatta": vengono lette allo stesso modo)
function campiInAttesa(valore) {
  return typeof valore === 'boolean' ? { fatto: valore } : valore;
}

function mettiInAttesa(id, campi) {
  const inAttesa = leggiCopia('in-attesa', {});
  scriviCopia('in-attesa', { ...inAttesa, [id]: { ...campiInAttesa(inAttesa[id] ?? {}), ...campi } });
  aggiornaStatoRete();
}

async function inviaInAttesa() {
  const inAttesa = leggiCopia('in-attesa', {});
  for (const [id, valore] of Object.entries(inAttesa)) {
    const { error } = await db.from('voci').update(campiInAttesa(valore)).eq('id', id);
    if (error && eErroreDiRete(error)) return; // la rete è di nuovo caduta: si riprova dopo
    delete inAttesa[id];
    scriviCopia('in-attesa', inAttesa);
  }
  aggiornaStatoRete();
}

function aggiornaStatoRete() {
  const offline = !navigator.onLine;
  const inAttesa = Object.keys(leggiCopia('in-attesa', {})).length;
  document.body.classList.toggle('offline', offline);
  const stato = document.getElementById('stato-rete');
  stato.hidden = !offline && !inAttesa;
  stato.textContent = offline
    ? '📴 Sei senza connessione: vedi l\'ultima copia salvata. Puoi spuntare le voci, le salvo appena torna la rete.'
      + (inAttesa ? ` (${inAttesa} da salvare)` : '')
    : `⏳ Sto salvando ${inAttesa} ${inAttesa === 1 ? 'modifica fatta' : 'modifiche fatte'} senza connessione…`;
}

window.addEventListener('offline', aggiornaStatoRete);
window.addEventListener('online', async () => {
  aggiornaStatoRete();
  if (!utenteAttuale) return;
  // Fa rinnovare l'accesso a Supabase, se nel frattempo era scaduto
  await db.auth.getSession();
  await inviaInAttesa();
  await aggiornaTutto();
});

function aggiornaConteggio() {
  const restanti = lista.querySelectorAll('li:not(.fatto)').length;
  conteggio.textContent = restanti === 0 ? 'Nessuna cosa da fare'
    : restanti === 1 ? 'Ti resta 1 cosa da fare'
    : `Ti restano ${restanti} cose da fare`;
  // Il pulsante compare solo se c'è almeno una voce completata
  svuota.hidden = !lista.querySelector('li.fatto');
  salvaCopiaVoci();
  mostraPromemoria();
}

function aggiungiVoce(voce) {
  const li = document.createElement('li');
  li.dataset.id = voce.id;
  li.dataset.posizione = voce.posizione;

  // Maniglia per trascinare la voce (non è uno <span>, perché lo span è il testo della voce)
  const maniglia = document.createElement('div');
  maniglia.className = 'maniglia';
  maniglia.textContent = '⠿';
  maniglia.title = 'Trascina per spostare';
  if (voce.fatto) li.classList.add('fatto');

  const casella = document.createElement('input');
  casella.type = 'checkbox';
  casella.checked = voce.fatto;
  casella.title = 'Segna come fatta';
  casella.addEventListener('change', async () => {
    let campi = { fatto: casella.checked };
    if (casella.checked && li.dataset.ripeti) {
      // Voce ricorrente: invece di restare fatta, si sposta alla prossima scadenza
      const prossima = prossimaScadenza(li.dataset.scadenza || oggiIso(), li.dataset.ripeti);
      campi = { fatto: false, scadenza: prossima };
      casella.checked = false;
      mostraMessaggio(`Fatto! "${span.textContent}" torna ${prossima === oggiIso(1) ? 'domani' : 'il ' + dataLeggibile(prossima)}.`);
    }
    li.classList.toggle('fatto', campi.fatto);
    mostraScadenza(li, campi.scadenza ?? li.dataset.scadenza);
    aggiornaConteggio();
    if (!navigator.onLine) return mettiInAttesa(li.dataset.id, campi);
    const { error } = await db.from('voci').update(campi).eq('id', li.dataset.id);
    if (error && eErroreDiRete(error)) return mettiInAttesa(li.dataset.id, campi);
    gestisciErrore(error);
  });

  const span = document.createElement('span');
  span.textContent = voce.testo;
  span.title = 'Doppio clic per modificare';
  span.addEventListener('dblclick', () => modificaVoce(li, span));

  const elimina = document.createElement('button');
  elimina.className = 'elimina';
  elimina.textContent = '✕';
  elimina.title = 'Elimina';
  elimina.addEventListener('click', () => eliminaVoce(li));

  // Chi ha aggiunto la voce: il nome viene riempito da aggiornaEtichette()
  const chi = document.createElement('small');
  chi.className = 'chi';
  chi.dataset.utente = voce.user_id;
  riempiEtichetta(chi);

  // Quantità: − ×2 +
  const quantita = document.createElement('div');
  quantita.className = 'quantita';
  const meno = document.createElement('button');
  meno.textContent = '−';
  meno.title = 'Togli uno';
  const numero = document.createElement('small');
  numero.className = 'numero';
  const piu = document.createElement('button');
  piu.textContent = '+';
  piu.title = 'Aggiungi uno';
  quantita.append(meno, numero, piu);
  meno.addEventListener('click', () => cambiaQuantita(li, -1));
  piu.addEventListener('click', () => cambiaQuantita(li, +1));

  // Testo e nome di chi l'ha aggiunta stanno insieme: su schermi stretti il nome va a capo sotto il testo
  const corpo = document.createElement('div');
  corpo.className = 'corpo';
  corpo.append(span, chi, creaScadenza(li));

  li.append(maniglia, casella, corpo, quantita, elimina);
  mostraQuantita(li, voce.quantita ?? 1);
  mostraRipeti(li, voce.ripeti);
  mostraScadenza(li, voce.scadenza);
  inserisciInOrdine(li);
}

// Scadenza: un pulsante 📅 con sopra un selettore di data invisibile
function creaScadenza(li) {
  const etichetta = document.createElement('label');
  etichetta.className = 'scadenza';
  const testoData = document.createElement('small');
  const campo = document.createElement('input');
  campo.type = 'date';
  campo.title = 'Scadenza';
  // Sul computer il calendario va aperto esplicitamente; sul telefono si apre da solo
  campo.addEventListener('click', () => { try { campo.showPicker(); } catch {} });
  campo.addEventListener('change', async () => {
    const nuova = campo.value || null;
    mostraScadenza(li, nuova);
    const { error } = await db.from('voci').update({ scadenza: nuova }).eq('id', li.dataset.id);
    gestisciErrore(error);
  });
  etichetta.append(testoData, campo);

  // ✕ per togliere la data con un tocco, senza passare dal calendario
  const togli = document.createElement('button');
  togli.className = 'togli-scadenza';
  togli.textContent = '✕';
  togli.title = 'Togli la scadenza';
  togli.addEventListener('click', async () => {
    mostraScadenza(li, null);
    const { error } = await db.from('voci').update({ scadenza: null }).eq('id', li.dataset.id);
    gestisciErrore(error);
  });

  const gruppo = document.createElement('div');
  gruppo.className = 'gruppo-scadenza';
  gruppo.append(etichetta, togli, creaRipeti(li));
  return gruppo;
}

// Data di oggi come "2026-10-22", nel fuso orario di chi guarda
function oggiIso(spostamentoGiorni = 0) {
  const d = new Date();
  d.setDate(d.getDate() + spostamentoGiorni);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

// ---- Promemoria delle scadenze ----
// In cima alla pagina, un riquadro ricorda le cose da fare in ritardo, di oggi e di domani, in tutte le liste.
// Per la lista aperta legge le voci sulla pagina, così si aggiorna subito quando ne spunti una o cambi una data.
const promemoria = document.getElementById('promemoria');
const testoPromemoria = document.getElementById('testo-promemoria');
let scadenzeTutteLeListe = [];

async function caricaScadenze() {
  const { data, error } = navigator.onLine
    ? await db.from('voci').select('testo, scadenza, lista_id').eq('fatto', false).lte('scadenza', oggiIso(1))
    : { data: null, error: { message: 'offline' } };
  // Senza connessione usa le copie salvate delle liste
  scadenzeTutteLeListe = error
    ? mieListe.flatMap((l) => leggiCopia('voci-' + l.id, [])
      .filter((v) => !v.fatto && v.scadenza && v.scadenza <= oggiIso(1))
      .map((v) => ({ ...v, lista_id: l.id })))
    : data;
  mostraPromemoria();
}

function mostraPromemoria() {
  // Le voci della lista aperta prendono il posto di quelle lette prima dal database,
  // così restano giuste anche dopo essere passati a un'altra lista
  // (lista.dataset.lista dice di quale lista sono le voci sulla pagina, anche mentre se ne sta aprendo un'altra)
  const listaSullaPagina = lista.dataset.lista;
  scadenzeTutteLeListe = scadenzeTutteLeListe
    .filter((v) => v.lista_id !== listaSullaPagina)
    .concat([...lista.children]
      .filter((li) => !li.classList.contains('fatto') && li.dataset.scadenza && li.dataset.scadenza <= oggiIso(1))
      .map((li) => ({
        testo: li.querySelector('span')?.textContent ?? li.querySelector('.modifica')?.value ?? '',
        scadenza: li.dataset.scadenza,
        lista_id: listaSullaPagina,
      })));
  const daRicordare = scadenzeTutteLeListe.filter((v) => mieListe.some((l) => l.id === v.lista_id));
  let chiusoOggi = false;
  try { chiusoOggi = localStorage.getItem('promemoria-chiuso') === oggiIso(); } catch {}
  promemoria.hidden = !daRicordare.length || chiusoOggi;
  if (promemoria.hidden) return;

  const gruppi = [
    { classe: 'in-ritardo', titolo: '⚠️ In ritardo', vale: (s) => s < oggiIso() },
    { classe: 'oggi', titolo: '⏰ Oggi', vale: (s) => s === oggiIso() },
    { classe: 'domani', titolo: '📅 Domani', vale: (s) => s === oggiIso(1) },
  ];
  testoPromemoria.replaceChildren(...gruppi.map((gruppo) => {
    const voci = daRicordare.filter((v) => gruppo.vale(v.scadenza)).sort((a, b) => a.scadenza.localeCompare(b.scadenza));
    if (!voci.length) return null;
    const riga = document.createElement('p');
    riga.className = gruppo.classe;
    const titolo = document.createElement('strong');
    titolo.textContent = gruppo.titolo + ': ';
    riga.append(titolo);
    voci.forEach((v, i) => {
      if (i) riga.append(', ');
      // Le voci di un'altra lista sono un pulsante che apre quella lista
      const altraLista = v.lista_id !== listaAttiva;
      const voce = document.createElement(altraLista ? 'button' : 'span');
      voce.textContent = v.testo;
      if (altraLista) {
        const nomeLista = mieListe.find((l) => l.id === v.lista_id)?.nome;
        voce.title = `Apri la lista "${nomeLista}"`;
        voce.addEventListener('click', () => apriLista(v.lista_id));
        const nome = document.createElement('span');
        nome.className = 'nome-lista';
        nome.textContent = ` (${nomeLista})`;
        riga.append(voce, nome);
      } else {
        riga.append(voce);
      }
    });
    return riga;
  }).filter(Boolean));
}

document.getElementById('chiudi-promemoria').addEventListener('click', () => {
  try { localStorage.setItem('promemoria-chiuso', oggiIso()); } catch {}
  promemoria.hidden = true;
});

// ---- Voci ricorrenti ----
const NOMI_RIPETI = { giorno: 'ogni giorno', settimana: 'ogni settimana', mese: 'ogni mese', anno: 'ogni anno' };

// Un 🔁 con sopra un menu invisibile per scegliere ogni quanto si ripete la voce
function creaRipeti(li) {
  const etichetta = document.createElement('label');
  etichetta.className = 'ripeti';
  const testoRipeti = document.createElement('small');
  const scelta = document.createElement('select');
  scelta.title = 'Si ripete';
  scelta.append(new Option('Non si ripete', ''),
    ...Object.entries(NOMI_RIPETI).map(([valore, nome]) => new Option(nome[0].toUpperCase() + nome.slice(1), valore)));
  scelta.addEventListener('change', async () => {
    const campi = { ripeti: scelta.value || null };
    // Una voce ricorrente senza data parte da oggi
    if (campi.ripeti && !li.dataset.scadenza) campi.scadenza = oggiIso();
    mostraRipeti(li, campi.ripeti);
    if (campi.scadenza) mostraScadenza(li, campi.scadenza);
    salvaCopiaVoci();
    const { error } = await db.from('voci').update(campi).eq('id', li.dataset.id);
    gestisciErrore(error);
  });
  etichetta.append(testoRipeti, scelta);
  return etichetta;
}

function mostraRipeti(li, ripeti) {
  const etichetta = li.querySelector('.ripeti');
  li.dataset.ripeti = ripeti || '';
  etichetta.querySelector('select').value = ripeti || '';
  etichetta.querySelector('small').textContent = ripeti ? '🔁 ' + NOMI_RIPETI[ripeti] : '🔁';
  etichetta.title = ripeti ? 'Si ripete ' + NOMI_RIPETI[ripeti] : 'Fai ripetere questa voce';
  etichetta.classList.toggle('vuota', !ripeti);
}

// La data dopo "dataIso" di un giorno, una settimana, un mese o un anno; se finisse nel passato
// o oggi (voce in ritardo), va avanti finché non arriva a una data futura
function prossimaScadenza(dataIso, ripeti) {
  const [anno, mese, giorno] = dataIso.split('-').map(Number);
  const oggi = oggiIso();
  let n = 0;
  let prossima;
  do {
    n++;
    let d;
    if (ripeti === 'giorno') d = new Date(anno, mese - 1, giorno + n);
    else if (ripeti === 'settimana') d = new Date(anno, mese - 1, giorno + 7 * n);
    else {
      // Mesi e anni: stesso giorno del mese, ma il 31 diventa l'ultimo giorno dei mesi più corti
      d = ripeti === 'mese' ? new Date(anno, mese - 1 + n, 1) : new Date(anno + n, mese - 1, 1);
      d.setDate(Math.min(giorno, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    }
    prossima = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  } while (prossima <= oggi && n < 1000);
  return prossima;
}

function mostraScadenza(li, scadenza) {
  const etichetta = li.querySelector('.scadenza');
  const testoData = etichetta.querySelector('small');
  etichetta.querySelector('input').value = scadenza || '';
  li.dataset.scadenza = scadenza || '';
  // Quando cambi una data, il promemoria in cima si aggiorna subito
  if (li.isConnected) mostraPromemoria();
  li.classList.remove('in-ritardo', 'vicina', 'urgente');
  etichetta.classList.toggle('vuota', !scadenza);
  li.querySelector('.togli-scadenza').hidden = !scadenza;
  if (!scadenza) {
    testoData.textContent = '📅';
    etichetta.title = 'Aggiungi una scadenza';
    return;
  }
  const oggi = oggiIso();
  const nomi = { [oggiIso(-1)]: 'ieri', [oggi]: 'oggi', [oggiIso(1)]: 'domani' };
  const [anno, mese, giorno] = scadenza.split('-').map(Number);
  const data = new Date(anno, mese - 1, giorno);
  testoData.textContent = '📅 ' + (nomi[scadenza] || data.toLocaleDateString('it-IT', {
    day: 'numeric', month: 'short', year: 'numeric',
  }));
  etichetta.title = 'Scadenza: ' + data.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Le date si possono confrontare come testo perché sono nel formato anno-mese-giorno
  if (!li.classList.contains('fatto')) {
    if (scadenza < oggi) li.classList.add('in-ritardo', 'urgente');
    else if (scadenza <= oggiIso(1)) li.classList.add('vicina', 'urgente');
    else if (scadenza <= oggiIso(7)) li.classList.add('urgente');
  }
}

function mostraQuantita(li, quantita) {
  li.dataset.quantita = quantita;
  li.querySelector('.quantita .numero').textContent = '×' + quantita;
  li.classList.toggle('piu-di-uno', quantita > 1);
}

async function cambiaQuantita(li, differenza) {
  const nuova = Math.min(999, Math.max(1, Number(li.dataset.quantita) + differenza));
  if (nuova === Number(li.dataset.quantita)) return;
  mostraQuantita(li, nuova);
  const { error } = await db.from('voci').update({ quantita: nuova }).eq('id', li.dataset.id);
  gestisciErrore(error);
}

function eliminaVoce(li) {
  eliminaConAnnulla([li], `"${li.querySelector('span')?.textContent ?? 'Voce'}" eliminata`);
}

// ---- Annulla eliminazione ----
// Le voci spariscono subito, ma vengono cancellate dal database solo dopo 6 secondi:
// fino ad allora il pulsante "Annulla" le rimette al loro posto.
let eliminazioneInAttesa = null;
const avvisoAnnulla = document.getElementById('avviso-annulla');

function eliminaConAnnulla(voci, descrizione) {
  confermaEliminazione(); // se ce n'era già una in attesa, la completa subito
  voci.forEach((li) => li.remove());
  aggiornaConteggio();
  document.getElementById('testo-annulla').textContent = descrizione;
  avvisoAnnulla.hidden = false;
  eliminazioneInAttesa = { voci, timer: setTimeout(confermaEliminazione, 6000) };
}

async function confermaEliminazione() {
  if (!eliminazioneInAttesa) return;
  const { voci, timer } = eliminazioneInAttesa;
  eliminazioneInAttesa = null;
  clearTimeout(timer);
  avvisoAnnulla.hidden = true;
  const { error } = await db.from('voci').delete().in('id', voci.map((li) => li.dataset.id));
  gestisciErrore(error);
}

document.getElementById('annulla').addEventListener('click', () => {
  if (!eliminazioneInAttesa) return;
  const { voci, timer } = eliminazioneInAttesa;
  eliminazioneInAttesa = null;
  clearTimeout(timer);
  avvisoAnnulla.hidden = true;
  voci.filter((li) => !trovaVoce(li.dataset.id)).forEach(inserisciInOrdine);
  aggiornaConteggio();
});

// Se chiudi l'app o cambi lista mentre l'avviso è visibile, l'eliminazione viene completata subito
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') confermaEliminazione();
});

// Sostituisce il testo con un campo modificabile: Invio salva, Esc annulla
function modificaVoce(li, span) {
  const campo = document.createElement('input');
  campo.className = 'modifica';
  campo.value = span.textContent;
  span.replaceWith(campo);
  campo.focus();
  campo.select();

  let finito = false;
  async function chiudi(conferma) {
    if (finito) return;
    finito = true;
    const nuovo = campo.value.trim();
    campo.replaceWith(span);
    if (!conferma || nuovo === span.textContent) return;
    if (!nuovo) {
      // Se il testo è stato cancellato, elimina la voce
      return eliminaVoce(li);
    }
    span.textContent = nuovo;
    const { error } = await db.from('voci').update({ testo: nuovo }).eq('id', li.dataset.id);
    gestisciErrore(error);
  }

  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') chiudi(true);
    if (e.key === 'Escape') chiudi(false);
  });
  campo.addEventListener('blur', () => chiudi(true));
}

// La lista che stai guardando (puoi averne più di una se qualcuno ti invita)
let listaAttiva = null;
let mieListe = [];
const sceltaLista = document.getElementById('liste');

function creatoreListaAttiva() {
  return mieListe.find((l) => l.id === listaAttiva)?.creata_da;
}

async function preparaListe() {
  // Accetta gli inviti per la tua email e crea la tua prima lista se non ne hai
  let { data, error } = navigator.onLine ? await db.rpc('prepara_liste') : { data: null, error: { message: 'offline' } };
  if (error && eErroreDiRete(error) && leggiCopia('liste', []).length) {
    data = leggiCopia('liste', []);
    error = null;
  } else if (!error) {
    scriviCopia('liste', data);
  }
  if (error) {
    console.error(error);
    mostraMessaggio('Non riesco a caricare le tue liste: ' + error.message, true);
    return false;
  }
  mieListe = data;
  let preferita = listaAttiva;
  try { preferita = preferita || localStorage.getItem('lista-attiva'); } catch {}
  listaAttiva = data.some((l) => l.id === preferita) ? preferita : data[0].id;

  mostraListe();
  return true;
}

function mostraListe() {
  sceltaLista.replaceChildren(...mieListe.map((l) => new Option(l.nome, l.id, false, l.id === listaAttiva)));
  // Solo chi ha creato la lista può eliminarla
  document.getElementById('elimina-lista').hidden = creatoreListaAttiva() !== utenteAttuale;
}

function apriLista(id) {
  confermaEliminazione();
  listaAttiva = id;
  try { localStorage.setItem('lista-attiva', listaAttiva); } catch {}
  mostraListe();
  caricaVoci();
  caricaPersone();
}

sceltaLista.addEventListener('change', () => apriLista(sceltaLista.value));

document.getElementById('nuova-lista').addEventListener('click', async () => {
  const nome = prompt('Come vuoi chiamare la nuova lista?', 'Spesa')?.trim();
  if (!nome) return;
  const { data, error } = await db.rpc('crea_lista', { nome_lista: nome.slice(0, 100) });
  if (error) {
    mostraMessaggio('Non sono riuscito a creare la lista: ' + error.message, true);
    return;
  }
  mieListe.push(data);
  apriLista(data.id);
  mostraMessaggio(`Lista "${data.nome}" creata. Puoi condividerla da "Condividi la lista".`);
});

document.getElementById('rinomina-lista').addEventListener('click', async () => {
  const attuale = mieListe.find((l) => l.id === listaAttiva);
  const nome = prompt('Nuovo nome della lista:', attuale.nome)?.trim();
  if (!nome || nome === attuale.nome) return;
  const { error } = await db.from('liste').update({ nome: nome.slice(0, 100) }).eq('id', listaAttiva);
  if (error) {
    mostraMessaggio('Non sono riuscito a rinominare la lista: ' + error.message, true);
    return;
  }
  attuale.nome = nome.slice(0, 100);
  mostraListe();
});

document.getElementById('elimina-lista').addEventListener('click', async () => {
  const attuale = mieListe.find((l) => l.id === listaAttiva);
  if (!confirm(`Vuoi eliminare la lista "${attuale.nome}" con tutte le sue voci? Sparirà anche per le persone con cui la condividi.`)) return;
  const { error } = await db.from('liste').delete().eq('id', listaAttiva);
  if (error) {
    mostraMessaggio('Non sono riuscito a eliminare la lista: ' + error.message, true);
    return;
  }
  listaAttiva = null;
  try { localStorage.removeItem('lista-attiva'); } catch {}
  mostraMessaggio(`Lista "${attuale.nome}" eliminata.`);
  // Se era l'ultima, ne viene creata una nuova vuota
  await aggiornaTutto();
});

// Mostra chi fa parte della lista e chi è stato invitato
const persone = document.getElementById('persone');

// Nome e colore di ogni persona della lista attiva, per le etichette sulle voci
let nomiPersone = new Map();
let listaCondivisa = false;
const TINTE = [265, 25, 145, 200, 330, 45, 175, 0];

function tintaDi(userId) {
  let somma = 0;
  for (const c of userId) somma = (somma * 31 + c.charCodeAt(0)) >>> 0;
  return somma % TINTE.length;
}

function riempiEtichetta(chi) {
  const persona = nomiPersone.get(chi.dataset.utente);
  // Nelle liste non condivise l'etichetta non serve
  chi.textContent = listaCondivisa && persona ? persona.nome : '';
  chi.title = listaCondivisa && persona ? 'Aggiunta da ' + persona.nome : '';
  if (persona) chi.style.setProperty('--h', persona.tinta);
}

function aggiornaEtichette() {
  lista.querySelectorAll('.chi').forEach(riempiEtichetta);
}

async function caricaPersone() {
  const senzaRete = { data: null, error: { message: 'offline' } };
  const [membri, inviti] = !navigator.onLine ? [senzaRete, senzaRete] : await Promise.all([
    db.from('membri').select('user_id, email').eq('lista_id', listaAttiva),
    db.from('inviti').select('email').eq('lista_id', listaAttiva),
  ]);
  if (membri.error || inviti.error) {
    console.error(membri.error || inviti.error);
    const copia = leggiCopia('persone-' + listaAttiva, null);
    if (copia) {
      nomiPersone = new Map(copia.nomi);
      listaCondivisa = copia.condivisa;
      aggiornaEtichette();
    }
    return;
  }
  const profili = await db.from('profili').select('user_id, nome')
    .in('user_id', membri.data.map((m) => m.user_id));
  const nomiScelti = new Map((profili.data || []).map((p) => [p.user_id, p.nome]));

  // Ogni persona prende la sua tinta; se è già presa da un altro nella lista, la successiva libera
  nomiPersone = new Map();
  const tinteUsate = new Set();
  for (const m of [...membri.data].sort((a, b) => a.user_id.localeCompare(b.user_id))) {
    let i = tintaDi(m.user_id);
    while (tinteUsate.has(i) && tinteUsate.size < TINTE.length) i = (i + 1) % TINTE.length;
    tinteUsate.add(i);
    nomiPersone.set(m.user_id, { nome: nomiScelti.get(m.user_id) || m.email.split('@')[0], tinta: TINTE[i] });
  }
  listaCondivisa = membri.data.length > 1;
  scriviCopia('persone-' + listaAttiva, { nomi: [...nomiPersone], condivisa: listaCondivisa });
  aggiornaEtichette();

  const creatore = creatoreListaAttiva();
  const sonoCreatore = creatore === utenteAttuale;
  persone.replaceChildren();
  for (const m of membri.data) {
    const io = m.user_id === utenteAttuale;
    const ruolo = m.user_id === creatore ? 'ha creato la lista' : 'membro';
    // Solo chi ha creato la lista può togliere gli altri
    const togli = sonoCreatore && !io ? {
      titolo: 'Togli dalla lista',
      azione: () => togliMembro(m),
    } : null;
    aggiungiPersona(m.email, (io ? 'tu · ' : '') + ruolo, togli, nomiPersone.get(m.user_id));
  }
  for (const i of inviti.data) {
    // Solo chi ha creato la lista può annullare gli inviti
    aggiungiPersona(i.email, 'invito in attesa', sonoCreatore ? {
      titolo: 'Annulla invito',
      azione: async () => {
        const { error } = await db.from('inviti').delete().eq('lista_id', listaAttiva).eq('email', i.email);
        if (error) mostraMessaggio('Non sono riuscito ad annullare l\'invito: ' + error.message, true);
        caricaPersone();
      },
    } : null);
  }
  // Chi non ha creato la lista può uscirne, ma non invitare
  esci.hidden = sonoCreatore;
  document.getElementById('form-invito').hidden = !sonoCreatore;
  document.getElementById('nota-invito').hidden = !sonoCreatore;
  document.getElementById('nota-solo-creatore').hidden = sonoCreatore;
}

async function togliMembro(membro) {
  if (!confirm(`Vuoi togliere ${membro.email} dalla lista? Non potrà più vederla né modificarla.`)) return;
  const { error } = await db.from('membri').delete()
    .eq('lista_id', listaAttiva).eq('user_id', membro.user_id);
  if (error) {
    mostraMessaggio('Non sono riuscito a togliere ' + membro.email + ': ' + error.message, true);
  } else {
    mostraMessaggio(`${membro.email} non fa più parte della lista.`);
  }
  caricaPersone();
}

const esci = document.getElementById('esci-lista');
esci.addEventListener('click', async () => {
  if (!confirm('Vuoi uscire da questa lista? Per rientrare dovrai essere invitato di nuovo.')) return;
  const { error } = await db.from('membri').delete()
    .eq('lista_id', listaAttiva).eq('user_id', utenteAttuale);
  if (error) {
    mostraMessaggio('Non sono riuscito a farti uscire dalla lista: ' + error.message, true);
    return;
  }
  listaAttiva = null;
  try { localStorage.removeItem('lista-attiva'); } catch {}
  mostraMessaggio('Sei uscito dalla lista.');
  await aggiornaTutto();
});

function aggiungiPersona(email, stato, pulsanteAzione, persona) {
  const li = document.createElement('li');
  const nome = document.createElement('span');
  const etichetta = document.createElement('small');
  etichetta.className = 'stato';
  if (persona) {
    // Il nome nella pillola colorata, come sulle voci, e l'email accanto
    const pillola = document.createElement('small');
    pillola.className = 'chi';
    pillola.textContent = persona.nome;
    pillola.style.setProperty('--h', persona.tinta);
    nome.append(pillola, ' ');
    etichetta.textContent = email + ' · ' + stato;
  } else {
    nome.textContent = email + ' ';
    etichetta.textContent = '· ' + stato;
  }
  nome.append(etichetta);
  li.append(nome);
  if (pulsanteAzione) {
    const pulsante = document.createElement('button');
    pulsante.className = 'elimina';
    pulsante.textContent = '✕';
    pulsante.title = pulsanteAzione.titolo;
    pulsante.addEventListener('click', pulsanteAzione.azione);
    li.append(pulsante);
  }
  persone.append(li);
}

document.getElementById('form-invito').addEventListener('submit', async (e) => {
  e.preventDefault();
  const campo = document.getElementById('email-invito');
  const email = campo.value.trim().toLowerCase();
  const { error } = await db.from('inviti').insert({ lista_id: listaAttiva, email });
  if (error) {
    mostraMessaggio(error.code === '23505' ? `${email} è già stata invitata.` : 'Invito non riuscito: ' + error.message, true);
    return;
  }
  campo.value = '';
  mostraMessaggio(`Invito registrato! Di' a ${email} di aprire il sito e accedere con questa email.`);
  caricaPersone();
});

// Mette la voce al suo posto in base alla posizione
function inserisciInOrdine(li) {
  const dopo = [...lista.children].find((altra) => altra !== li && Number(altra.dataset.posizione) > Number(li.dataset.posizione));
  lista.insertBefore(li, dopo || null);
}

// Trascinamento delle voci: la nuova posizione è a metà tra le due voci vicine
Sortable.create(lista, {
  handle: '.maniglia',
  animation: 150,
  ghostClass: 'fantasma',
  onEnd: async ({ item: li, oldIndex, newIndex }) => {
    if (oldIndex === newIndex) return;
    const prima = li.previousElementSibling;
    const dopo = li.nextElementSibling;
    const pPrima = prima ? Number(prima.dataset.posizione) : null;
    const pDopo = dopo ? Number(dopo.dataset.posizione) : null;
    const nuova = prima && dopo ? (pPrima + pDopo) / 2
      : prima ? pPrima + 1
      : dopo ? pDopo - 1
      : 0;
    li.dataset.posizione = nuova;
    const { error } = await db.from('voci').update({ posizione: nuova }).eq('id', li.dataset.id);
    gestisciErrore(error);
  },
});

async function caricaVoci() {
  let { data, error } = navigator.onLine
    ? await db.from('voci').select('id, testo, fatto, user_id, posizione, quantita, scadenza, ripeti').eq('lista_id', listaAttiva).order('posizione')
    : { data: null, error: { message: 'offline' } };
  const senzaRete = error && eErroreDiRete(error);
  if (senzaRete && leggiCopia('voci-' + listaAttiva, null)) {
    const inAttesa = leggiCopia('in-attesa', {});
    data = leggiCopia('voci-' + listaAttiva, []).map((v) => (v.id in inAttesa ? { ...v, ...campiInAttesa(inAttesa[v.id]) } : v));
    error = null;
  }
  if (error) {
    console.error(error);
    mostraMessaggio('Non riesco a caricare la lista: ' + error.message, true);
    return;
  }
  // Le voci appena eliminate (in attesa di "Annulla") non devono ricomparire
  const inEliminazione = new Set(eliminazioneInAttesa?.voci.map((li) => li.dataset.id) ?? []);
  lista.replaceChildren();
  lista.dataset.lista = listaAttiva;
  data.filter((v) => !inEliminazione.has(v.id)).forEach(aggiungiVoce);
  aggiornaConteggio();
  if (!senzaRete) ascoltaModifiche();
  aggiornaSuggerimenti();
}

// Tempo reale: il database avvisa quando qualcuno aggiunge, modifica o elimina una voce
let canale = null;
let canaleLista = null;

function ascoltaModifiche() {
  if (canale && canaleLista === listaAttiva) return;
  smettiDiAscoltare();
  canaleLista = listaAttiva;
  canale = db.channel('voci-' + listaAttiva)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'voci', filter: `lista_id=eq.${listaAttiva}` },
      ({ new: voce }) => {
        if (trovaVoce(voce.id)) return;
        aggiungiVoce(voce);
        aggiornaConteggio();
      })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'voci', filter: `lista_id=eq.${listaAttiva}` },
      ({ new: voce }) => {
        const li = trovaVoce(voce.id);
        if (!li) return;
        li.classList.toggle('fatto', voce.fatto);
        li.querySelector('input[type="checkbox"]').checked = voce.fatto;
        // Se in quel momento la stai modificando tu, il testo non viene toccato
        const span = li.querySelector('span');
        if (span) span.textContent = voce.testo;
        mostraQuantita(li, voce.quantita ?? 1);
        mostraRipeti(li, voce.ripeti);
        mostraScadenza(li, voce.scadenza);
        // Se qualcuno l'ha spostata, la sposta anche qui
        if (Number(li.dataset.posizione) !== voce.posizione) {
          li.dataset.posizione = voce.posizione;
          inserisciInOrdine(li);
        }
        aggiornaConteggio();
      })
    // Le eliminazioni non si possono filtrare per lista: arriva solo l'id della voce
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'voci' },
      ({ old: voce }) => {
        trovaVoce(voce.id)?.remove();
        aggiornaConteggio();
      })
    .subscribe();
}

function smettiDiAscoltare() {
  if (canale) db.removeChannel(canale);
  canale = null;
  canaleLista = null;
}

function trovaVoce(id) {
  return [...lista.children].find((li) => li.dataset.id === id);
}

// La prima volta che accedi, sposta nel database le voci salvate prima solo nel browser
async function trasferisciVecchieVoci() {
  let vecchie = [];
  try { vecchie = JSON.parse(localStorage.getItem(CHIAVE)) || []; } catch {}
  if (!vecchie.length) return;
  const { error } = await db.from('voci').insert(vecchie.map((v) => ({ testo: v.testo, fatto: !!v.fatto, lista_id: listaAttiva })));
  if (error) {
    console.error(error);
    mostraMessaggio('Non sono riuscito a trasferire le voci salvate nel browser: ' + error.message, true);
    return;
  }
  try {
    localStorage.setItem(CHIAVE + '-copia', JSON.stringify(vecchie));
    localStorage.removeItem(CHIAVE);
  } catch {}
  mostraMessaggio(`Ho spostato ${vecchie.length} voci dal browser al tuo account.`);
}

// I filtri nascondono le voci con il CSS, senza toglierle dalla lista
const filtri = document.getElementById('filtri');
filtri.addEventListener('click', (e) => {
  const pulsante = e.target.closest('button');
  if (!pulsante) return;
  filtri.querySelectorAll('button').forEach((b) => b.classList.toggle('attivo', b === pulsante));
  lista.dataset.filtro = pulsante.dataset.filtro;
});

svuota.addEventListener('click', () => {
  const completate = [...lista.querySelectorAll('li.fatto')];
  eliminaConAnnulla(completate, completate.length === 1 ? '1 voce completata eliminata' : `${completate.length} voci completate eliminate`);
});

// ---- Suggerimenti mentre scrivi ----
// Vengono dalle voci di tutte le tue liste e da quelle che hai aggiunto in passato su questo dispositivo
// (anche se poi sono state eliminate). Le più usate compaiono per prime.
let testiDalDatabase = null;

function ricordaPerSuggerimenti(testoVoce) {
  const storico = leggiCopia('storico', []).filter((s) => s.toLowerCase() !== testoVoce.toLowerCase());
  scriviCopia('storico', [testoVoce, ...storico].slice(0, 300));
  aggiornaSuggerimenti();
}

async function aggiornaSuggerimenti() {
  if (testiDalDatabase === null && navigator.onLine) {
    const { data } = await db.from('voci').select('testo').limit(1000);
    testiDalDatabase = (data || []).map((v) => v.testo);
  }
  // Non suggerire quello che è già nella lista e non ancora fatto
  const giaPresenti = new Set([...lista.querySelectorAll('li:not(.fatto) .corpo > span')].map((s) => s.textContent.toLowerCase()));
  const conteggi = new Map();
  for (const testoVoce of [...leggiCopia('storico', []), ...(testiDalDatabase || [])]) {
    const chiave = testoVoce.trim().toLowerCase();
    if (!chiave || giaPresenti.has(chiave)) continue;
    const voce = conteggi.get(chiave) || { testo: testoVoce.trim(), volte: 0 };
    voce.volte++;
    conteggi.set(chiave, voce);
  }
  const ordinati = [...conteggi.values()].sort((a, b) => b.volte - a.volte).slice(0, 200);
  document.getElementById('suggerimenti').replaceChildren(...ordinati.map((v) => new Option('', v.testo)));
}

// "Latte x2", "Latte ×2" o "2x Latte" diventano la voce "Latte" con quantità 2
function leggiQuantita(scritto) {
  const inFondo = scritto.match(/^(.+?)\s*[x×]\s*(\d{1,3})$/i);
  const inCima = scritto.match(/^(\d{1,3})\s*[x×]\s+(.+)$/i);
  const [testoVoce, numero] = inFondo ? [inFondo[1], inFondo[2]] : inCima ? [inCima[2], inCima[1]] : [scritto, '1'];
  return { testo: testoVoce.trim(), quantita: Math.min(999, Math.max(1, Number(numero))) };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { testo: nuovo, quantita } = leggiQuantita(testo.value.trim());
  if (!nuovo) return;
  testo.value = '';
  const { data, error } = await db.from('voci').insert({ testo: nuovo, quantita, lista_id: listaAttiva }).select('id, testo, fatto, user_id, posizione, quantita, scadenza, ripeti').single();
  if (gestisciErrore(error)) return;
  // Potrebbe essere già arrivata tramite il tempo reale
  if (!trovaVoce(data.id)) aggiungiVoce(data);
  aggiornaConteggio();
  ricordaPerSuggerimenti(nuovo);
});

// Accesso con link via email
document.getElementById('form-accesso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pulsante = e.target.querySelector('button');
  const email = document.getElementById('email').value.trim();
  pulsante.disabled = true;
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  pulsante.disabled = false;
  if (error) {
    mostraMessaggio('Invio non riuscito: ' + error.message, true);
  } else {
    mostraMessaggio(`Fatto! Controlla la posta di ${email}: clicca il link oppure scrivi qui sotto il codice che trovi nella mail.`);
    formCodice.hidden = false;
  }
});

// In alternativa al link: il codice nella mail. Serve soprattutto nell'app installata su iPhone,
// perché lì il link si aprirebbe in Safari invece che nell'app.
const formCodice = document.getElementById('form-codice');
formCodice.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await db.auth.verifyOtp({
    email: document.getElementById('email').value.trim(),
    token: document.getElementById('codice').value.trim(),
    type: 'email',
  });
  if (error) mostraMessaggio('Codice non valido o scaduto: ' + error.message, true);
});

document.getElementById('esci').addEventListener('click', async () => {
  // Chi esce non deve più ricevere su questo dispositivo i promemoria delle sue liste
  try {
    const iscrizione = 'serviceWorker' in navigator && 'PushManager' in window ? await iscrizioneDiQuestoDispositivo() : null;
    if (iscrizione) {
      await db.from('iscrizioni_notifiche').delete().eq('endpoint', iscrizione.endpoint);
      await iscrizione.unsubscribe();
    }
  } catch (errore) {
    console.error(errore);
  }
  db.auth.signOut();
});

// Esportazione: le voci della lista attiva (tutte, anche quelle nascoste dai filtri)
function vociDaEsportare() {
  return [...lista.children].map((li) => ({
    testo: li.querySelector('span')?.textContent ?? li.querySelector('.modifica')?.value ?? '',
    fatta: li.classList.contains('fatto'),
    quantita: Number(li.dataset.quantita) || 1,
    scadenza: li.dataset.scadenza || '',
    ripeti: li.dataset.ripeti || '',
    chi: nomiPersone.get(li.querySelector('.chi')?.dataset.utente)?.nome || '',
  }));
}

function nomeListaAttiva() {
  return mieListe.find((l) => l.id === listaAttiva)?.nome || 'Lista';
}

function dataLeggibile(iso) {
  const [anno, mese, giorno] = iso.split('-').map(Number);
  return new Date(anno, mese - 1, giorno).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

document.getElementById('copia-testo').addEventListener('click', async () => {
  const righe = vociDaEsportare().map((v) =>
    (v.fatta ? '✅ ' : '⬜ ') + v.testo
    + (v.quantita > 1 ? ' ×' + v.quantita : '')
    + (v.scadenza ? ' (entro ' + dataLeggibile(v.scadenza) + ')' : '')
    + (v.ripeti ? ' 🔁 ' + NOMI_RIPETI[v.ripeti] : ''));
  const testoLista = nomeListaAttiva() + '\n\n' + righe.join('\n');
  try {
    await navigator.clipboard.writeText(testoLista);
    mostraMessaggio('Lista copiata! Ora puoi incollarla dove vuoi.');
  } catch {
    // Se il browser non permette di copiare, mostra il testo da copiare a mano
    prompt('Copia questo testo:', testoLista);
  }
});

document.getElementById('scarica-csv').addEventListener('click', () => {
  // Il punto e virgola e il segno iniziale (BOM) fanno aprire il file correttamente in Excel in italiano
  const cella = (valore) => '"' + String(valore).replaceAll('"', '""') + '"';
  const righe = [['Voce', 'Quantità', 'Fatta', 'Scadenza', 'Si ripete', 'Aggiunta da']]
    .concat(vociDaEsportare().map((v) => [v.testo, v.quantita, v.fatta ? 'sì' : 'no', v.scadenza, NOMI_RIPETI[v.ripeti] || '', v.chi]));
  const csv = '﻿' + righe.map((r) => r.map(cella).join(';')).join('\r\n');
  const collegamento = document.createElement('a');
  collegamento.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  collegamento.download = `${nomeListaAttiva()} ${oggiIso()}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  collegamento.click();
  setTimeout(() => URL.revokeObjectURL(collegamento.href), 1000);
});

document.getElementById('stampa').addEventListener('click', () => {
  document.getElementById('titolo-stampa').textContent = nomeListaAttiva();
  window.print();
});

// Il nome con cui ti vedono le persone con cui condividi le liste
document.getElementById('mio-nome').addEventListener('click', async () => {
  const attuale = nomiPersone.get(utenteAttuale)?.nome || '';
  const nome = prompt('Come vuoi farti chiamare nelle liste condivise?', attuale)?.trim();
  if (!nome || nome === attuale) return;
  const { error } = await db.from('profili').upsert({ user_id: utenteAttuale, nome: nome.slice(0, 40) });
  if (error) {
    mostraMessaggio('Non sono riuscito a salvare il nome: ' + error.message, true);
    return;
  }
  mostraMessaggio(`D'ora in poi ti vedranno come "${nome.slice(0, 40)}".`);
  caricaPersone();
});

// Mostra il login o la lista a seconda che tu abbia fatto l'accesso
let utenteAttuale = null;
db.auth.onAuthStateChange((evento, sessione) => {
  if (evento === 'SIGNED_OUT') try { localStorage.removeItem('copia-utente'); } catch {}
  if (sessione?.user) scriviCopia('utente', { id: sessione.user.id, email: sessione.user.email });
  // Senza connessione Supabase non può rinnovare l'accesso: si usa l'ultimo utente, solo per vedere la copia salvata
  const utente = sessione?.user ?? (!navigator.onLine && evento !== 'SIGNED_OUT' ? leggiCopia('utente', null) : null);
  if (utente?.id === utenteAttuale) return;
  utenteAttuale = utente?.id ?? null;

  accesso.hidden = !!utente;
  app.hidden = !utente;
  lista.replaceChildren();
  delete lista.dataset.lista;
  scadenzeTutteLeListe = [];
  // Anche questa chiamata a Supabase va fatta fuori da questa funzione, altrimenti può bloccare l'accesso
  setTimeout(smettiDiAscoltare, 0);
  if (!utente) {
    mostraMessaggio('');
    return;
  }
  document.getElementById('utente').textContent = utente.email;
  mostraMessaggio('');
  // Le chiamate al database vanno fatte fuori da questa funzione, come chiede Supabase
  setTimeout(async () => {
    const controllo = setTimeout(caricamentoBloccato, 8000);
    try {
      if (!(await preparaListe())) return;
      // Prima invia le spunte fatte l'ultima volta senza connessione
      if (navigator.onLine) await inviaInAttesa();
      await trasferisciVecchieVoci();
      await caricaVoci();
      await caricaPersone();
      await caricaScadenze();
      aggiornaPannelloNotifiche().catch((errore) => console.error(errore));
    } finally {
      clearTimeout(controllo);
    }
  }, 0);
});

// A volte, dopo tanto tempo che la pagina non veniva aperta, il caricamento resta in attesa
// per sempre. In quel caso ricarica la pagina una volta; se non basta, lo dice invece di restare vuota.
function caricamentoBloccato() {
  if (!navigator.onLine) return;
  let giaRicaricata = false;
  try { giaRicaricata = sessionStorage.getItem('ricaricata') === 'si'; } catch {}
  if (!giaRicaricata) {
    try { sessionStorage.setItem('ricaricata', 'si'); } catch {}
    location.reload();
    return;
  }
  mostraMessaggio('La lista non si carica. Controlla la connessione e ricarica la pagina.', true);
}

// Se la pagina si è caricata bene, la prossima volta potrà ricaricarsi di nuovo se serve
window.addEventListener('load', () => setTimeout(() => {
  if (listaAttiva) try { sessionStorage.removeItem('ricaricata'); } catch {}
}, 10000));

// Ricarica liste, voci e persone (per esempio se nel frattempo ti hanno tolto da una lista)
async function aggiornaTutto() {
  if (!(await preparaListe())) return;
  await caricaVoci();
  await caricaPersone();
  await caricaScadenze();
}

// Quando torni sulla pagina, ricarica tutto: così vedi le modifiche fatte dagli altri
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && utenteAttuale) aggiornaTutto();
});

// ---- Notifiche sul telefono ----
// Ogni mattina la funzione "promemoria" di Supabase manda una notifica ai dispositivi registrati qui
// (vedi supabase/notifiche.sql e supabase/functions/promemoria/index.ts).
const CHIAVE_PUBBLICA_NOTIFICHE = 'BCwbhMQqxMakW3Ejxu4-_Sc-hn8maqlxTEk1ppgRRoVcpdr2RY4kyiXcokNEmfAbbXEMJQdW14aN8OopviQFNCM';
const statoNotifiche = document.getElementById('stato-notifiche');
const attivaNotifiche = document.getElementById('attiva-notifiche');
const provaNotifica = document.getElementById('prova-notifica');
const disattivaNotifiche = document.getElementById('disattiva-notifiche');

function eIphone() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function eAppInstallata() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// La chiave pubblica è scritta in "base64url": il browser la vuole come sequenza di byte
function byteDaBase64Url(testoBase64) {
  const normale = (testoBase64 + '='.repeat((4 - testoBase64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normale), (c) => c.charCodeAt(0));
}

async function iscrizioneDiQuestoDispositivo() {
  const registrazione = await navigator.serviceWorker.getRegistration();
  return registrazione ? registrazione.pushManager.getSubscription() : null;
}

async function salvaIscrizione(iscrizione) {
  const { endpoint, keys } = iscrizione.toJSON();
  return db.from('iscrizioni_notifiche').upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
}

function mostraStatoNotifiche(testoStato, { attiva = false, prova = false, disattiva = false } = {}) {
  statoNotifiche.textContent = testoStato;
  attivaNotifiche.hidden = !attiva;
  provaNotifica.hidden = !prova;
  disattivaNotifiche.hidden = !disattiva;
}

async function aggiornaPannelloNotifiche() {
  if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) {
    mostraStatoNotifiche(eIphone() && !eAppInstallata()
      ? 'Su iPhone le notifiche arrivano solo all\'app aggiunta alla schermata Home: aggiungila e aprila da lì.'
      : 'Questo browser non può ricevere notifiche.');
    return;
  }
  if (Notification.permission === 'denied') {
    mostraStatoNotifiche('Hai bloccato le notifiche per questo sito: per riattivarle, cambia il permesso nelle impostazioni del browser o del telefono.');
    return;
  }
  const iscrizione = await iscrizioneDiQuestoDispositivo();
  if (!iscrizione) {
    mostraStatoNotifiche('Le notifiche non sono attive su questo dispositivo.', { attiva: true });
    return;
  }
  mostraStatoNotifiche('✅ Le notifiche sono attive su questo dispositivo.', { prova: true, disattiva: true });
  // Si assicura che il database conosca questo dispositivo (per esempio dopo un nuovo accesso)
  if (navigator.onLine) {
    const { error } = await salvaIscrizione(iscrizione);
    if (error) console.error(error);
  }
}

attivaNotifiche.addEventListener('click', async () => {
  if (CHIAVE_PUBBLICA_NOTIFICHE.startsWith('METTI_QUI')) {
    mostraMessaggio('Le notifiche non sono ancora configurate: manca la chiave pubblica (vedi README).', true);
    return;
  }
  const permesso = await Notification.requestPermission();
  if (permesso !== 'granted') {
    await aggiornaPannelloNotifiche();
    return;
  }
  try {
    const registrazione = await navigator.serviceWorker.getRegistration();
    if (!registrazione) throw new Error('il sito non è ancora pronto, ricarica la pagina e riprova');
    const iscrizione = await registrazione.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: byteDaBase64Url(CHIAVE_PUBBLICA_NOTIFICHE),
    });
    const { error } = await salvaIscrizione(iscrizione);
    if (error) {
      await iscrizione.unsubscribe();
      throw error;
    }
    mostraMessaggio('Notifiche attivate: ogni mattina alle 8 ti ricordo le cose in scadenza.');
  } catch (errore) {
    console.error(errore);
    mostraMessaggio('Non sono riuscito ad attivare le notifiche: ' + errore.message, true);
  }
  await aggiornaPannelloNotifiche();
});

provaNotifica.addEventListener('click', async () => {
  provaNotifica.disabled = true;
  const { data, error } = await db.functions.invoke('promemoria', { body: { prova: true } });
  provaNotifica.disabled = false;
  if (error) {
    console.error(error);
    mostraMessaggio('Non sono riuscito a mandare la prova: ' + error.message, true);
  } else if (!data.inviate) {
    mostraMessaggio('Il server non ha trovato questo dispositivo: disattiva e riattiva le notifiche.', true);
  } else {
    mostraMessaggio('Ti ho mandato una notifica di prova: dovrebbe arrivare tra qualche secondo.');
  }
});

disattivaNotifiche.addEventListener('click', async () => {
  const iscrizione = await iscrizioneDiQuestoDispositivo();
  if (iscrizione) {
    const { error } = await db.from('iscrizioni_notifiche').delete().eq('endpoint', iscrizione.endpoint);
    if (error) {
      mostraMessaggio('Non sono riuscito a disattivare le notifiche: ' + error.message, true);
      return;
    }
    await iscrizione.unsubscribe();
  }
  mostraMessaggio('Notifiche disattivate su questo dispositivo.');
  await aggiornaPannelloNotifiche();
});

// Tema chiaro/scuro: parte da quello del Mac e ricorda la scelta fatta col pulsante
const tema = document.getElementById('tema');
const scuroDiSistema = window.matchMedia('(prefers-color-scheme: dark)');

function applicaTema(scelto) {
  if (scelto) document.documentElement.dataset.tema = scelto;
  const scuro = scelto ? scelto === 'scuro' : scuroDiSistema.matches;
  tema.textContent = scuro ? '☀️' : '🌙';
  tema.title = scuro ? 'Passa al tema chiaro' : 'Passa al tema scuro';
}

tema.addEventListener('click', () => {
  const scuroOra = tema.textContent === '☀️';
  const nuovo = scuroOra ? 'chiaro' : 'scuro';
  try { localStorage.setItem('tema', nuovo); } catch {}
  applicaTema(nuovo);
});

// Installazione come app: Chrome su Android e computer propone l'installazione con questo evento
const installa = document.getElementById('installa');
let richiestaInstallazione = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  richiestaInstallazione = e;
  installa.hidden = false;
});

installa.addEventListener('click', async () => {
  if (!richiestaInstallazione) return;
  richiestaInstallazione.prompt();
  await richiestaInstallazione.userChoice;
  richiestaInstallazione = null;
  installa.hidden = true;
});

window.addEventListener('appinstalled', () => { installa.hidden = true; });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch((errore) => console.error(errore));
}

let temaSalvato = null;
try { temaSalvato = localStorage.getItem('tema'); } catch {}
applicaTema(temaSalvato);
aggiornaStatoRete();
