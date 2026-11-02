"""Crea la coppia di chiavi per le notifiche (dette "VAPID").

Uso: python3 strumenti/crea_chiavi_notifiche.py   (dalla cartella del progetto, una volta sola)

- La chiave PUBBLICA viene scritta da sola in app.js e nella funzione promemoria.
- La chiave PRIVATA viene solo mostrata qui: va copiata nei segreti di Supabase
  con il nome CHIAVE_PRIVATA_NOTIFICHE, e non va scritta da nessun'altra parte.
"""
import base64
import re
import subprocess
import sys
from pathlib import Path

CARTELLA = Path(__file__).resolve().parent.parent
SEGNAPOSTO = "METTI_QUI_LA_CHIAVE_PUBBLICA"
FILE_CON_LA_CHIAVE = [CARTELLA / "app.js", CARTELLA / "supabase" / "functions" / "promemoria" / "index.ts"]


def base64url(dati):
    return base64.urlsafe_b64encode(dati).rstrip(b"=").decode()


def byte_dopo(etichetta, testo):
    # In "openssl ec -text" i byte sono scritti in esadecimale, divisi da ":" e su più righe
    blocco = re.search(etichetta + r":\s*\n((?:\s+[0-9a-f:]+\n)+)", testo)
    return bytes.fromhex(re.sub(r"[\s:]", "", blocco.group(1)))


def main():
    for file in FILE_CON_LA_CHIAVE:
        if SEGNAPOSTO not in file.read_text():
            sys.exit(f"In {file.name} c'è già una chiave pubblica: le chiavi si creano una volta sola.\n"
                     "Se le cambi, chi ha già attivato le notifiche deve disattivarle e riattivarle.")

    pem = subprocess.run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout"],
                         capture_output=True, check=True).stdout
    testo = subprocess.run(["openssl", "ec", "-text", "-noout"], input=pem,
                           capture_output=True, check=True).stdout.decode()
    privata = byte_dopo("priv", testo)[-32:].rjust(32, b"\0")
    pubblica = byte_dopo("pub", testo)
    assert len(pubblica) == 65 and pubblica[0] == 4, "chiave pubblica inattesa"

    for file in FILE_CON_LA_CHIAVE:
        file.write_text(file.read_text().replace(SEGNAPOSTO, base64url(pubblica)))

    print("Chiave pubblica scritta in app.js e nella funzione promemoria.\n")
    print("Chiave PRIVATA (copiala nei segreti di Supabase come CHIAVE_PRIVATA_NOTIFICHE, e non darla a nessuno):\n")
    print("    " + base64url(privata) + "\n")


if __name__ == "__main__":
    main()
