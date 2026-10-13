import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BACKEND_URL = os.getenv('BACKEND_URL', 'http://localhost:8000').rstrip('/')
VALHALLA_URL = os.getenv('VALHALLA_URL', 'http://localhost:8002').rstrip('/')


def forwardHeaders(targetUrl):
    headers = {'Content-Type': 'application/json'}
    commandUrl = f'{BACKEND_URL}/v1/command'
    commandKey = os.getenv('COMMAND_API_KEY')
    if commandKey and (targetUrl == commandUrl or targetUrl.startswith(commandUrl + '/') or targetUrl.startswith(commandUrl + '?')):
        headers['X-Command-Key'] = commandKey
    return headers


def mapConfig():
    token = os.getenv('MAPBOX_TOKEN', '').strip()
    # The browser gets public tokens only; a secret sk. token must never reach a page.
    config = {'mapboxToken': token if token.startswith('pk.') else None, 'mapboxStyle': os.getenv('MAPBOX_STYLE', 'mapbox/standard')}
    return 'window.EVACUAID_MAP = ' + json.dumps(config) + '\n'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=Path(__file__).parent, **kwargs)

    def end_headers(self):
        if not self.path.startswith(('/api/', '/health', '/route')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def forward(self, targetUrl: str, body: bytes | None = None):
        headers = forwardHeaders(targetUrl)
        request = Request(targetUrl, data=body, headers=headers, method=self.command)
        try:
            timeout = 120 if self.path.startswith('/api/command/') and self.command == 'POST' else 15
            with urlopen(request, timeout=timeout) as response:
                payload = response.read()
                self.send_response(response.status)
        except HTTPError as error:
            payload = error.read()
            self.send_response(error.code)
        except URLError:
            service = 'Valhalla' if targetUrl.startswith(VALHALLA_URL + '/') else 'EvacuAid backend'
            payload = json.dumps({'error': f'{service} is unavailable'}).encode()
            self.send_response(503)
        except TimeoutError:
            payload = json.dumps({'detail': 'Backend request timed out. Retry the same submission to check whether it was saved.'}).encode()
            self.send_response(504)
        self.send_header('Content-Type', 'application/json')
        if self.path.startswith('/api/command/'):
            self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def externalUrl(self) -> str:
        return f'{BACKEND_URL}/v1/external-data{self.path.removeprefix("/api/external")}'

    def navigationUrl(self) -> str:
        return f'{BACKEND_URL}/v1/navigation{self.path.removeprefix("/api/navigation")}'

    def do_GET(self):
        if self.path == '/health':
            self.forward(f'{BACKEND_URL}/health')
            return
        if self.path.startswith('/api/command/'):
            self.forward(f'{BACKEND_URL}/v1/command{self.path.removeprefix("/api/command")}')
            return
        if self.path == '/command-center/config.js':
            payload = mapConfig().encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path in ('/command-center', '/command-center/') or (self.path == '/' and os.getenv('DASHBOARD_HOME') == 'true'):
            self.path = '/command-center/index.html'
        if self.path.startswith('/api/external/'):
            self.forward(self.externalUrl())
            return
        if self.path.startswith('/api/navigation/'):
            self.forward(self.navigationUrl())
            return
        super().do_GET()

    def do_DELETE(self):
        if self.path == '/api/command/mock-disasters' or self.path.startswith('/api/command/mock-disasters/'):
            self.forward(f'{BACKEND_URL}/v1/command{self.path.removeprefix("/api/command")}')
            return
        self.send_error(404)

    def do_POST(self):
        contentLength = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(contentLength)
        if self.path.startswith('/api/command/'):
            self.forward(f'{BACKEND_URL}/v1/command{self.path.removeprefix("/api/command")}', body)
            return
        if self.path == '/route':
            self.forward(f'{VALHALLA_URL}/route', body)
            return
        if self.path.startswith('/api/external/'):
            self.forward(self.externalUrl(), body)
            return
        if self.path.startswith('/api/navigation/'):
            self.forward(self.navigationUrl(), body)
            return
        self.send_error(404)

    def do_PATCH(self):
        if not self.path.startswith('/api/command/'):
            self.send_error(404)
            return
        content_length = int(self.headers.get('Content-Length', '0'))
        if content_length > 65536:
            self.send_error(413)
            return
        self.forward(f'{BACKEND_URL}/v1/command{self.path.removeprefix("/api/command")}', self.rfile.read(content_length))


if __name__ == '__main__':
    ThreadingHTTPServer((os.getenv('HOST', '127.0.0.1'), int(os.getenv('PORT', '8080'))), Handler).serve_forever()
