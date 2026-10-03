import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=Path(__file__).parent, **kwargs)

    def forward(self, targetUrl: str, body: bytes | None = None):
        request = Request(targetUrl, data=body, headers={'Content-Type': 'application/json'}, method=self.command)
        try:
            with urlopen(request, timeout=15) as response:
                payload = response.read()
                self.send_response(response.status)
        except HTTPError as error:
            payload = error.read()
            self.send_response(error.code)
        except URLError:
            service = 'Valhalla' if 'localhost:8002' in targetUrl else 'EvacuAid backend'
            payload = json.dumps({'error': f'{service} is unavailable'}).encode()
            self.send_response(503)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def externalUrl(self) -> str:
        return f'http://localhost:8000/v1/external-data{self.path.removeprefix("/api/external")}'

    def navigationUrl(self) -> str:
        return f'http://localhost:8000/v1/navigation{self.path.removeprefix("/api/navigation")}'

    def do_GET(self):
        if self.path.startswith('/api/external/'):
            self.forward(self.externalUrl())
            return
        if self.path.startswith('/api/navigation/'):
            self.forward(self.navigationUrl())
            return
        super().do_GET()

    def do_POST(self):
        contentLength = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(contentLength)
        if self.path == '/route':
            self.forward('http://localhost:8002/route', body)
            return
        if self.path.startswith('/api/external/'):
            self.forward(self.externalUrl(), body)
            return
        if self.path.startswith('/api/navigation/'):
            self.forward(self.navigationUrl(), body)
            return
        self.send_error(404)


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8080), Handler).serve_forever()
