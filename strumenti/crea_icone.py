"""Disegna le icone dell'app (quadrato viola con una spunta bianca) senza librerie esterne.

Uso: python3 strumenti/crea_icone.py   (dalla cartella del progetto)
"""
import math
import struct
import zlib
from pathlib import Path

CARTELLA = Path(__file__).resolve().parent.parent / "icone"

COLORE_ALTO = (124, 124, 245)   # viola chiaro, in alto a sinistra
COLORE_BASSO = (79, 79, 207)    # viola scuro, in basso a destra
SPUNTA = [(0.29, 0.52), (0.44, 0.67), (0.72, 0.36)]  # punti della spunta, da 0 a 1
SPESSORE = 0.09


def distanza_segmento(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def distanza_rettangolo_arrotondato(px, py, lato, raggio):
    # Distanza con segno dal bordo di un quadrato con angoli arrotondati (negativa = dentro)
    meta = lato / 2
    qx = abs(px - meta) - (meta - raggio)
    qy = abs(py - meta) - (meta - raggio)
    fuori = math.hypot(max(qx, 0), max(qy, 0))
    return fuori + min(max(qx, qy), 0) - raggio


def copertura(distanza):
    # Bordo sfumato di un pixel per evitare la scalettatura
    return max(0.0, min(1.0, 0.5 - distanza))


def disegna(lato, arrotondata, scala_spunta=1.0):
    raggio = lato * 0.22 if arrotondata else 0
    punti = [((0.5 + (x - 0.5) * scala_spunta) * lato, (0.5 + (y - 0.5) * scala_spunta) * lato) for x, y in SPUNTA]
    meta_spessore = SPESSORE * scala_spunta * lato / 2
    righe = []
    for y in range(lato):
        riga = bytearray([0])  # filtro PNG "nessuno"
        for x in range(lato):
            cx, cy = x + 0.5, y + 0.5
            alfa = copertura(distanza_rettangolo_arrotondato(cx, cy, lato, raggio)) if arrotondata else 1.0
            t = (cx + cy) / (2 * lato)
            colore = [a + (b - a) * t for a, b in zip(COLORE_ALTO, COLORE_BASSO)]
            d = min(distanza_segmento(cx, cy, *punti[i], *punti[i + 1]) for i in range(len(punti) - 1))
            bianco = copertura(d - meta_spessore)
            colore = [c + (255 - c) * bianco for c in colore]
            riga += bytes([round(colore[0]), round(colore[1]), round(colore[2]), round(alfa * 255)])
        righe.append(bytes(riga))
    return righe


def salva_png(percorso, lato, righe):
    def blocco(tipo, dati):
        return struct.pack(">I", len(dati)) + tipo + dati + struct.pack(">I", zlib.crc32(tipo + dati) & 0xFFFFFFFF)

    intestazione = struct.pack(">IIBBBBB", lato, lato, 8, 6, 0, 0, 0)  # RGBA a 8 bit
    dati = zlib.compress(b"".join(righe), 9)
    percorso.write_bytes(b"\x89PNG\r\n\x1a\n" + blocco(b"IHDR", intestazione) + blocco(b"IDAT", dati) + blocco(b"IEND", b""))


if __name__ == "__main__":
    CARTELLA.mkdir(exist_ok=True)
    icone = {
        "icona-192.png": (192, True, 1.0),
        "icona-512.png": (512, True, 1.0),
        # Android ritaglia questa icona in forme diverse: spunta più piccola e sfondo pieno
        "icona-maskable-512.png": (512, False, 0.8),
        # iPhone arrotonda da solo gli angoli
        "apple-touch-icon.png": (180, False, 0.9),
    }
    for nome, (lato, arrotondata, scala) in icone.items():
        salva_png(CARTELLA / nome, lato, disegna(lato, arrotondata, scala))
        print("creata", nome)
