// Funzione "promemoria" di Supabase: manda le notifiche delle scadenze ai telefoni.
// Va incollata in Supabase, Edge Functions (vedi README).
//
// Viene chiamata in due modi:
// - dall'orologio del database (notifiche.sql), ogni mattina: a chi ha cose in ritardo, di oggi o di domani;
// - dal pulsante "Manda una prova" della pagina: solo ai dispositivi di chi l'ha premuto.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';

// La chiave pubblica si può mostrare a tutti; quella privata è un segreto salvato in Supabase
const CHIAVE_PUBBLICA = 'BCwbhMQqxMakW3Ejxu4-_Sc-hn8maqlxTEk1ppgRRoVcpdr2RY4kyiXcokNEmfAbbXEMJQdW14aN8OopviQFNCM';
const SITO = 'https://gfabozzo.github.io/lista-cose-da-fare/';
const ORA_DEL_PROMEMORIA = 8;

// Supabase dà da solo alla funzione l'indirizzo e la chiave di servizio, che può leggere tutte le liste
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

// La pagina sta su un altro sito (GitHub Pages): queste intestazioni le permettono di chiamare la funzione
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Iscrizione = { endpoint: string; user_id: string; p256dh: string; auth: string };
type Voce = { testo: string; scadenza: string };

function rispondi(dati: unknown, stato = 200) {
  return new Response(JSON.stringify(dati), { status: stato, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Data come "2026-11-02" e ora, in Italia
function giornoInItalia(spostamentoGiorni = 0) {
  const quando = new Date(Date.now() + spostamentoGiorni * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(quando);
}

function oraInItalia() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}

// Le cose non fatte, in ritardo o che scadono entro domani, in tutte le liste di una persona
async function scadenzeDi(userId: string): Promise<Voce[]> {
  const { data: membri, error } = await db.from('membri').select('lista_id').eq('user_id', userId);
  if (error) throw error;
  if (!membri.length) return [];
  const { data: voci, error: errore } = await db.from('voci')
    .select('testo, scadenza')
    .in('lista_id', membri.map((m) => m.lista_id))
    .eq('fatto', false)
    .lte('scadenza', giornoInItalia(1))
    .order('scadenza');
  if (errore) throw errore;
  return voci;
}

// Il testo della notifica, diviso come il riquadro in cima alla pagina
function componi(voci: Voce[]) {
  const oggi = giornoInItalia();
  const gruppi = [
    { titolo: '⚠️ In ritardo', voci: voci.filter((v) => v.scadenza < oggi) },
    { titolo: '⏰ Oggi', voci: voci.filter((v) => v.scadenza === oggi) },
    { titolo: '📅 Domani', voci: voci.filter((v) => v.scadenza > oggi) },
  ];
  return {
    title: voci.length === 1 ? 'Cose da fare: 1 promemoria' : `Cose da fare: ${voci.length} promemoria`,
    body: gruppi.filter((g) => g.voci.length).map((g) => g.titolo + ': ' + g.voci.map((v) => v.testo).join(', ')).join('\n'),
  };
}

async function invia(iscrizione: Iscrizione, messaggio: { title: string; body: string }) {
  try {
    await webpush.sendNotification(
      { endpoint: iscrizione.endpoint, keys: { p256dh: iscrizione.p256dh, auth: iscrizione.auth } },
      JSON.stringify(messaggio),
      { TTL: 12 * 60 * 60 },
    );
    return true;
  } catch (errore) {
    // 404 o 410: il dispositivo ha tolto il permesso o l'app è stata disinstallata
    if (errore.statusCode === 404 || errore.statusCode === 410) {
      await db.from('iscrizioni_notifiche').delete().eq('endpoint', iscrizione.endpoint);
    } else {
      console.error(errore);
    }
    return false;
  }
}

// Il pulsante "Manda una prova": solo per chi ha fatto l'accesso, solo ai suoi dispositivi
async function prova(richiesta: Request) {
  const token = richiesta.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data } = await db.auth.getUser(token);
  if (!data.user) return rispondi({ errore: 'Devi fare l\'accesso' }, 401);

  const { data: iscrizioni, error } = await db.from('iscrizioni_notifiche').select('*').eq('user_id', data.user.id);
  if (error) throw error;
  const voci = await scadenzeDi(data.user.id);
  const messaggio = voci.length ? componi(voci) : {
    title: 'Cose da fare',
    body: `Le notifiche funzionano! Ogni mattina alle ${ORA_DEL_PROMEMORIA} ti ricordo le cose in scadenza.`,
  };
  let inviate = 0;
  for (const iscrizione of iscrizioni) if (await invia(iscrizione, messaggio)) inviate++;
  return rispondi({ inviate });
}

// L'orologio del mattino: a ogni persona una notifica con le sue scadenze, al massimo una al giorno
async function promemoriaDelMattino() {
  if (oraInItalia() !== ORA_DEL_PROMEMORIA) return rispondi({ saltato: `in Italia non sono le ${ORA_DEL_PROMEMORIA}` });
  const oggi = giornoInItalia();
  const { data: iscrizioni, error } = await db.from('iscrizioni_notifiche')
    .select('*')
    .or(`ultimo_invio.is.null,ultimo_invio.lt.${oggi}`);
  if (error) throw error;

  const perPersona = new Map<string, Iscrizione[]>();
  for (const i of iscrizioni) perPersona.set(i.user_id, [...(perPersona.get(i.user_id) ?? []), i]);

  let inviate = 0;
  for (const [userId, dispositivi] of perPersona) {
    // Segna subito il giorno, così una seconda chiamata non manda un doppione
    await db.from('iscrizioni_notifiche').update({ ultimo_invio: oggi }).in('endpoint', dispositivi.map((d) => d.endpoint));
    const voci = await scadenzeDi(userId);
    if (!voci.length) continue;
    const messaggio = componi(voci);
    for (const dispositivo of dispositivi) if (await invia(dispositivo, messaggio)) inviate++;
  }
  return rispondi({ persone: perPersona.size, inviate });
}

Deno.serve(async (richiesta) => {
  if (richiesta.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const chiavePrivata = Deno.env.get('CHIAVE_PRIVATA_NOTIFICHE');
    if (!chiavePrivata) throw new Error('Manca il segreto CHIAVE_PRIVATA_NOTIFICHE in Supabase');
    webpush.setVapidDetails(SITO, CHIAVE_PUBBLICA, chiavePrivata);
    const corpo = await richiesta.json().catch(() => ({}));
    return corpo.prova ? await prova(richiesta) : await promemoriaDelMattino();
  } catch (errore) {
    console.error(errore);
    return rispondi({ errore: errore.message ?? String(errore) }, 500);
  }
});
