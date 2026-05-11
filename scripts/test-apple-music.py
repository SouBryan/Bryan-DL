"""
Fase 0 — PoC: Testa gamdl com cookies do main.py
1. Converte cookies JSON → Netscape .txt
2. Testa busca (música japonesa que não existe no Qobuz)
3. Testa obtenção de stream URL (AAC Legacy)
"""
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COOKIES_JSON = ROOT / "applemusic_auth_cookies.json"
COOKIES_TXT = ROOT / "apple_cookies_netscape.txt"

# ── 1. Converter cookies JSON → Netscape ──

def json_to_netscape(json_path: Path, txt_path: Path):
    cookies = json.loads(json_path.read_text("utf-8"))
    lines = ["# Netscape HTTP Cookie File", "# https://curl.se/docs/http-cookies.html", ""]
    
    # Mapeamento de domínios corretos para cada cookie
    domain_map = {
        "media-user-token": ".music.apple.com",
        "commerce-authorization-token": ".music.apple.com",
        "mut-refresh": ".music.apple.com",
        "myacinfo": ".apple.com",
        "aasp": ".idmsa.apple.com",
        "itspod": ".apple.com",
        "itua": ".apple.com",
        "pltvcid": ".apple.com",
        "pldfltcid": ".apple.com",
    }
    defaults_domain = ".apple.com"
    
    for name, value in cookies.items():
        domain = domain_map.get(name, defaults_domain)
        include_subdomains = "TRUE" if domain.startswith(".") else "FALSE"
        path = "/"
        secure = "TRUE"
        expiry = "0"  # session cookie
        lines.append(f"{domain}\t{include_subdomains}\t{path}\t{secure}\t{expiry}\t{name}\t{value}")
    
    txt_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[OK] Cookies convertidos: {txt_path.name} ({len(cookies)} cookies)")


# ── 2. Testar gamdl ──

async def test_gamdl():
    from gamdl.api.apple_music import AppleMusicApi

    # Testar factory method create() direto com tokens (mais limpo que arquivo)
    cookies_data = json.loads(COOKIES_JSON.read_text("utf-8"))
    media_user_token = cookies_data.get("media-user-token", "")
    
    if not media_user_token:
        print("[ERRO] media-user-token não encontrado nos cookies!")
        return False
    
    print(f"\n[INFO] media-user-token: {media_user_token[:20]}...{media_user_token[-10:]}")

    # Tentar com cookies Netscape (método principal do gamdl)
    print("\n── Testando AppleMusicApi.create_from_netscape_cookies() ──")
    try:
        api = await AppleMusicApi.create_from_netscape_cookies(
            cookies_path=str(COOKIES_TXT),
            language="en-US",
            storefront="us",
        )
        print(f"[OK] API criada com sucesso")
        print(f"  Subscription ativa: {api.active_subscription}")
        print(f"  Restrições: {api.account_restrictions}")
    except Exception as e:
        print(f"[ERRO] Falha ao criar API: {e}")
        # Tentar factory create() manual como fallback
        print("\n── Tentando AppleMusicApi.create() manual ──")
        try:
            api = await AppleMusicApi.create(
                media_user_token=media_user_token,
            )
            print(f"[OK] API criada manualmente")
            print(f"  Subscription ativa: {api.active_subscription}")
        except Exception as e2:
            print(f"[ERRO] Factory create() também falhou: {e2}")
            return False

    if not api.active_subscription:
        print("\n[AVISO] Sem subscription ativa — stream URLs não funcionarão.")
        print("  Mas vamos tentar a busca mesmo assim...\n")

    # ── 2a. Teste de busca ──
    print("\n── Teste de Busca ──")
    
    test_queries = [
        ("YOASOBI アイドル", "songs"),          # Japonesa (caso de uso principal)
        ("Ado 踊", "songs"),                     # Outra japonesa popular
        ("Rick Astley Never Gonna", "songs"),    # Controle (existe em tudo)
    ]
    
    for term, types in test_queries:
        try:
            results = await api.get_search_results(term=term, types=types, limit=3)
            songs = results.get("results", {}).get("songs", {}).get("data", [])
            print(f"\n  Busca: \"{term}\"")
            print(f"  Resultados: {len(songs)}")
            for i, song in enumerate(songs):
                attrs = song.get("attributes", {})
                print(f"    [{i+1}] {attrs.get('artistName', '?')} — {attrs.get('name', '?')}")
                print(f"        ID: {song.get('id', '?')} | Duração: {attrs.get('durationInMillis', 0)//1000}s")
                print(f"        ISRC: {attrs.get('isrc', 'N/A')}")
                if i == 0:
                    first_song_id = song.get("id")
        except Exception as e:
            print(f"\n  Busca \"{term}\": ERRO — {e}")

    # ── 2b. Teste de stream URL (AAC Legacy) ──
    if not api.active_subscription:
        print("\n[SKIP] Stream URL — sem subscription")
        return True

    print("\n── Teste de Stream URL (AAC Legacy) ──")
    try:
        from gamdl.interface.base import AppleMusicBaseInterface
        from gamdl.interface.song import AppleMusicSongInterface
        from gamdl.interface.enums import SongCodec
        from gamdl.interface.types import AppleMusicMedia

        base = await AppleMusicBaseInterface.create(apple_music_api=api)
        song_iface = AppleMusicSongInterface(
            base=base,
            codec_priority=[SongCodec.AAC_LEGACY],
        )

        # Usar o primeiro resultado da busca YOASOBI
        test_id = first_song_id if 'first_song_id' in dir() else "1624945512"
        print(f"  Testando song_id: {test_id}")
        
        media = AppleMusicMedia(media_id=str(test_id))
        
        async for m in song_iface.get_media(media):
            if m.partial:
                continue
            print(f"\n  [OK] Stream info obtido!")
            print(f"    Título: {m.tags.title}")
            print(f"    Artista: {m.tags.artist}")
            print(f"    Álbum: {m.tags.album}")
            print(f"    Codec: {m.stream_info.audio_track.codec}")
            print(f"    Formato: {m.stream_info.file_format.value}")
            print(f"    Stream URL: {m.stream_info.audio_track.stream_url[:80]}...")
            
            # Verificar se é HLS ou URL direta
            url = m.stream_info.audio_track.stream_url
            if ".m3u8" in url:
                print(f"    [INFO] Stream é HLS (m3u8) — precisará de proxy")
            else:
                print(f"    [INFO] Stream é URL direta — pode ser servida direto")
            
            if m.decryption_key and m.decryption_key.audio_track:
                print(f"    [AVISO] Precisa de decryption key! Key: {m.decryption_key.audio_track.key[:20]}...")
            else:
                print(f"    [OK] Sem DRM / decryption key necessária")
            
            break

    except Exception as e:
        print(f"  [ERRO] Stream URL: {e}")
        import traceback
        traceback.print_exc()

    return True


if __name__ == "__main__":
    print("=" * 60)
    print("  Fase 0 — PoC Apple Music via gamdl")
    print("=" * 60)
    
    # Converter cookies
    if not COOKIES_JSON.exists():
        print(f"[ERRO] {COOKIES_JSON} não encontrado. Rode main.py primeiro.")
        sys.exit(1)
    
    json_to_netscape(COOKIES_JSON, COOKIES_TXT)
    
    # Rodar testes
    success = asyncio.run(test_gamdl())
    
    print("\n" + "=" * 60)
    if success:
        print("  Fase 0 concluída — verifique os resultados acima")
    else:
        print("  Fase 0 FALHOU — verifique os erros acima")
    print("=" * 60)
