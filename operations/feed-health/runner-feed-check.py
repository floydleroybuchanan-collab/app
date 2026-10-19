"""Read-only feed checks. Credentials are environment-only; output contains no URLs."""
import os, json, time, hashlib, urllib.request, urllib.error, urllib.parse, gzip, io, tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

UA = 'TiviMate/5.1.6 (Linux; Android TV)'
MAX_BYTES = 256 * 1024 * 1024

def xml_date(value):
    try:
        value = value.strip()
        if len(value) == 14: value += ' +0000'
        return datetime.strptime(value, '%Y%m%d%H%M%S %z').timestamp()
    except (ValueError, AttributeError): return None

def inspect_file(file, kind):
    file.seek(0); now = time.time()
    if kind == 'playlist':
        first = file.readline().decode('utf-8-sig', 'replace').strip()
        if first != '#EXTM3U' and not first.startswith('#EXTM3U '):
            return {'status': 'unexpected_content', 'readable': False}
        entries = 0; ids = set(); streams = 0
        import re
        for raw in file:
            line = raw.decode('utf-8', 'replace').strip()
            if line.startswith('#EXTINF:'):
                entries += 1
                match = re.search(r'tvg-id=["\']([^"\']+)', line)
                if match: ids.add(match[1])
            elif line.startswith(('http://', 'https://')): streams += 1
        epg_urls=[]
        for match in re.finditer(r'(?:url-tvg|x-tvg-url|tvg-url)=["\']([^"\']+)', first, re.I):
            epg_urls.extend(u.strip() for u in match[1].split(',') if u.strip())
        return {'status': 'readable' if entries and streams else 'empty_playlist',
                'readable': bool(entries and streams), 'channels': entries,
                'http_stream_entries': streams, 'unique_tvg_ids': len(ids), '_ids': ids, '_epg_urls':epg_urls}
    channels = set(); programmes = current = future = expired = invalid = 0
    earliest = latest = None; root = None
    for event, element in ET.iterparse(file, events=('start', 'end')):
        if root is None:
            root = element
            if element.tag != 'tv': return {'status': 'unexpected_content', 'readable': False}
        if event != 'end': continue
        if element.tag == 'channel':
            channels.add(element.get('id', '')); element.clear(); root.clear()
        elif element.tag == 'programme':
            programmes += 1
            start, stop = xml_date(element.get('start')), xml_date(element.get('stop'))
            if start is not None: earliest = min(earliest, start) if earliest is not None else start
            if stop is not None: latest = max(latest, stop) if latest is not None else stop
            if start is None or stop is None or stop <= start: invalid += 1
            elif start <= now < stop: current += 1
            elif start > now: future += 1
            else: expired += 1
            element.clear(); root.clear()
    return {'status': 'readable', 'readable': True, 'well_formed_xml': True,
            'channels': len(channels), 'programmes': programmes, 'current_programmes': current,
            'future_programmes': future, 'expired_programmes': expired, 'missing_or_invalid_times': invalid,
            'earliest_start': datetime.fromtimestamp(earliest, timezone.utc).isoformat() if earliest else None,
            'latest_stop': datetime.fromtimestamp(latest, timezone.utc).isoformat() if latest else None, '_ids': channels}

def probe(url, kind):
    started = time.monotonic(); result = {'kind': kind}
    if not url: return {**result, 'status': 'not_configured'}
    result['source_fingerprint'] = hashlib.sha256(url.strip().encode()).hexdigest()
    try:
        request = urllib.request.Request(url.strip(), headers={'User-Agent': UA, 'Accept': '*/*', 'Accept-Encoding': 'gzip'})
        with urllib.request.urlopen(request, timeout=30) as response:
            result['http_status'] = response.status
            raw = io.BufferedReader(response)
            decoded = gzip.GzipFile(fileobj=raw) if raw.peek(2)[:2] == b'\x1f\x8b' else raw
            with tempfile.TemporaryFile() as file:
                size = 0
                while True:
                    if time.monotonic() - started > 120: raise TimeoutError()
                    chunk = decoded.read(65536)
                    if not chunk: break
                    size += len(chunk)
                    if size > MAX_BYTES: raise OverflowError()
                    file.write(chunk)
                result['decoded_bytes'] = size
                result.update(inspect_file(file, kind))
    except urllib.error.HTTPError as error:
        result.update(status='access_denied' if error.code in (401,403) else 'http_error', http_status=error.code)
        import re
        text=re.sub('<[^>]*>', ' ', error.read(16384).decode('utf-8','replace'))
        match=re.search(r'Error\s+(1\d{3})\b',text,re.I)
        result['cloudflare_error']=match[1] if match else None
        result['ip_denied']=bool(re.search(r'(?:banned|blocked) your IP|IP address.{0,30}(?:banned|blocked)',text,re.I))
        error.close()
    except ET.ParseError: result.update(status='invalid_xml', readable=False)
    except OverflowError: result['status'] = 'size_limit_exceeded'
    except TimeoutError: result['status'] = 'timeout'
    except Exception: result['status'] = 'network_or_decode_error'
    result['duration_ms'] = round((time.monotonic() - started) * 1000)
    return result

def main():
    output = {'checked_at': datetime.now(timezone.utc).isoformat(), 'vantage': 'GitHub Actions', 'sources': []}
    for label, suffix in [('primary',''),('secondary','_2')]:
        playlist = probe(os.getenv('M3U_URL'+suffix, ''), 'playlist')
        epg_url=os.getenv('EPG_URL'+suffix, '')
        epg = probe(epg_url, 'epg')
        embedded=playlist.pop('_epg_urls',[])
        alternatives=[]
        if not epg.get('readable') and epg_url.startswith('http://'):
            candidate=probe('https://'+epg_url[7:],'epg');candidate.pop('_ids',None);alternatives.append({'method':'same_host_https','result':candidate})
        known_hosts={urllib.parse.urlsplit(epg_url).hostname,urllib.parse.urlsplit(os.getenv('M3U_URL'+suffix,'')).hostname}
        for url in embedded[:2]:
            if url!=epg_url and urllib.parse.urlsplit(url).hostname in known_hosts:
                candidate=probe(url,'epg');candidate.pop('_ids',None);alternatives.append({'method':'playlist_embedded_same_host_guide','result':candidate})
        playlist_ids, epg_ids = playlist.pop('_ids', set()), epg.pop('_ids', set())
        output['sources'].append({'source': label, 'playlist': playlist, 'epg': epg,
           'matching_tvg_ids': len(playlist_ids & epg_ids) if epg.get('readable') else None, 'playlist_tvg_ids_missing_from_epg': len(playlist_ids - epg_ids) if epg.get('readable') else None,
           'embedded_guide_matches_configured':epg_url in embedded,'embedded_guide_count':len(embedded),'alternatives':alternatives,
           'playback': 'not tested; feed readability does not prove individual streams play'})
    with open('feed-health-result.json','w',encoding='utf-8') as file: json.dump(output,file,indent=2)
    print(json.dumps(output,indent=2))

if __name__ == '__main__': main()
