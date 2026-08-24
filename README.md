# Swap Duel

Eksperymentalny **second-person shooter** (proof of concept). Sterujesz swoją
postacią, ale ekran pokazuje świat **oczami przeciwnika** — żeby trafić, musisz
nauczyć się celować „odwrotnie". Prosty duel 1v1 na kwadratowej arenie z jedną
niezniszczalną skrzynią pośrodku.

Całość to pojedynczy plik `index.html` (Three.js + PeerJS z CDN). Bez instalacji,
bez serwera — gra online działa peer-to-peer przez darmowy broker PeerJS.

## Sterowanie

- **W A S D** — ruch
- **← →** — obrót w lewo / prawo
- **Spacja** — strzał (przytrzymaj = seria)
- **V** — przełączenie widoku (oczami przeciwnika ↔ własne oczy)

Bursztynowy celownik pokazuje, gdzie realnie poleci pocisk. Przeciwnika trafisz,
gdy celownik znajdzie się na środku ekranu (środek = miejsce, z którego patrzy).

## Jak grać online

1. Jedna osoba wybiera **Utwórz grę online** i dostaje 5-znakowy kod.
2. Druga osoba wybiera **Dołącz do gry** i wpisuje ten kod.
3. Po połączeniu każdy klika **Zacznij** i gracie.

Jest też tryb **Trening (bot)** do gry solo.

> Uwaga: w części sieci domowych czyste połączenie P2P (WebRTC) nie zestawi się
> bez serwera TURN. Jeśli utyka na „Łączę...", to najczęściej ten przypadek.

## Uruchomienie lokalne

Otwórz `index.html` w przeglądarce na komputerze (Chrome/Edge/Firefox).
Potrzebne jest połączenie z internetem, bo biblioteki ładują się z CDN.

## Status

Proof of concept — mechanika i tryb online do testów. Kolejne kroki: obsługa
TURN dla trudnych sieci, dopracowanie trafień i respawnów, dźwięk.

## Licencja

MIT — patrz plik `LICENSE`.
