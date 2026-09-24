import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=Path(__file__).parent, **kwargs)

    def do_POST(self):
        if self.path != '/route':
            self.send_error(404)
            return
        contentLength = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(contentLength)
        request = Request('http://localhost:8002/route', data=body, headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urlopen(request, timeout=15) as response:
                payload = response.read()
                self.send_response(response.status)
        except HTTPError as error:
            payload = error.read()
            self.send_response(error.code)
        except URLError:
            payload = json.dumps({'error': 'Valhalla is unavailable at http://localhost:8002'}).encode()
            self.send_response(503)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8080), Handler).serve_forever()
